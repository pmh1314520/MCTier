package top.pmh13.mctier.network

import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import top.pmh13.mctier.data.ChatSendRequest
import top.pmh13.mctier.data.ChatServerPort
import top.pmh13.mctier.data.ChatWireMessage
import top.pmh13.mctier.data.MctierWireJson
import java.util.Collections
import java.util.concurrent.TimeUnit

/**
 * P2P 聊天客户端。
 *
 * [bindIp] 为 EasyTier 分配的虚拟网卡地址，透传给内部的 [ChatHttpServer]，
 * 使聊天服务只监听虚拟网卡而不是 `0.0.0.0`（见 issue #17）。
 */
class ChatP2PClient(
    private val playerId: String,
    private val scope: CoroutineScope,
    bindIp: String = ChatHttpServer.DEFAULT_BIND_IP,
    private val onMessage: (ChatWireMessage) -> Unit,
) {
    private val client = OkHttpClient.Builder()
        .connectTimeout(3, TimeUnit.SECONDS)
        .callTimeout(15, TimeUnit.SECONDS)
        .build()
    private val server = ChatHttpServer(playerId, bindIp).also { it.onMessageReceived = { m -> accept(m) } }
    private val seen = Collections.synchronizedSet(HashSet<String>())

    @Volatile private var peerIps: List<String> = emptyList()

    fun start() {
        runCatching { server.start(5000, false) }
            .onFailure { Log.w(TAG, "Chat server start failed: ${it.message}") }
    }

    fun stop() {
        runCatching { server.stop() }
        server.clear()
        seen.clear()
        peerIps = emptyList()
    }

    fun setPeers(ips: List<String>) {
        peerIps = ips.filter { it.isNotBlank() }
    }

    /**
     * 下发大厅身份名册（playerId -> 虚拟IP，含自己）。
     *
     * 内部聊天服务器据此校验收到的消息是否来自其自称的玩家，
     * 避免同大厅成员冒用他人身份发言。
     */
    fun setPeerRoster(roster: Map<String, String>) {
        server.setPeerRoster(roster)
    }

    /**
     * 下发允许读取本机聊天记录的成员 IP。
     *
     * 读取类接口不携带 playerId，只能按来源 IP 判断，因此与名册分开下发；
     * 仅在所有成员虚拟IP均已就绪时传入非空集合。
     */
    fun setAllowedReaders(ips: Collection<String>) {
        server.setAllowedReaders(ips)
    }

    fun sendText(playerName: String, content: String): ChatWireMessage =
        sendInternal(playerName, content, "text", null)

    fun sendImage(playerName: String, imageBytes: List<Int>): ChatWireMessage =
        sendInternal(playerName, "[Image]", "image", imageBytes)

    fun sendAnnounce(playerName: String, text: String): ChatWireMessage =
        sendInternal(playerName, text, "announce", null)

    fun sendVoiceGroup(playerName: String, group: Int): ChatWireMessage =
        sendInternal(playerName, group.toString(), "voicegroup", null)

    /** 多人协同待办：content 为待办列表 JSON（与桌面端一致，后写覆盖全队同步） */
    fun sendTodo(playerName: String, todosJson: String): ChatWireMessage =
        sendInternal(playerName, todosJson, "todo", null)

    fun sendRecall(playerName: String, messageId: String): ChatWireMessage =
        sendInternal(playerName, messageId, "recall", null)

    fun sendAvatar(avatarData: String?): ChatWireMessage =
        sendInternal("", avatarData.orEmpty(), "avatar", null)

    private fun sendInternal(playerName: String, content: String, type: String, imageData: List<Int>?): ChatWireMessage {
        val id = "msg-$playerId-${System.currentTimeMillis()}"
        val msg = ChatWireMessage(id, playerId, playerName, content, type, System.currentTimeMillis() / 1000, imageData)
        seen.add(id)
        server.addLocal(msg)
        val req = ChatSendRequest(id, playerId, playerName, content, type, imageData)
        val body = MctierWireJson.encodeToString(ChatSendRequest.serializer(), req)
        peerIps.forEach { ip -> scope.launch { postWithRetry(ip, body) } }
        return msg
    }

    private fun accept(msg: ChatWireMessage) {
        if (!seen.add(msg.id)) return
        if (msg.playerId == playerId) return
        onMessage(msg)
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
