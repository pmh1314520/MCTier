package top.pmh13.mctier.network

import android.content.Context
import android.media.AudioAttributes
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
    private val pendingIceCandidates = linkedMapOf<String, MutableList<IceCandidate>>()
    private val playerVolumes = linkedMapOf<String, Double>() // 0.0 ~ 1.0
    private var globalMuted = false

    private val _micEnabled = MutableStateFlow(false)
    val micEnabled: StateFlow<Boolean> = _micEnabled

    // 说话检测：根据各 peer 的音频电平判断谁在说话
    private val rtcScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val audioLevels = ConcurrentHashMap<String, Double>()
    private val _speakingPlayers = MutableStateFlow<Set<String>>(emptySet())
    val speakingPlayers: StateFlow<Set<String>> = _speakingPlayers
    private var statsJob: Job? = null
    private var audioModeJob: Job? = null

    private fun startAudioModeGuard() {
        if (audioModeJob != null) return
        audioModeJob = rtcScope.launch {
            while (isActive) {
                delay(1500)
                resetAudioRouting()
            }
        }
    }

    private fun startStatsLoop() {
        if (statsJob != null) return
        statsJob = rtcScope.launch {
            while (isActive) {
                delay(400)
                val current = peerConnections.toMap()
                current.forEach { (id, pc) ->
                    runCatching {
                        pc.getStats { report ->
                            var level = 0.0
                            report.statsMap.values.forEach { s ->
                                if (s.type == "inbound-rtp") {
                                    (s.members["audioLevel"] as? Number)?.let { level = maxOf(level, it.toDouble()) }
                                }
                            }
                            audioLevels[id] = level
                        }
                    }
                }
                // 清理已离开的 peer
                audioLevels.keys.retainAll(current.keys)
                _speakingPlayers.value = audioLevels.filterValues { it > 0.02 }.keys.toSet()
            }
        }
    }

    private var speakerphoneOn = true

    /**
     * 通话音频路由：保持通话模式(回声消除需要)，同时把输出强制路由到"内置扬声器"，
     * 避免默认走听筒/单个通话扬声器导致只有一个扬声器响、对方听到的声音很小。
     */
    private fun routeAudio() {
        runCatching {
            val am = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
            am.mode = AudioManager.MODE_IN_COMMUNICATION
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) {
                val targetType = if (speakerphoneOn)
                    android.media.AudioDeviceInfo.TYPE_BUILTIN_SPEAKER
                else
                    android.media.AudioDeviceInfo.TYPE_BUILTIN_EARPIECE
                val dev = am.availableCommunicationDevices.firstOrNull { it.type == targetType }
                if (dev != null) am.setCommunicationDevice(dev)
                else @Suppress("DEPRECATION") run { am.isSpeakerphoneOn = speakerphoneOn }
            } else {
                @Suppress("DEPRECATION")
                am.isSpeakerphoneOn = speakerphoneOn
            }
        }
    }

    private fun applyAudioRouting() = routeAudio()

    /** 切换扬声器外放 / 听筒 */
    fun setSpeakerphone(on: Boolean) {
        speakerphoneOn = on
        routeAudio()
    }

    private fun resetAudioRouting() = routeAudio()

    /** 离开大厅/结束通话时恢复普通音频模式，避免长期占用通话模式影响系统其它音频 */
    fun restoreNormalAudio() {
        runCatching {
            val am = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) {
                runCatching { am.clearCommunicationDevice() }
            } else {
                @Suppress("DEPRECATION") run { am.isSpeakerphoneOn = false }
            }
            am.mode = AudioManager.MODE_NORMAL
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
                // 变声器：在录音 PCM 进入 WebRTC 前原地处理
                .setAudioBufferCallback { buffer, audioFormat, channelCount, sampleRate, bytesRead, captureTimestampNs ->
                    runCatching { VoiceProcessor.process(audioFormat, channelCount, sampleRate, buffer, bytesRead) }
                    captureTimestampNs
                }
                .createAudioDeviceModule()
            factory = PeerConnectionFactory.builder()
                .setOptions(options)
                .setAudioDeviceModule(adm)
                .createPeerConnectionFactory()
            adm.setMicrophoneMute(false)
        }
        // 语音大厅期间持续保持通话模式：这是硬件回声消除/降噪生效的前提，
        // 否则会出现严重声学回声与底噪（媒体提示音音量略降是可接受的代价）。
        startStatsLoop()
        startAudioModeGuard()
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

    fun setMicEnabled(enabled: Boolean) {
        _micEnabled.value = enabled
        localAudioTrack?.setEnabled(enabled)
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
        if (peerConnections.containsKey(remotePlayerId)) return
        if (localPlayerId > remotePlayerId) {
            val pc = ensurePeer(remotePlayerId) ?: return
            pc.createOffer(object : SimpleSdpObserver() {
                override fun onCreateSuccess(desc: SessionDescription) {
                    pc.setLocalDescription(SimpleSdpObserver(), desc)
                    sendSignal?.invoke(
                        SignalingEnvelope(
                            type = "offer",
                            from = localPlayerId,
                            to = remotePlayerId,
                            offer = SdpPayload(desc.type.canonicalForm(), desc.description),
                        ),
                    )
                }
            }, MediaConstraints())
        }
        // 否则等待对方发起 offer
    }

    fun connectToPlayers(remoteIds: List<String>) {
        remoteIds.forEach { connectToPlayer(it) }
    }

    fun ensurePeer(remotePlayerId: String): PeerConnection? {
        peerConnections[remotePlayerId]?.let { return it }
        val iceServers = listOf(
            PeerConnection.IceServer.builder("stun:stun.qq.com:3478").createIceServer(),
            PeerConnection.IceServer.builder("stun:stun.miwifi.com:3478").createIceServer(),
            PeerConnection.IceServer.builder("stun:stun.l.google.com:19302").createIceServer(),
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

                override fun onSignalingChange(newState: PeerConnection.SignalingState) = Unit
                override fun onIceConnectionChange(newState: PeerConnection.IceConnectionState) {
                    Log.i(TAG, "ICE 连接状态[$remotePlayerId]: $newState")
                }
                override fun onIceConnectionReceivingChange(receiving: Boolean) = Unit
                override fun onIceGatheringChange(newState: PeerConnection.IceGatheringState) {
                    Log.i(TAG, "ICE 收集状态[$remotePlayerId]: $newState")
                }
                override fun onConnectionChange(newState: PeerConnection.PeerConnectionState) {
                    Log.i(TAG, "PeerConnection 状态[$remotePlayerId]: $newState")
                }
                override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>) = Unit
                override fun onAddStream(stream: org.webrtc.MediaStream) = Unit
                override fun onRemoveStream(stream: org.webrtc.MediaStream) = Unit
                override fun onDataChannel(channel: org.webrtc.DataChannel) = Unit
                override fun onRenegotiationNeeded() = Unit
                override fun onAddTrack(receiver: RtpReceiver, streams: Array<out org.webrtc.MediaStream>) {
                    val track = receiver.track()
                    if (track is AudioTrack && track.kind() == MediaStreamTrack.AUDIO_TRACK_KIND) {
                        remoteAudioTracks[remotePlayerId] = track
                        applyRemoteVolume(remotePlayerId, track)
                        resetAudioRouting()
                        Log.i(TAG, "收到远端音频轨: $remotePlayerId")
                    }
                }
            },
        )
        if (connection != null) {
            localAudioTrack?.let { connection.addTrack(it, listOf("mctier-stream-$localPlayerId")) }
            peerConnections[remotePlayerId] = connection
        }
        return connection
    }

    fun handleSignal(message: SignalingEnvelope) {
        when (message.type) {
            "offer" -> handleOffer(message)
            "answer" -> handleAnswer(message)
            "ice-candidate" -> handleIce(message)
            "player-left" -> message.playerId?.let(::removePeer)
        }
    }

    fun removePeer(playerId: String) {
        peerConnections.remove(playerId)?.close()
        remoteAudioTracks.remove(playerId)
        pendingIceCandidates.remove(playerId)
        playerVolumes.remove(playerId)
    }

    /**
     * 重置所有对等连接（用于信令断线重连后）：关闭并清空全部 PeerConnection 与远端音轨，
     * 但保留 factory 与本地音频轨，使后续 players-list 能重新建立全新的语音连接。
     * 修复“共享/网络抖动导致 WS 重连后语音永久失效”。
     */
    fun resetPeers() {
        Log.i(TAG, "重置所有对等连接（信令重连）")
        peerConnections.values.forEach { runCatching { it.close() } }
        peerConnections.clear()
        remoteAudioTracks.clear()
        pendingIceCandidates.clear()
        audioLevels.clear()
        _speakingPlayers.value = emptySet()
    }

    fun cleanup() {
        statsJob?.cancel()
        statsJob = null
        audioModeJob?.cancel()
        audioModeJob = null
        audioLevels.clear()
        _speakingPlayers.value = emptySet()
        peerConnections.values.forEach { it.close() }
        peerConnections.clear()
        remoteAudioTracks.clear()
        pendingIceCandidates.clear()
        playerVolumes.clear()
        localAudioTrack?.dispose()
        audioSource?.dispose()
        localAudioTrack = null
        audioSource = null
        _micEnabled.value = false
        globalMuted = false
        restoreNormalAudio()
    }

    private fun handleOffer(message: SignalingEnvelope) {
        val from = message.from ?: return
        val offer = message.offer ?: return
        val pc = ensurePeer(from) ?: return
        pc.setRemoteDescription(object : SimpleSdpObserver() {
            override fun onSetSuccess() {
                flushPendingIce(from, pc)
            }
        }, SessionDescription(SessionDescription.Type.OFFER, offer.sdp))
        pc.createAnswer(object : SimpleSdpObserver() {
            override fun onCreateSuccess(desc: SessionDescription) {
                pc.setLocalDescription(SimpleSdpObserver(), desc)
                sendSignal?.invoke(
                    SignalingEnvelope(
                        type = "answer",
                        from = localPlayerId,
                        to = from,
                        answer = SdpPayload(desc.type.canonicalForm(), desc.description),
                    ),
                )
            }
        }, MediaConstraints())
    }

    private fun handleAnswer(message: SignalingEnvelope) {
        val from = message.from ?: return
        val answer = message.answer ?: return
        peerConnections[from]?.let { pc ->
            pc.setRemoteDescription(object : SimpleSdpObserver() {
                override fun onSetSuccess() {
                    flushPendingIce(from, pc)
                }
            }, SessionDescription(SessionDescription.Type.ANSWER, answer.sdp))
        }
    }

    private fun handleIce(message: SignalingEnvelope) {
        val from = message.from ?: return
        val candidate = message.candidate ?: return
        val ice = IceCandidate(candidate.sdpMid, candidate.sdpMLineIndex ?: 0, candidate.candidate)
        val pc = peerConnections[from]
        if (pc == null) {
            pendingIceCandidates.getOrPut(from) { mutableListOf() }.add(ice)
        } else {
            runCatching { pc.addIceCandidate(ice) }
                .onFailure { pendingIceCandidates.getOrPut(from) { mutableListOf() }.add(ice) }
        }
    }

    private fun flushPendingIce(playerId: String, pc: PeerConnection) {
        val pending = pendingIceCandidates.remove(playerId).orEmpty()
        pending.forEach { candidate ->
            runCatching { pc.addIceCandidate(candidate) }
        }
    }

    private companion object {
        private const val TAG = "AndroidRtcController"
    }
}

open class SimpleSdpObserver : org.webrtc.SdpObserver {
    override fun onCreateSuccess(desc: SessionDescription) = Unit
    override fun onSetSuccess() = Unit
    override fun onCreateFailure(error: String) = Unit
    override fun onSetFailure(error: String) = Unit
}
