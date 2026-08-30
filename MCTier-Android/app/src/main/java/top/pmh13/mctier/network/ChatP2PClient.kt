package top.pmh13.mctier.network

import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import top.pmh13.mctier.data.ChatPeerIdentity
import top.pmh13.mctier.data.ChatSendRequest
import top.pmh13.mctier.data.ChatWireMessage
import top.pmh13.mctier.data.MctierWireJson
import java.util.Collections
import java.util.LinkedHashSet
import java.util.UUID
import java.util.concurrent.TimeUnit

/**
 * P2P chat client.
 *
 * The HTTP listener is deliberately inert until the signaling session has
 * supplied a valid chat token and epoch. Peer destinations and message
 * identities are populated from the same authenticated signaling snapshot.
 */
class ChatP2PClient(
    private val playerId: String,
    private val scope: CoroutineScope,
    private val bindIp: String,
    private val onMessage: (ChatWireMessage) -> Unit,
) {
    private val client = OkHttpClient.Builder()
        .connectTimeout(3, TimeUnit.SECONDS)
        .callTimeout(15, TimeUnit.SECONDS)
        .followRedirects(false)
        .followSslRedirects(false)
        .build()
    private val server = ChatHttpServer(playerId, bindIp).also { it.onMessageReceived = { message -> accept(message) } }
    private val seen = Collections.synchronizedSet(LinkedHashSet<String>())

    @Volatile private var peerIdentities: List<ChatPeerIdentity> = emptyList()
    @Volatile private var localPlayerName: String = ""
    @Volatile private var started = false

    /** Install the first session or a newer registration snapshot. */
    fun configureSession(token: String, tokenEpoch: Long, playerName: String, hostId: String?): Boolean {
        localPlayerName = playerName
        val local = ChatPeerIdentity(playerId, playerName, bindIp)
        return server.configureSession(token, tokenEpoch, local, peerIdentities, hostId)
    }

    /** Apply a signaling-issued token rotation. Lower epochs are ignored. */
    fun rotateToken(token: String, tokenEpoch: Long): Boolean = server.rotateToken(token, tokenEpoch)

    fun updateHostId(hostId: String?): Boolean = server.updateHostId(hostId)

    fun isReady(): Boolean = server.hasSession()

    fun isAuthoritativePeer(expectedPlayerId: String, rawIp: String): Boolean {
        if (!server.hasSession()) return false
        val ip = ChatHttpServer.parseUsableIp(rawIp)?.hostAddress ?: return false
        return peerIdentities.any { it.playerId == expectedPlayerId && it.virtualIp == ip }
    }

    /** Start only after [configureSession] succeeds. */
    fun start(): Boolean {
        if (!server.hasSession()) {
            Log.w(TAG, "Chat server start refused before authenticated session")
            return false
        }
        if (started) return true
        return runCatching {
            server.start(5000, false)
            started = true
            true
        }.onFailure { Log.w(TAG, "Chat server start failed: ${it.message}") }.getOrDefault(false)
    }

    fun stop() {
        started = false
        runCatching { server.stop() }
        server.clearSession()
        seen.clear()
        peerIdentities = emptyList()
        localPlayerName = ""
    }

    /** Update the authoritative peer IP-to-player map from signaling. */
    fun setPeers(peers: List<ChatPeerIdentity>): Boolean {
        val normalized = peers
            .asSequence()
            .filter { it.playerId.isNotBlank() && it.playerId != playerId }
            .mapNotNull { peer ->
                ChatHttpServer.parseUsableIp(peer.virtualIp)?.hostAddress?.let { ip -> peer.copy(virtualIp = ip) }
            }
            .toList()
        if (
            normalized.size > MAX_PEERS ||
            normalized.map { it.playerId }.distinct().size != normalized.size ||
            normalized.map { it.virtualIp }.distinct().size != normalized.size
        ) {
            Log.w(TAG, "Rejected duplicate or oversized chat peer snapshot")
            return false
        }
        if (server.hasSession() && !server.updatePeers(normalized)) {
            Log.w(TAG, "Rejected invalid chat peer identity snapshot")
            return false
        }
        peerIdentities = normalized
        return true
    }

    fun sendText(playerName: String, content: String): ChatWireMessage? =
        sendInternal(playerName, content, "text", null)

    fun sendImage(playerName: String, imageBytes: List<Int>): ChatWireMessage? =
        sendInternal(playerName, "[Image]", "image", imageBytes)

    fun sendAnnounce(playerName: String, text: String): ChatWireMessage? =
        sendInternal(playerName, text, "announce", null)

    fun sendVoiceGroup(playerName: String, group: Int): ChatWireMessage? =
        sendInternal(playerName, group.toString(), "voicegroup", null)

    /** 多人协同待办：content 为待办列表 JSON（与桌面端一致，后写覆盖全队同步） */
    fun sendTodo(playerName: String, todosJson: String): ChatWireMessage? =
        sendInternal(playerName, todosJson, "todo", null)

    fun sendRecall(playerName: String, messageId: String): ChatWireMessage? =
        sendInternal(playerName, messageId, "recall", null)

    fun sendAvatar(avatarData: String?): ChatWireMessage? =
        sendInternal(localPlayerName, avatarData.orEmpty(), "avatar", null)

    private fun sendInternal(playerName: String, content: String, type: String, imageData: List<Int>?): ChatWireMessage? {
        if (!server.hasSession()) {
            Log.w(TAG, "Chat send suppressed before authenticated session")
            return null
        }
        val effectiveName = localPlayerName.ifBlank { playerName }
        val id = "msg-$playerId-${System.currentTimeMillis()}-${UUID.randomUUID()}"
        val msg = ChatWireMessage(id, playerId, effectiveName, content, type, System.currentTimeMillis() / 1000L, imageData)
        if (!server.addLocal(msg)) {
            Log.w(TAG, "Rejected invalid or duplicate local chat message")
            return null
        }
        remember(id)
        val req = ChatSendRequest(id, playerId, effectiveName, content, type, imageData)
        val body = MctierWireJson.encodeToString(ChatSendRequest.serializer(), req)
        peerIdentities.map { it.virtualIp }.distinct().forEach { ip ->
            scope.launch { postWithRetry(ip, body) }
        }
        return msg
    }

    private fun accept(msg: ChatWireMessage) {
        if (!server.isKnownPeer(msg)) return
        if (msg.playerId == playerId) return
        if (!remember(msg.id)) return
        onMessage(msg)
    }

    private fun postWithRetry(ip: String, body: String) {
        repeat(2) { attempt ->
            val token = server.currentToken()
            if (token == null) return
            val ok = runCatching {
                val req = Request.Builder()
                    .url("http://${formatHost(ip)}:14540/api/chat/send")
                    .header(ChatTokenHeader, token)
                    .post(body.toRequestBody("application/json".toMediaType()))
                    .build()
                client.newCall(req).execute().use { it.isSuccessful }
            }.getOrDefault(false)
            if (ok) return
            if (attempt == 0) Thread.sleep(400)
        }
    }

    private fun remember(id: String): Boolean = synchronized(seen) {
        if (!seen.add(id)) return false
        while (seen.size > MAX_SEEN_IDS) {
            val first = seen.firstOrNull() ?: break
            seen.remove(first)
        }
        true
    }

    private fun formatHost(ip: String): String = if (ip.contains(':')) "[$ip]" else ip

    private companion object {
        private const val TAG = "ChatP2PClient"
        private const val MAX_SEEN_IDS = 1000
        private const val MAX_PEERS = 64
        private const val ChatTokenHeader = "x-mctier-chat-token"
    }
}
