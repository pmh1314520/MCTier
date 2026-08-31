package top.pmh13.mctier.network

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SecurityHardeningTest {
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
