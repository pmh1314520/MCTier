package top.pmh13.mctier.network

import android.util.Log
import fi.iki.elonen.NanoHTTPD
import top.pmh13.mctier.data.ChatSendRequest
import top.pmh13.mctier.data.ChatServerPort
import top.pmh13.mctier.data.ChatWireMessage
import top.pmh13.mctier.data.MctierJson
import java.util.concurrent.CopyOnWriteArrayList

/**
 * P2P 聊天服务器（与桌面端 chat_service.rs 完全互通）
 *
 * - POST /api/chat/send      接收其他玩家推送来的消息（存储 + 回调通知 UI）
 * - GET  /api/chat/messages  返回本机存储的消息（支持 ?since=秒 过滤），供他人对账拉取
 *
 * 发送方会把自己发的消息也存进本机，所以任何 peer 都能从发送方拉到完整历史。
 */
class ChatHttpServer(
    private val ownerId: String,
    bindIp: String = DEFAULT_BIND_IP,
) : NanoHTTPD(bindIp.ifBlank { DEFAULT_BIND_IP }, ChatServerPort) {

    private val messages = CopyOnWriteArrayList<ChatWireMessage>()
    /** 收到他人 POST 的新消息时回调（用于推送到 UI） */
    var onMessageReceived: ((ChatWireMessage) -> Unit)? = null

    /**
     * 大厅身份名册：playerId -> 虚拟 IP。
     *
     * 用于校验 `/api/chat/send` 里自称的 `playerId` 是否与其真实来源 IP 相符，
     * 与桌面端 `chat_service.rs` 的判定规则保持一致。
     */
    @Volatile
    private var peerRoster: Map<String, String> = emptyMap()

    /** 更新身份名册（只保留同时具备 ID 与 IP 的条目） */
    fun setPeerRoster(roster: Map<String, String>) {
        peerRoster = roster.filter { it.key.isNotBlank() && it.value.isNotBlank() }
    }

    /**
     * 允许读取本机聊天记录的成员 IP 集合。
     *
     * 读取类接口（`/api/chat/messages`）不携带 playerId，只能按来源 IP 判断，
     * 因此与发送侧的名册分开维护。集合为空时放行（尚未下发或对端为旧版本）。
     */
    @Volatile
    private var allowedReaders: Set<String> = emptySet()

    /** 更新可读取聊天记录的成员 IP 集合 */
    fun setAllowedReaders(ips: Collection<String>) {
        allowedReaders = ips.filter { it.isNotBlank() }.toSet()
    }

    /** 判断调用方是否有权读取本机聊天记录 */
    internal fun isAllowedReader(remoteIp: String?): Boolean {
        val allowed = allowedReaders
        if (allowed.isEmpty()) return true
        if (remoteIp.isNullOrBlank()) return true
        return allowed.contains(normalizeIp(remoteIp))
    }

    /** 把本机发送的消息加入存储（供他人拉取） */
    fun addLocal(message: ChatWireMessage) {
        messages.add(message)
        trim()
    }

    fun clear() {
        messages.clear()
        peerRoster = emptyMap()
        allowedReaders = emptySet()
    }

    /**
     * 校验消息里自称的 [playerId] 是否确实来自该玩家的虚拟 IP。
     *
     * 同一大厅内任何成员都能直连他人的聊天端口，若完全信任请求体里的 `playerId`，
     * 任意成员都可以伪造成房主或其他玩家发言（含 announce / recall / avatar 等控制消息）。
     *
     * 判定规则与桌面端一致：名册为空、或名册中没有该 playerId 时放行（升级过程与
     * 新玩家刚加入都属正常）；名册中存在但登记 IP 与来源 IP 不一致时判定为冒名。
     */
    internal fun senderIdentityMatches(playerId: String, remoteIp: String?): Boolean {
        val roster = peerRoster
        if (roster.isEmpty() || playerId.isBlank()) return true
        val expected = roster[playerId] ?: return true
        if (remoteIp.isNullOrBlank()) return true
        return expected == normalizeIp(remoteIp)
    }

    /** 归一化来源地址：去掉 IPv6 映射前缀与端口，便于与名册里的 IPv4 文本比较。 */
    private fun normalizeIp(raw: String): String {
        var ip = raw.trim()
        if (ip.startsWith("::ffff:")) ip = ip.removePrefix("::ffff:")
        return ip
    }

    private fun trim() {
        while (messages.size > 1000) messages.removeAt(0)
    }

    private fun messagesSince(since: Long?): List<ChatWireMessage> =
        if (since == null) messages.toList() else messages.filter { it.timestamp > since }

    override fun serve(session: IHTTPSession): Response {
        val origin = LanCors.originOf(session)
        // 预检请求：仅对白名单来源回写跨域头
        if (session.method == Method.OPTIONS) {
            return withCors(newFixedLengthResponse(Response.Status.OK, "text/plain", ""), origin)
        }
        return try {
            when {
                session.uri == "/api/chat/messages" && session.method == Method.GET -> {
                    // 非大厅成员不得拉取聊天历史
                    if (!isAllowedReader(session.remoteIpAddress)) {
                        Log.w(TAG, "拒绝非大厅成员拉取聊天历史：来源 ${session.remoteIpAddress}")
                        withCors(
                            newFixedLengthResponse(Response.Status.FORBIDDEN, "text/plain", "forbidden"),
                            origin,
                        )
                    } else {
                        val since = session.parameters["since"]?.firstOrNull()?.toLongOrNull()
                        json(messagesSince(since), origin)
                    }
                }
                session.uri == "/api/chat/send" && session.method == Method.POST -> handleSend(session, origin)
                else -> withCors(newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "not found"), origin)
            }
        } catch (e: Exception) {
            Log.w(TAG, "处理聊天请求失败: ${e.message}")
            withCors(newFixedLengthResponse(Response.Status.INTERNAL_ERROR, "text/plain", "error"), origin)
        }
    }

    /**
     * 为响应附加跨域头。
     *
     * 只对白名单内的来源回写 `Access-Control-Allow-Origin`（详见 [LanCors]），
     * 避免虚拟网内任意网页在浏览器里读取本机聊天记录。
     */
    private fun withCors(response: Response, origin: String?): Response =
        LanCors.apply(response, origin)

    private fun handleSend(session: IHTTPSession, origin: String?): Response {
        // 【中文乱码修复】不依赖 nanohttpd 的 parseBody（其默认按非 UTF-8 解码请求体，
        // 会把桌面端发来的中文变成乱码），直接按 Content-Length 读原始字节并以 UTF-8 解码。
        val len = session.headers["content-length"]?.toIntOrNull() ?: 0
        val body = if (len > 0) {
            val buf = ByteArray(len)
            var off = 0
            while (off < len) {
                val r = session.inputStream.read(buf, off, len - off)
                if (r < 0) break
                off += r
            }
            String(buf, 0, off, Charsets.UTF_8)
        } else {
            // 兜底：极少数情况下没有 Content-Length，退回 parseBody
            val files = HashMap<String, String>()
            session.parseBody(files)
            files["postData"] ?: session.queryParameterString ?: ""
        }
        val req = MctierJson.decodeFromString(ChatSendRequest.serializer(), body)
        // 身份绑定：拒绝冒用他人 playerId 的消息（含控制类消息）
        if (!senderIdentityMatches(req.playerId, session.remoteIpAddress)) {
            Log.w(TAG, "拒绝冒名消息：自称 ${req.playerId} 但来源为 ${session.remoteIpAddress}")
            return withCors(
                newFixedLengthResponse(Response.Status.FORBIDDEN, "text/plain", "identity mismatch"),
                origin,
            )
        }
        val message = ChatWireMessage(
            id = req.id ?: "msg-${req.playerId}-${System.currentTimeMillis()}",
            playerId = req.playerId,
            playerName = req.playerName,
            content = req.content,
            messageType = req.messageType,
            timestamp = System.currentTimeMillis() / 1000,
            imageData = req.imageData,
        )
        messages.add(message)
        trim()
        onMessageReceived?.invoke(message)
        return json(message, origin)
    }

    private fun json(value: List<ChatWireMessage>, origin: String?): Response =
        withCors(newFixedLengthResponse(
            Response.Status.OK,
            "application/json; charset=utf-8",
            MctierJson.encodeToString(kotlinx.serialization.builtins.ListSerializer(ChatWireMessage.serializer()), value),
        ), origin)

    private fun json(value: ChatWireMessage, origin: String?): Response =
        withCors(newFixedLengthResponse(Response.Status.OK, "application/json; charset=utf-8", MctierJson.encodeToString(ChatWireMessage.serializer(), value)), origin)

    companion object {
        private const val TAG = "ChatHttpServer"

        /** 兜底监听地址：仅在拿不到虚拟 IP 时使用。 */
        const val DEFAULT_BIND_IP = "0.0.0.0"
    }
}
