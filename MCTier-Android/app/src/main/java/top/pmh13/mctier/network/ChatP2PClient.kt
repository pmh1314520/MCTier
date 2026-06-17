package top.pmh13.mctier.network

import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.builtins.ListSerializer
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import top.pmh13.mctier.data.ChatSendRequest
import top.pmh13.mctier.data.ChatServerPort
import top.pmh13.mctier.data.ChatWireMessage
import top.pmh13.mctier.data.MctierJson
import top.pmh13.mctier.data.MctierWireJson
import java.util.Collections
import java.util.concurrent.TimeUnit

/**
 * P2P 聊天客户端（与桌面端 14540 P2P 聊天完全互通）
 *
 * - 本机运行 ChatHttpServer 接收他人推送、提供历史拉取
 * - 发送：把消息存进本机 + 并发 POST 到所有 peer 的 /api/chat/send（带一次重试）
 * - 接收：他人 POST 到本机 → 服务器回调；并周期性从所有 peer 对账拉取，补回任何推送失败的消息
 * - 全程按消息 ID 去重，跳过自己已显示的消息
 */
class ChatP2PClient(
    private val playerId: String,
    private val scope: CoroutineScope,
    private val onMessage: (ChatWireMessage) -> Unit,
) {
    private val client = OkHttpClient.Builder()
        .connectTimeout(3, TimeUnit.SECONDS)
        .callTimeout(15, TimeUnit.SECONDS)
        .build()
    private val server = ChatHttpServer(playerId).also { it.onMessageReceived = { m -> accept(m) } }
    private val seen = Collections.synchronizedSet(HashSet<String>())

    @Volatile private var peerIps: List<String> = emptyList()
    @Volatile private var lastTs: Long = 0
    private var reconcileJob: Job? = null

    fun start() {
        runCatching { server.start(5000, false) }.onFailure { Log.w(TAG, "聊天服务器启动失败: ${it.message}") }
        reconcileJob = scope.launch {
            while (isActive) {
                delay(3_000)
                reconcileOnce()
            }
        }
    }

    fun stop() {
        reconcileJob?.cancel()
        reconcileJob = null
        runCatching { server.stop() }
        server.clear()
        seen.clear()
        peerIps = emptyList()
        lastTs = 0
    }

    fun setPeers(ips: List<String>) {
        peerIps = ips.filter { it.isNotBlank() }
    }

    fun sendText(playerName: String, content: String): ChatWireMessage =
        sendInternal(playerName, content, "text", null)

    fun sendImage(playerName: String, imageBytes: List<Int>): ChatWireMessage =
        sendInternal(playerName, "[图片]", "image", imageBytes)

    /** 发送大厅公告（控制消息，不计入聊天记录） */
    fun sendAnnounce(playerName: String, text: String): ChatWireMessage =
        sendInternal(playerName, text, "announce", null)

    /** 广播自己的语音小队组别（控制消息，content 为组号字符串） */
    fun sendVoiceGroup(playerName: String, group: Int): ChatWireMessage =
        sendInternal(playerName, group.toString(), "voicegroup", null)

    /** 共享剪贴板（控制消息，content 为文本） */
    fun sendClipboard(playerName: String, text: String): ChatWireMessage =
        sendInternal(playerName, text, "clipboard", null)

    /** 广播待办列表（控制消息，content 为待办数组 JSON） */
    fun sendTodos(playerName: String, json: String): ChatWireMessage =
        sendInternal(playerName, json, "todo", null)

    /** 广播白板笔画/清空指令（控制消息，content 为 JSON） */
    fun sendWhiteboard(playerName: String, json: String): ChatWireMessage =
        sendInternal(playerName, json, "whiteboard", null)

    private fun sendInternal(playerName: String, content: String, type: String, imageData: List<Int>?): ChatWireMessage {
        val id = "msg-$playerId-${System.currentTimeMillis()}"
        val msg = ChatWireMessage(id, playerId, playerName, content, type, System.currentTimeMillis() / 1000, imageData)
        seen.add(id)
        if (msg.timestamp > lastTs) lastTs = msg.timestamp
        server.addLocal(msg)
        val req = ChatSendRequest(id, playerId, playerName, content, type, imageData)
        val body = MctierWireJson.encodeToString(ChatSendRequest.serializer(), req)
        peerIps.forEach { ip -> scope.launch { postWithRetry(ip, body) } }
        return msg
    }

    /** 收到一条消息（来自本机服务器或对账），去重后回调 UI（跳过自己的） */
    private fun accept(msg: ChatWireMessage) {
        if (msg.timestamp > lastTs) lastTs = msg.timestamp
        if (!seen.add(msg.id)) return
        if (msg.playerId == playerId) return
        onMessage(msg)
    }

    private fun reconcileOnce() {
        val ips = peerIps
        if (ips.isEmpty()) return
        val since = if (lastTs > 20) lastTs - 20 else 0
        ips.forEach { ip ->
            scope.launch {
                runCatching {
                    val url = "http://$ip:$ChatServerPort/api/chat/messages" + if (since > 0) "?since=$since" else ""
                    client.newCall(Request.Builder().url(url).build()).execute().use { resp ->
                        if (resp.isSuccessful) {
                            val text = resp.body?.string().orEmpty()
                            val list = MctierJson.decodeFromString(ListSerializer(ChatWireMessage.serializer()), text)
                            list.sortedBy { it.timestamp }.forEach { accept(it) }
                        }
                    }
                }
            }
        }
    }

    private fun postWithRetry(ip: String, body: String) {
        repeat(2) { attempt ->
            val ok = runCatching {
                val req = Request.Builder()
                    .url("http://$ip:$ChatServerPort/api/chat/send")
                    .post(body.toRequestBody("application/json".toMediaType()))
                    .build()
                client.newCall(req).execute().use { it.isSuccessful }
            }.getOrDefault(false)
            if (ok) return
            if (attempt == 0) Thread.sleep(400)
        }
    }

    private companion object {
        private const val TAG = "ChatP2PClient"
    }
}
