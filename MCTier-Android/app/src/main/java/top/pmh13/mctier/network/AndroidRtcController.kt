package top.pmh13.mctier.network

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.media.MediaRecorder
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import org.webrtc.AudioSource
import org.webrtc.AudioTrack
import org.webrtc.DataChannel
import org.webrtc.RtpTransceiver
import java.nio.ByteBuffer
import org.webrtc.audio.JavaAudioDeviceModule
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.MediaStreamTrack
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RtpReceiver
import org.webrtc.SessionDescription
import top.pmh13.mctier.data.IcePayload
import top.pmh13.mctier.data.SdpPayload
import top.pmh13.mctier.data.SignalingEnvelope
import top.pmh13.mctier.audio.LocalVqePcmProcessor

/**
 * Android 语音控制器（WebRTC 网状连接）
 *
 * 与桌面端互通约定：
 * - 发起规则：playerId 字典序较大的一方主动创建 offer（避免双向 offer 撞车）
 * - 信令字段：offer/answer 走 {offer|answer:{type,sdp}}，ice 走 {candidate:{candidate,sdpMLineIndex,sdpMid}}
 * - 始终携带音频收发线（即使麦克风关闭也能接收他人语音）
 */
class AndroidRtcController(private val context: Context) {
    private var factory: PeerConnectionFactory? = null
    private var audioSource: AudioSource? = null
    private var localAudioTrack: AudioTrack? = null
    private var localPlayerId: String = ""
    private var sendSignal: ((SignalingEnvelope) -> Unit)? = null
    private val peerConnections = linkedMapOf<String, PeerConnection>()
    private val remoteAudioTracks = linkedMapOf<String, AudioTrack>()
    private val pendingIceCandidates = BoundedIceCache<String, IceCandidate>(
        maxEntries = MAX_PENDING_ICE_ENTRIES,
        maxBytes = MAX_PENDING_ICE_BYTES,
        maxEntriesPerPeer = MAX_PENDING_ICE_PER_PEER,
        ttlMillis = PENDING_ICE_TTL_MILLIS,
        peerOf = { it },
        bytesOf = ::iceCandidateBytes,
    )
    private val playerVolumes = linkedMapOf<String, Double>() // 0.0 ~ 1.0
    private var globalMuted = false
    private val voiceRecordingLeases = mutableSetOf<Any>()
    @Volatile private var voiceRecordingSuppressed = false

    @Synchronized
    fun suspendLobbyVoice(): () -> Unit {
        val lease = Any()
        voiceRecordingLeases.add(lease)
        voiceRecordingSuppressed = true
        localAudioTrack?.setEnabled(false)
        return { releaseLobbyVoice(lease) }
    }

    @Synchronized
    private fun releaseLobbyVoice(lease: Any) {
        voiceRecordingLeases.remove(lease)
        voiceRecordingSuppressed = voiceRecordingLeases.isNotEmpty()
        localAudioTrack?.setEnabled(_micEnabled.value && !voiceRecordingSuppressed)
    }
    // 通话中途连接抖动后的 ICE 自动重启任务（按 peer 防抖，避免重复重启）
    private val iceRestartJobs = ConcurrentHashMap<String, Job>()

    private val _micEnabled = MutableStateFlow(false)
    val micEnabled: StateFlow<Boolean> = _micEnabled

    // 说话检测：根据各 peer 的音频电平判断谁在说话
    // All peer state and native callbacks are serialized on Main; never block a native callback.
    private val rtcScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val knownPeers = mutableSetOf<String>()
    private val peerTokens = mutableMapOf<String, Any>()
    private val peerStartedAt = mutableMapOf<String, Long>()
    private val health = mutableMapOf<String, VoiceHealth>()
    private val healthChannels = mutableMapOf<String, DataChannel>()
    private val remotePackets = mutableMapOf<String, Pair<Long, Long>>()
    private val recoveryJobs = mutableMapOf<String, Job>()
    private val recoveryAt = mutableMapOf<String, Long>()
    private val lastHealthAt = mutableMapOf<String, Long>()
    private val makingOffers = mutableSetOf<String>()
    private val audioLevels = ConcurrentHashMap<String, Double>()
    private val _speakingPlayers = MutableStateFlow<Set<String>>(emptySet())
    val speakingPlayers: StateFlow<Set<String>> = _speakingPlayers
    private var statsJob: Job? = null
    private var audioRouteJob: Job? = null
    private var audioDeviceCallback: AudioDeviceCallback? = null
    private val lastAudioStatsLogAt = ConcurrentHashMap<String, Long>()

    private fun registerAudioDeviceCallback() {
        if (audioDeviceCallback != null) return
        val callback = object : AudioDeviceCallback() {
            override fun onAudioDevicesAdded(addedDevices: Array<out AudioDeviceInfo>) = scheduleAudioRouting()
            override fun onAudioDevicesRemoved(removedDevices: Array<out AudioDeviceInfo>) = scheduleAudioRouting()
        }
        val am = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        am.registerAudioDeviceCallback(callback, null)
        audioDeviceCallback = callback
    }

    private fun scheduleAudioRouting() {
        audioRouteJob?.cancel()
        audioRouteJob = rtcScope.launch {
            // 蓝牙在 A2DP 与 SCO 间切换时会连续上报移除/新增，等待设备列表稳定后再选路由。
            delay(600)
            routeAudio()
        }
    }

    private fun startStatsLoop() {
        if (statsJob != null) return
        statsJob = rtcScope.launch {
            while (isActive) {
                delay(400)
                val tick = android.os.SystemClock.elapsedRealtime()
                knownPeers.toList().forEach { id ->
                    val pc = peerConnections[id]
                    val started = peerStartedAt.getOrPut(id) { tick }
                    if (pc?.connectionState() == PeerConnection.PeerConnectionState.CONNECTED) {
                        peerStartedAt[id] = tick
                    } else if (tick - started >= 30_000L) {
                        recoverPeer(id, "connection-timeout")
                    }
                }
                val current = peerConnections.toMap()
                current.forEach { (id, pc) ->
                    runCatching {
                        pc.getStats { report ->
                          rtcScope.launch {
                            if (peerConnections[id] !== pc) return@launch
                            try {
                            var level = 0.0
                            var inboundBytes = 0L
                            var inboundPackets = 0L
                            var outboundBytes = 0L
                            var outboundPackets = 0L
                            var inboundLost = 0L
                            var remoteSent: Long? = null
                            report.statsMap.values.forEach stats@{ s ->
                                if ((s.members["kind"] ?: s.members["mediaType"]) != "audio") return@stats
                                if (s.type == "inbound-rtp") {
                                    (s.members["audioLevel"] as? Number)?.let { level = maxOf(level, it.toDouble()) }
                                    (s.members["bytesReceived"] as? Number)?.let { inboundBytes = maxOf(inboundBytes, it.toLong()) }
                                    (s.members["packetsReceived"] as? Number)?.let { inboundPackets = maxOf(inboundPackets, it.toLong()) }
                                    (s.members["packetsLost"] as? Number)?.let { inboundLost = maxOf(inboundLost, it.toLong()) }
                                } else if (s.type == "outbound-rtp") {
                                    (s.members["bytesSent"] as? Number)?.let { outboundBytes = maxOf(outboundBytes, it.toLong()) }
                                    (s.members["packetsSent"] as? Number)?.let { outboundPackets = maxOf(outboundPackets, it.toLong()) }
                                } else if (s.type == "remote-outbound-rtp") {
                                    (s.members["packetsSent"] as? Number)?.let { remoteSent = (remoteSent ?: 0L) + it.toLong() }
                                }
                            }
                            audioLevels[id] = level
                            val now = android.os.SystemClock.elapsedRealtime()
                            if (now - (lastHealthAt[id] ?: 0L) >= 2000L && pc.connectionState() == PeerConnection.PeerConnectionState.CONNECTED) {
                                lastHealthAt[id] = now
                                healthChannels[id]?.let { channel ->
                                    if (channel.state() == DataChannel.State.OPEN && channel.bufferedAmount() < 1024) {
                                        val data = "{\"v\":1,\"packets\":$outboundPackets}".toByteArray(Charsets.UTF_8)
                                        channel.send(DataChannel.Buffer(ByteBuffer.wrap(data), false))
                                    }
                                }
                                remotePackets[id]?.takeIf { now - it.second < 6000L }?.let { remoteSent = it.first }
                                val transceiver = audioTransceiver(pc)
                                val receiver = transceiver?.receiver?.track() as? AudioTrack
                                val senderHealthy = transceiver == null || transceiver.sender.track()?.id() == localAudioTrack?.id() ||
                                    transceiver.sender.setTrack(localAudioTrack, false)
                                if (receiver?.state() == MediaStreamTrack.State.LIVE) {
                                    remoteAudioTracks[id] = receiver
                                    applyRemoteVolume(id, receiver)
                                }
                                val broken = !senderHealthy || transceiver == null || receiver?.state() == MediaStreamTrack.State.ENDED ||
                                    (pc.signalingState() == PeerConnection.SignalingState.STABLE && transceiver.currentDirection != RtpTransceiver.RtpTransceiverDirection.SEND_RECV)
                                health.getOrPut(id) { VoiceHealth() }.observe(now, inboundPackets, remoteSent, broken)?.let { recoverPeer(id, it) }
                            }
                            val last = lastAudioStatsLogAt[id] ?: 0L
                            if (now - last >= 5_000L) {
                                lastAudioStatsLogAt[id] = now
                                Log.i(TAG, "RTP audio stats[$id]: inboundBytes=$inboundBytes inboundPackets=$inboundPackets inboundLost=$inboundLost outboundBytes=$outboundBytes outboundPackets=$outboundPackets audioLevel=$level")
                            }
                            } catch (error: Exception) { Log.w(TAG, "语音统计检查失败[$id]", error) }
                          }
                        }
                    }
                }
                // 清理已离开的 peer
                audioLevels.keys.retainAll(current.keys)
                lastAudioStatsLogAt.keys.retainAll(current.keys)
                _speakingPlayers.value = audioLevels.filterValues { it > 0.02 }.keys.toSet()
            }
        }
    }

    private var speakerphoneOn = true
    private var legacyBluetoothScoRequested = false
    private var communicationDeviceRequested = false

    /**
     * 通话音频路由：保持通话模式（回声消除需要），优先沿用已连接的蓝牙、
     * 有线或 USB 音频设备；只有没有外接设备时才使用扬声器/听筒偏好。
     */
    private fun routeAudio() {
        runCatching {
            val am = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
            if (!_micEnabled.value) {
                restoreMediaAudio(am)
                return@runCatching
            }
            // 只有真正开麦时才进入通话模式。未开麦时保持 A2DP 媒体路由，避免组网后
            // 抢占用户正在播放的音乐、视频和系统提示音。
            if (am.mode != AudioManager.MODE_IN_COMMUNICATION) am.mode = AudioManager.MODE_IN_COMMUNICATION
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) {
                val devices = am.availableCommunicationDevices
                val targetType = AudioRoutePolicy.preferredDeviceType(
                    devices.mapTo(mutableSetOf()) { it.type },
                    am.communicationDevice?.type,
                    speakerphoneOn,
                )
                if (targetType != null && am.communicationDevice?.type != targetType) {
                    devices.firstOrNull { it.type == targetType }?.let { device ->
                        if (!am.setCommunicationDevice(device)) {
                            Log.w(TAG, "无法切换通信音频设备 type=$targetType")
                        } else {
                            communicationDeviceRequested = true
                        }
                    }
                }
            } else {
                routeLegacyAudio(am)
            }
        }.onFailure { Log.w(TAG, "更新通信音频路由失败", it) }
    }

    @Suppress("DEPRECATION")
    private fun routeLegacyAudio(am: AudioManager) {
        // 部分厂商系统在 A2DP 切到 SCO 后会暂时从 getDevices() 隐藏蓝牙设备。
        // 已建立的 SCO 应保持不动，否则设备回调会造成 start/stop 循环和周期性静音。
        if (legacyBluetoothScoRequested && am.isBluetoothScoOn) {
            if (am.isSpeakerphoneOn) am.isSpeakerphoneOn = false
            return
        }
        val outputTypes = am.getDevices(AudioManager.GET_DEVICES_OUTPUTS).mapTo(mutableSetOf()) { it.type }
        val targetType = AudioRoutePolicy.preferredDeviceType(outputTypes, null, speakerphoneOn)
        val useBluetooth = targetType != null && AudioRoutePolicy.isBluetooth(targetType)
        if (useBluetooth) {
            if (!legacyBluetoothScoRequested) {
                am.startBluetoothSco()
                legacyBluetoothScoRequested = true
            }
            if (!am.isBluetoothScoOn) am.isBluetoothScoOn = true
            if (am.isSpeakerphoneOn) am.isSpeakerphoneOn = false
            return
        }
        stopLegacyBluetoothSco(am)
        val useExternalDevice = targetType != null && AudioRoutePolicy.isExternal(targetType)
        val routeToSpeaker = !useExternalDevice && speakerphoneOn
        if (am.isSpeakerphoneOn != routeToSpeaker) am.isSpeakerphoneOn = routeToSpeaker
    }

    @Suppress("DEPRECATION")
    private fun stopLegacyBluetoothSco(am: AudioManager) {
        if (!legacyBluetoothScoRequested) return
        runCatching { am.stopBluetoothSco() }
        if (am.isBluetoothScoOn) am.isBluetoothScoOn = false
        legacyBluetoothScoRequested = false
    }

    @Suppress("DEPRECATION")
    private fun restoreMediaAudio(am: AudioManager) {
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) {
            if (communicationDeviceRequested) runCatching { am.clearCommunicationDevice() }
            communicationDeviceRequested = false
        } else {
            stopLegacyBluetoothSco(am)
            if (am.isSpeakerphoneOn) am.isSpeakerphoneOn = false
        }
        if (am.mode != AudioManager.MODE_NORMAL) am.mode = AudioManager.MODE_NORMAL
    }

    /** 切换扬声器外放 / 听筒 */
    fun setSpeakerphone(on: Boolean) {
        speakerphoneOn = on
        resetAudioRouting()
    }

    private fun resetAudioRouting() {
        routeAudio()
        // WebRTC 音轨启动会异步初始化 AudioTrack；只在状态变化后补一次校正，不能周期轮询。
        scheduleAudioRouting()
    }

    /** 离开大厅/结束通话时恢复普通音频模式，避免长期占用通话模式影响系统其它音频 */
    fun restoreNormalAudio() {
        runCatching {
            val am = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
            restoreMediaAudio(am)
        }
    }

    fun initialize(playerId: String, signalSender: (SignalingEnvelope) -> Unit) {
        localPlayerId = playerId
        sendSignal = signalSender
        if (factory == null) {
            PeerConnectionFactory.initialize(
                PeerConnectionFactory.InitializationOptions.builder(context)
                    .setEnableInternalTracer(false)
                    // 关键修复（Chromium webrtc#7798）：安卓在 VPN(TUN) 下，按接口 IP 绑定 socket
                    // 会路由失败，导致虚拟局域网内 host 候选无法连通；按接口名绑定(SO_BINDTODEVICE)
                    // 才能让 UDP 正确走 EasyTier 隧道，从而语音/屏幕共享能 P2P 直连
                    .setFieldTrials("WebRTC-BindUsingInterfaceName/Enabled/")
                    .createInitializationOptions(),
            )
            val options = PeerConnectionFactory.Options().apply {
                // 不忽略任何网卡（含 VPN/TUN/loopback），保证采集到虚拟网卡候选
                networkIgnoreMask = 0
            }
            LocalVqePcmProcessor.init(context)
            // 显式配置音频设备模块：必须用语音通话采集 + 通话模式，才能真正启用硬件回声消除/降噪，
            // 否则会出现严重声学回声(对方扬声器→对方麦克风→无限循环啸叫)与嘈杂底噪。
            val adm = JavaAudioDeviceModule.builder(context)
                .setAudioSource(MediaRecorder.AudioSource.VOICE_COMMUNICATION)
                .setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build(),
                )
                .setUseHardwareAcousticEchoCanceler(true)
                .setUseHardwareNoiseSuppressor(true)
                // 不可开启低延迟通道：低延迟(FAST)路径会绕过系统 AEC/NS，导致回声
                .setUseLowLatency(false)
                .setPlaybackSamplesReadyCallback { samples ->
                    LocalVqePcmProcessor.onPlaybackSamplesReady(samples)
                }
                // 变声器：在录音 PCM 进入 WebRTC 前原地处理
                .setAudioBufferCallback { buffer, audioFormat, channelCount, sampleRate, bytesRead, captureTimestampNs ->
                    runCatching { VoiceProcessor.process(audioFormat, channelCount, sampleRate, buffer, bytesRead) }
                    runCatching { LocalVqePcmProcessor.processCapture(buffer, audioFormat, channelCount, sampleRate, bytesRead) }
                    // Defense in depth: no captured PCM can leave through WebRTC
                    // while a chat voice recording owns the microphone.
                    if (voiceRecordingSuppressed) {
                        val output = buffer.duplicate()
                        for (index in 0 until minOf(bytesRead, output.remaining())) output.put(index, 0.toByte())
                    }
                    captureTimestampNs
                }
                .createAudioDeviceModule()
            factory = PeerConnectionFactory.builder()
                .setOptions(options)
                .setAudioDeviceModule(adm)
                .createPeerConnectionFactory()
            adm.setMicrophoneMute(false)
        }
        // 未开麦时保持系统媒体路由；开麦后才进入通话模式以启用硬件回声消除/降噪。
        startStatsLoop()
        registerAudioDeviceCallback()
        // 始终创建本地音频轨（默认禁用），保证连接含音频 m-line，可双向收发
        if (localAudioTrack == null) {
            val source = factory?.createAudioSource(MediaConstraints())
            audioSource = source
            localAudioTrack = factory?.createAudioTrack("mctier-audio-$localPlayerId", source).also {
                it?.setEnabled(false)
            }
        }
        resetAudioRouting()
    }

    @Synchronized
    fun setMicEnabled(enabled: Boolean) {
        _micEnabled.value = enabled
        localAudioTrack?.setEnabled(enabled && !voiceRecordingSuppressed)
        // 开麦时进入通话模式(回声消除/合适增益)；关麦时回到普通模式，避免压低提示音音量
        resetAudioRouting()
        sendSignal?.invoke(SignalingEnvelope(type = "status-update", clientId = localPlayerId, micEnabled = enabled))
    }

    /** 全局静音：禁用/启用所有远端音频 */
    fun setGlobalMute(muted: Boolean) {
        globalMuted = muted
        remoteAudioTracks.forEach { (id, track) -> applyRemoteVolume(id, track) }
    }

    /** 设置某个玩家的音量（0.0~1.0） */
    fun setPlayerVolume(playerId: String, volume: Double) {
        playerVolumes[playerId] = volume.coerceIn(0.0, 1.0)
        remoteAudioTracks[playerId]?.let { applyRemoteVolume(playerId, it) }
    }

    private fun applyRemoteVolume(playerId: String, track: AudioTrack) {
        val vol = if (globalMuted) 0.0 else (playerVolumes[playerId] ?: 0.5)
        // WebRTC Android 音量范围 0~10
        runCatching { track.setVolume(vol * 10.0) }
        track.setEnabled(vol > 0.0)
    }

    /**
     * 根据发起规则与某个远端玩家建立连接（仅当本地 ID 字典序较大时主动 offer）
     */
    fun connectToPlayer(remotePlayerId: String) {
        if (remotePlayerId == localPlayerId) return
        knownPeers.add(remotePlayerId)
        peerStartedAt.putIfAbsent(remotePlayerId, android.os.SystemClock.elapsedRealtime())
        peerConnections[remotePlayerId]?.let { existing ->
            val state = runCatching { existing.connectionState() }.getOrNull()
            if (state == PeerConnection.PeerConnectionState.CONNECTED ||
                state == PeerConnection.PeerConnectionState.CONNECTING
            ) return
            closePeer(remotePlayerId)
        }
        if (localPlayerId > remotePlayerId) {
            forceOffer(remotePlayerId)
        }
        // 否则等待对方发起 offer
    }

    fun connectToPlayers(remoteIds: List<String>) {
        remoteIds.forEach { connectToPlayer(it) }
    }

    /**
     * 语音重连：只重建与指定玩家的语音链路，不影响大厅与其他人的语音。
     *
     * 用于「联机与信令都正常，但听不到某一个人说话且长时间不恢复」的情况。
     * 与 [connectToPlayer] 的区别：
     * - 先销毁本地旧 PeerConnection（不等自动重连）；
     * - 无视「ID 字典序较大者才发起」的规则，由点击方强制发起 Offer，
     *   保证点击的人一定能把连接重新建起来。
     *
     * 通知、延迟和冲突仲裁都由控制器统一管理。
     */
    fun reconnectPeer(remotePlayerId: String) {
        recoverPeer(remotePlayerId, "manual", manual = true)
    }

    private fun recoverPeer(id: String, reason: String, manual: Boolean = false) {
        if (id !in knownPeers || id == localPlayerId || recoveryJobs[id]?.isActive == true) return
        val now = android.os.SystemClock.elapsedRealtime()
        if (!manual && now - (recoveryAt[id] ?: -30_000L) < 30_000L) return
        recoveryAt[id] = now
        Log.w(TAG, "恢复语音[$id]: $reason")
        recoveryJobs[id] = rtcScope.launch {
            sendSignal?.invoke(SignalingEnvelope(type = "voice-reconnect", from = localPlayerId, to = id))
            delay(300)
            if (id !in knownPeers) return@launch
            closePeer(id)
            forceOffer(id)
            delay(3000)
        }
    }

    /** 强制向指定玩家发起 Offer（不受字典序限制，供语音重连使用） */
    private fun forceOffer(remotePlayerId: String) {
        val pc = ensurePeer(remotePlayerId) ?: return
        if (pc.signalingState() != PeerConnection.SignalingState.STABLE || !makingOffers.add(remotePlayerId)) return
        pc.createOffer(sdpObserver(remotePlayerId, pc, created = { desc ->
            setLocalOfferAndSend(remotePlayerId, pc, desc)
        }), MediaConstraints())
    }

    fun ensurePeer(remotePlayerId: String): PeerConnection? {
        peerConnections[remotePlayerId]?.let { return it }
        val token = Any()
        peerTokens[remotePlayerId] = token
        fun dispatch(action: () -> Unit) {
            rtcScope.launch {
                if (peerTokens[remotePlayerId] === token) runCatching(action).onFailure {
                    Log.w(TAG, "语音回调失败[$remotePlayerId]", it)
                }
            }
        }
        // 同一 EasyTier 虚拟子网内靠 host 候选即可直连；仅保留可达的国内 STUN 兜底，
        // 移除被墙的 Google STUN（否则每次 ICE 收集都要等它超时，拖慢语音建立/重连）
        val iceServers = listOf(
            PeerConnection.IceServer.builder("stun:stun.qq.com:3478").createIceServer(),
            PeerConnection.IceServer.builder("stun:stun.miwifi.com:3478").createIceServer(),
        )
        val connection = factory?.createPeerConnection(
            PeerConnection.RTCConfiguration(iceServers).apply {
                bundlePolicy = PeerConnection.BundlePolicy.MAXBUNDLE
                rtcpMuxPolicy = PeerConnection.RtcpMuxPolicy.REQUIRE
                sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
                continualGatheringPolicy = PeerConnection.ContinualGatheringPolicy.GATHER_CONTINUALLY
            },
            object : PeerConnection.Observer {
                override fun onIceCandidate(candidate: IceCandidate) {
                  dispatch {
                    Log.i(TAG, "本地 ICE 候选[$remotePlayerId]: ${candidate.sdp}")
                    sendSignal?.invoke(
                        SignalingEnvelope(
                            type = "ice-candidate",
                            from = localPlayerId,
                            to = remotePlayerId,
                            candidate = IcePayload(candidate.sdp, candidate.sdpMLineIndex, candidate.sdpMid),
                        ),
                    )
                  }
                }

                override fun onSignalingChange(newState: PeerConnection.SignalingState) = Unit
                override fun onIceConnectionChange(newState: PeerConnection.IceConnectionState) {
                  dispatch {
                    Log.i(TAG, "ICE 连接状态[$remotePlayerId]: $newState")
                    when (newState) {
                        // EasyTier 成员退出时可能短暂重算虚拟路由，多个仍在线连接会同时进入
                        // DISCONNECTED/FAILED。统一留出自愈窗口，避免立即让所有 peer 同时重协商。
                        PeerConnection.IceConnectionState.DISCONNECTED -> scheduleIceRestart(remotePlayerId, 6000)
                        PeerConnection.IceConnectionState.FAILED -> scheduleIceRestart(remotePlayerId, 6000)
                        // 已恢复连接：取消尚未执行的重启任务
                        PeerConnection.IceConnectionState.CONNECTED,
                        PeerConnection.IceConnectionState.COMPLETED -> iceRestartJobs.remove(remotePlayerId)?.cancel()
                        else -> Unit
                    }
                  }
                }
                override fun onIceConnectionReceivingChange(receiving: Boolean) = Unit
                override fun onIceGatheringChange(newState: PeerConnection.IceGatheringState) {
                    Log.i(TAG, "ICE 收集状态[$remotePlayerId]: $newState")
                }
                override fun onConnectionChange(newState: PeerConnection.PeerConnectionState) {
                  dispatch {
                    Log.i(TAG, "PeerConnection 状态[$remotePlayerId]: $newState")
                    when (newState) {
                        PeerConnection.PeerConnectionState.DISCONNECTED,
                        PeerConnection.PeerConnectionState.FAILED -> scheduleIceRestart(remotePlayerId, 5000)
                        PeerConnection.PeerConnectionState.CONNECTED -> iceRestartJobs.remove(remotePlayerId)?.cancel()
                        else -> Unit
                    }
                  }
                }
                override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>) = Unit
                override fun onAddStream(stream: org.webrtc.MediaStream) = Unit
                override fun onRemoveStream(stream: org.webrtc.MediaStream) = Unit
                override fun onDataChannel(channel: DataChannel) {
                    dispatch { if (channel.label() == VOICE_HEALTH_CHANNEL) bindHealthChannel(remotePlayerId, token, channel) }
                }
                override fun onRenegotiationNeeded() = Unit
                override fun onAddTrack(receiver: RtpReceiver, streams: Array<out org.webrtc.MediaStream>) {
                    receiveAudioTrack(receiver.track())
                }
                override fun onTrack(transceiver: org.webrtc.RtpTransceiver) {
                    receiveAudioTrack(transceiver.receiver.track())
                }
                private fun receiveAudioTrack(track: MediaStreamTrack?) {
                  dispatch {
                    if (track is AudioTrack && track.kind() == MediaStreamTrack.AUDIO_TRACK_KIND) {
                        remoteAudioTracks[remotePlayerId] = track
                        applyRemoteVolume(remotePlayerId, track)
                        resetAudioRouting()
                        Log.i(TAG, "收到远端音频轨: $remotePlayerId")
                    }
                  }
                }
            },
        )
        if (connection != null) {
            localAudioTrack?.let { connection.addTrack(it, listOf("mctier-stream-$localPlayerId")) }
            peerConnections[remotePlayerId] = connection
            peerStartedAt[remotePlayerId] = android.os.SystemClock.elapsedRealtime()
            if (localPlayerId > remotePlayerId) {
                val init = DataChannel.Init().apply { ordered = false; maxRetransmits = 0 }
                bindHealthChannel(remotePlayerId, token, connection.createDataChannel(VOICE_HEALTH_CHANNEL, init))
            }
        }
        return connection
    }

    fun handleSignal(message: SignalingEnvelope) {
        if (message.to != null && message.to != localPlayerId) return
        when (message.type) {
            "offer" -> handleOffer(message)
            "answer" -> handleAnswer(message)
            "ice-candidate" -> handleIce(message)
            "player-left" -> message.playerId?.let(::removePeer)
            // 对方点击了「语音重连」：只拆掉与他的旧连接（不移除玩家本身），
            // 随后由对方作为发起方送来全新的 Offer 完成重建。双端同拆同建，
            // 避免一端沿用旧连接导致「已连接却没有声音」。
            "voice-reconnect" -> message.from?.let {
                if (recoveryJobs[it]?.isActive == true && localPlayerId > it) return@let
                recoveryJobs.remove(it)?.cancel()
                Log.i(TAG, "收到来自 $it 的语音重连请求，拆除旧连接等待重建")
                closePeer(it)
                peerStartedAt[it] = android.os.SystemClock.elapsedRealtime()
            }
        }
    }

    fun removePeer(playerId: String) {
        knownPeers.remove(playerId)
        recoveryJobs.remove(playerId)?.cancel()
        recoveryAt.remove(playerId)
        closePeer(playerId)
        health.remove(playerId)
        playerVolumes.remove(playerId)
        peerStartedAt.remove(playerId)
    }

    private fun closePeer(playerId: String) {
        peerTokens.remove(playerId)
        makingOffers.remove(playerId)
        iceRestartJobs.remove(playerId)?.cancel()
        healthChannels.remove(playerId)?.let { it.unregisterObserver(); it.close() }
        remotePackets.remove(playerId)
        lastHealthAt.remove(playerId)
        health[playerId]?.resetSample()
        peerConnections.remove(playerId)?.let { it.close(); it.dispose() }
        remoteAudioTracks.remove(playerId)
        pendingIceCandidates.remove(playerId)
    }

    /**
     * 重置所有对等连接（用于信令断线重连后）：关闭并清空全部 PeerConnection 与远端音轨，
     * 但保留 factory 与本地音频轨，使后续 players-list 能重新建立全新的语音连接。
     * 修复“共享/网络抖动导致 WS 重连后语音永久失效”。
     */
    fun resetPeers() {
        Log.i(TAG, "重置所有对等连接（信令重连）")
        recoveryJobs.values.forEach { it.cancel() }
        recoveryJobs.clear()
        peerConnections.keys.toList().forEach(::closePeer)
        knownPeers.clear()
        peerStartedAt.clear()
        health.clear()
        recoveryAt.clear()
        iceRestartJobs.values.forEach { runCatching { it.cancel() } }
        iceRestartJobs.clear()
        remoteAudioTracks.clear()
        pendingIceCandidates.clear()
        audioLevels.clear()
        lastAudioStatsLogAt.clear()
        _speakingPlayers.value = emptySet()
    }

    fun cleanup() {
        resetPeers()
        statsJob?.cancel()
        statsJob = null
        audioRouteJob?.cancel()
        audioRouteJob = null
        audioDeviceCallback?.let { callback ->
            val am = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
            runCatching { am.unregisterAudioDeviceCallback(callback) }
        }
        audioDeviceCallback = null
        playerVolumes.clear()
        localAudioTrack?.dispose()
        audioSource?.dispose()
        localAudioTrack = null
        audioSource = null
        LocalVqePcmProcessor.dispose()
        _micEnabled.value = false
        globalMuted = false
        restoreNormalAudio()
    }

    private fun handleOffer(message: SignalingEnvelope) {
        val from = message.from ?: return
        val offer = message.offer ?: return
        knownPeers.add(from)
        val pc = ensurePeer(from) ?: return
        val collision = from in makingOffers || pc.signalingState() == PeerConnection.SignalingState.HAVE_LOCAL_OFFER
        if (collision && localPlayerId > from) return
        makingOffers.remove(from)
        val accept = {
            pc.setRemoteDescription(sdpObserver(from, pc, applied = {
                makingOffers.remove(from)
                audioTransceiver(pc)?.let { transceiver ->
                    transceiver.direction = RtpTransceiver.RtpTransceiverDirection.SEND_RECV
                    transceiver.sender.setTrack(localAudioTrack, false)
                }
                flushPendingIce(from, pc)
                pc.createAnswer(sdpObserver(from, pc, created = { desc ->
                    pc.setLocalDescription(sdpObserver(from, pc, applied = {
                        sendSignal?.invoke(SignalingEnvelope(type = "answer", from = localPlayerId, to = from,
                            answer = SdpPayload(desc.type.canonicalForm(), desc.description)))
                    }), desc)
                }), MediaConstraints())
            }), SessionDescription(SessionDescription.Type.OFFER, offer.sdp))
        }
        if (pc.signalingState() == PeerConnection.SignalingState.HAVE_LOCAL_OFFER) {
            pc.setLocalDescription(sdpObserver(from, pc, applied = accept), SessionDescription(SessionDescription.Type.ROLLBACK, ""))
        } else {
            // Invalidate a queued local createOffer callback before accepting the remote offer.
            makingOffers.remove(from)
            accept()
        }
    }

    private fun handleAnswer(message: SignalingEnvelope) {
        val from = message.from ?: return
        val answer = message.answer ?: return
        peerConnections[from]?.let { pc ->
            if (pc.signalingState() != PeerConnection.SignalingState.HAVE_LOCAL_OFFER) return
            pc.setRemoteDescription(sdpObserver(from, pc, applied = { flushPendingIce(from, pc) }),
                SessionDescription(SessionDescription.Type.ANSWER, answer.sdp))
        }
    }

    private fun handleIce(message: SignalingEnvelope) {
        val from = message.from ?: return
        val candidate = message.candidate ?: return
        val ice = IceCandidate(candidate.sdpMid, candidate.sdpMLineIndex ?: 0, candidate.candidate)
        val pc = peerConnections[from]
        if (shouldQueueVoiceIce(pc?.remoteDescription != null) { pc?.addIceCandidate(ice) == true }) {
            if (!pendingIceCandidates.add(from, ice)) {
                Log.w(TAG, "丢弃超出限制的待处理 ICE[$from]")
            }
        }
    }

    private fun flushPendingIce(playerId: String, pc: PeerConnection) {
        if (peerConnections[playerId] !== pc || pc.remoteDescription == null) return
        val pending = pendingIceCandidates.remove(playerId).orEmpty()
        pending.forEach { candidate ->
            runCatching { pc.addIceCandidate(candidate) }
        }
    }

    /**
     * 通话中途连接中断后的自动恢复：在 DISCONNECTED/FAILED 时按防抖发起 ICE 重启。
     * 仅由发起方（本地 ID 字典序较大）发起，避免双方同时重协商撞车；另一方在收到
     * 重启 offer 后用 createAnswer 自动配合。这修复了“两人通话聊着聊着突然没声音、
     * 且不再恢复”的问题（网络抖动 / NAT 绑定超时 / 隧道瞬断导致媒体通道失效）。
     */
    private fun scheduleIceRestart(remotePlayerId: String, delayMs: Long) {
        if (iceRestartJobs[remotePlayerId]?.isActive == true) return
        iceRestartJobs[remotePlayerId] = rtcScope.launch {
            // ID 较大的一方优先发起；较小的一方延迟兜底，避免两端都等待
            // 或主发起端故障后连接永久停在 disconnected/failed。
            val effectiveDelay = if (localPlayerId > remotePlayerId) delayMs else delayMs + 6000L
            if (effectiveDelay > 0) delay(effectiveDelay)
            var attempt = 0
            while (isActive) {
                val pc = peerConnections[remotePlayerId] ?: return@launch
                val state = runCatching { pc.iceConnectionState() }.getOrNull()
                if (state == PeerConnection.IceConnectionState.CONNECTED ||
                    state == PeerConnection.IceConnectionState.COMPLETED
                ) return@launch

                attempt += 1
                if (attempt >= 3) {
                    Log.w(TAG, "ICE 重启多次未恢复[$remotePlayerId]，重建整条语音连接")
                    recoverPeer(remotePlayerId, "ice-restarts-exhausted")
                    return@launch
                }
                Log.w(TAG, "ICE 自愈重试[$remotePlayerId] 第 $attempt 次，当前状态=$state")
                restartIce(remotePlayerId, pc)
                delay((8_000L + attempt * 2_000L).coerceAtMost(20_000L))
            }
        }
    }

    private fun setLocalOfferAndSend(remotePlayerId: String, pc: PeerConnection, desc: SessionDescription) {
        if (remotePlayerId !in makingOffers || peerConnections[remotePlayerId] !== pc || pc.signalingState() != PeerConnection.SignalingState.STABLE) return
        pc.setLocalDescription(sdpObserver(remotePlayerId, pc, applied = applied@{
                if (remotePlayerId !in makingOffers || pc.signalingState() != PeerConnection.SignalingState.HAVE_LOCAL_OFFER) return@applied
                makingOffers.remove(remotePlayerId)
                sendSignal?.invoke(
                    SignalingEnvelope(
                        type = "offer",
                        from = localPlayerId,
                        to = remotePlayerId,
                        offer = SdpPayload(desc.type.canonicalForm(), desc.description),
                    ),
                )
        }), desc)
    }

    private fun restartIce(remotePlayerId: String, pc: PeerConnection) {
        if (pc.signalingState() != PeerConnection.SignalingState.STABLE || !makingOffers.add(remotePlayerId)) return
        Log.i(TAG, "发起 ICE 重启[$remotePlayerId]")
        val constraints = MediaConstraints().apply {
            mandatory.add(MediaConstraints.KeyValuePair("IceRestart", "true"))
        }
        pc.createOffer(sdpObserver(remotePlayerId, pc, created = { desc -> setLocalOfferAndSend(remotePlayerId, pc, desc) }), constraints)
    }

    private fun audioTransceiver(pc: PeerConnection): RtpTransceiver? {
        val audio = pc.transceivers.filter { it.receiver.track()?.kind() == MediaStreamTrack.AUDIO_TRACK_KIND }
        return audio.firstOrNull { it.mid != null } ?: audio.firstOrNull()
    }

    private fun sdpObserver(id: String, pc: PeerConnection, created: (SessionDescription) -> Unit = {}, applied: () -> Unit = {}): SimpleSdpObserver =
        object : SimpleSdpObserver() {
            override fun onCreateSuccess(desc: SessionDescription) { dispatch { created(desc) } }
            override fun onSetSuccess() { dispatch(applied) }
            override fun onCreateFailure(error: String) = failed(error)
            override fun onSetFailure(error: String) = failed(error)
            private fun dispatch(action: () -> Unit) {
                rtcScope.launch {
                    if (peerConnections[id] === pc) runCatching(action).onFailure { failed(it.message ?: "SDP callback failed") }
                }
            }
            private fun failed(error: String) {
                rtcScope.launch {
                    if (peerConnections[id] !== pc) return@launch
                    makingOffers.remove(id)
                    Log.w(TAG, "语音协商失败[$id]: $error")
                    recoverPeer(id, "sdp-failure")
                }
            }
        }

    private fun bindHealthChannel(id: String, token: Any, channel: DataChannel) {
        if (healthChannels.containsKey(id)) { channel.close(); return }
        healthChannels[id] = channel
        channel.registerObserver(object : DataChannel.Observer {
            override fun onBufferedAmountChange(previousAmount: Long) = Unit
            override fun onStateChange() = Unit
            override fun onMessage(buffer: DataChannel.Buffer) {
                if (buffer.binary || buffer.data.remaining() > 128) return
                val bytes = ByteArray(buffer.data.remaining())
                buffer.data.get(bytes)
                val packets = parseVoiceHealth(String(bytes, Charsets.UTF_8)) ?: return
                rtcScope.launch {
                    if (peerTokens[id] === token) remotePackets[id] = packets to android.os.SystemClock.elapsedRealtime()
                }
            }
        })
    }

    private companion object {
        private const val TAG = "AndroidRtcController"
        private const val VOICE_HEALTH_CHANNEL = "mctier-voice-health-v1"
        private const val MAX_PENDING_ICE_ENTRIES = 256
        private const val MAX_PENDING_ICE_BYTES = 256 * 1024
        private const val MAX_PENDING_ICE_PER_PEER = 64
        private const val PENDING_ICE_TTL_MILLIS = 15_000L

        private fun iceCandidateBytes(candidate: IceCandidate): Int =
            candidate.sdp.toByteArray(Charsets.UTF_8).size +
                (candidate.sdpMid?.toByteArray(Charsets.UTF_8)?.size ?: 0) + 16
    }
}

open class SimpleSdpObserver : org.webrtc.SdpObserver {
    override fun onCreateSuccess(desc: SessionDescription) = Unit
    override fun onSetSuccess() = Unit
    override fun onCreateFailure(error: String) = Unit
    override fun onSetFailure(error: String) = Unit
}
