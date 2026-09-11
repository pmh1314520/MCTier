package top.pmh13.mctier.network

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import top.pmh13.mctier.data.ChatPeerIdentity

class SecurityHardeningTest {
    @Test
    fun signalingBusinessMessagesRequireAcceptedRegistration() {
        val signaling = SignalingClient()
        val sent = mutableListOf<String>()
        val socket = object : okhttp3.WebSocket {
            override fun request() = okhttp3.Request.Builder().url("https://localhost").build()
            override fun queueSize() = 0L
            override fun send(text: String): Boolean { sent.add(text); return true }
            override fun send(bytes: okio.ByteString) = false
            override fun close(code: Int, reason: String?) = true
            override fun cancel() {}
        }
        fun setField(name: String, value: Any?) {
            SignalingClient::class.java.getDeclaredField(name).apply { isAccessible = true }.set(signaling, value)
        }
        setField("webSocket", socket)
        val request = top.pmh13.mctier.data.SignalingEnvelope(type = "players-list-request")
        assertFalse(signaling.send(request))
        assertTrue(signaling.send(top.pmh13.mctier.data.SignalingEnvelope(type = "register-v3")))
        setField("serverSessionGeneration", 1234567890123456L)
        assertFalse(signaling.send(request))
        @Suppress("UNCHECKED_CAST")
        val connected = SignalingClient::class.java.getDeclaredField("_connected").apply { isAccessible = true }
            .get(signaling) as kotlinx.coroutines.flow.MutableStateFlow<Boolean>
        connected.value = true
        assertTrue(signaling.send(request))
        assertTrue(sent.last().contains("1234567890123456"))
        connected.value = false
        assertFalse(signaling.send(request))
        assertEquals(2, sent.size)
    }

    @Test
    fun chatAuthBaselineCanResetAfterSignalingServerRestart() {
        val localSigner = ChatAuth.ChatSigner.generate() ?: error("P-256 unavailable")
        val server = ChatHttpServer(localSigner.identityId(), "10.126.126.7")
        val local = ChatPeerIdentity(
            localSigner.identityId(),
            "local",
            "10.126.126.7",
            localSigner.publicKeyBase64(),
        )

        assertTrue(server.configureSession("a".repeat(64), 7, local, emptyList(), local.playerId))
        assertFalse(server.configureSession("b".repeat(64), 1, local, emptyList(), local.playerId))
        server.resetAuthBaseline()
        assertTrue(server.configureSession("b".repeat(64), 1, local, emptyList(), local.playerId))
    }

    @Test
    fun signalingChallengeSignatureBindsContextAndDerivesIdentity() {
        val signer = ChatAuth.ChatSigner.generate() ?: error("P-256 unavailable")
        val challenge = "ab".repeat(32)
        val lobbyName = "lobby-a"
        val virtualIp = "10.126.126.7"
        val signature = signer.signSignalingRegistration(challenge, lobbyName, virtualIp)
            ?: error("signing failed")
        val der = ChatAuth.parsePublicKey(signer.publicKeyBase64()) ?: error("key parse failed")

        assertTrue(
            ChatAuth.verifySignature(
                der,
                signature,
                ChatAuth.canonicalSignalingRegistration(challenge, lobbyName, virtualIp),
            ),
        )
        assertFalse(
            ChatAuth.verifySignature(
                der,
                signature,
                ChatAuth.canonicalSignalingRegistration("cd".repeat(32), lobbyName, virtualIp),
            ),
        )
        assertFalse(
            ChatAuth.verifySignature(
                der,
                signature,
                ChatAuth.canonicalSignalingRegistration(challenge, "lobby-b", virtualIp),
            ),
        )
        assertEquals(signer.identityId(), ChatAuth.identityIdForPublicKey(der))
        assertEquals(
            "${signer.identityId().substring(0, 32)}.mct.net",
            ChatAuth.virtualDomainForIdentityId(signer.identityId()),
        )
    }

    @Test
    fun boundedIceCacheEnforcesPeerEntryByteAndTtlLimits() {
        var now = 0L
        val cache = BoundedIceCache<String, String>(
            maxEntries = 3,
            maxBytes = 10,
            maxEntriesPerPeer = 2,
            ttlMillis = 100,
            peerOf = { it.substringBefore('|') },
            bytesOf = { it.length },
            clockMillis = { now },
        )

        assertTrue(cache.add("peer-a|route-1", "1234"))
        assertTrue(cache.add("peer-a|route-2", "5678"))
        assertTrue(cache.add("peer-a|route-1", "zzzz"))
        assertEquals(2, cache.size())
        assertTrue(cache.add("peer-b|route-1", "12"))
        assertTrue(cache.byteSize() <= 10)

        now = 101
        assertEquals(0, cache.size())
        assertEquals(0, cache.byteSize())
    }

    @Test
    fun passwordBackoffIsPerKeyAndResetsOnSuccess() {
        var now = 0L
        val limiter = ExponentialBackoffLimiter(
            maxEntries = 4,
            baseDelayMillis = 100,
            maxDelayMillis = 1_000,
            ttlMillis = 10_000,
            clockMillis = { now },
        )

        assertTrue(limiter.beforeAttempt("share-a|viewer-a").allowed)
        assertEquals(100, limiter.recordFailure("share-a|viewer-a"))
        assertFalse(limiter.beforeAttempt("share-a|viewer-a").allowed)
        assertTrue(limiter.beforeAttempt("share-a|viewer-b").allowed)
        now = 100
        assertTrue(limiter.beforeAttempt("share-a|viewer-a").allowed)
        assertEquals(200, limiter.recordFailure("share-a|viewer-a"))
        limiter.recordSuccess("share-a|viewer-a")
        assertTrue(limiter.beforeAttempt("share-a|viewer-a").allowed)
    }
}
