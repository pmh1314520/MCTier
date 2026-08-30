package top.pmh13.mctier.network

import android.util.Log
import fi.iki.elonen.NanoHTTPD
import top.pmh13.mctier.data.ChatMaxHistoryBytes
import top.pmh13.mctier.data.ChatMaxHistoryMessages
import top.pmh13.mctier.data.ChatMaxHttpBodyBytes
import top.pmh13.mctier.data.ChatPeerIdentity
import top.pmh13.mctier.data.ChatSendRequest
import top.pmh13.mctier.data.ChatServerPort
import top.pmh13.mctier.data.ChatTokenHeader
import top.pmh13.mctier.data.ChatTokenHexLength
import top.pmh13.mctier.data.ChatWireMessage
import top.pmh13.mctier.data.MctierJson
import java.net.InetAddress
import java.net.Inet4Address
import java.security.MessageDigest
import java.util.ArrayDeque
import java.util.HashMap
import java.util.LinkedHashMap
import java.util.Locale
import java.util.UUID

/**
 * P2P chat HTTP server.
 *
 * Authentication has two independent layers:
 *
 * 1. The signaling-issued per-lobby token proves the caller is a member of this
 *    lobby. Every member holds the same value, so it says nothing about *which*
 *    member is calling.
 * 2. A per-request ECDSA signature proves *who* is calling. The signer is
 *    resolved by key id against the roster of public keys signaling published,
 *    and the signature is verified against that key before anything else is
 *    trusted.
 *
 * The TCP source IP is consulted only after a signature verifies, purely to
 * confirm it matches the address signaling recorded for that member. Forging a
 * virtual IP therefore gains an attacker nothing: it would still need the
 * victim's private key to produce an acceptable signature. Request-body identity
 * fields are retained only for wire compatibility and are never used for
 * attribution.
 */
class ChatHttpServer(
    private val ownerId: String,
    bindIp: String,
) : NanoHTTPD(requireBindIp(bindIp), ChatServerPort) {

    private val boundIp = requireBindIp(bindIp)
    private val sessionLock = Any()
    private val historyLock = Any()
    private val rateLimitLock = Any()
    private val messages = ArrayDeque<ChatWireMessage>()
    private var historyBytes = 0
    private var authSession: AuthSession? = null
    private val requestTimes = HashMap<RateLimitKey, ArrayDeque<Long>>()
    private val replayGuard = ChatAuth.ReplayGuard()

    /** 收到他人 POST 的新消息时回调（用于推送到 UI） */
    var onMessageReceived: ((ChatWireMessage) -> Unit)? = null

    /**
     * Install the current signaling session. A lower epoch or a different
     * token at the same epoch is rejected so stale callbacks cannot reopen the
     * HTTP boundary.
     */
    fun configureSession(
        token: String,
        tokenEpoch: Long,
        local: ChatPeerIdentity,
        peers: List<ChatPeerIdentity>,
        hostId: String?,
    ): Boolean {
        if (!isValidChatToken(token) || tokenEpoch <= 0L || local.playerId != ownerId) return false
        val normalizedLocal = normalizeIdentity(local) ?: return false
        if (normalizedLocal.virtualIp != boundIp) return false
        val identities = buildIdentityMap(normalizedLocal, peers) ?: return false
        val peersByKey = buildKeyMap(identities) ?: return false
        synchronized(sessionLock) {
            val current = authSession
            if (current != null) {
                // The local member's own signing key legitimately appears on a
                // fresh session, so only the stable identity fields are compared.
                if (current.local.playerId != normalizedLocal.playerId ||
                    current.local.playerName != normalizedLocal.playerName ||
                    current.local.virtualIp != normalizedLocal.virtualIp
                ) {
                    return false
                }
                if (tokenEpoch < current.tokenEpoch) return false
                if (tokenEpoch == current.tokenEpoch && current.token != token) return false
            }
            if (!isValidHostId(hostId, identities)) return false
            authSession = AuthSession(token, tokenEpoch, normalizedLocal, hostId, identities, peersByKey)
        }
        return true
    }

    /** Rotate only the credential while retaining the authoritative peer map. */
    fun rotateToken(token: String, tokenEpoch: Long): Boolean {
        if (!isValidChatToken(token) || tokenEpoch <= 0L) return false
        synchronized(sessionLock) {
            val current = authSession ?: return false
            if (tokenEpoch < current.tokenEpoch) return false
            if (tokenEpoch == current.tokenEpoch) return current.token == token
            authSession = current.copy(token = token, tokenEpoch = tokenEpoch)
        }
        return true
    }

    /** Replace peer identities after an authenticated signaling snapshot. */
    fun updatePeers(peers: List<ChatPeerIdentity>): Boolean {
        synchronized(sessionLock) {
            val current = authSession ?: return false
            val identities = buildIdentityMap(current.local, peers) ?: return false
            val peersByKey = buildKeyMap(identities) ?: return false
            if (!isValidHostId(current.hostId, identities)) return false
            authSession = current.copy(identities = identities, peersByKey = peersByKey)
        }
        return true
    }

    fun updateHostId(hostId: String?): Boolean {
        synchronized(sessionLock) {
            val current = authSession ?: return false
            if (!isValidHostId(hostId, current.identities)) return false
            authSession = current.copy(hostId = hostId)
        }
        return true
    }

    fun currentToken(): String? = synchronized(sessionLock) { authSession?.token }

    fun currentTokenEpoch(): Long = synchronized(sessionLock) { authSession?.tokenEpoch ?: 0L }

    fun localIdentity(): ChatPeerIdentity? = synchronized(sessionLock) { authSession?.local }

    fun hasSession(): Boolean = synchronized(sessionLock) { authSession != null }

    fun isKnownPeer(message: ChatWireMessage): Boolean = synchronized(sessionLock) {
        authSession?.identities?.values?.any { identity ->
            identity.playerId == message.playerId && identity.playerName == message.playerName
        } == true
    }

    /** 把本机发送的消息加入存储（供他人拉取）。 */
    fun addLocal(message: ChatWireMessage): Boolean {
        val session = synchronized(sessionLock) { authSession } ?: return false
        if (message.playerId != session.local.playerId || message.playerName != session.local.playerName) return false
        if (!isValidMessage(message, hostId = session.hostId, checkHost = true)) return false
        return storeMessage(message)
    }

    /** Stop/reset is a security boundary: revoke credentials and discard history. */
    fun clearSession() {
        synchronized(sessionLock) { authSession = null }
        synchronized(rateLimitLock) { requestTimes.clear() }
        replayGuard.clear()
        synchronized(historyLock) {
            messages.clear()
            historyBytes = 0
        }
    }

    private fun messagesSince(since: Long?): List<ChatWireMessage> = synchronized(historyLock) {
        if (since == null) messages.toList() else messages.filter { it.timestamp > since }
    }

    override fun serve(session: IHTTPSession): Response {
        val origin = LanCors.originOf(session)
        if (session.method == Method.OPTIONS) {
            return withCors(newFixedLengthResponse(Response.Status.OK, "text/plain", ""), origin)
        }
        return try {
            when {
                session.uri == "/api/chat/messages" && session.method == Method.GET -> handleMessages(session, origin)
                session.uri == "/api/chat/send" && session.method == Method.POST -> handleSend(session, origin)
                else -> withCors(newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "not found"), origin)
            }
        } catch (rejected: RequestRejected) {
            withCors(newFixedLengthResponse(rejected.status, "text/plain", rejected.message ?: "request rejected"), origin)
        } catch (e: Exception) {
            Log.w(TAG, "处理聊天请求失败: ${e.message}")
            withCors(newFixedLengthResponse(Response.Status.INTERNAL_ERROR, "text/plain", "error"), origin)
        }
    }

    private fun handleMessages(session: IHTTPSession, origin: String?): Response {
        // History reads are signed too: otherwise a member could spoof another
        // member's address and harvest the history attributed to them.
        val auth = authenticate(session, "GET", "/api/chat/messages", EMPTY_BODY)
        if (!allowRequest(auth.identity, auth.sourceIp)) reject(Response.Status.TOO_MANY_REQUESTS)
        val rawSince = session.parameters["since"]?.firstOrNull()
        val since = when {
            rawSince == null -> null
            rawSince.isBlank() -> reject(Response.Status.BAD_REQUEST)
            else -> rawSince.toLongOrNull()?.takeIf { it >= 0L } ?: reject(Response.Status.BAD_REQUEST)
        }
        return json(messagesSince(since), origin)
    }

    private fun handleSend(session: IHTTPSession, origin: String?): Response {
        // The body is consumed before authentication because the signature
        // covers these exact bytes, binding attribution and content together:
        // neither can be swapped without invalidating the signature.
        val bodyBytes = readJsonBody(session)
        val auth = authenticate(session, "POST", "/api/chat/send", bodyBytes)
        if (!allowRequest(auth.identity, auth.sourceIp)) reject(Response.Status.TOO_MANY_REQUESTS)
        val req = runCatching {
            MctierJson.decodeFromString(ChatSendRequest.serializer(), bodyBytes.toString(Charsets.UTF_8))
        }.getOrElse { reject(Response.Status.BAD_REQUEST) }
        val type = req.messageType.trim().lowercase(Locale.US)
        val id = req.id?.trim()?.takeIf { it.isNotEmpty() }
        val message = ChatWireMessage(
            id = id ?: "msg-${auth.identity.playerId}-${UUID.randomUUID()}",
            playerId = auth.identity.playerId,
            playerName = auth.identity.playerName,
            content = req.content,
            messageType = type,
            timestamp = System.currentTimeMillis() / 1000L,
            imageData = req.imageData,
        )
        if (!isValidMessage(message, auth.hostId, checkHost = true)) {
            reject(Response.Status.BAD_REQUEST)
        }
        if (!storeMessage(message)) reject(Response.Status.PAYLOAD_TOO_LARGE)
        onMessageReceived?.invoke(message)
        return json(message, origin)
    }

    /**
     * Resolve and verify the caller's identity from its request signature.
     *
     * The order matters: the shared lobby token is checked first so
     * unauthenticated probes never reach the verifier, then the signer is
     * resolved *by key id* and the signature is verified against the
     * roster-published public key. Only after that is the source address
     * examined, and then merely to confirm it matches the address signaling
     * recorded for that member.
     *
     * Consequence: forging a virtual IP is useless. The attacker would still
     * have to produce a signature under the victim's key, and lacking the
     * private key it cannot. Conversely a member signing with its own key but
     * arriving from someone else's address is refused as inconsistent.
     */
    private fun authenticate(
        session: IHTTPSession,
        method: String,
        path: String,
        body: ByteArray,
    ): AuthenticatedRequest {
        val snapshot = synchronized(sessionLock) { authSession }
            ?: reject(Response.Status.UNAUTHORIZED)
        val supplied = singleHeader(session, ChatTokenHeader) ?: reject(Response.Status.UNAUTHORIZED)
        if (!constantTimeEquals(supplied, snapshot.token)) reject(Response.Status.UNAUTHORIZED)

        val keyId = singleHeader(session, ChatAuth.KeyIdHeader)?.trim()
            ?: reject(Response.Status.UNAUTHORIZED)
        val signature = singleHeader(session, ChatAuth.SignatureHeader)?.trim()
            ?: reject(Response.Status.UNAUTHORIZED)
        val nonce = singleHeader(session, ChatAuth.NonceHeader)?.trim()
            ?: reject(Response.Status.UNAUTHORIZED)
        val rawTimestamp = singleHeader(session, ChatAuth.TimestampHeader)
            ?: reject(Response.Status.UNAUTHORIZED)
        val timestamp = ChatAuth.parseTimestamp(rawTimestamp) ?: reject(Response.Status.BAD_REQUEST)
        if (!ChatAuth.isValidKeyId(keyId) || !ChatAuth.isValidNonce(nonce)) {
            reject(Response.Status.BAD_REQUEST)
        }
        val now = ChatAuth.unixSeconds()
        if (!ChatAuth.isFreshTimestamp(timestamp, now)) reject(Response.Status.UNAUTHORIZED)

        // An unknown key id means the member is not in the authoritative roster,
        // or published no key at all. Either way it cannot be attributed.
        val peer = snapshot.peersByKey[keyId.lowercase(Locale.US)] ?: reject(Response.Status.FORBIDDEN)

        // We are the audience: the signature must have been produced for this
        // member specifically, not for some other peer in the lobby.
        val canonical = ChatAuth.canonicalRequest(
            method,
            path,
            snapshot.local.virtualIp,
            snapshot.tokenEpoch,
            timestamp,
            nonce,
            body,
            snapshot.token,
        )
        if (!ChatAuth.verifySignature(peer.publicKeyDer, signature, canonical)) {
            reject(Response.Status.UNAUTHORIZED)
        }

        // A captured request must not be usable twice inside the freshness window.
        if (!replayGuard.accept(keyId, nonce, timestamp, now)) {
            Log.w(TAG, "拒绝重放的聊天请求: signer=${peer.identity.playerId}")
            reject(Response.Status.UNAUTHORIZED)
        }

        // Source address is now only a consistency check against the roster.
        val source = parseUsableIp(session.remoteIpAddress) ?: reject(Response.Status.FORBIDDEN)
        if (peer.identity.virtualIp != source.hostAddress) {
            Log.w(
                TAG,
                "拒绝签名与来源地址不一致的聊天请求: signer=${peer.identity.playerId}, 来源=${source.hostAddress}",
            )
            reject(Response.Status.FORBIDDEN)
        }
        return AuthenticatedRequest(snapshot.hostId, source, peer.identity)
    }

    private fun readJsonBody(session: IHTTPSession): ByteArray {
        if (session.headers.keys.any { it.equals("transfer-encoding", ignoreCase = true) }) {
            reject(Response.Status.BAD_REQUEST)
        }
        val contentType = singleHeader(session, "content-type")
            ?.substringBefore(';')
            ?.trim()
            ?.takeIf { it.equals("application/json", ignoreCase = true) }
            ?: reject(Response.Status.UNSUPPORTED_MEDIA_TYPE)
        @Suppress("UNUSED_VARIABLE")
        val ignoredContentType = contentType
        val lengthText = singleHeader(session, "content-length") ?: reject(Response.Status.LENGTH_REQUIRED)
        val length = lengthText.toLongOrNull()?.takeIf { it >= 0L }
            ?: reject(Response.Status.BAD_REQUEST)
        if (length > ChatMaxHttpBodyBytes.toLong()) reject(Response.Status.PAYLOAD_TOO_LARGE)
        val bytes = ByteArray(length.toInt())
        var offset = 0
        while (offset < bytes.size) {
            val read = session.inputStream.read(bytes, offset, bytes.size - offset)
            if (read <= 0) reject(Response.Status.BAD_REQUEST)
            offset += read
        }
        if (bytes.isEmpty()) reject(Response.Status.BAD_REQUEST)
        return bytes
    }

    private fun allowRequest(identity: ChatPeerIdentity, sourceIp: InetAddress): Boolean {
        val key = RateLimitKey(identity.playerId, sourceIp)
        val now = System.nanoTime()
        synchronized(rateLimitLock) {
            val entries = requestTimes.getOrPut(key) { ArrayDeque() }
            while (entries.peekFirst()?.let { now - it > RATE_WINDOW_NANOS } == true) entries.removeFirst()
            if (entries.size >= RATE_MAX_REQUESTS) return false
            entries.addLast(now)
            if (requestTimes.size > RATE_KEY_LIMIT) {
                requestTimes.entries.removeIf { it.value.isEmpty() }
            }
            return true
        }
    }

    private fun storeMessage(message: ChatWireMessage): Boolean {
        val encodedSize = runCatching {
            MctierJson.encodeToString(ChatWireMessage.serializer(), message).toByteArray(Charsets.UTF_8).size
        }.getOrNull() ?: return false
        if (encodedSize > ChatMaxHistoryBytes) return false
        synchronized(historyLock) {
            if (messages.any { it.id == message.id }) return false
            while (messages.size >= ChatMaxHistoryMessages || historyBytes + encodedSize > ChatMaxHistoryBytes) {
                if (messages.isEmpty()) break
                val removed = messages.removeFirst()
                historyBytes = (historyBytes - encodedSizeOf(removed)).coerceAtLeast(0)
            }
            historyBytes += encodedSize
            messages.addLast(message)
        }
        return true
    }

    private fun encodedSizeOf(message: ChatWireMessage): Int = runCatching {
        MctierJson.encodeToString(ChatWireMessage.serializer(), message).toByteArray(Charsets.UTF_8).size
    }.getOrDefault(0)

    private fun isValidMessage(message: ChatWireMessage, hostId: String?, checkHost: Boolean): Boolean {
        if (!isMessageIdForPlayer(message.id, message.playerId)) return false
        if (message.content.toByteArray(Charsets.UTF_8).size > MAX_CONTENT_BYTES) return false
        if (message.playerId.isBlank() || message.playerId.toByteArray(Charsets.UTF_8).size > MAX_ID_BYTES) return false
        if (message.playerName.isBlank() || message.playerName.toByteArray(Charsets.UTF_8).size > MAX_PLAYER_NAME_BYTES || message.playerName.any { it.isISOControl() }) return false
        if (checkHost && message.messageType == "announce" && hostId != message.playerId) return false
        return when (message.messageType.lowercase(Locale.US)) {
            "text" -> message.content.isNotEmpty() && message.contentBytes() <= MAX_TEXT_BYTES && message.imageData == null
            "image" -> message.contentBytes() <= MAX_IMAGE_CONTENT_BYTES && validImage(message.imageData)
            "announce" -> message.contentBytes() <= MAX_ANNOUNCE_BYTES && message.imageData == null
            "voicegroup" -> message.contentBytes() <= MAX_VOICE_GROUP_BYTES &&
                message.imageData == null && message.content.toIntOrNull()?.let { it in 0..4 } == true
            "clipboard" -> message.contentBytes() <= MAX_CLIPBOARD_BYTES && message.imageData == null
            "todo" -> message.contentBytes() <= MAX_TODO_BYTES && message.imageData == null
            "whiteboard" -> message.contentBytes() <= MAX_WHITEBOARD_BYTES && message.imageData == null
            "recall" -> message.content.isNotEmpty() && message.contentBytes() <= MAX_RECALL_BYTES &&
                message.imageData == null && validRecall(message)
            "avatar" -> message.contentBytes() <= MAX_AVATAR_BYTES && message.imageData == null &&
                (message.content.isEmpty() || message.content.startsWith("data:image/"))
            else -> false
        }
    }

    private fun validRecall(message: ChatWireMessage): Boolean {
        val now = System.currentTimeMillis() / 1000L
        val target = synchronized(historyLock) { messages.lastOrNull { it.id == message.content } } ?: return false
        return target.playerId == message.playerId && now >= target.timestamp && now - target.timestamp <= RECALL_WINDOW_SECS
    }

    private fun validImage(image: List<Int>?): Boolean = image != null && image.isNotEmpty() &&
        image.size <= MAX_IMAGE_BYTES && image.all { it in 0..255 }

    private fun ChatWireMessage.contentBytes(): Int = content.toByteArray(Charsets.UTF_8).size

    private fun singleHeader(session: IHTTPSession, name: String): String? {
        val matches = session.headers.entries.filter { it.key.equals(name, ignoreCase = true) }
        return if (matches.size == 1) matches.single().value else null
    }

    private fun withCors(response: Response, origin: String?): Response = LanCors.apply(response, origin)

    private fun json(value: List<ChatWireMessage>, origin: String?): Response =
        withCors(newFixedLengthResponse(
            Response.Status.OK,
            "application/json; charset=utf-8",
            MctierJson.encodeToString(kotlinx.serialization.builtins.ListSerializer(ChatWireMessage.serializer()), value),
        ), origin)

    private fun json(value: ChatWireMessage, origin: String?): Response =
        withCors(newFixedLengthResponse(
            Response.Status.OK,
            "application/json; charset=utf-8",
            MctierJson.encodeToString(ChatWireMessage.serializer(), value),
        ), origin)

    private data class AuthSession(
        val token: String,
        val tokenEpoch: Long,
        val local: ChatPeerIdentity,
        val hostId: String?,
        val identities: Map<InetAddress, ChatPeerIdentity>,
        /** Signing keys of every roster member, indexed by key id. */
        val peersByKey: Map<String, VerifiedPeer>,
    )

    /** A roster member together with the decoded public key bound to it. */
    private data class VerifiedPeer(
        val identity: ChatPeerIdentity,
        val publicKeyDer: ByteArray,
    ) {
        // ByteArray needs structural equality for the enclosing data classes to
        // compare sensibly.
        override fun equals(other: Any?): Boolean {
            if (this === other) return true
            if (other !is VerifiedPeer) return false
            return identity == other.identity && publicKeyDer.contentEquals(other.publicKeyDer)
        }

        override fun hashCode(): Int = 31 * identity.hashCode() + publicKeyDer.contentHashCode()
    }

    private data class AuthenticatedRequest(
        val hostId: String?,
        val sourceIp: InetAddress,
        val identity: ChatPeerIdentity,
    )

    private data class RateLimitKey(val playerId: String, val ip: InetAddress)

    private class RequestRejected(val status: Response.Status) : RuntimeException()

    companion object {
        private const val TAG = "ChatHttpServer"

        /** Signed-but-bodyless requests (history reads) hash the empty string. */
        private val EMPTY_BODY = ByteArray(0)
        private const val MAX_ID_BYTES = 128
        private const val MAX_PLAYER_NAME_BYTES = 256
        private const val MAX_CONTENT_BYTES = 512 * 1024
        private const val MAX_TEXT_BYTES = 16 * 1024
        private const val MAX_IMAGE_BYTES = 512 * 1024
        private const val MAX_IMAGE_CONTENT_BYTES = 256
        private const val MAX_ANNOUNCE_BYTES = 16 * 1024
        private const val MAX_VOICE_GROUP_BYTES = 32
        private const val MAX_CLIPBOARD_BYTES = 16 * 1024
        private const val MAX_TODO_BYTES = 64 * 1024
        private const val MAX_WHITEBOARD_BYTES = 64 * 1024
        private const val MAX_RECALL_BYTES = 128
        private const val MAX_AVATAR_BYTES = 192 * 1024
        private const val RECALL_WINDOW_SECS = 2 * 60
        private const val RATE_MAX_REQUESTS = 12
        private const val RATE_KEY_LIMIT = 256
        private const val RATE_WINDOW_NANOS = 3_000_000_000L
        private const val MAX_PEERS = ChatMaxHistoryMessages

        /** Numeric, specific virtual IP only; wildcard and loopback binds are rejected. */
        private fun requireBindIp(raw: String): String =
            parseUsableIp(raw)?.hostAddress ?: throw IllegalArgumentException("Chat server requires a specific virtual IP")

        internal fun parseUsableIp(raw: String): InetAddress? {
            val value = raw.trim()
            if (value.isEmpty() || value.contains('%')) return null
            val numeric = if (value.contains(':')) {
                value.matches(Regex("[0-9A-Fa-f:]+"))
            } else {
                value.matches(Regex("[0-9.]+"))
            }
            if (!numeric) return null
            return runCatching { InetAddress.getByName(value) }.getOrNull()?.takeIf {
                it is Inet4Address &&
                    it.address.sliceArray(0..2).contentEquals(byteArrayOf(10, 126, 126)) &&
                    (it.address[3].toInt() and 0xff) in 1..254
            }
        }

        private fun normalizeIdentity(identity: ChatPeerIdentity): ChatPeerIdentity? {
            val ip = parseUsableIp(identity.virtualIp) ?: return null
            val normalizedIp = ip.hostAddress ?: return null
            if (identity.playerId.isBlank() || identity.playerId.toByteArray(Charsets.UTF_8).size > MAX_ID_BYTES) return null
            if (identity.playerName.isBlank() || identity.playerName.toByteArray(Charsets.UTF_8).size > MAX_PLAYER_NAME_BYTES || identity.playerName.any { it.isISOControl() }) return null
            if (identity.playerId.any { it.isISOControl() }) return null
            return identity.copy(virtualIp = normalizedIp)
        }

        private fun buildIdentityMap(
            local: ChatPeerIdentity,
            peers: List<ChatPeerIdentity>,
        ): Map<InetAddress, ChatPeerIdentity>? {
            val map = LinkedHashMap<InetAddress, ChatPeerIdentity>()
            val ids = HashSet<String>()
            val all = sequenceOf(local).plus(peers.asSequence().take(MAX_PEERS))
            for (raw in all) {
                val identity = normalizeIdentity(raw) ?: return null
                val ip = parseUsableIp(identity.virtualIp) ?: return null
                if (!ids.add(identity.playerId) || map.put(ip, identity) != null) return null
            }
            return map
        }

        /**
         * Index the roster by key id so a request can be attributed from its
         * signature alone.
         *
         * A duplicate key id is refused outright: two members presenting the
         * same public key would make attribution ambiguous, which is exactly
         * the property this mechanism exists to guarantee. A malformed key
         * fails here, at roster installation, rather than silently breaking
         * every later request. Members without a published key are simply
         * absent from the map, so their requests cannot be verified.
         */
        private fun buildKeyMap(
            identities: Map<InetAddress, ChatPeerIdentity>,
        ): Map<String, VerifiedPeer>? {
            val byKey = LinkedHashMap<String, VerifiedPeer>()
            for (identity in identities.values) {
                val encoded = identity.chatPublicKey?.takeIf { it.isNotBlank() } ?: continue
                val der = ChatAuth.parsePublicKey(encoded) ?: return null
                val keyId = ChatAuth.keyIdForPublicKey(der)
                if (byKey.put(keyId, VerifiedPeer(identity, der)) != null) return null
            }
            return byKey
        }

        private fun isValidChatToken(token: String): Boolean =
            token.length == ChatTokenHexLength && token.all { it.isDigit() || it.lowercaseChar() in 'a'..'f' }

        private fun isMessageIdForPlayer(id: String, playerId: String): Boolean {
            if (id.isBlank() || id.toByteArray(Charsets.UTF_8).size > MAX_ID_BYTES || id.any { it.isISOControl() }) return false
            return listOf("msg-$playerId-", "recall-$playerId-").any { prefix ->
                id.startsWith(prefix) && id.length > prefix.length
            }
        }

        private fun isValidHostId(
            hostId: String?,
            identities: Map<InetAddress, ChatPeerIdentity>,
        ): Boolean = hostId == null || identities.values.any { it.playerId == hostId }

        private fun constantTimeEquals(left: String, right: String): Boolean =
            MessageDigest.isEqual(left.toByteArray(Charsets.UTF_8), right.toByteArray(Charsets.UTF_8))

        private fun reject(status: Response.Status): Nothing = throw RequestRejected(status)
    }
}
