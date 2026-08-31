package top.pmh13.mctier.network

import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.MessageDigest
import java.security.PrivateKey
import java.security.PublicKey
import java.security.SecureRandom
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.security.spec.X509EncodedKeySpec
import java.util.ArrayDeque
import java.util.Base64
import java.util.HashMap
import java.util.Locale

/**
 * Per-member chat authentication (Android side).
 *
 * Mirrors the desktop `chat_auth.rs` byte for byte. The chat HTTP service used
 * to authenticate with a single per-lobby token and then attribute the request
 * to whichever member owned the TCP source IP. Every member of a lobby knows
 * that token, and EasyTier does not stop a member from emitting packets that
 * carry another member's virtual IP, so a malicious member could be attributed
 * as anyone else in the same lobby.
 *
 * This takes the source IP out of the trust chain. Each member generates an
 * ephemeral P-256 key pair for the lifetime of a lobby session and publishes
 * only the public half over its own authenticated signaling WebSocket.
 * Signaling redistributes those public keys as part of the authoritative
 * roster, so a public key always arrives bound to a player id the sender could
 * not forge. Every chat request then carries a signature over a canonical
 * description of that request; the receiver resolves the signer by key id,
 * verifies against the roster-published key, and only afterwards looks at the
 * source IP - as a consistency hint, never as identity.
 *
 * P-256 / SHA256withECDSA is used rather than Ed25519 because
 * `KeyPairGenerator("Ed25519")` requires API 33 while this app supports API 26.
 * X.509 SubjectPublicKeyInfo DER public keys and ASN.1 DER signatures are
 * exactly what the desktop `p256` crate emits and consumes, so no conversion
 * layer is needed on either end.
 */
object ChatAuth {

    /** Domain separator. Must stay identical to the desktop constant. */
    private const val CANONICAL_DOMAIN = "MCTIER-CHAT-V1"
    private const val SIGNALING_CANONICAL_DOMAIN = "MCTIER-SIGNALING-V3"
    const val SIGNALING_PROTOCOL_VERSION = 3

    const val KeyIdHeader = "x-mctier-chat-key"
    const val SignatureHeader = "x-mctier-chat-sig"
    const val TimestampHeader = "x-mctier-chat-ts"
    const val NonceHeader = "x-mctier-chat-nonce"

    /**
     * A signature is accepted only when its timestamp is within this many
     * seconds of local time. Peers on one overlay are normally within a second
     * of each other; 120s absorbs realistic skew while keeping the replay
     * window small.
     */
    const val MaxTimestampSkewSecs = 120L

    /**
     * Key ids are the first 32 hex characters (16 bytes) of the SHA-256 of the
     * public key DER. Truncation is safe because a key id is only a lookup
     * handle: the signature is always verified against the full public key.
     */
    const val KeyIdHexLength = 32
    const val NonceHexLength = 32

    /**
     * Uncompressed P-256 SubjectPublicKeyInfo DER is 91 bytes; leave room for
     * encoder differences while still rejecting anything absurd.
     */
    private const val MaxPublicKeyDerBytes = 200
    private const val MaxSignatureDerBytes = 144

    /**
     * Upper bound on remembered nonces per session. A member is rate limited to
     * 12 requests / 3s, so this covers minutes of traffic for a full lobby and
     * cannot be grown without bound by a hostile peer.
     */
    private const val MaxTrackedNonces = 8192

    private const val CurveName = "secp256r1"
    private const val KeyAlgorithm = "EC"
    private const val SignatureAlgorithm = "SHA256withECDSA"

    private val random = SecureRandom()

    private fun sha256(bytes: ByteArray): ByteArray =
        MessageDigest.getInstance("SHA-256").digest(bytes)

    private fun toHex(bytes: ByteArray): String {
        val out = StringBuilder(bytes.size * 2)
        for (byte in bytes) out.append(String.format(Locale.US, "%02x", byte))
        return out.toString()
    }

    private fun sha256Hex(bytes: ByteArray): String = toHex(sha256(bytes))

    private fun encodeBase64(bytes: ByteArray): String = Base64.getEncoder().encodeToString(bytes)

    private fun decodeBase64(value: String): ByteArray? =
        runCatching { Base64.getDecoder().decode(value) }.getOrNull()

    /** Hex-encoded, truncated fingerprint of a public key DER. */
    fun keyIdForPublicKey(publicKeyDer: ByteArray): String =
        sha256Hex(publicKeyDer).substring(0, KeyIdHexLength)

    /** Full SHA-256 fingerprint used by signaling as the authoritative id. */
    fun identityIdForPublicKey(publicKeyDer: ByteArray): String = sha256Hex(publicKeyDer)

    /** Matches the signaling server's derived virtual-domain convention. */
    fun virtualDomainForIdentityId(identityId: String): String? {
        val normalized = identityId.trim()
        if (normalized.length != 64 || !normalized.all { it.isHexDigit() }) return null
        return "${normalized.substring(0, 32)}.mct.net"
    }

    fun isValidKeyId(value: String): Boolean =
        value.length == KeyIdHexLength && value.all { it.isHexDigit() }

    fun isValidNonce(value: String): Boolean =
        value.length == NonceHexLength && value.all { it.isHexDigit() }

    private fun Char.isHexDigit(): Boolean =
        this in '0'..'9' || this in 'a'..'f' || this in 'A'..'F'

    /**
     * Reject anything that is not a well formed P-256 public key before it can
     * enter a roster, so a bad key fails at registration instead of silently
     * breaking every later request.
     */
    fun parsePublicKey(encoded: String): ByteArray? {
        val trimmed = encoded.trim()
        if (trimmed.isEmpty() || trimmed.length > MaxPublicKeyDerBytes * 2) return null
        val der = decodeBase64(trimmed) ?: return null
        if (der.isEmpty() || der.size > MaxPublicKeyDerBytes) return null
        // Round-tripping through KeyFactory is what proves the DER really is a
        // usable EC key rather than arbitrary bytes of the right length.
        if (decodePublicKey(der) == null) return null
        return der
    }

    private fun decodePublicKey(der: ByteArray): PublicKey? = runCatching {
        KeyFactory.getInstance(KeyAlgorithm).generatePublic(X509EncodedKeySpec(der))
    }.getOrNull()

    /** Byte-identical registration transcript shared with desktop and server. */
    fun canonicalSignalingRegistration(
        challenge: String,
        lobbyName: String,
        virtualIp: String,
    ): ByteArray = listOf(
        SIGNALING_CANONICAL_DOMAIN,
        SIGNALING_PROTOCOL_VERSION.toString(),
        challenge,
        lobbyName,
        virtualIp,
    ).joinToString("\n").toByteArray(Charsets.UTF_8)

    /**
     * Canonical byte string covered by a signature.
     *
     * Request-shaping fields (method, path, body digest) and session-scoping
     * fields (token epoch, lobby credential digest) are both included, so a
     * captured signature cannot be moved to another endpoint, another lobby, or
     * another credential generation. Hashing the body keeps this cheap for
     * large image payloads while still covering every byte.
     *
     * [audience] is the intended recipient's virtual IP. Binding it prevents a
     * member from taking a request addressed to itself and forwarding it to a
     * third member, who would otherwise accept it as freshly authored by the
     * original signer.
     */
    fun canonicalRequest(
        method: String,
        path: String,
        audience: String,
        tokenEpoch: Long,
        timestamp: Long,
        nonce: String,
        body: ByteArray,
        lobbyToken: String,
    ): ByteArray {
        // The shared lobby token is never emitted in this form; only its digest
        // is bound in, which separates two lobbies that both sit at epoch 1.
        val fields = listOf(
            CANONICAL_DOMAIN,
            method.uppercase(Locale.US),
            path,
            audience,
            tokenEpoch.toString(),
            timestamp.toString(),
            nonce,
            sha256Hex(body),
            sha256Hex(lobbyToken.toByteArray(Charsets.UTF_8)),
        )
        return fields.joinToString("\n").toByteArray(Charsets.UTF_8)
    }

    /** Header values that must accompany a signed request. */
    data class SignedHeaders(
        val keyId: String,
        val signature: String,
        val timestamp: String,
        val nonce: String,
    )

    fun randomNonce(): String {
        val bytes = ByteArray(NonceHexLength / 2)
        random.nextBytes(bytes)
        return toHex(bytes)
    }

    fun unixSeconds(): Long = System.currentTimeMillis() / 1000L

    /** True when [timestamp] is close enough to [now] in either direction. */
    fun isFreshTimestamp(timestamp: Long, now: Long): Boolean {
        val diff = if (timestamp >= now) timestamp - now else now - timestamp
        return diff <= MaxTimestampSkewSecs
    }

    fun parseTimestamp(raw: String): Long? {
        val trimmed = raw.trim()
        // Length is capped first so a huge digit string never reaches the parser.
        if (trimmed.isEmpty() || trimmed.length > 20) return null
        if (!trimmed.all { it in '0'..'9' }) return null
        return trimmed.toLongOrNull()
    }

    /** Verify a DER signature over [canonical] using a DER public key. */
    fun verifySignature(publicKeyDer: ByteArray, signatureB64: String, canonical: ByteArray): Boolean {
        val trimmed = signatureB64.trim()
        if (trimmed.isEmpty() || trimmed.length > MaxSignatureDerBytes * 2) return false
        val signatureDer = decodeBase64(trimmed) ?: return false
        if (signatureDer.isEmpty() || signatureDer.size > MaxSignatureDerBytes) return false
        val publicKey = decodePublicKey(publicKeyDer) ?: return false
        return runCatching {
            Signature.getInstance(SignatureAlgorithm).run {
                initVerify(publicKey)
                update(canonical)
                verify(signatureDer)
            }
        }.getOrDefault(false)
    }

    /** The local member's ephemeral signing identity. */
    class ChatSigner private constructor(
        private val privateKey: PrivateKey,
        private val publicKeyDer: ByteArray,
        val keyId: String,
    ) {
        fun publicKeyBase64(): String = encodeBase64(publicKeyDer)

        fun identityId(): String = identityIdForPublicKey(publicKeyDer)

        /** Sign a one-time server challenge and its lobby/IP context. */
        fun signSignalingRegistration(
            challenge: String,
            lobbyName: String,
            virtualIp: String,
        ): String? {
            val canonical = canonicalSignalingRegistration(challenge, lobbyName, virtualIp)
            val signature = runCatching {
                Signature.getInstance(SignatureAlgorithm).run {
                    initSign(privateKey)
                    update(canonical)
                    sign()
                }
            }.getOrNull() ?: return null
            return encodeBase64(signature)
        }

        /**
         * Sign a request and return the header material the peer needs.
         *
         * [audience] must be the virtual IP of the peer the request is sent to.
         */
        fun sign(
            method: String,
            path: String,
            audience: String,
            tokenEpoch: Long,
            timestamp: Long,
            body: ByteArray,
            lobbyToken: String,
        ): SignedHeaders? {
            val nonce = randomNonce()
            val canonical = canonicalRequest(
                method,
                path,
                audience,
                tokenEpoch,
                timestamp,
                nonce,
                body,
                lobbyToken,
            )
            val signature = runCatching {
                Signature.getInstance(SignatureAlgorithm).run {
                    initSign(privateKey)
                    update(canonical)
                    sign()
                }
            }.getOrNull() ?: return null
            return SignedHeaders(
                keyId = keyId,
                signature = encodeBase64(signature),
                timestamp = timestamp.toString(),
                nonce = nonce,
            )
        }

        companion object {
            /**
             * Generate a fresh key pair. One is created per lobby session, so
             * leaving a lobby permanently retires the credential.
             */
            fun generate(): ChatSigner? = runCatching {
                val generator = KeyPairGenerator.getInstance(KeyAlgorithm)
                generator.initialize(ECGenParameterSpec(CurveName), random)
                val pair = generator.generateKeyPair()
                val der = pair.public.encoded ?: return@runCatching null
                ChatSigner(pair.private, der, keyIdForPublicKey(der))
            }.getOrNull()
        }
    }

    /**
     * Remembers recently accepted (keyId, nonce) pairs so a captured request
     * cannot be replayed inside the timestamp window.
     */
    class ReplayGuard {
        private val lock = Any()
        private val seen = HashMap<String, Long>()
        private val order = ArrayDeque<String>()

        /** Record a nonce. Returns false when this exact pair was already accepted. */
        fun accept(keyId: String, nonce: String, timestamp: Long, now: Long): Boolean = synchronized(lock) {
            evictExpired(now)
            val entry = "$keyId:$nonce"
            if (seen.containsKey(entry)) return false
            // Bound growth even when every nonce is still inside the window.
            while (order.size >= MaxTrackedNonces) {
                val oldest = order.pollFirst() ?: break
                seen.remove(oldest)
            }
            seen[entry] = timestamp
            order.addLast(entry)
            return true
        }

        private fun evictExpired(now: Long) {
            // A nonce can be forgotten once its timestamp can no longer pass the
            // freshness check, because from then on the request is refused anyway.
            val cutoff = now - MaxTimestampSkewSecs * 2
            while (true) {
                val front = order.peekFirst() ?: break
                val timestamp = seen[front]
                if (timestamp == null) {
                    order.pollFirst()
                    continue
                }
                if (timestamp >= cutoff) break
                order.pollFirst()
                seen.remove(front)
            }
        }

        fun clear() = synchronized(lock) {
            seen.clear()
            order.clear()
        }
    }
}
