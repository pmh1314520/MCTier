package top.pmh13.mctier

import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import android.util.Base64
import android.util.Log
import androidx.core.content.edit
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import top.pmh13.mctier.data.AppConnectionState
import top.pmh13.mctier.data.ChatMessage
import top.pmh13.mctier.data.ChatWireMessage
import top.pmh13.mctier.data.AppClientVersion
import top.pmh13.mctier.data.DefaultSignalingServer
import top.pmh13.mctier.data.MctierJson
import top.pmh13.mctier.data.Lobby
import top.pmh13.mctier.data.Player
import top.pmh13.mctier.data.ScreenShareInfo
import top.pmh13.mctier.data.SharedFolder
import top.pmh13.mctier.data.SignalingEnvelope
import top.pmh13.mctier.data.UserSettings
import top.pmh13.mctier.network.AndroidRtcController
import top.pmh13.mctier.network.ChatP2PClient
import top.pmh13.mctier.network.ConnectArgs
import top.pmh13.mctier.network.FileShareHttpServer
import top.pmh13.mctier.network.NetworkController
import top.pmh13.mctier.network.RemoteFileClient
import top.pmh13.mctier.network.ScreenShareController
import top.pmh13.mctier.service.ScreenCaptureService
import top.pmh13.mctier.network.SignalingClient
import top.pmh13.mctier.data.FileShareWire
import top.pmh13.mctier.data.RemoteFileInfo
import top.pmh13.mctier.data.RemoteShareEntry
import top.pmh13.mctier.data.FavoriteLobby
import top.pmh13.mctier.data.CustomNode
import top.pmh13.mctier.data.TodoItem
import top.pmh13.mctier.data.PublicLobbyWire
import top.pmh13.mctier.ui.L
import top.pmh13.mctier.data.RecentLobby
import top.pmh13.mctier.data.RecentPlayer
import top.pmh13.mctier.network.PublicLobbyClient
import top.pmh13.mctier.network.UpdateChecker
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer


import java.io.ByteArrayOutputStream
import java.util.concurrent.ConcurrentHashMap
import java.util.UUID

data class MctierUiState(
    val state: AppConnectionState = AppConnectionState.Idle,
    val error: String? = null,
    val playerId: String = "android-${System.currentTimeMillis()}-${UUID.randomUUID().toString().take(8)}",
    val settings: UserSettings = UserSettings(),
    val lobby: Lobby? = null,
    val players: List<Player> = emptyList(),
    val chatMessages: List<ChatMessage> = emptyList(),
    val sharedFolders: List<SharedFolder> = emptyList(),
    val remoteShares: List<top.pmh13.mctier.data.RemoteShareEntry> = emptyList(),
    val screenShares: List<ScreenShareInfo> = emptyList(),
    val micEnabled: Boolean = false,
    val globalMuted: Boolean = false,
    val playerVolumes: Map<String, Float> = emptyMap(),
    val hostId: String? = null,
    val maxPlayers: Int? = null,
    val isPublicLobby: Boolean = false,
    val mutedPlayers: Set<String> = emptySet(),
    val favorites: List<top.pmh13.mctier.data.FavoriteLobby> = emptyList(),
    val recentLobbies: List<top.pmh13.mctier.data.RecentLobby> = emptyList(),
    val recentPlayers: List<top.pmh13.mctier.data.RecentPlayer> = emptyList(),
    val favoritePlayers: List<String> = emptyList(),
    val publicLobbies: List<top.pmh13.mctier.data.PublicLobbyWire> = emptyList(),
    val publicLoading: Boolean = false,
    val showOnboarding: Boolean = false,
    val viewingShareId: String? = null,
    val customNodes: List<top.pmh13.mctier.data.CustomNode> = emptyList(),
    val todos: List<top.pmh13.mctier.data.TodoItem> = emptyList(),
    val countdownRemaining: Int = 0,
    val countdownRunning: Boolean = false,
    val speakerphoneOn: Boolean = true,
    val downloadedFiles: List<String> = emptyList(),
    val downloadProgress: Map<String, Int> = emptyMap(), // 文件名 -> 下载进度(0~100)
    val playerLatencies: Map<String, Int> = emptyMap(), // playerId -> 延迟ms，-1=不可达
    val playerLossRates: Map<String, Int> = emptyMap(), // playerId -> 丢包率(%)
    val playerConnTypes: Map<String, String> = emptyMap(), // playerId -> "p2p"|"relay"
    val versionError: top.pmh13.mctier.data.VersionAlert? = null, // 服务器要求最低版本不满足，强制更新并禁止建/进大厅
    val updateAvailable: String? = null, // Gitee 检测到的新版本号（可选更新）
    val reconnecting: Boolean = false, // 信令断线重连中（顶部显示"重连中…"）
    val announcement: String = "", // 大厅公告（房主设置，新人进入即见）
    val myVoiceGroup: Int = 0, // 我的语音小队（0=大厅公共，1~4=小队）
    val playerVoiceGroups: Map<String, Int> = emptyMap(), // 各玩家的语音小队
    val pendingJoin: top.pmh13.mctier.data.DeepLinkJoin? = null, // deep link 预填加入信息
    // 远程控制（电脑控制本机手机）
    val remoteControlRequest: top.pmh13.mctier.data.RemoteControlRequest? = null, // 收到的待确认控制请求
    val remoteControlActiveBy: String? = null, // 正在被谁远程控制（控制端名字）
    val remoteControllingPeer: String? = null, // 本机正在远程控制的对方设备名（控制端视角）
)

class MctierRepository(private val context: Context) {
    companion object {
        private const val TAG = "MctierRepository"
        private const val MaxPlayerNameLength = 8

        private fun normalizePlayerName(name: String): String =
            name.replace(Regex("\\s+"), "").take(MaxPlayerNameLength)

        @Volatile
        private var INSTANCE: MctierRepository? = null

        /** 进程级单例：避免 Activity 重建(如横竖屏切换)时重新创建导致组网状态丢失、界面退回首页 */
        fun get(context: Context): MctierRepository =
            INSTANCE ?: synchronized(this) {
                INSTANCE ?: MctierRepository(context.applicationContext).also { INSTANCE = it }
            }
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val ioScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val prefs = context.getSharedPreferences("mctier", Context.MODE_PRIVATE)
    private val networkController = NetworkController(context)
    private val signalingClient = SignalingClient()
    private val rtcController = AndroidRtcController(context)
    private var fileServer: FileShareHttpServer? = null
    private var chatClient: ChatP2PClient? = null
    private val remoteFileClient = RemoteFileClient(context)
    private val downloadJobs = ConcurrentHashMap<String, Job>()
    private val downloadCancelers = ConcurrentHashMap<String, () -> Unit>()
    private val canceledDownloads = ConcurrentHashMap.newKeySet<String>()
    private val publicLobbyClient = PublicLobbyClient()
    private val updateChecker = UpdateChecker(context)
    private val soundManager = top.pmh13.mctier.network.SoundManager(context)
    private var reconnectNoticeJob: Job? = null
    private var lastShareSignalRequestAt: Long = 0L

    /** 是否正处于聊天室界面：在聊天室内收到消息不再播放提示音(对齐桌面端 __isInChatRoom__) */
    @Volatile
    private var inChatRoom = false
    fun setInChatRoom(value: Boolean) { inChatRoom = value }

    /** App 是否处于前台：用于弹幕判定——挂后台(玩游戏)时即使在聊天室界面也应显示弹幕 */
    @Volatile
    private var appForeground = true
    fun setAppForeground(value: Boolean) {
        appForeground = value
        updateMicKeepAlive()
    }

    /**
     * 麦克风后台保活：当 App 处于后台且正在语音大厅时，显示 1×1 全透明保活悬浮窗，
     * 让系统持续允许后台麦克风采集，避免切到后台数秒后语音被系统切断。
     * 回到前台或离开大厅时移除。
     */
    private fun updateMicKeepAlive() {
        val active = !appForeground && _state.value.state == AppConnectionState.InLobby
        runCatching {
            if (active) top.pmh13.mctier.ui.MicKeepAliveOverlay.show(appContext)
            else top.pmh13.mctier.ui.MicKeepAliveOverlay.hide()
        }
    }
    var screenController: ScreenShareController? = null
        private set
    private var remoteControlController: top.pmh13.mctier.network.RemoteControlController? = null
    /** 供 UI 访问远程控制控制器（渲染对方屏幕、发送触摸输入） */
    val remoteControl: top.pmh13.mctier.network.RemoteControlController? get() = remoteControlController
    // 暂存待接受的控制请求（用于 UI 拿到 MediaProjection 授权后调用 accept）
    private var pendingRcRequest: top.pmh13.mctier.data.RemoteControlRequest? = null
    private val appContext = context

    private val _state = MutableStateFlow(
        MctierUiState(
            settings = loadSettings(),
            favorites = loadFavorites(),
            recentLobbies = loadRecentLobbies(),
            recentPlayers = loadRecentPlayers(),
            favoritePlayers = loadFavoritePlayers(),
            showOnboarding = !prefs.getBoolean("onboarded", false),
            customNodes = loadCustomNodes(),
            todos = loadTodos(),
        ),
    )
    val state: StateFlow<MctierUiState> = _state.asStateFlow()

    init {
        scope.launch { signalingClient.events.collect { handleSignal(it) } }
        // 应用已保存的音效/免打扰设置
        soundManager.applySettings(_state.value.settings)
        // 应用弹幕配置
        runCatching {
            val s = _state.value.settings
            top.pmh13.mctier.ui.DanmakuOverlay.applyConfig(
                context, s.danmakuEnabled, s.danmakuFontSize.toFloat(),
                s.danmakuSpeed.toFloat(), s.danmakuOpacity, s.danmakuTracks,
                parseDanmakuColor(s.danmakuColor), s.danmakuColor.equals("rainbow", true),
            )
        }
        // 应用变声器音色
        top.pmh13.mctier.network.VoiceProcessor.preset = _state.value.settings.voicePreset
        // 启动时检测 Gitee 上是否有新版本（可选更新提示）
        checkUpdateOnStart()
        // 周期性测量与各玩家的延迟（在大厅内时）
        ioScope.launch {
            while (true) {
                delay(5000)
                val st = _state.value
                if (st.state == AppConnectionState.InLobby) {
                    val others = st.players.filter { it.id != st.playerId && !it.virtualIp.isNullOrBlank() }
                    if (others.isNotEmpty()) {
                        // 多次探测以估算延迟与丢包率
                        val latencyResults = HashMap<String, Int>()
                        val lossResults = HashMap<String, Int>()
                        others.forEach { p ->
                            val samples = (1..4).map { measureLatency(p.virtualIp!!) }
                            val ok = samples.filter { it >= 0 }
                            latencyResults[p.id] = if (ok.isEmpty()) -1 else ok.average().toInt()
                            lossResults[p.id] = ((samples.size - ok.size) * 100 / samples.size)
                        }
                        // 连接类型(P2P/中继)：解析 EasyTier 路由信息
                        val connByIp = runCatching { networkController.peerConnectionTypes() }.getOrDefault(emptyMap())
                        val connResults = others.associate { p -> p.id to (connByIp[p.virtualIp] ?: "") }
                        _state.update {
                            it.copy(
                                playerLatencies = it.playerLatencies + latencyResults,
                                playerLossRates = it.playerLossRates + lossResults,
                                playerConnTypes = it.playerConnTypes + connResults.filterValues { v -> v.isNotBlank() },
                            )
                        }
                    }
                }
            }
        }
        scope.launch { rtcController.micEnabled.collect { enabled -> _state.update { it.copy(micEnabled = enabled) } } }
        // 监听信令连接状态：断线后重连时，重置所有语音连接并重发共享，避免重连后语音/共享失效
        scope.launch {
            var wasConnected = false
            signalingClient.connected.collect { connected ->
                // 顶部"重连中"提示：在大厅内且信令断开时显示
                reconnectNoticeJob?.cancel()
                if (connected) {
                    _state.update { it.copy(reconnecting = false) }
                } else if (_state.value.state == AppConnectionState.InLobby) {
                    reconnectNoticeJob = scope.launch {
                        delay(3500)
                        if (!signalingClient.connected.value && _state.value.state == AppConnectionState.InLobby) {
                            _state.update { it.copy(reconnecting = true) }
                        }
                    }
                }
                if (connected && !wasConnected && _state.value.state == AppConnectionState.InLobby) {
                    Log.i(TAG, "信令重连成功，重置语音连接并重发共享")
                    rtcController.resetPeers()
                    // 重新与现有玩家建立语音
                    val others = _state.value.players.map { it.id }.filter { it != _state.value.playerId }
                    rtcController.connectToPlayers(others)
                    // 重发自己的共享，确保对端在我“重新加入”后仍能看到
                    // 重新请求他人的共享列表
                    signalingClient.send(SignalingEnvelope(type = "file-share-list-request", from = _state.value.playerId))
                }
                wasConnected = connected
            }
        }
        scope.launch {
            rtcController.speakingPlayers.collect { speaking ->
                _state.update { st -> st.copy(players = st.players.map { it.copy(speaking = speaking.contains(it.id)) }) }
            }
        }
    }

    fun updateSettings(settings: UserSettings) {
        val normalizedSettings = settings.copy(playerName = normalizePlayerName(settings.playerName))
        prefs.edit {
            putString("playerName", normalizedSettings.playerName)
            putString("preferredServer", settings.preferredServer)
            putString("signalingServer", settings.signalingServer)
            putBoolean("useDomain", settings.useDomain)
            putString("virtualDomain", settings.virtualDomain)
            putBoolean("autoLobbyEnabled", settings.autoLobbyEnabled)
            putString("autoLobbyName", settings.autoLobbyName)
            putString("autoLobbyPassword", settings.autoLobbyPassword)
            putBoolean("enableExitNode", settings.enableExitNode)
            putBoolean("enableAsExitNode", settings.enableAsExitNode)
            putString("proxyCidrs", settings.proxyCidrs)
            putString("exitNodes", settings.exitNodes)
            putInt("mtu", settings.mtu)
            putBoolean("latencyFirst", settings.latencyFirst)
            putBoolean("multiThread", settings.multiThread)
            putBoolean("useSmoltcp", settings.useSmoltcp)
            putBoolean("enableKcpProxy", settings.enableKcpProxy)
            putBoolean("enableQuicProxy", settings.enableQuicProxy)
            putBoolean("disableP2p", settings.disableP2p)
            putBoolean("disableUdpHolePunching", settings.disableUdpHolePunching)
            putBoolean("relayAllPeerRpc", settings.relayAllPeerRpc)
            putBoolean("compressionZstd", settings.compressionZstd)
            putBoolean("privateMode", settings.privateMode)
            putBoolean("lobbyUseGlobalConfig", settings.lobbyUseGlobalConfig)
            putString("customSoundMsg", settings.customSoundMsg)
            putString("customSoundJoin", settings.customSoundJoin)
            putString("customSoundLeave", settings.customSoundLeave)
            putBoolean("soundMuted", settings.soundMuted)
            putBoolean("soundMutedMsg", settings.soundMutedMsg)
            putBoolean("soundMutedJoin", settings.soundMutedJoin)
            putBoolean("soundMutedLeave", settings.soundMutedLeave)
            putFloat("soundVolume", settings.soundVolume)
            putBoolean("dndEnabled", settings.dndEnabled)
            putInt("dndStartMinutes", settings.dndStartMinutes)
            putInt("dndEndMinutes", settings.dndEndMinutes)
            putString("themeMode", settings.themeMode)
            putString("themePrimary", settings.themePrimary)
            putString("language", settings.language)
            putBoolean("danmakuEnabled", settings.danmakuEnabled)
            putInt("danmakuFontSize", settings.danmakuFontSize)
            putInt("danmakuSpeed", settings.danmakuSpeed)
            putFloat("danmakuOpacity", settings.danmakuOpacity)
            putInt("danmakuTracks", settings.danmakuTracks)
            putString("danmakuColor", settings.danmakuColor)
            putString("voicePreset", settings.voicePreset)
        }
        _state.update { it.copy(settings = normalizedSettings) }
        // 同步音量/自定义音到 SoundManager
        soundManager.applySettings(normalizedSettings)
        // 同步变声器音色
        top.pmh13.mctier.network.VoiceProcessor.preset = normalizedSettings.voicePreset
        // 同步弹幕配置
        top.pmh13.mctier.ui.DanmakuOverlay.applyConfig(
            context,
            normalizedSettings.danmakuEnabled,
            normalizedSettings.danmakuFontSize.toFloat(),
            normalizedSettings.danmakuSpeed.toFloat(),
            normalizedSettings.danmakuOpacity,
            normalizedSettings.danmakuTracks,
            parseDanmakuColor(normalizedSettings.danmakuColor),
            normalizedSettings.danmakuColor.equals("rainbow", true),
        )
    }

    fun previewSound(kind: String) {
        when (kind) {
            "message" -> soundManager.previewMessage()
            "join" -> soundManager.previewPlayerJoin()
            "leave" -> soundManager.previewPlayerLeave()
        }
    }

    fun createOrJoinLobby(lobbyName: String, password: String, nodeOverride: String? = null) {
        val current = _state.value
        val settings = current.settings
        val effectiveNode = nodeOverride?.takeIf { it.isNotBlank() } ?: settings.preferredServer
        scope.launch {
            _state.update { it.copy(state = AppConnectionState.Connecting, error = null) }
            runCatching {
                val session = networkController.startEasyTier(
                    lobbyName.trim(), password, settings.playerName, effectiveNode,
                    mtu = settings.mtu.takeIf { it in 500..1500 } ?: 1420,
                    latencyFirst = settings.latencyFirst,
                    proxyCidrs = settings.proxyCidrs.split('\n', ',').map { it.trim() }.filter { it.isNotBlank() },
                    exitNodes = if (settings.enableExitNode) settings.exitNodes.split('\n', ',').map { it.trim() }.filter { it.isNotBlank() } else emptyList(),
                    asExitNode = settings.enableAsExitNode,
                    multiThread = settings.multiThread,
                    useSmoltcp = settings.useSmoltcp,
                    enableKcpProxy = settings.enableKcpProxy,
                    enableQuicProxy = settings.enableQuicProxy,
                    disableP2p = settings.disableP2p,
                    disableUdpHolePunching = settings.disableUdpHolePunching,
                    relayAllPeerRpc = settings.relayAllPeerRpc,
                    compressionZstd = settings.compressionZstd,
                    privateMode = settings.privateMode,
                    useDomain = settings.useDomain,
                )
                val lobby = Lobby(
                    id = UUID.randomUUID().toString(),
                    name = lobbyName.trim(),
                    password = password,
                    createdAt = System.currentTimeMillis(),
                    virtualIp = session.virtualIp,
                    virtualDomain = settings.virtualDomain.ifBlank { "${settings.playerName}.mct.net" },
                    useDomain = settings.useDomain,
                    signalingServer = settings.signalingServer.ifBlank { DefaultSignalingServer },
                )
                fileServer = FileShareHttpServer(context, current.playerId).also { it.start(5_000, false) }
                // 启动 P2P 聊天（与桌面端 14540 互通）
                chatClient = ChatP2PClient(current.playerId, ioScope) { wire -> onIncomingChat(wire) }.also { it.start() }
                screenController = ScreenShareController(appContext, current.playerId) { signalingClient.send(it) }
                remoteControlController = top.pmh13.mctier.network.RemoteControlController(appContext, current.playerId) { signalingClient.send(it) }.also { rc ->
                    rc.onRequest = { sid, fromId, fromName ->
                        _state.update { it.copy(remoteControlRequest = top.pmh13.mctier.data.RemoteControlRequest(sid, fromId, fromName)) }
                    }
                    rc.onActive = { name ->
                        _state.update { it.copy(remoteControlActiveBy = name, remoteControlRequest = null) }
                    }
                    rc.onEnded = {
                        _state.update { it.copy(remoteControlActiveBy = null, remoteControlRequest = null, remoteControllingPeer = null) }
                    }
                    rc.onControllerActive = { name ->
                        _state.update { it.copy(remoteControllingPeer = name) }
                    }
                    rc.onRejected = { reason ->
                        _state.update { it.copy(remoteControllingPeer = null) }
                    }
                }
                rtcController.initialize(current.playerId) { signalingClient.send(it) }
                // 启动麦克风前台服务：保证挂后台时系统不切断麦克风采集（此时处于前台且已持有
                // RECORD_AUDIO 权限，满足 Android 14 启动 microphone 前台服务的要求）
                top.pmh13.mctier.service.VoiceForegroundService.start(appContext)
                signalingClient.connect(
                    ConnectArgs(
                        url = lobby.signalingServer,
                        playerId = current.playerId,
                        playerName = settings.playerName,
                        lobbyName = lobby.name,
                        lobbyPassword = lobby.password,
                        virtualIp = lobby.virtualIp,
                        virtualDomain = lobby.virtualDomain,
                        useDomain = lobby.useDomain,
                    ),
                )
                _state.update {
                    it.copy(
                        state = AppConnectionState.InLobby,
                        lobby = lobby,
                        players = listOf(
                            Player(
                                id = current.playerId,
                                name = settings.playerName,
                                virtualIp = lobby.virtualIp,
                                virtualDomain = lobby.virtualDomain,
                                useDomain = lobby.useDomain,
                            ),
                        ),
                    )
                }
                recordRecentLobby(lobby.name, lobby.password)
                statsStartSession()
            }.onFailure { e ->
                _state.update { it.copy(state = AppConnectionState.Error, error = e.message ?: L("加入大厅失败", "Failed to join lobby")) }
            }
        }
    }

    fun leaveLobby() {        scope.launch {
            statsEndSession(_state.value.hostId == _state.value.playerId)
            signalingClient.send(SignalingEnvelope(type = "leave", clientId = _state.value.playerId))
            signalingClient.close()
            rtcController.cleanup()
            top.pmh13.mctier.service.VoiceForegroundService.stop(appContext)
            top.pmh13.mctier.ui.MicKeepAliveOverlay.hide()
            chatClient?.stop()
            chatClient = null
            screenController?.release()
            screenController = null
            remoteControlController?.release()
            remoteControlController = null
            ScreenCaptureService.stop(appContext)
            fileServer?.stop()
            fileServer = null
            networkController.stopEasyTier()
            _state.update {
                it.copy(
                    state = AppConnectionState.Idle,
                    lobby = null,
                    players = emptyList(),
                    chatMessages = emptyList(),
                    sharedFolders = emptyList(),
                    remoteShares = emptyList(),
                    screenShares = emptyList(),
                    viewingShareId = null,
                    micEnabled = false,
                    hostId = null,
                    maxPlayers = null,
                    isPublicLobby = false,
                    announcement = "",
                    myVoiceGroup = 0,
                    playerVoiceGroups = emptyMap(),
                )
            }
        }
    }

    /** 重载大厅：用当前大厅名/密码与最新配置重新组网（修改动态配置后调用，等价于"自动重新加入"） */
    fun reloadLobby() {
        val lobby = _state.value.lobby ?: return
        val name = lobby.name
        val pw = lobby.password
        leaveLobby()
        scope.launch {
            kotlinx.coroutines.delay(1200)
            createOrJoinLobby(name, pw)
        }
    }

    fun toggleMic() {
        // 被房主禁言时不允许开麦
        val st = _state.value
        if (st.mutedPlayers.contains(st.playerId) && !st.micEnabled) {
            return
        }
        rtcController.setMicEnabled(!st.micEnabled)
    }

    // ==================== 房主管理 ====================
    fun kickPlayer(targetId: String) {
        signalingClient.send(SignalingEnvelope(type = "kick-player", from = _state.value.playerId, target = targetId))
    }

    fun transferHost(targetId: String) {
        signalingClient.send(SignalingEnvelope(type = "transfer-host", from = _state.value.playerId, target = targetId))
    }

    fun setPlayerMuted(targetId: String, muted: Boolean) {
        signalingClient.send(SignalingEnvelope(type = "mute-player", from = _state.value.playerId, target = targetId, muted = muted))
    }

    val isHost: Boolean get() = _state.value.hostId != null && _state.value.hostId == _state.value.playerId

    fun toggleGlobalMute() {
        val newMuted = !_state.value.globalMuted
        rtcController.setGlobalMute(newMuted)
        _state.update { it.copy(globalMuted = newMuted) }
    }

    fun setSpeakerphone(on: Boolean) {
        rtcController.setSpeakerphone(on)
        _state.update { it.copy(speakerphoneOn = on) }
    }

    /** 设置某玩家音量（0.0~1.0），并记忆到状态 */
    fun setPlayerVolume(playerId: String, volume: Float) {
        _state.update { it.copy(playerVolumes = it.playerVolumes + (playerId to volume)) }
        applyVoiceGroupRouting()
    }

    /** 设置/清空大厅公告（仅房主）：保存到状态并通过 P2P 聊天通道广播给所有成员 */
    fun setAnnouncement(text: String) {
        val cur = _state.value
        _state.update { it.copy(announcement = text.trim()) }
        val client = chatClient ?: return
        client.sendAnnounce(cur.settings.playerName, text.trim())
    }

    /** 设置自己的语音小队（0=大厅公共，1~4=小队），广播给所有成员并重算听音范围 */
    fun setMyVoiceGroup(group: Int) {
        val cur = _state.value
        _state.update { it.copy(myVoiceGroup = group, playerVoiceGroups = it.playerVoiceGroups + (cur.playerId to group)) }
        chatClient?.sendVoiceGroup(cur.settings.playerName, group)
        applyVoiceGroupRouting()
    }

    /**
     * 语音小队听音路由：
     * - 我在公共频道(0)：听所有人；
     * - 我在某小队(非0)：只听同小队成员，其余静音。
     * 通过已验证的 setPlayerVolume 机制实现（音量 0=静音，1=正常）。
     */
    private fun applyVoiceGroupRouting() {
        val st = _state.value
        val myGroup = st.myVoiceGroup
        st.players.filter { it.id != st.playerId }.forEach { p ->
            val theirGroup = st.playerVoiceGroups[p.id] ?: 0
            val shouldHear = theirGroup == myGroup
            // 不覆盖用户手动设为 0 的禁音：仅在分组要求静音、或需恢复时调整。默认听筒音量 50%
            val target = if (shouldHear) (st.playerVolumes[p.id] ?: 0.5f) else 0f
            rtcController.setPlayerVolume(p.id, target.toDouble())
        }
    }

    fun sendChat(content: String) {
        val trimmed = content.trim()
        if (trimmed.isEmpty()) return
        val current = _state.value
        val client = chatClient ?: return
        val wire = client.sendText(current.settings.playerName, trimmed)
        val message = ChatMessage(wire.id, current.playerId, current.settings.playerName, trimmed, wire.timestamp * 1000, mine = true)
        _state.update { it.copy(chatMessages = (it.chatMessages + message).takeLast(500)) }
    }

    /** 发送图片消息（与桌面端互通，统一压成 JPEG 后以字节数组传输） */
    fun sendImageChat(uri: Uri) {
        val current = _state.value
        val client = chatClient ?: return
        ioScope.launch {
            runCatching {
                val input = context.contentResolver.openInputStream(uri) ?: return@launch
                val bitmap = input.use { BitmapFactory.decodeStream(it) } ?: return@launch
                val baos = ByteArrayOutputStream()
                bitmap.compress(android.graphics.Bitmap.CompressFormat.JPEG, 70, baos)
                val bytes = baos.toByteArray()
                val intList = bytes.map { it.toInt() and 0xFF }
                val wire = client.sendImage(current.settings.playerName, intList)
                val base64 = "data:image/jpeg;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP)
                val message = ChatMessage(wire.id, current.playerId, current.settings.playerName, "[图片]", wire.timestamp * 1000, mine = true, type = "image", imageBase64 = base64)
                _state.update { it.copy(chatMessages = (it.chatMessages + message).takeLast(500)) }
            }
        }
    }

    /** 收到他人聊天消息（来自 P2P 聊天客户端，已去重并排除自己） */
    private fun onIncomingChat(wire: ChatWireMessage) {
        // 公告控制消息：更新公告横幅，不计入聊天、不播放提示音
        if (wire.messageType == "announce") {
            _state.update { it.copy(announcement = wire.content) }
            return
        }
        // 语音小队控制消息：更新该玩家组别并重算语音听音范围
        if (wire.messageType == "voicegroup") {
            val g = wire.content.trim().toIntOrNull() ?: 0
            _state.update { it.copy(playerVoiceGroups = it.playerVoiceGroups + (wire.playerId to g)) }
            applyVoiceGroupRouting()
            return
        }
        val base64 = wire.imageData?.let { data ->
            val bytes = ByteArray(data.size) { i -> data[i].toByte() }
            "data:image/jpeg;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP)
        }
        // 桌面端发送时 player_name 可能为空（其前端按 player_id 在玩家列表里查名显示），
        // 这里同样在 playerName 为空时用 playerId 解析真实昵称，避免显示成"玩家"
        val resolvedName = wire.playerName.ifBlank {
            _state.value.players.firstOrNull { it.id == wire.playerId }?.name ?: L("玩家", "Player")
        }
        val message = ChatMessage(
            id = wire.id,
            playerId = wire.playerId,
            playerName = resolvedName,
            content = wire.content,
            timestamp = wire.timestamp * 1000,
            mine = false,
            type = wire.messageType,
            imageBase64 = base64,
        )
        _state.update {
            if (it.chatMessages.any { m -> m.id == message.id }) it
            else it.copy(chatMessages = (it.chatMessages + message).takeLast(500))
        }
        // 弹幕：他人消息以弹幕飘过屏幕（含游戏中）。
        // 仅当(不在聊天室界面) 或 (App 挂在后台)时才弹幕——已在聊天室且在前台能直接看到消息，无需再弹幕
        if (!inChatRoom || !appForeground) {
            runCatching {
                if (wire.messageType == "image" && base64 != null) {
                    top.pmh13.mctier.ui.DanmakuOverlay.pushImage("$resolvedName:", base64)
                } else {
                    val dm = "$resolvedName: ${wire.content}"
                    top.pmh13.mctier.ui.DanmakuOverlay.push(dm, copyText = wire.content)
                }
            }
        }
        // 仅当不在聊天室界面时才播放提示音(在聊天室内能直接看到，无需提示)
        if (!inChatRoom) soundManager.message()
    }
    fun addSharedFolder(uri: Uri, displayName: String, password: String?) {
        val current = _state.value
        val folder = SharedFolder(
            id = "share-${current.playerId}-${System.currentTimeMillis()}",
            name = displayName.ifBlank { "Android共享文件夹" },
            uri = uri.toString(),
            password = password?.takeIf { it.isNotBlank() },
            ownerId = current.playerId,
        )
        fileServer?.addFolder(folder)
        // 共享列表以状态为准（即使文件服务器异常也能让自己看到已共享的文件夹）
        val newList = current.sharedFolders.filterNot { it.id == folder.id } + folder
        _state.update { it.copy(sharedFolders = newList) }
        // 主动向大厅广播自己的共享列表，让其他玩家（含电脑端）立即看到我的共享
        broadcastMyShares()
    }

    /** 玩家列表更新后，回填此前 ownerIp 为空的远端共享（修“共享时有时无”） */
    private fun backfillRemoteShareIps() {
        val players = _state.value.players
        val updated = _state.value.remoteShares.map { entry ->
            if (entry.ownerIp.isBlank()) {
                val ip = players.firstOrNull { it.id == entry.ownerId }?.virtualIp
                if (!ip.isNullOrBlank()) entry.copy(ownerIp = ip) else entry
            } else entry
        }
        if (updated != _state.value.remoteShares) {
            _state.update { it.copy(remoteShares = updated) }
        }
    }

    /** 广播自己当前的文件共享列表（新增/移除共享后调用）：仅向每个其他玩家"定向"发送(带 to)，
     *  与桌面端行为完全一致。绝不发送无 to 的广播——信令服务器会把"无 to 的 file-share-list-response"
     *  判定为协议异常并关闭连接，进而引发断线重连抖动。 */
    private fun broadcastMyShares() {
        Log.i(TAG, "File share signaling broadcast skipped; shares are discovered over HTTP")
    }

    fun removeSharedFolder(id: String) {
        fileServer?.removeFolder(id)
        _state.update { it.copy(sharedFolders = it.sharedFolders.filterNot { f -> f.id == id }) }
        broadcastMyShares()
    }

    // ==================== 远端文件共享（浏览/下载电脑端等其他玩家的共享） ====================
    fun refreshRemoteShares() {
        refreshRemoteSharesByHttp()
    }

    private fun refreshRemoteSharesByHttp() {
        val cur = _state.value
        val peers = cur.players.filter { it.id != cur.playerId && !it.virtualIp.isNullOrBlank() }
        if (peers.isEmpty()) return
        ioScope.launch {
            val entries = mutableListOf<RemoteShareEntry>()
            val successOwners = mutableSetOf<String>()
            peers.forEach { p ->
                runCatching { remoteFileClient.listShares(p.virtualIp!!) }
                    .onSuccess { shares ->
                        successOwners += p.id
                        entries += shares.map { w ->
                            RemoteShareEntry(
                                shareId = w.shareId,
                                shareName = w.shareName,
                                ownerId = p.id,
                                ownerName = w.playerName.ifBlank { p.name },
                                ownerIp = p.virtualIp.orEmpty(),
                                hasPassword = w.hasPassword,
                            )
                        }
                    }
            }
            if (successOwners.isNotEmpty()) {
                scope.launch {
                    _state.update {
                        it.copy(remoteShares = it.remoteShares.filterNot { e -> e.ownerId in successOwners } + entries)
                    }
                }
            }
        }
    }

    /** 把任意 Bitmap 保存到系统相册(Pictures/MCTier)，回调在主线程返回是否成功 */
    fun saveBitmapToGallery(bitmap: android.graphics.Bitmap, onResult: (Boolean) -> Unit) {
        ioScope.launch {
            val ok = runCatching {
                val baos = ByteArrayOutputStream()
                bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, baos)
                val bytes = baos.toByteArray()
                val name = "MCTier_QR_${System.currentTimeMillis()}.png"
                if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.Q) {
                    val values = android.content.ContentValues().apply {
                        put(android.provider.MediaStore.Images.Media.DISPLAY_NAME, name)
                        put(android.provider.MediaStore.Images.Media.MIME_TYPE, "image/png")
                        put(android.provider.MediaStore.Images.Media.RELATIVE_PATH, "Pictures/MCTier")
                    }
                    val uri = context.contentResolver.insert(android.provider.MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
                        ?: return@runCatching false
                    context.contentResolver.openOutputStream(uri)?.use { it.write(bytes) } ?: return@runCatching false
                    true
                } else {
                    val dir = java.io.File(android.os.Environment.getExternalStoragePublicDirectory(android.os.Environment.DIRECTORY_PICTURES), "MCTier")
                    dir.mkdirs()
                    java.io.File(dir, name).outputStream().use { it.write(bytes) }
                    true
                }
            }.getOrDefault(false)
            scope.launch { onResult(ok) }
        }
    }

    /** 把聊天图片保存到系统相册(Pictures/MCTier)，回调在主线程返回是否成功 */
    fun saveChatImageToGallery(imageBase64: String?, onResult: (Boolean) -> Unit) {
        if (imageBase64.isNullOrBlank()) { onResult(false); return }
        ioScope.launch {
            val ok = runCatching {
                val raw = imageBase64.substringAfter("base64,", imageBase64)
                val bytes = Base64.decode(raw, Base64.DEFAULT)
                val name = "MCTier_${System.currentTimeMillis()}.jpg"
                if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.Q) {
                    val values = android.content.ContentValues().apply {
                        put(android.provider.MediaStore.Images.Media.DISPLAY_NAME, name)
                        put(android.provider.MediaStore.Images.Media.MIME_TYPE, "image/jpeg")
                        put(android.provider.MediaStore.Images.Media.RELATIVE_PATH, "Pictures/MCTier")
                    }
                    val uri = context.contentResolver.insert(android.provider.MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
                        ?: return@runCatching false
                    context.contentResolver.openOutputStream(uri)?.use { it.write(bytes) } ?: return@runCatching false
                    true
                } else {
                    val dir = java.io.File(android.os.Environment.getExternalStoragePublicDirectory(android.os.Environment.DIRECTORY_PICTURES), "MCTier")
                    dir.mkdirs()
                    java.io.File(dir, name).outputStream().use { it.write(bytes) }
                    true
                }
            }.getOrDefault(false)
            scope.launch { onResult(ok) }
        }
    }

    fun browseRemoteFiles(
        entry: RemoteShareEntry,
        path: String,
        password: String?,
        onResult: (List<RemoteFileInfo>) -> Unit,
        onError: (String) -> Unit,
    ) {
        ioScope.launch {
            runCatching { remoteFileClient.listFiles(entry.ownerIp, entry.shareId, path, password) }
                .onSuccess { files -> scope.launch { onResult(files) } }
                .onFailure { e -> scope.launch { onError(e.message ?: L("浏览失败", "Browse failed")) } }
        }
    }

    fun clearDownloadedFiles() {
        _state.update { it.copy(downloadedFiles = emptyList()) }
    }

    /** 扫描大厅内各玩家虚拟 IP 上开放的 Minecraft 世界（默认端口 25565） */
    fun scanMinecraftWorlds(port: Int, onResult: (List<top.pmh13.mctier.network.DiscoveredWorld>) -> Unit) {
        val st = _state.value
        val ipToName = LinkedHashMap<String, String>()
        st.lobby?.virtualIp?.let { ip -> if (ip.isNotBlank()) ipToName[ip] = "${st.settings.playerName}（我）" }
        st.players.forEach { p ->
            val ip = p.virtualIp
            if (!ip.isNullOrBlank()) {
                ipToName[ip] = if (p.id == st.playerId) "${p.name}（我）" else p.name
            }
        }
        ioScope.launch {
            val worlds = runCatching { top.pmh13.mctier.network.MinecraftScanner.scan(ipToName, port) }.getOrDefault(emptyList())
            scope.launch { onResult(worlds) }
        }
    }

    /** 测量与某玩家的延迟(ms)：用 TCP 连接其聊天端口的耗时估算，失败返回 -1 */
    private fun measureLatency(ip: String): Int = try {
        val start = System.currentTimeMillis()
        java.net.Socket().use { sock ->
            sock.connect(java.net.InetSocketAddress(ip, top.pmh13.mctier.data.ChatServerPort), 2000)
        }
        (System.currentTimeMillis() - start).toInt()
    } catch (e: Exception) {
        -1
    }

    // ==================== 版本检测与客户端内更新 ====================
    private fun checkUpdateOnStart() {
        updateChecker.check { hasUpdate, latest ->
            if (hasUpdate) scope.launch { _state.update { it.copy(updateAvailable = latest) } }
        }
    }

    fun dismissUpdateAvailable() { _state.update { it.copy(updateAvailable = null) } }

    fun clearVersionError() { _state.update { it.copy(versionError = null) } }

    /** 客户端内一键更新：下载最新 APK 并调起系统安装器（回调切回主线程） */
    fun startInAppUpdate(onProgress: (Int) -> Unit, onError: (String) -> Unit) {
        updateChecker.downloadAndInstall(
            onProgress = { p -> scope.launch { onProgress(p) } },
            onError = { e -> scope.launch { onError(e) } },
        )
    }

    private fun defaultApkUrl(version: String): String {
        val v = version.removePrefix("v").ifBlank { AppClientVersion }
        return "https://gitee.com/peng-minghang/mctier/releases/download/v$v/MCTier-Android.apk"
    }

    fun downloadRemoteFile(
        entry: RemoteShareEntry,
        file: RemoteFileInfo,
        password: String?,
        onResult: (String) -> Unit,
        onError: (String) -> Unit,
    ) {
        val key = downloadKey(entry, file)
        if (downloadJobs[key]?.isActive == true) return
        canceledDownloads.remove(key)

        val job = ioScope.launch {
            runCatching {
                remoteFileClient.download(entry.ownerIp, entry.shareId, file.path, file.name, password, onProgress = { downloaded, total ->
                    val pct = if (total > 0) ((downloaded * 100) / total).toInt().coerceIn(0, 100) else -1
                    scope.launch { _state.update { it.copy(downloadProgress = it.downloadProgress + (key to pct)) } }
                }, isCanceled = { key in canceledDownloads || downloadJobs[key]?.isCancelled == true },
                    onCall = { call -> downloadCancelers[key] = { call.cancel() } })
            }
                .onSuccess { savedPath ->
                    downloadJobs.remove(key)
                    downloadCancelers.remove(key)
                    canceledDownloads.remove(key)
                    scope.launch {
                        // 持久记录下载路径，供文件页常驻展示（最多保留最近 20 条）
                        _state.update { s ->
                            s.copy(
                                downloadedFiles = (listOf(savedPath) + s.downloadedFiles).distinct().take(20),
                                downloadProgress = s.downloadProgress - key,
                            )
                        }
                        onResult(savedPath)
                    }
                }
                .onFailure { e ->
                    val wasCanceled = key in canceledDownloads || e is CancellationException
                    downloadJobs.remove(key)
                    downloadCancelers.remove(key)
                    canceledDownloads.remove(key)
                    scope.launch { _state.update { it.copy(downloadProgress = it.downloadProgress - key) } }
                    scope.launch {
                        onError(if (wasCanceled) "Download canceled. Tap again to resume." else e.message ?: "Download failed")
                    }
                }
        }
        downloadJobs[key] = job
        _state.update { it.copy(downloadProgress = it.downloadProgress + (key to -1)) }
    }

    fun downloadRemoteFiles(
        entry: RemoteShareEntry,
        files: List<RemoteFileInfo>,
        password: String?,
        onResult: (String) -> Unit,
        onError: (String) -> Unit,
    ) {
        files.filterNot { it.isDir }.forEach { file ->
            downloadRemoteFile(entry, file, password, onResult, onError)
        }
    }

    fun cancelRemoteDownload(entry: RemoteShareEntry, file: RemoteFileInfo) {
        val key = downloadKey(entry, file)
        canceledDownloads.add(key)
        downloadCancelers.remove(key)?.invoke()
        downloadJobs[key]?.cancel(CancellationException("Download canceled"))
        _state.update { it.copy(downloadProgress = it.downloadProgress - key) }
    }

    fun downloadKey(entry: RemoteShareEntry, file: RemoteFileInfo): String =
        "${entry.ownerId}:${entry.shareId}:${file.path}"

    fun startViewingScreen(share: ScreenShareInfo, password: String?) {
        screenController?.startViewing(share.id, share.playerId, _state.value.settings.playerName, password)
        _state.update { it.copy(viewingShareId = share.id) }
    }

    fun stopViewingScreen() {
        screenController?.stopViewing(notify = true)
        _state.update { it.copy(viewingShareId = null) }
    }

    /** 开始共享自己的屏幕（需传入 MediaProjection 授权数据） */
    fun startScreenCapture(data: Intent, requirePassword: Boolean, password: String?) {
        val playerId = _state.value.playerId
        val playerName = _state.value.settings.playerName
        val shareId = "share-$playerId-${System.currentTimeMillis()}"
        // 先在本地显示"正在共享"
        val share = ScreenShareInfo(shareId, playerId, playerName, requirePassword)
        _state.update { it.copy(screenShares = it.screenShares.filterNot { s -> s.playerId == playerId } + share) }
        // 启动前台服务（mediaProjection 类型）
        ScreenCaptureService.start(appContext)
        // 【关键修复】前台服务是异步启动的，必须等它就绪后再获取 MediaProjection 采集，
        // 否则 Android 10+/14 会抛"需要 mediaProjection 前台服务"异常导致采集起不来、对方看不到画面。
        // 采集就绪后再向大厅通告，避免观看者过早发起 offer 时本机尚未在共享。
        scope.launch {
            delay(800)
            screenController?.startSharing(shareId, data, password)
            delay(400)
            signalingClient.send(
                SignalingEnvelope(
                    type = "screen-share-start", from = playerId, shareId = shareId,
                    playerName = playerName, hasPassword = requirePassword, password = password?.takeIf { it.isNotBlank() },
                ),
            )
        }
    }

    fun stopScreenCapture() {
        val playerId = _state.value.playerId
        val myShare = _state.value.screenShares.firstOrNull { it.playerId == playerId }
        screenController?.stopSharing()
        ScreenCaptureService.stop(appContext)
        if (myShare != null) signalingClient.send(SignalingEnvelope(type = "screen-share-stop", from = playerId, shareId = myShare.id))
        _state.update { it.copy(screenShares = it.screenShares.filterNot { it.playerId == playerId }) }
    }

    // ========================= 远程控制（被控端） =========================
    /** 拒绝当前收到的远程控制请求 */
    fun rejectRemoteControl() {
        val req = _state.value.remoteControlRequest ?: pendingRcRequest ?: return
        remoteControlController?.reject(req.sessionId, req.fromId)
        pendingRcRequest = null
        _state.update { it.copy(remoteControlRequest = null) }
    }

    /** 开始接受流程：暂存请求并关闭弹窗，返回请求供 UI 去申请 MediaProjection 授权 */
    fun beginAcceptRemoteControl(): top.pmh13.mctier.data.RemoteControlRequest? {
        val req = _state.value.remoteControlRequest ?: return null
        pendingRcRequest = req
        _state.update { it.copy(remoteControlRequest = null) }
        return req
    }

    /** 拿到 MediaProjection 授权后真正接受：启动前台服务→采集屏幕→发送 accept */
    fun acceptRemoteControl(projectionData: Intent) {
        val req = pendingRcRequest ?: return
        pendingRcRequest = null
        ScreenCaptureService.start(appContext)
        scope.launch {
            delay(800)
            remoteControlController?.accept(projectionData, req.sessionId, req.fromId, req.fromName)
        }
    }

    /** 停止被远程控制 */
    fun stopRemoteControl() {
        remoteControlController?.stop(notify = true)
        ScreenCaptureService.stop(appContext)
    }

    /** 发起远程控制对方设备（本机作为控制端） */
    fun requestRemoteControl(targetId: String, targetName: String) {
        remoteControlController?.localPlayerName = _state.value.settings.playerName.ifBlank { "玩家" }
        remoteControlController?.requestControl(targetId, targetName)
    }

    fun announceScreenShare(requirePassword: Boolean, password: String?) {
        val current = _state.value
        val share = ScreenShareInfo("share-${current.playerId}-${System.currentTimeMillis()}", current.playerId, current.settings.playerName, requirePassword)
        _state.update { it.copy(screenShares = it.screenShares + share) }
        signalingClient.send(
            SignalingEnvelope(
                type = "screen-share-start",
                from = current.playerId,
                shareId = share.id,
                playerName = current.settings.playerName,
                hasPassword = requirePassword,
                password = password?.takeIf { it.isNotBlank() },
            ),
        )
    }

    private fun handleSignal(message: SignalingEnvelope) {
        rtcController.handleSignal(message)
        when (message.type) {
            "version-too-old" -> {
                // 服务器判定客户端版本过低：拦截、退出大厅并要求强制更新
                val alert = top.pmh13.mctier.data.VersionAlert(
                    current = message.currentVersion ?: AppClientVersion,
                    minimum = message.minimumVersion ?: "",
                    downloadUrl = message.downloadUrl ?: defaultApkUrl(message.minimumVersion ?: ""),
                )
                _state.update { it.copy(versionError = alert, state = AppConnectionState.Error, error = L("客户端版本过低，请更新后再使用", "Client version too low, please update")) }
                scope.launch { runCatching { leaveLobby() } }
            }
            "register-success" -> {
                _state.update { it.copy(hostId = message.hostId, maxPlayers = message.maxPlayers, isPublicLobby = message.isPublic ?: false, mutedPlayers = message.mutedPlayers?.toSet() ?: it.mutedPlayers) }
                // 请求大厅内其他玩家的文件共享列表
                refreshRemoteSharesByHttp()
            }
            "players-list" -> {
                val remotes = message.players.orEmpty().map {
                    Player(it.playerId, it.playerName, it.virtualIp, it.virtualDomain, it.useDomain ?: false)
                }
                _state.update { it.copy(players = mergePlayers(it.players, remotes)) }
                recordRecentPlayers(remotes.map { it.name })
                backfillRemoteShareIps()
                // 与所有其他玩家建立语音连接（发起规则由 RtcController 内部按 ID 字典序决定）
                val others = remotes.map { it.id }.filter { it != _state.value.playerId }
                rtcController.connectToPlayers(others)
                // 更新 P2P 聊天 peer 列表
                chatClient?.setPeers(_state.value.players.filter { it.id != _state.value.playerId }.mapNotNull { it.virtualIp })
                // 玩家列表变化后，主动重发一次自己的共享，确保新加入/刚获取 IP 的玩家能看到
                if (_state.value.sharedFolders.isNotEmpty()) broadcastMyShares()
            }
            "player-joined" -> {
                val id = message.playerId ?: return
                val name = message.playerName ?: L("未知玩家", "Unknown player")
                _state.update { it.copy(players = mergePlayers(it.players, listOf(Player(id, name, message.virtualIp, message.virtualDomain, message.useDomain ?: false)))) }
                if (id != _state.value.playerId) {
                    // 该玩家可能是断线重连后“重新加入”，先移除可能存在的旧连接再重建，避免悬空连接导致语音失效
                    rtcController.removePeer(id)
                    rtcController.connectToPlayer(id)
                }
                backfillRemoteShareIps()
                chatClient?.setPeers(_state.value.players.filter { it.id != _state.value.playerId }.mapNotNull { it.virtualIp })
                if (id != _state.value.playerId) {
                    soundManager.playerJoin()
                    // 有新玩家加入时，把自己的文件共享列表推送给对方，确保对方能看到我的共享
                    if (_state.value.sharedFolders.isNotEmpty()) broadcastMyShares()
                    // 房主把当前公告补发给新加入者，确保新人进来即见
                    if (isHost && _state.value.announcement.isNotBlank()) {
                        scope.launch {
                            delay(1500)
                            chatClient?.sendAnnounce(_state.value.settings.playerName, _state.value.announcement)
                        }
                    }
                    // 把自己的语音小队组别告知新加入者，确保小队听音一致
                    if (_state.value.myVoiceGroup != 0) {
                        scope.launch {
                            delay(1800)
                            chatClient?.sendVoiceGroup(_state.value.settings.playerName, _state.value.myVoiceGroup)
                        }
                    }
                }
            }
            "player-left" -> {
                val id = message.playerId ?: return
                _state.update { it.copy(players = it.players.filterNot { player -> player.id == id }) }
                soundManager.playerLeave()
            }
            "status-update" -> {
                val id = message.clientId ?: message.playerId ?: message.from ?: return
                _state.update { it.copy(players = it.players.map { player -> if (player.id == id) player.copy(micEnabled = message.micEnabled ?: false) else player }) }
            }
            "chat-message" -> {
                // 已废弃：聊天改为 P2P（14540）传输，不再走信令
            }
            "host-changed" -> _state.update { it.copy(hostId = message.hostId) }
            "player-mute-changed" -> {
                val id = message.playerId ?: return
                val muted = message.muted ?: false
                _state.update {
                    val set = it.mutedPlayers.toMutableSet().apply { if (muted) add(id) else remove(id) }
                    it.copy(mutedPlayers = set)
                }
                // 自己被禁言：强制关麦
                if (id == _state.value.playerId && muted && _state.value.micEnabled) {
                    rtcController.setMicEnabled(false)
                }
            }
            "kicked" -> {
                _state.update { it.copy(error = message.reason ?: message.content ?: L("你已被房主移出大厅", "You have been removed from the lobby by the host")) }
                leaveLobby()
            }
            "lobby-options-changed" -> _state.update { it.copy(maxPlayers = message.maxPlayers, isPublicLobby = message.isPublic ?: it.isPublicLobby) }
            "screen-share-start" -> {
                val from = message.from ?: return
                if (from == _state.value.playerId) return
                val share = ScreenShareInfo(message.shareId ?: return, from, message.playerName ?: L("未知玩家", "Unknown player"), message.hasPassword ?: false)
                _state.update { it.copy(screenShares = it.screenShares.filterNot { s -> s.id == share.id } + share) }
            }
            "screen-share-stop" -> {
                _state.update { it.copy(screenShares = it.screenShares.filterNot { share -> share.id == message.shareId }) }
                if (_state.value.viewingShareId == message.shareId) {
                    screenController?.stopViewing(notify = false)
                    _state.update { it.copy(viewingShareId = null) }
                }
            }
            "screen-share-answer", "screen-share-ice-candidate", "screen-share-offer", "screen-share-viewer-left" -> screenController?.handleSignal(message)
            "remote-control-request", "remote-control-offer", "remote-control-ice", "remote-control-stop", "remote-control-accept", "remote-control-answer", "remote-control-reject" -> remoteControlController?.handleSignal(message)
            "screen-share-error" -> {
                if (message.shareId != null && _state.value.viewingShareId == message.shareId) {
                    screenController?.stopViewing(notify = false)
                    _state.update { it.copy(viewingShareId = null, error = message.error ?: L("无法观看该屏幕", "Cannot view this screen")) }
                }
            }
            "file-share-list-request" -> {
                Log.i(TAG, "File share signaling request ignored; shares are discovered over HTTP")
                return
                val requester = message.from ?: return
                if (requester == _state.value.playerId) return
                // 回应自己的共享列表
                val myShares = _state.value.sharedFolders.map {
                    FileShareWire(
                        shareId = it.id,
                        shareName = it.name,
                        playerName = _state.value.settings.playerName,
                        hasPassword = it.password != null,
                    )
                }
                signalingClient.send(
                    SignalingEnvelope(
                        type = "file-share-list-response",
                        from = _state.value.playerId,
                        to = requester,
                        shares = myShares,
                    ),
                )
            }
            "file-share-list-response" -> {
                val from = message.from ?: return
                if (from == _state.value.playerId) return
                val ownerIp = _state.value.players.firstOrNull { it.id == from }?.virtualIp ?: ""
                val ownerName = _state.value.players.firstOrNull { it.id == from }?.name ?: message.playerName ?: L("玩家", "Player")
                val entries = message.shares.orEmpty().map { w ->
                    RemoteShareEntry(
                        shareId = w.shareId,
                        shareName = w.shareName,
                        ownerId = from,
                        ownerName = w.playerName.ifBlank { ownerName },
                        ownerIp = ownerIp,
                        hasPassword = w.hasPassword,
                    )
                }
                Log.i(TAG, "收到文件共享列表 from=$from ownerIp=$ownerIp 共 ${entries.size} 项")
                _state.update {
                    val others = it.remoteShares.filterNot { e -> e.ownerId == from }
                    it.copy(remoteShares = others + entries)
                }
            }
        }
    }

    private fun mergePlayers(existing: List<Player>, incoming: List<Player>): List<Player> {
        val map = linkedMapOf<String, Player>()
        existing.forEach { map[it.id] = it }
        incoming.forEach { map[it.id] = it }
        return map.values.toList()
    }

    // ==================== 自定义节点管理（增/删/改） ====================
    fun addCustomNode(name: String, address: String) {
        if (name.isBlank() || address.isBlank()) return
        if (!Regex("^(tcp|udp|ws|wss|txt)://.+").matches(address.trim())) return
        val node = CustomNode(name.trim(), address.trim())
        val list = _state.value.customNodes.filterNot { it.address == node.address } + node
        saveCustomNodes(list)
        _state.update { it.copy(customNodes = list) }
    }

    fun removeCustomNode(address: String) {
        val list = _state.value.customNodes.filterNot { it.address == address }
        saveCustomNodes(list)
        _state.update { it.copy(customNodes = list) }
    }

    fun editCustomNode(oldAddress: String, name: String, address: String) {
        if (name.isBlank() || address.isBlank()) return
        val list = _state.value.customNodes.map {
            if (it.address == oldAddress) CustomNode(name.trim(), address.trim()) else it
        }
        saveCustomNodes(list)
        _state.update { it.copy(customNodes = list) }
    }

    private fun loadCustomNodes(): List<CustomNode> = runCatching {
        prefs.getString("customNodes", null)?.let { MctierJson.decodeFromString(ListSerializer(CustomNode.serializer()), it) }
    }.getOrNull().orEmpty()

    private fun saveCustomNodes(list: List<CustomNode>) {
        prefs.edit { putString("customNodes", MctierJson.encodeToString(ListSerializer(CustomNode.serializer()), list)) }
    }

    // ==================== 新手引导 / 自动大厅 ====================
    fun dismissOnboarding() {
        prefs.edit { putBoolean("onboarded", true) }
        _state.update { it.copy(showOnboarding = false) }
    }

    private var autoJoinTried = false
    fun maybeAutoJoin() {
        if (autoJoinTried) return
        autoJoinTried = true
        val s = _state.value.settings
        if (s.autoLobbyEnabled && s.autoLobbyName.isNotBlank() && s.autoLobbyPassword.length >= 4) {
            createOrJoinLobby(s.autoLobbyName, s.autoLobbyPassword)
        }
    }

    // ==================== 公开广场 / 收藏 / 最近 / 大厅设置 ====================
    fun fetchPublicLobbies() {
        val url = _state.value.settings.signalingServer.ifBlank { DefaultSignalingServer }
        _state.update { it.copy(publicLoading = true) }
        publicLobbyClient.fetch(
            url,
            onResult = { list -> scope.launch { _state.update { it.copy(publicLobbies = list, publicLoading = false) } } },
            onError = { scope.launch { _state.update { it.copy(publicLoading = false) } } },
        )
    }

    fun setLobbyOptions(maxPlayers: Int?, isPublic: Boolean, description: String, publicPassword: String?) {
        signalingClient.send(
            SignalingEnvelope(
                type = "set-lobby-options",
                from = _state.value.playerId,
                maxPlayers = maxPlayers,
                isPublic = isPublic,
                description = description.ifBlank { null },
                password = publicPassword?.takeIf { it.isNotBlank() },
                // 公开时附带房主使用的节点地址，供广场加入者自动同步
                serverNode = if (isPublic) _state.value.settings.preferredServer.takeIf { it.isNotBlank() } else null,
            ),
        )
        _state.update { it.copy(maxPlayers = maxPlayers, isPublicLobby = isPublic) }
    }

    fun addFavorite(name: String, password: String, note: String = "") {
        if (name.isBlank()) return
        val fav = FavoriteLobby(name.trim(), password, note)
        val list = (_state.value.favorites.filterNot { it.name == fav.name && it.password == fav.password } + fav)
        saveFavorites(list)
        _state.update { it.copy(favorites = list) }
    }

    fun removeFavorite(name: String, password: String) {
        val list = _state.value.favorites.filterNot { it.name == name && it.password == password }
        saveFavorites(list)
        _state.update { it.copy(favorites = list) }
    }

    /** 使用某收藏时记一次（次数+1、更新时间），用于按最近使用排序 */
    fun touchFavorite(name: String, password: String) {
        val now = System.currentTimeMillis()
        val list = _state.value.favorites.map {
            if (it.name == name && it.password == password) it.copy(useCount = it.useCount + 1, lastUsedAt = now) else it
        }
        saveFavorites(list)
        _state.update { it.copy(favorites = list) }
    }

    fun clearRecentLobbies() {
        saveRecentLobbies(emptyList())
        _state.update { it.copy(recentLobbies = emptyList()) }
    }

    fun clearRecentPlayers() {
        saveRecentPlayers(emptyList())
        _state.update { it.copy(recentPlayers = emptyList()) }
    }

    private fun recordRecentLobby(name: String, password: String) {
        val entry = RecentLobby(name, password, System.currentTimeMillis())
        val list = (listOf(entry) + _state.value.recentLobbies.filterNot { it.name == name && it.password == password }).take(20)
        saveRecentLobbies(list)
        _state.update { it.copy(recentLobbies = list) }
    }

    private fun recordRecentPlayers(names: List<String>) {
        if (names.isEmpty()) return
        val now = System.currentTimeMillis()
        val map = LinkedHashMap<String, RecentPlayer>()
        _state.value.recentPlayers.forEach { map[it.name] = it }
        names.filter { it.isNotBlank() }.forEach { n ->
            val prev = map[n]
            map[n] = RecentPlayer(n, now, (prev?.count ?: 0) + 1)
        }
        val list = map.values.sortedByDescending { it.lastSeen }.take(50)
        saveRecentPlayers(list)
        _state.update { it.copy(recentPlayers = list) }
    }

    private fun loadFavorites(): List<FavoriteLobby> = runCatching {
        prefs.getString("favorites", null)?.let { MctierJson.decodeFromString(ListSerializer(FavoriteLobby.serializer()), it) }
    }.getOrNull().orEmpty()

    private fun saveFavorites(list: List<FavoriteLobby>) {
        prefs.edit { putString("favorites", MctierJson.encodeToString(ListSerializer(FavoriteLobby.serializer()), list)) }
    }

    private fun loadRecentLobbies(): List<RecentLobby> = runCatching {
        prefs.getString("recentLobbies", null)?.let { MctierJson.decodeFromString(ListSerializer(RecentLobby.serializer()), it) }
    }.getOrNull().orEmpty()

    private fun saveRecentLobbies(list: List<RecentLobby>) {
        prefs.edit { putString("recentLobbies", MctierJson.encodeToString(ListSerializer(RecentLobby.serializer()), list)) }
    }

    private fun loadRecentPlayers(): List<RecentPlayer> = runCatching {
        prefs.getString("recentPlayers", null)?.let { MctierJson.decodeFromString(ListSerializer(RecentPlayer.serializer()), it) }
    }.getOrNull().orEmpty()

    private fun saveRecentPlayers(list: List<RecentPlayer>) {
        prefs.edit { putString("recentPlayers", MctierJson.encodeToString(ListSerializer(RecentPlayer.serializer()), list)) }
    }

    // ==================== 收藏队友（本地存储，按名字） ====================
    fun toggleFavoritePlayer(name: String) {
        if (name.isBlank()) return
        val list = if (_state.value.favoritePlayers.contains(name))
            _state.value.favoritePlayers - name
        else _state.value.favoritePlayers + name
        prefs.edit { putString("favoritePlayers", MctierJson.encodeToString(ListSerializer(String.serializer()), list)) }
        _state.update { it.copy(favoritePlayers = list) }
    }

    private fun loadFavoritePlayers(): List<String> = runCatching {
        prefs.getString("favoritePlayers", null)?.let { MctierJson.decodeFromString(ListSerializer(String.serializer()), it) }
    }.getOrNull().orEmpty()

    // ==================== 房间工具：待办 + 倒计时 ====================
    /** 提交并广播待办列表（后写覆盖），全队同步 */
    private fun commitTodos(list: List<TodoItem>) {
        saveTodos(list)
        _state.update { it.copy(todos = list) }

    }

    fun addTodo(text: String) {
        if (text.isBlank()) return
        val item = TodoItem(
            id = "todo-${_state.value.playerId}-${System.currentTimeMillis()}",
            text = text.trim(),
            creator = _state.value.settings.playerName,
            ts = System.currentTimeMillis(),
        )
        commitTodos(_state.value.todos + item)
    }

    fun toggleTodo(id: String) {
        commitTodos(_state.value.todos.map { if (it.id == id) it.copy(done = !it.done) else it })
    }

    fun removeTodo(id: String) {
        commitTodos(_state.value.todos.filterNot { it.id == id })
    }

    fun clearDoneTodos() {
        commitTodos(_state.value.todos.filterNot { it.done })
    }

    // ==================== 房间工具：共享剪贴板 ====================
    // ==================== 邀请 Deep Link ====================
    /** 解析 deep link 并预填加入信息（仅填表，不自动连接） */
    fun applyDeepLink(name: String, pwd: String) {
        if (name.isBlank()) return
        _state.update { it.copy(pendingJoin = top.pmh13.mctier.data.DeepLinkJoin(name.trim(), pwd)) }
    }

    /** 消费预填加入信息（UI 填好后调用，避免重复预填） */
    fun consumePendingJoin() {
        _state.update { it.copy(pendingJoin = null) }
    }

    // ==================== 房间工具：共享白板 ====================
    // ==================== 数据统计（纯本地） ====================
    private fun bucketOf(ts: Long): Int {
        val h = java.util.Calendar.getInstance().apply { timeInMillis = ts }.get(java.util.Calendar.HOUR_OF_DAY)
        return when { h < 6 -> 0; h < 12 -> 1; h < 18 -> 2; else -> 3 }
    }

    private fun statsStartSession() {
        val now = System.currentTimeMillis()
        prefs.edit {
            if (prefs.getLong("stats_firstUse", 0L) == 0L) putLong("stats_firstUse", now)
            putInt("stats_joinCount", prefs.getInt("stats_joinCount", 0) + 1)
            val b = bucketOf(now)
            putInt("stats_bucket_$b", prefs.getInt("stats_bucket_$b", 0) + 1)
            putLong("stats_sessionStart", now)
        }
    }

    private fun statsEndSession(isHost: Boolean) {
        val start = prefs.getLong("stats_sessionStart", 0L)
        if (start <= 0L) return
        val now = System.currentTimeMillis()
        val dur = now - start
        prefs.edit {
            if (dur > 0) {
                putLong("stats_total", prefs.getLong("stats_total", 0L) + dur)
                if (dur > prefs.getLong("stats_maxSession", 0L)) putLong("stats_maxSession", dur)
            }
            if (isHost) putInt("stats_hostCount", prefs.getInt("stats_hostCount", 0) + 1)
            else putInt("stats_memberCount", prefs.getInt("stats_memberCount", 0) + 1)
            putLong("stats_lastOnline", now)
            putLong("stats_sessionStart", 0L)
        }
        // 记录一场开黑（时长 >= 30 秒才算有效，最多保留 50 场）
        if (dur >= 30000) {
            val rec = top.pmh13.mctier.data.SessionRecord(start, dur, isHost)
            val list = (listOf(rec) + getSessions()).take(50)
            runCatching {
                prefs.edit { putString("stats_sessions", MctierJson.encodeToString(ListSerializer(top.pmh13.mctier.data.SessionRecord.serializer()), list)) }
            }
        }
    }

    /** 读取开黑记录（最新在前） */
    fun getSessions(): List<top.pmh13.mctier.data.SessionRecord> = runCatching {
        val raw = prefs.getString("stats_sessions", null) ?: return emptyList()
        MctierJson.decodeFromString(ListSerializer(top.pmh13.mctier.data.SessionRecord.serializer()), raw)
    }.getOrNull().orEmpty()

    fun getStats(): top.pmh13.mctier.data.LocalStats {
        val total = prefs.getLong("stats_total", 0L)
        val joinCount = prefs.getInt("stats_joinCount", 0)
        val firstUse = prefs.getLong("stats_firstUse", 0L)
        val buckets = (0..3).map { prefs.getInt("stats_bucket_$it", 0) }
        var mostBucket = -1; var maxB = 0
        buckets.forEachIndexed { i, v -> if (v > maxB) { maxB = v; mostBucket = i } }
        val partners = _state.value.recentPlayers.sortedByDescending { it.count }
        val usedDays = if (firstUse > 0) maxOf(1, Math.ceil((System.currentTimeMillis() - firstUse) / 86400000.0).toInt()) else 0
        return top.pmh13.mctier.data.LocalStats(
            totalOnlineMs = total,
            joinCount = joinCount,
            hostCount = prefs.getInt("stats_hostCount", 0),
            memberCount = prefs.getInt("stats_memberCount", 0),
            maxSessionMs = prefs.getLong("stats_maxSession", 0L),
            avgSessionMs = if (joinCount > 0) total / joinCount else 0L,
            firstUseTs = firstUse,
            lastOnlineTs = prefs.getLong("stats_lastOnline", 0L),
            usedDays = usedDays,
            buckets = buckets,
            mostActiveBucket = mostBucket,
            partners = partners,
            uniquePartners = partners.size,
            hasData = joinCount > 0 || total > 0 || partners.isNotEmpty(),
        )
    }

    fun clearStats() {
        prefs.edit {
            remove("stats_total"); remove("stats_joinCount"); remove("stats_hostCount")
            remove("stats_memberCount"); remove("stats_maxSession"); remove("stats_firstUse")
            remove("stats_lastOnline"); remove("stats_sessionStart")
            remove("stats_sessions")
            (0..3).forEach { remove("stats_bucket_$it") }
        }
        clearRecentPlayers()
    }

    private var countdownJob: kotlinx.coroutines.Job? = null
    fun startCountdown(seconds: Int) {
        if (seconds <= 0) return
        countdownJob?.cancel()
        _state.update { it.copy(countdownRemaining = seconds, countdownRunning = true) }
        countdownJob = scope.launch {
            var remain = seconds
            while (remain > 0 && _state.value.countdownRunning) {
                kotlinx.coroutines.delay(1000)
                remain -= 1
                _state.update { it.copy(countdownRemaining = remain) }
            }
            if (remain <= 0) {
                _state.update { it.copy(countdownRunning = false) }
                playBeeps()
            }
        }
    }

    fun stopCountdown() {
        countdownJob?.cancel()
        countdownJob = null
        _state.update { it.copy(countdownRunning = false, countdownRemaining = 0) }
    }

    private fun playBeeps() {
        ioScope.launch {
            runCatching {
                val tone = android.media.ToneGenerator(android.media.AudioManager.STREAM_MUSIC, 100)
                repeat(3) {
                    tone.startTone(android.media.ToneGenerator.TONE_PROP_BEEP, 250)
                    kotlinx.coroutines.delay(400)
                }
                kotlinx.coroutines.delay(300)
                tone.release()
            }
        }
    }

    private fun loadTodos(): List<TodoItem> = runCatching {
        prefs.getString("todos", null)?.let { MctierJson.decodeFromString(ListSerializer(TodoItem.serializer()), it) }
    }.getOrNull().orEmpty()

    private fun saveTodos(list: List<TodoItem>) {
        prefs.edit { putString("todos", MctierJson.encodeToString(ListSerializer(TodoItem.serializer()), list)) }
    }

    private fun defaultDevicePlayerName(): String {
        val manufacturer = Build.MANUFACTURER.orEmpty().trim()
        val model = Build.MODEL.orEmpty().trim()
        val name = when {
            model.isBlank() -> manufacturer
            manufacturer.isBlank() -> model
            model.startsWith(manufacturer, ignoreCase = true) -> model
            else -> "$manufacturer $model"
        }.trim()
        return normalizePlayerName(name.ifBlank { UserSettings().playerName })
    }

    private fun storedPlayerNameOrDeviceName(): String {
        val saved = prefs.getString("playerName", null)?.trim()
        val oldDefault = UserSettings().playerName
        return if (saved.isNullOrBlank() || saved == oldDefault || saved == "Android 玩家") {
            defaultDevicePlayerName()
        } else {
            normalizePlayerName(saved)
        }
    }

    private fun loadSettings(): UserSettings = UserSettings(
        playerName = storedPlayerNameOrDeviceName(),
        preferredServer = prefs.getString("preferredServer", null) ?: UserSettings().preferredServer,
        signalingServer = prefs.getString("signalingServer", null) ?: UserSettings().signalingServer,
        useDomain = prefs.getBoolean("useDomain", false),
        virtualDomain = prefs.getString("virtualDomain", null).orEmpty(),
        autoLobbyEnabled = prefs.getBoolean("autoLobbyEnabled", false),
        autoLobbyName = prefs.getString("autoLobbyName", null).orEmpty(),
        autoLobbyPassword = prefs.getString("autoLobbyPassword", null).orEmpty(),
        enableExitNode = prefs.getBoolean("enableExitNode", false),
        enableAsExitNode = prefs.getBoolean("enableAsExitNode", false),
        proxyCidrs = prefs.getString("proxyCidrs", null).orEmpty(),
        exitNodes = prefs.getString("exitNodes", null).orEmpty(),
        mtu = prefs.getInt("mtu", 1420),
        latencyFirst = prefs.getBoolean("latencyFirst", true),
        multiThread = prefs.getBoolean("multiThread", true),
        useSmoltcp = prefs.getBoolean("useSmoltcp", false),
        enableKcpProxy = prefs.getBoolean("enableKcpProxy", false),
        enableQuicProxy = prefs.getBoolean("enableQuicProxy", false),
        disableP2p = prefs.getBoolean("disableP2p", false),
        disableUdpHolePunching = prefs.getBoolean("disableUdpHolePunching", false),
        relayAllPeerRpc = prefs.getBoolean("relayAllPeerRpc", false),
        compressionZstd = prefs.getBoolean("compressionZstd", false),
        privateMode = prefs.getBoolean("privateMode", false),
        lobbyUseGlobalConfig = prefs.getBoolean("lobbyUseGlobalConfig", true),
        customSoundMsg = prefs.getString("customSoundMsg", null).orEmpty(),
        customSoundJoin = prefs.getString("customSoundJoin", null).orEmpty(),
        customSoundLeave = prefs.getString("customSoundLeave", null).orEmpty(),
        soundMuted = prefs.getBoolean("soundMuted", false),
        soundMutedMsg = prefs.getBoolean("soundMutedMsg", prefs.getBoolean("soundMuted", false)),
        soundMutedJoin = prefs.getBoolean("soundMutedJoin", prefs.getBoolean("soundMuted", false)),
        soundMutedLeave = prefs.getBoolean("soundMutedLeave", prefs.getBoolean("soundMuted", false)),
        soundVolume = prefs.getFloat("soundVolume", 1.0f),
        dndEnabled = prefs.getBoolean("dndEnabled", false),
        dndStartMinutes = prefs.getInt("dndStartMinutes", 22 * 60),
        dndEndMinutes = prefs.getInt("dndEndMinutes", 8 * 60),
        themeMode = prefs.getString("themeMode", null) ?: "dark",
        themePrimary = prefs.getString("themePrimary", null).orEmpty(),
        language = prefs.getString("language", null).orEmpty(),
        danmakuEnabled = prefs.getBoolean("danmakuEnabled", true),
        danmakuFontSize = prefs.getInt("danmakuFontSize", 20),
        danmakuSpeed = prefs.getInt("danmakuSpeed", 130),
        danmakuOpacity = prefs.getFloat("danmakuOpacity", 0.9f),
        danmakuTracks = prefs.getInt("danmakuTracks", 4),
        danmakuColor = prefs.getString("danmakuColor", null) ?: "#FFFFFF",
        voicePreset = prefs.getString("voicePreset", null) ?: "none",
    )
}

/** 解析弹幕颜色字符串（如 #FFFFFF），失败回退为白色 */
private fun parseDanmakuColor(s: String): Int =
    runCatching { android.graphics.Color.parseColor(s) }.getOrDefault(android.graphics.Color.WHITE)
