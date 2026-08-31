/**
 * Per-member chat authentication.
 *
 * Background: the chat HTTP service used to authenticate with a single
 * per-lobby token and then attribute the request to whichever member owned the
 * TCP source IP. Every member of a lobby knows that token, and EasyTier does
 * not stop a member from emitting packets carrying another member's virtual IP,
 * so a malicious member could be attributed as anyone else in the same lobby.
 *
 * This module takes the source IP out of the trust chain. Each member generates
 * an ephemeral P-256 key pair for the lifetime of a lobby session and publishes
 * only the public half over its own authenticated signaling WebSocket. Signaling
 * redistributes those public keys as part of the authoritative roster, so a
 * public key always arrives bound to a player id the sender could not forge.
 *
 * Every chat request then carries a signature over a canonical description of
 * that request. The receiver resolves the signer by key id, verifies the
 * signature against the roster-supplied public key, and only afterwards
 * consults the source IP - as a consistency hint, never as identity. Forging a
 * virtual IP therefore gains an attacker nothing: without the private key no
 * acceptable signature can be produced.
 *
 * P-256 with SHA-256 is used rather than Ed25519 because the Android client has
 * to interoperate and `KeyPairGenerator("Ed25519")` requires API 33 while this
 * app supports API 26. Public keys travel as X.509 SubjectPublicKeyInfo DER and
 * signatures as ASN.1 DER, which are exactly the encodings Java's
 * `KeyFactory("EC")` and `Signature("SHA256withECDSA")` produce and consume, so
 * both ends speak identical bytes without any custom conversion code.
 */
use std::collections::{HashMap, VecDeque};

use p256::ecdsa::signature::{Signer, Verifier};
use p256::ecdsa::{Signature, SigningKey, VerifyingKey};
use p256::pkcs8::{DecodePublicKey, EncodePublicKey};
use sha2::{Digest, Sha256};

/// Domain separator. Changing this string invalidates every signature produced
/// by an older client, which is exactly what must happen if the canonical form
/// below ever changes.
const CANONICAL_DOMAIN: &str = "MCTIER-CHAT-V1";
const SIGNALING_CANONICAL_DOMAIN: &str = "MCTIER-SIGNALING-V3";
pub const SIGNALING_PROTOCOL_VERSION: u8 = 3;

pub const CHAT_KEY_ID_HEADER: &str = "x-mctier-chat-key";
pub const CHAT_SIGNATURE_HEADER: &str = "x-mctier-chat-sig";
pub const CHAT_TIMESTAMP_HEADER: &str = "x-mctier-chat-ts";
pub const CHAT_NONCE_HEADER: &str = "x-mctier-chat-nonce";

/// A signature is accepted only when its timestamp is within this many seconds
/// of local time. Peers on one overlay are normally within a second of each
/// other; 120s absorbs realistic skew while keeping the replay window small.
pub const MAX_TIMESTAMP_SKEW_SECS: u64 = 120;

/// Key ids are the first 32 hex characters (16 bytes) of the SHA-256 of the
/// public key DER. Truncation is safe because a key id is only a lookup handle:
/// the signature is always verified against the full public key.
pub const KEY_ID_HEX_LEN: usize = 32;
pub const NONCE_HEX_LEN: usize = 32;

/// Uncompressed P-256 SubjectPublicKeyInfo DER is 91 bytes; leave room for
/// encoder differences while still rejecting anything absurd.
const MAX_PUBLIC_KEY_DER_BYTES: usize = 200;
const MAX_SIGNATURE_DER_BYTES: usize = 144;

/// Upper bound on remembered nonces per session. A member is rate limited to
/// 12 requests / 3s, so this covers minutes of traffic for a full 64-member
/// lobby and cannot be grown without bound by a hostile peer.
const MAX_TRACKED_NONCES: usize = 8192;

fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// Hex-encoded, truncated fingerprint of a public key DER.
pub fn key_id_for_public_key(public_key_der: &[u8]) -> String {
    let mut id = sha256_hex(public_key_der);
    id.truncate(KEY_ID_HEX_LEN);
    id
}

/// Full SHA-256 fingerprint used as the authoritative signaling identity.
/// Unlike the shorter chat lookup key, this value is a security principal and
/// therefore is never truncated.
pub fn identity_id_for_public_key(public_key_der: &[u8]) -> String {
    sha256_hex(public_key_der)
}

pub fn canonical_signaling_registration(
    challenge: &str,
    lobby_name: &str,
    virtual_ip: &str,
) -> Vec<u8> {
    [
        SIGNALING_CANONICAL_DOMAIN.to_string(),
        SIGNALING_PROTOCOL_VERSION.to_string(),
        challenge.to_string(),
        lobby_name.to_string(),
        virtual_ip.to_string(),
    ]
    .join("\n")
    .into_bytes()
}

pub fn is_valid_key_id(value: &str) -> bool {
    value.len() == KEY_ID_HEX_LEN && value.as_bytes().iter().all(u8::is_ascii_hexdigit)
}

pub fn is_valid_nonce(value: &str) -> bool {
    value.len() == NONCE_HEX_LEN && value.as_bytes().iter().all(u8::is_ascii_hexdigit)
}

fn base64_decode(value: &str) -> Option<Vec<u8>> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.decode(value).ok()
}

fn base64_encode(value: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(value)
}

/// Reject anything that is not a well formed P-256 public key before it can be
/// stored in a roster, so a bad key fails at registration instead of silently
/// breaking every later request.
pub fn parse_public_key_b64(encoded: &str) -> Option<Vec<u8>> {
    let trimmed = encoded.trim();
    if trimmed.is_empty() || trimmed.len() > MAX_PUBLIC_KEY_DER_BYTES * 2 {
        return None;
    }
    let der = base64_decode(trimmed)?;
    if der.len() > MAX_PUBLIC_KEY_DER_BYTES {
        return None;
    }
    VerifyingKey::from_public_key_der(&der).ok()?;
    Some(der)
}

/// Canonical byte string covered by a signature.
///
/// Request-shaping fields (method, path, body digest) and session-scoping
/// fields (token epoch, lobby credential digest) are both included, so a
/// captured signature cannot be moved to another endpoint, another lobby, or
/// another credential generation. Hashing the body keeps this cheap for large
/// image payloads while still covering every byte.
///
/// `audience` is the intended recipient's virtual IP. Binding it prevents a
/// member from taking a request addressed to itself and forwarding it to a
/// third member, who would otherwise accept it as freshly authored by the
/// original signer.
pub fn canonical_request(
    method: &str,
    path: &str,
    audience: &str,
    token_epoch: u64,
    timestamp: u64,
    nonce: &str,
    body: &[u8],
    lobby_token: &str,
) -> Vec<u8> {
    // The shared lobby token is never emitted in this form; only its digest is
    // bound in, which separates two lobbies that both sit at epoch 1.
    let fields = [
        CANONICAL_DOMAIN.to_string(),
        method.to_ascii_uppercase(),
        path.to_string(),
        audience.to_string(),
        token_epoch.to_string(),
        timestamp.to_string(),
        nonce.to_string(),
        sha256_hex(body),
        sha256_hex(lobby_token.as_bytes()),
    ];
    fields.join("\n").into_bytes()
}

/// Header values that must accompany a signed request.
#[derive(Debug, Clone)]
pub struct SignedRequestHeaders {
    pub key_id: String,
    pub signature: String,
    pub timestamp: String,
    pub nonce: String,
}

pub fn random_nonce() -> String {
    use rand::RngCore;
    let mut bytes = [0u8; NONCE_HEX_LEN / 2];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// The local member's ephemeral signing identity.
pub struct ChatSigner {
    signing_key: SigningKey,
    public_key_der: Vec<u8>,
    key_id: String,
}

impl ChatSigner {
    /// Generate a fresh key pair. One is created per lobby session, so leaving
    /// a lobby permanently retires the credential.
    pub fn generate() -> Result<Self, String> {
        let signing_key = SigningKey::random(&mut rand::rngs::OsRng);
        let public_key_der = signing_key
            .verifying_key()
            .to_public_key_der()
            .map_err(|error| format!("导出聊天公钥失败: {error}"))?
            .as_bytes()
            .to_vec();
        let key_id = key_id_for_public_key(&public_key_der);
        Ok(Self {
            signing_key,
            public_key_der,
            key_id,
        })
    }

    pub fn public_key_b64(&self) -> String {
        base64_encode(&self.public_key_der)
    }

    pub fn key_id(&self) -> &str {
        &self.key_id
    }

    pub fn identity_id(&self) -> String {
        identity_id_for_public_key(&self.public_key_der)
    }

    pub fn sign_signaling_registration(
        &self,
        challenge: &str,
        lobby_name: &str,
        virtual_ip: &str,
    ) -> String {
        let canonical = canonical_signaling_registration(challenge, lobby_name, virtual_ip);
        let signature: Signature = self.signing_key.sign(&canonical);
        base64_encode(signature.to_der().as_bytes())
    }

    /// Sign a request and return the header material the peer needs.
    ///
    /// `audience` must be the virtual IP of the peer the request is sent to.
    pub fn sign(
        &self,
        method: &str,
        path: &str,
        audience: &str,
        token_epoch: u64,
        timestamp: u64,
        body: &[u8],
        lobby_token: &str,
    ) -> SignedRequestHeaders {
        let nonce = random_nonce();
        let canonical = canonical_request(
            method,
            path,
            audience,
            token_epoch,
            timestamp,
            &nonce,
            body,
            lobby_token,
        );
        let signature: Signature = self.signing_key.sign(&canonical);
        SignedRequestHeaders {
            key_id: self.key_id.clone(),
            signature: base64_encode(signature.to_der().as_bytes()),
            timestamp: timestamp.to_string(),
            nonce,
        }
    }
}

/// Verify a DER signature over `canonical` using a DER public key.
pub fn verify_signature(public_key_der: &[u8], signature_b64: &str, canonical: &[u8]) -> bool {
    let trimmed = signature_b64.trim();
    if trimmed.is_empty() || trimmed.len() > MAX_SIGNATURE_DER_BYTES * 2 {
        return false;
    }
    let Some(signature_der) = base64_decode(trimmed) else {
        return false;
    };
    if signature_der.len() > MAX_SIGNATURE_DER_BYTES {
        return false;
    }
    let Ok(verifying_key) = VerifyingKey::from_public_key_der(public_key_der) else {
        return false;
    };
    let Ok(signature) = Signature::from_der(&signature_der) else {
        return false;
    };
    verifying_key.verify(canonical, &signature).is_ok()
}

/// True when `timestamp` is close enough to `now` in either direction.
pub fn is_fresh_timestamp(timestamp: u64, now: u64) -> bool {
    timestamp.abs_diff(now) <= MAX_TIMESTAMP_SKEW_SECS
}

pub fn parse_timestamp(raw: &str) -> Option<u64> {
    let trimmed = raw.trim();
    // Length is capped first so a huge digit string never reaches the parser.
    if trimmed.is_empty() || trimmed.len() > 20 {
        return None;
    }
    trimmed.parse::<u64>().ok()
}

/// Remembers recently accepted `(key_id, nonce)` pairs so a captured request
/// cannot be replayed inside the timestamp window.
#[derive(Debug, Default)]
pub struct ReplayGuard {
    seen: HashMap<(String, String), u64>,
    order: VecDeque<(String, String)>,
}

impl ReplayGuard {
    pub fn new() -> Self {
        Self::default()
    }

    /// Record a nonce. Returns false when this exact pair was already accepted.
    pub fn accept(&mut self, key_id: &str, nonce: &str, timestamp: u64, now: u64) -> bool {
        self.evict_expired(now);
        let entry = (key_id.to_string(), nonce.to_string());
        if self.seen.contains_key(&entry) {
            return false;
        }
        // Bound growth even when every nonce is still inside the window.
        while self.order.len() >= MAX_TRACKED_NONCES {
            match self.order.pop_front() {
                Some(oldest) => {
                    self.seen.remove(&oldest);
                }
                None => break,
            }
        }
        self.seen.insert(entry.clone(), timestamp);
        self.order.push_back(entry);
        true
    }

    fn evict_expired(&mut self, now: u64) {
        // A nonce can be forgotten once its timestamp can no longer pass the
        // freshness check, because from then on the request is refused anyway.
        let cutoff = now.saturating_sub(MAX_TIMESTAMP_SKEW_SECS * 2);
        while let Some(front) = self.order.front() {
            match self.seen.get(front) {
                Some(timestamp) if *timestamp >= cutoff => break,
                Some(_) => {
                    if let Some(expired) = self.order.pop_front() {
                        self.seen.remove(&expired);
                    }
                }
                None => {
                    self.order.pop_front();
                }
            }
        }
    }

    pub fn clear(&mut self) {
        self.seen.clear();
        self.order.clear();
    }

    #[cfg(test)]
    pub fn tracked(&self) -> usize {
        self.order.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn signer() -> ChatSigner {
        ChatSigner::generate().expect("generate signer")
    }

    #[test]
    fn public_keys_round_trip_and_derive_a_stable_key_id() {
        let signer = signer();
        let der = parse_public_key_b64(&signer.public_key_b64()).expect("public key must parse");
        assert_eq!(key_id_for_public_key(&der), signer.key_id());
        assert!(is_valid_key_id(signer.key_id()));
        assert_eq!(signer.identity_id().len(), 64);
        assert_eq!(
            signer.identity_id(),
            identity_id_for_public_key(&der),
            "signaling identity must be the full public-key fingerprint"
        );
    }

    #[test]
    fn signaling_registration_signature_covers_challenge_and_lobby_context() {
        let signer = signer();
        let der = parse_public_key_b64(&signer.public_key_b64()).expect("key");
        let challenge = "01".repeat(32);
        let signature = signer.sign_signaling_registration(&challenge, "lobby-a", "10.1.2.3");
        let canonical = canonical_signaling_registration(&challenge, "lobby-a", "10.1.2.3");
        assert!(verify_signature(&der, &signature, &canonical));

        let wrong_lobby = canonical_signaling_registration(&challenge, "lobby-b", "10.1.2.3");
        assert!(!verify_signature(&der, &signature, &wrong_lobby));
        let wrong_challenge =
            canonical_signaling_registration(&"02".repeat(32), "lobby-a", "10.1.2.3");
        assert!(!verify_signature(&der, &signature, &wrong_challenge));
    }

    #[test]
    fn malformed_public_keys_are_rejected_at_the_boundary() {
        assert!(parse_public_key_b64("").is_none());
        assert!(parse_public_key_b64("not-base64!!").is_none());
        // Valid base64 but not a key.
        assert!(parse_public_key_b64("AAAA").is_none());
        assert!(parse_public_key_b64(&"A".repeat(MAX_PUBLIC_KEY_DER_BYTES * 4)).is_none());
    }

    #[test]
    fn a_signature_verifies_only_against_its_own_canonical_request() {
        let signer = signer();
        let der = parse_public_key_b64(&signer.public_key_b64()).expect("key");
        let body = br#"{"content":"hello"}"#;
        let peer = "10.126.126.2";
        let signed = signer.sign(
            "POST",
            "/api/chat/send",
            peer,
            3,
            1_700_000_000,
            body,
            "token-a",
        );
        let canonical = canonical_request(
            "POST",
            "/api/chat/send",
            peer,
            3,
            1_700_000_000,
            &signed.nonce,
            body,
            "token-a",
        );
        assert!(verify_signature(&der, &signed.signature, &canonical));

        // Any change to covered material must invalidate the signature.
        let tampered = [
            canonical_request(
                "GET",
                "/api/chat/send",
                peer,
                3,
                1_700_000_000,
                &signed.nonce,
                body,
                "token-a",
            ),
            canonical_request(
                "POST",
                "/api/chat/messages",
                peer,
                3,
                1_700_000_000,
                &signed.nonce,
                body,
                "token-a",
            ),
            // Different recipient: blocks one member relaying another's request.
            canonical_request(
                "POST",
                "/api/chat/send",
                "10.126.126.3",
                3,
                1_700_000_000,
                &signed.nonce,
                body,
                "token-a",
            ),
            canonical_request(
                "POST",
                "/api/chat/send",
                peer,
                4,
                1_700_000_000,
                &signed.nonce,
                body,
                "token-a",
            ),
            canonical_request(
                "POST",
                "/api/chat/send",
                peer,
                3,
                1_700_000_001,
                &signed.nonce,
                body,
                "token-a",
            ),
            canonical_request(
                "POST",
                "/api/chat/send",
                peer,
                3,
                1_700_000_000,
                &"f".repeat(NONCE_HEX_LEN),
                body,
                "token-a",
            ),
            canonical_request(
                "POST",
                "/api/chat/send",
                peer,
                3,
                1_700_000_000,
                &signed.nonce,
                br#"{"content":"x"}"#,
                "token-a",
            ),
            canonical_request(
                "POST",
                "/api/chat/send",
                peer,
                3,
                1_700_000_000,
                &signed.nonce,
                body,
                "token-b",
            ),
        ];
        for canonical in tampered {
            assert!(
                !verify_signature(&der, &signed.signature, &canonical),
                "签名必须只对其自身的规范化请求有效"
            );
        }
    }

    #[test]
    fn one_member_cannot_sign_as_another() {
        // The impersonation case: knowing the shared lobby token and spoofing a
        // virtual IP is useless without the victim's private key.
        let victim = signer();
        let attacker = signer();
        let victim_der = parse_public_key_b64(&victim.public_key_b64()).expect("key");
        let body = b"{}";
        let forged = attacker.sign(
            "POST",
            "/api/chat/send",
            "10.126.126.9",
            1,
            1_700_000_000,
            body,
            "token",
        );
        let canonical = canonical_request(
            "POST",
            "/api/chat/send",
            "10.126.126.9",
            1,
            1_700_000_000,
            &forged.nonce,
            body,
            "token",
        );
        assert!(!verify_signature(
            &victim_der,
            &forged.signature,
            &canonical
        ));
        assert_ne!(attacker.key_id(), victim.key_id());
    }

    #[test]
    fn signatures_do_not_transfer_between_bodies_of_equal_length() {
        let signer = signer();
        let der = parse_public_key_b64(&signer.public_key_b64()).expect("key");
        let signed = signer.sign(
            "POST",
            "/api/chat/send",
            "10.126.126.2",
            1,
            1_700_000_000,
            b"AAAA",
            "t",
        );
        let canonical = canonical_request(
            "POST",
            "/api/chat/send",
            "10.126.126.2",
            1,
            1_700_000_000,
            &signed.nonce,
            b"BBBB",
            "t",
        );
        assert!(!verify_signature(&der, &signed.signature, &canonical));
    }

    #[test]
    fn replay_guard_rejects_a_repeated_nonce_and_bounds_its_memory() {
        let mut guard = ReplayGuard::new();
        let now = 1_700_000_000;
        assert!(guard.accept("key", "nonce-1", now, now));
        assert!(!guard.accept("key", "nonce-1", now, now));
        // The same nonce from a different signer is a distinct entry.
        assert!(guard.accept("other", "nonce-1", now, now));

        for index in 0..MAX_TRACKED_NONCES + 64 {
            guard.accept("flood", &format!("n{index}"), now, now);
        }
        assert!(guard.tracked() <= MAX_TRACKED_NONCES);
    }

    #[test]
    fn replay_guard_forgets_nonces_that_can_no_longer_be_fresh() {
        let mut guard = ReplayGuard::new();
        let start = 1_700_000_000;
        assert!(guard.accept("key", "old", start, start));
        let later = start + MAX_TIMESTAMP_SKEW_SECS * 4;
        guard.accept("key", "fresh", later, later);
        assert_eq!(guard.tracked(), 1, "过期 nonce 应被清理，避免无界增长");
    }

    #[test]
    fn timestamp_freshness_is_symmetric_and_bounded() {
        let now = 1_700_000_000;
        assert!(is_fresh_timestamp(now, now));
        assert!(is_fresh_timestamp(now - MAX_TIMESTAMP_SKEW_SECS, now));
        assert!(is_fresh_timestamp(now + MAX_TIMESTAMP_SKEW_SECS, now));
        assert!(!is_fresh_timestamp(now - MAX_TIMESTAMP_SKEW_SECS - 1, now));
        assert!(!is_fresh_timestamp(now + MAX_TIMESTAMP_SKEW_SECS + 1, now));
    }

    #[test]
    fn header_scalars_are_validated_before_use() {
        assert!(is_valid_nonce(&random_nonce()));
        assert!(!is_valid_nonce("short"));
        assert!(!is_valid_nonce(&"z".repeat(NONCE_HEX_LEN)));
        assert!(!is_valid_key_id("nothex"));
        assert_eq!(parse_timestamp(" 1700000000 "), Some(1_700_000_000));
        assert!(parse_timestamp("").is_none());
        assert!(parse_timestamp("-1").is_none());
        assert!(parse_timestamp(&"9".repeat(21)).is_none());
    }
}
