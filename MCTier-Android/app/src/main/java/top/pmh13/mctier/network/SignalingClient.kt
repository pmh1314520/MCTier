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
    @Volatile private var reconnectAttempts = 0
    private var connectArgs: ConnectArgs? = null
    @Volatile private var connectionGeneration = 0L
    @Volatile private var serverSessionGeneration: Long? = null
    @Volatile private var registrationSent = false
    @Volatile private var reconnectJob: Job? = null
    @Volatile private var stableJob: Job? = null
    @Volatile private var heartbeatJob: Job? = null

    private val _events = MutableSharedFlow<SignalingEnvelope>(extraBufferCapacity = 64)
    val events: SharedFlow<SignalingEnvelope> = _events

    private val _connected = MutableStateFlow(false)
    val connected: StateFlow<Boolean> = _connected

    fun connect(args: ConnectArgs) {
        val generation = synchronized(this) {
            connectionGeneration += 1
            connectArgs = args
            reconnectAttempts = 0
            serverSessionGeneration = null
            registrationSent = false
            connectionGeneration
        }
        reconnectJob?.cancel(); reconnectJob = null
        stableJob?.cancel(); stableJob = null
        heartbeatJob?.cancel(); heartbeatJob = null
        _connected.value = false
        open(args, generation)
    }

    fun send(message: SignalingEnvelope): Boolean {
        val outgoing = serverSessionGeneration?.let { generation ->
            if (message.type == "register-v3" || message.type == "server-challenge") message
            else message.copy(sessionGeneration = message.sessionGeneration ?: generation)
        } ?: message
        val json = MctierJson.encodeToString(SignalingEnvelope.serializer(), outgoing)
        return webSocket?.send(json) == true
    }

    fun refreshRegistration(): Boolean {
        val args = connectArgs ?: return false
        if (webSocket == null) return false
        val generation = connectionGeneration
        reconnectJob?.cancel()
        webSocket?.let { runCatching { it.cancel() } }
        webSocket = null
        serverSessionGeneration = null
        registrationSent = false
        _connected.value = false
        reconnectJob = scope.launch {
            delay(200)
            if (isActive && generation == connectionGeneration && connectArgs == args) {
                open(args, generation)
            }
        }
        return true
    }

    fun close() {
        synchronized(this) {
            connectionGeneration += 1
            connectArgs = null
            serverSessionGeneration = null
            registrationSent = false
        }
        _connected.value = false
        reconnectJob?.cancel(); reconnectJob = null
        stableJob?.cancel(); stableJob = null
        heartbeatJob?.cancel(); heartbeatJob = null
        runCatching { webSocket?.close(1000, "leave") }
        webSocket = null
    }

    private fun open(args: ConnectArgs, generation: Long) {
        // 先彻底关闭旧连接，避免与服务器形成“重复连接”被来回踢导致信令抖动(flapping)
        webSocket?.let { runCatching { it.cancel() } }
        webSocket = null
        val request = Request.Builder().url(args.url).build()
        val ws = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(ws: WebSocket, response: Response) {
                if (ws !== webSocket || generation != connectionGeneration) return
                // WebSocket open is only a transport state. The repository must
                // not send lobby traffic until the challenge/register handshake
                // has completed and register-success has been validated.
            }

            override fun onMessage(ws: WebSocket, text: String) {
                if (ws !== webSocket || generation != connectionGeneration) return
                runCatching {
                    MctierJson.decodeFromString(SignalingEnvelope.serializer(), text)
                }.onSuccess { message ->
                    when (message.type) {
                        "server-challenge" -> handleServerChallenge(ws, args, generation, message)
                        "register-success" -> {
                            val assignedId = message.clientId
                            val assignedGeneration = message.sessionGeneration
                            if (assignedId != args.identityId || assignedGeneration == null || assignedGeneration <= 0L) {
                                android.util.Log.e("SignalingClient", "拒绝无效的 v3 注册响应")
                                ws.close(1008, "invalid-register-success")
                                return@onSuccess
                            }
                            serverSessionGeneration = assignedGeneration
                            _connected.value = true
                            startHeartbeat()
                            // 连接稳定 6 秒后才认为重连成功并清零退避；6 秒内被关闭则继续指数退避
                            stableJob?.cancel()
                            stableJob = scope.launch { delay(6000); if (ws === webSocket) reconnectAttempts = 0 }
                            _events.tryEmit(message)
                        }
                        else -> {
                            // A top-level sessionGeneration on player-joined identifies
                            // the joining peer, not this WebSocket. Per-peer generation
                            // checks are applied by the repository when roster events
                            // are merged; never compare another peer's generation to ours.
                            _events.tryEmit(message)
                        }
                    }
                }
            }

            override fun onClosed(ws: WebSocket, code: Int, reason: String) {
                if (ws !== webSocket || generation != connectionGeneration) return // 旧连接的回调，忽略，避免触发重连风暴
                webSocket = null
                serverSessionGeneration = null
                registrationSent = false
                _connected.value = false
                android.util.Log.w("SignalingClient", "WS onClosed code=$code reason=$reason")
                scheduleReconnect(args, generation)
            }

            override fun onClosing(ws: WebSocket, code: Int, reason: String) {
                if (ws !== webSocket || generation != connectionGeneration) return
                android.util.Log.w("SignalingClient", "WS onClosing code=$code reason=$reason")
            }

            override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
                if (ws !== webSocket || generation != connectionGeneration) return // 旧连接被主动取消触发的失败，忽略
                webSocket = null
                serverSessionGeneration = null
                registrationSent = false
                _connected.value = false
                android.util.Log.e("SignalingClient", "WS onFailure: ${t.message} resp=${response?.code}")
                scheduleReconnect(args, generation)
            }
        })
        webSocket = ws
    }

    private fun handleServerChallenge(
        ws: WebSocket,
        args: ConnectArgs,
        generation: Long,
        message: SignalingEnvelope,
    ) {
        if (ws !== webSocket || generation != connectionGeneration || registrationSent) return
        val challenge = message.challenge?.trim().orEmpty()
        if (message.protocolVersion != ChatAuth.SIGNALING_PROTOCOL_VERSION || !isValidChallenge(challenge)) {
            android.util.Log.e("SignalingClient", "拒绝无效的 server-challenge")
            ws.close(1008, "invalid-server-challenge")
            return
        }
        if (args.identityId != args.signer.identityId() || args.chatPublicKey != args.signer.publicKeyBase64()) {
            android.util.Log.e("SignalingClient", "信令身份 ID 与签名公钥不匹配")
            ws.close(1008, "identity-mismatch")
            return
        }
        registrationSent = true
        if (!sendRegistration(args, challenge)) {
            registrationSent = false
            ws.close(1008, "registration-signature-failed")
        }
    }

    private fun isValidChallenge(challenge: String): Boolean =
        challenge.length == 64 && challenge.all { it in '0'..'9' || it in 'a'..'f' }

    private fun sendRegistration(args: ConnectArgs, challenge: String): Boolean {
        val signature = args.signer.signSignalingRegistration(challenge, args.lobbyName, args.virtualIp)
            ?: return false
        // Keep the published key tied to the signer supplied for this lobby.
        val chatPublicKey = args.chatPublicKey
        return send(
            SignalingEnvelope(
                type = "register-v3",
                protocolVersion = ChatAuth.SIGNALING_PROTOCOL_VERSION,
                identityPublicKey = chatPublicKey,
                challengeSignature = signature,
                playerName = args.playerName,
                virtualIp = args.virtualIp,
                lobbyName = args.lobbyName,
                lobbyPassword = args.lobbyPassword,
                clientVersion = AppClientVersion,
                useDomain = args.useDomain,
            ),
        )
    }

    private fun scheduleReconnect(args: ConnectArgs, generation: Long) {
        if (generation != connectionGeneration || connectArgs != args) return
        reconnectAttempts += 1
        // 快速重连：配合桌面端 3 秒"离线确认窗口"，保证断线后能在 3 秒内重新注册回来，
        // 让桌面端判定为"短时恢复"而不显示离开/加入抖动。连接风暴已由"仅当前连接重连+先关旧连接"挡住。
        // 仅在连续多次快速失败时略微拉长，避免极端情况下空转。
        val delayMs = if (reconnectAttempts <= 5) 800L else 2000L
        reconnectJob?.cancel()
        reconnectJob = scope.launch {
            delay(delayMs)
            if (isActive && generation == connectionGeneration && connectArgs == args) open(args, generation)
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
    val identityId: String,
    val playerName: String,
    val lobbyName: String,
    val lobbyPassword: String,
    val virtualIp: String,
    val signer: ChatAuth.ChatSigner,
    val useDomain: Boolean = false,
    val chatPublicKey: String = signer.publicKeyBase64(),
)
