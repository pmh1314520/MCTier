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
) : NanoHTTPD("0.0.0.0", ChatServerPort) {

    private val messages = CopyOnWriteArrayList<ChatWireMessage>()
    /** 收到他人 POST 的新消息时回调（用于推送到 UI） */
    var onMessageReceived: ((ChatWireMessage) -> Unit)? = null

    /** 把本机发送的消息加入存储（供他人拉取） */
    fun addLocal(message: ChatWireMessage) {
        messages.add(message)
        trim()
    }

    fun clear() = messages.clear()

    private fun trim() {
        while (messages.size > 1000) messages.removeAt(0)
    }

    private fun messagesSince(since: Long?): List<ChatWireMessage> =
        if (since == null) messages.toList() else messages.filter { it.timestamp > since }

    override fun serve(session: IHTTPSession): Response {
        // 预检请求直接放行（对齐桌面端 CorsLayer::permissive）
        if (session.method == Method.OPTIONS) {
            return withCors(newFixedLengthResponse(Response.Status.OK, "text/plain", ""))
        }
        return try {
            when {
                session.uri == "/api/chat/messages" && session.method == Method.GET -> {
                    val since = session.parameters["since"]?.firstOrNull()?.toLongOrNull()
                    json(messagesSince(since))
                }
                session.uri == "/api/chat/send" && session.method == Method.POST -> handleSend(session)
                else -> withCors(newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "not found"))
            }
        } catch (e: Exception) {
            Log.w(TAG, "处理聊天请求失败: ${e.message}")
            withCors(newFixedLengthResponse(Response.Status.INTERNAL_ERROR, "text/plain", "error"))
        }
    }

    /** 为响应附加跨域头，确保桌面端 webview 能直接读取（对齐桌面端 permissive CORS） */
    private fun withCors(response: Response): Response {
        response.addHeader("Access-Control-Allow-Origin", "*")
        response.addHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        response.addHeader("Access-Control-Allow-Headers", "*")
        response.addHeader("Access-Control-Max-Age", "86400")
        return response
    }

    private fun handleSend(session: IHTTPSession): Response {
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
        return json(message)
    }

    private fun json(value: List<ChatWireMessage>): Response =
        withCors(newFixedLengthResponse(
            Response.Status.OK,
            "application/json; charset=utf-8",
            MctierJson.encodeToString(kotlinx.serialization.builtins.ListSerializer(ChatWireMessage.serializer()), value),
        ))

    private fun json(value: ChatWireMessage): Response =
        withCors(newFixedLengthResponse(Response.Status.OK, "application/json; charset=utf-8", MctierJson.encodeToString(ChatWireMessage.serializer(), value)))

    private companion object {
        private const val TAG = "ChatHttpServer"
    }
}
