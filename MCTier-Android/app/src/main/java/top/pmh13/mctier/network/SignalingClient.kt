package top.pmh13.mctier.network

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import top.pmh13.mctier.data.AppClientVersion
import top.pmh13.mctier.data.MctierJson
import top.pmh13.mctier.data.SignalingEnvelope
import java.util.concurrent.TimeUnit

class SignalingClient {
    private val client = OkHttpClient.Builder()
        .pingInterval(15, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    @Volatile private var webSocket: WebSocket? = null
    private var reconnectAttempts = 0
    private var connectArgs: ConnectArgs? = null
    @Volatile private var reconnectJob: Job? = null
    @Volatile private var stableJob: Job? = null
    @Volatile private var heartbeatJob: Job? = null

    private val _events = MutableSharedFlow<SignalingEnvelope>(extraBufferCapacity = 64)
    val events: SharedFlow<SignalingEnvelope> = _events

    private val _connected = MutableStateFlow(false)
    val connected: StateFlow<Boolean> = _connected

    fun connect(args: ConnectArgs) {
        connectArgs = args
        reconnectAttempts = 0
        open(args)
    }

    fun send(message: SignalingEnvelope): Boolean {
        val json = MctierJson.encodeToString(SignalingEnvelope.serializer(), message)
        return webSocket?.send(json) == true
    }

    fun close() {
        connectArgs = null
        _connected.value = false
        reconnectJob?.cancel(); reconnectJob = null
        stableJob?.cancel(); stableJob = null
        heartbeatJob?.cancel(); heartbeatJob = null
        runCatching { webSocket?.close(1000, "leave") }
        webSocket = null
    }

    private fun open(args: ConnectArgs) {
        // 先彻底关闭旧连接，避免与服务器形成“重复连接”被来回踢导致信令抖动(flapping)
        webSocket?.let { runCatching { it.cancel() } }
        webSocket = null
        val request = Request.Builder().url(args.url).build()
        val ws = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(ws: WebSocket, response: Response) {
                if (ws !== webSocket) return
                _connected.value = true
                send(
                    SignalingEnvelope(
                        type = "register",
                        clientId = args.playerId,
                        playerName = args.playerName,
                        virtualIp = args.virtualIp,
                        virtualDomain = args.virtualDomain,
                        useDomain = args.useDomain,
                        lobbyName = args.lobbyName,
                        lobbyPassword = args.lobbyPassword,
                        clientVersion = AppClientVersion,
                    ),
                )
                startHeartbeat()
                // 连接稳定 6 秒后才认为重连成功并清零退避；6 秒内被关闭则继续指数退避
                stableJob?.cancel()
                stableJob = scope.launch { delay(6000); if (ws === webSocket) reconnectAttempts = 0 }
            }

            override fun onMessage(ws: WebSocket, text: String) {
                runCatching {
                    MctierJson.decodeFromString(SignalingEnvelope.serializer(), text)
                }.onSuccess { _events.tryEmit(it) }
            }

            override fun onClosed(ws: WebSocket, code: Int, reason: String) {
                if (ws !== webSocket) return // 旧连接的回调，忽略，避免触发重连风暴
                _connected.value = false
                android.util.Log.w("SignalingClient", "WS onClosed code=$code reason=$reason")
                scheduleReconnect()
            }

            override fun onClosing(ws: WebSocket, code: Int, reason: String) {
                android.util.Log.w("SignalingClient", "WS onClosing code=$code reason=$reason")
            }

            override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
                if (ws !== webSocket) return // 旧连接被主动取消触发的失败，忽略
                _connected.value = false
                android.util.Log.e("SignalingClient", "WS onFailure: ${t.message} resp=${response?.code}")
                scheduleReconnect()
            }
        })
        webSocket = ws
    }

    private fun scheduleReconnect() {
        val args = connectArgs ?: return
        reconnectAttempts += 1
        // 快速重连：配合桌面端 3 秒"离线确认窗口"，保证断线后能在 3 秒内重新注册回来，
        // 让桌面端判定为"短时恢复"而不显示离开/加入抖动。连接风暴已由"仅当前连接重连+先关旧连接"挡住。
        // 仅在连续多次快速失败时略微拉长，避免极端情况下空转。
        val delayMs = if (reconnectAttempts <= 5) 800L else 2000L
        reconnectJob?.cancel()
        reconnectJob = scope.launch {
            delay(delayMs)
            if (isActive && connectArgs != null) open(args)
        }
    }

    private fun startHeartbeat() {
        heartbeatJob?.cancel()
        heartbeatJob = scope.launch {
            while (isActive && _connected.value) {
                delay(15_000)
                send(SignalingEnvelope(type = "ping"))
            }
        }
    }
}

data class ConnectArgs(
    val url: String,
    val playerId: String,
    val playerName: String,
    val lobbyName: String,
    val lobbyPassword: String,
    val virtualIp: String,
    val virtualDomain: String?,
    val useDomain: Boolean,
)
