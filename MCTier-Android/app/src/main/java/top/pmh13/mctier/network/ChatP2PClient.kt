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

    fun sendText(playerName: String, content: String): ChatWireMessage =
        sendInternal(playerName, content, "text", null)

    fun sendImage(playerName: String, imageBytes: List<Int>): ChatWireMessage =
        sendInternal(playerName, "[Image]", "image", imageBytes)

    fun sendAnnounce(playerName: String, text: String): ChatWireMessage =
        sendInternal(playerName, text, "announce", null)

    fun sendVoiceGroup(playerName: String, group: Int): ChatWireMessage =
        sendInternal(playerName, group.toString(), "voicegroup", null)

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
