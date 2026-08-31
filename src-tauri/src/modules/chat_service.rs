/**
 * P2P chat service.
 *
 * The HTTP service is deliberately scoped to the current EasyTier interface.
 * Authentication has two independent layers:
 *
 * 1. The signaling-issued per-lobby token gates the endpoint at all. Every
 *    member of the lobby knows it, so on its own it only proves membership.
 * 2. Cross-peer requests must additionally carry a per-member signature (see
 *    [`super::chat_auth`]). The signer is resolved by key id and verified
 *    against the public key that signaling published for that player, so
 *    attribution no longer depends on the TCP source address.
 *
 * The source IP is still cross-checked, but only as a consistency hint: a
 * member that spoofs another member's virtual IP cannot produce a signature for
 * that member's key, so the request is refused. Request fields such as
 * player_id/player_name are never used for authorization or attribution.
 */
use std::collections::{HashMap, HashSet, VecDeque};
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use axum::{
    body::Bytes,
    extract::{ConnectInfo, DefaultBodyLimit, Query, State},
    http::{header, HeaderMap, StatusCode},
    response::sse::{Event, KeepAlive, Sse},
    routing::{get, post},
    Json, Router,
};
use futures_util::stream::Stream;
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use tokio::sync::{broadcast, Mutex};
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::StreamExt;

use super::chat_auth::{
    canonical_request, is_fresh_timestamp, is_valid_key_id, is_valid_nonce, key_id_for_public_key,
    parse_public_key_b64, parse_timestamp, verify_signature, ChatSigner, ReplayGuard,
    CHAT_KEY_ID_HEADER, CHAT_NONCE_HEADER, CHAT_SIGNATURE_HEADER, CHAT_TIMESTAMP_HEADER,
};
use super::http_cors::lan_cors_layer;

pub const CHAT_SERVER_PORT: u16 = 14540;
pub const CHAT_TOKEN_HEX_BYTES: usize = 64;
pub const MAX_HISTORY_MESSAGES: usize = 1000;
pub const MAX_HISTORY_BYTES: usize = 4 * 1024 * 1024;
pub const MAX_HTTP_BODY_BYTES: usize = 2 * 1024 * 1024;
pub const MAX_TEXT_BYTES: usize = 16 * 1024;
pub const MAX_IMAGE_BYTES: usize = 512 * 1024;
pub const MAX_IMAGE_CONTENT_BYTES: usize = 256;
pub const MAX_ANNOUNCE_BYTES: usize = 16 * 1024;
pub const MAX_VOICE_GROUP_BYTES: usize = 32;
pub const MAX_CLIPBOARD_BYTES: usize = 16 * 1024;
pub const MAX_TODO_BYTES: usize = 64 * 1024;
pub const MAX_WHITEBOARD_BYTES: usize = 64 * 1024;
pub const MAX_RECALL_BYTES: usize = 128;
pub const MAX_AVATAR_BYTES: usize = 192 * 1024;
pub const MAX_ID_BYTES: usize = 128;
pub const MAX_PLAYER_NAME_BYTES: usize = 256;
pub const MAX_CHAT_PEERS: usize = 64;
pub const RECALL_WINDOW_SECS: u64 = 2 * 60;
pub const CHAT_TOKEN_HEADER: &str = "x-mctier-chat-token";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub id: String,
    pub player_id: String,
    pub player_name: String,
    pub content: String,
    pub message_type: MessageType,
    pub timestamp: u64,
    pub image_data: Option<Vec<u8>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum MessageType {
    Text,
    Image,
    Announce,
    VoiceGroup,
    Clipboard,
    Todo,
    Whiteboard,
    Recall,
    Avatar,
}

#[derive(Debug, Deserialize)]
pub struct GetMessagesQuery {
    pub since: Option<u64>,
}

/// Authoritative identity received from the authenticated signaling snapshot.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ChatPeerIdentity {
    pub player_id: String,
    pub player_name: String,
    pub virtual_ip: String,
    /// Base64 X.509 SubjectPublicKeyInfo DER of this member's chat signing key,
    /// as published by signaling. `None` means the peer did not present one
    /// (an older client); such a peer cannot pass signature verification.
    #[serde(default)]
    pub chat_public_key: Option<String>,
}

/// Player fields are retained for wire compatibility but are ignored by the
/// receiver in favor of the TCP source IP identity map.
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SendMessageRequest {
    #[serde(default)]
    pub id: Option<String>,
    pub player_id: String,
    pub player_name: String,
    pub content: String,
    pub message_type: MessageType,
    pub image_data: Option<Vec<u8>>,
}

#[derive(Debug, Clone)]
struct RateLimitKey {
    player_id: String,
    ip: IpAddr,
}

impl PartialEq for RateLimitKey {
    fn eq(&self, other: &Self) -> bool {
        self.player_id == other.player_id && self.ip == other.ip
    }
}

impl Eq for RateLimitKey {}

impl std::hash::Hash for RateLimitKey {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        self.player_id.hash(state);
        self.ip.hash(state);
    }
}

#[derive(Clone)]
struct AppState {
    local_messages: Arc<RwLock<VecDeque<ChatMessage>>>,
    history_bytes: Arc<RwLock<usize>>,
    message_tx: broadcast::Sender<ChatMessage>,
    session: Arc<RwLock<Option<ChatSession>>>,
    rate_limiter: Arc<Mutex<HashMap<RateLimitKey, VecDeque<Instant>>>>,
    replay_guard: Arc<Mutex<ReplayGuard>>,
}

/// A roster entry resolved by signing key id.
#[derive(Debug, Clone)]
struct VerifiedPeer {
    identity: ChatPeerIdentity,
    public_key_der: Vec<u8>,
}

#[derive(Debug, Clone)]
struct ChatSession {
    token: String,
    epoch: u64,
    identities: HashMap<IpAddr, ChatPeerIdentity>,
    /// Key id -> roster entry. This is the authoritative attribution path;
    /// `identities` is only used for the source-IP consistency check.
    peers_by_key: HashMap<String, VerifiedPeer>,
    local_identity: ChatPeerIdentity,
    host_id: Option<String>,
}

pub struct ChatService {
    local_messages: Arc<RwLock<VecDeque<ChatMessage>>>,
    history_bytes: Arc<RwLock<usize>>,
    virtual_ip: Arc<RwLock<Option<String>>>,
    server_handle: Arc<RwLock<Option<tokio::task::JoinHandle<()>>>>,
    message_tx: broadcast::Sender<ChatMessage>,
    session: Arc<RwLock<Option<ChatSession>>>,
    rate_limiter: Arc<Mutex<HashMap<RateLimitKey, VecDeque<Instant>>>>,
    replay_guard: Arc<Mutex<ReplayGuard>>,
    /// Signing identity for the current lobby session. Recreated on every
    /// session so leaving a lobby retires the key permanently.
    signer: Arc<RwLock<Option<Arc<ChatSigner>>>>,
}

impl ChatService {
    pub fn new() -> Self {
        let (message_tx, _rx) = broadcast::channel(256);
        Self {
            local_messages: Arc::new(RwLock::new(VecDeque::new())),
            history_bytes: Arc::new(RwLock::new(0)),
            virtual_ip: Arc::new(RwLock::new(None)),
            server_handle: Arc::new(RwLock::new(None)),
            message_tx,
            session: Arc::new(RwLock::new(None)),
            rate_limiter: Arc::new(Mutex::new(HashMap::new())),
            replay_guard: Arc::new(Mutex::new(ReplayGuard::new())),
            signer: Arc::new(RwLock::new(None)),
        }
    }

    /// Public key the renderer must hand to signaling before registering.
    ///
    /// The key pair is created on first use and then reused until the session
    /// is cleared, so the value published to signaling and the value used to
    /// sign requests cannot drift apart.
    pub fn ensure_signing_key(&self) -> Result<String, String> {
        if let Some(signer) = self.signer.read().as_ref() {
            return Ok(signer.public_key_b64());
        }
        let mut slot = self.signer.write();
        // Re-check under the write lock: two callers may race here.
        if let Some(signer) = slot.as_ref() {
            return Ok(signer.public_key_b64());
        }
        let signer = Arc::new(ChatSigner::generate()?);
        let encoded = signer.public_key_b64();
        *slot = Some(signer);
        Ok(encoded)
    }

    pub fn signing_public_key(&self) -> Option<String> {
        self.signer
            .read()
            .as_ref()
            .map(|signer| signer.public_key_b64())
    }

    pub fn signaling_identity(&self) -> Result<(String, String), String> {
        self.ensure_signing_key()?;
        let signer = self
            .signer()
            .ok_or_else(|| "信令签名身份未就绪".to_string())?;
        Ok((signer.identity_id(), signer.public_key_b64()))
    }

    pub fn sign_signaling_registration(
        &self,
        challenge: &str,
        lobby_name: &str,
        virtual_ip: &str,
    ) -> Result<(String, String, String), String> {
        let (client_id, identity_public_key) = self.signaling_identity()?;
        let signer = self
            .signer()
            .ok_or_else(|| "信令签名身份未就绪".to_string())?;
        let signature = signer.sign_signaling_registration(challenge, lobby_name, virtual_ip);
        Ok((client_id, identity_public_key, signature))
    }

    fn signer(&self) -> Option<Arc<ChatSigner>> {
        self.signer.read().clone()
    }

    /// Sign an outgoing request for the current session.
    ///
    /// `audience` is the recipient peer's virtual IP; binding it stops one
    /// member from relaying a request it received to a third member. Returns
    /// `None` when no session or no key is active, in which case the caller
    /// must not send at all.
    pub fn sign_request(
        &self,
        method: &str,
        path: &str,
        audience: &str,
        body: &[u8],
    ) -> Option<super::chat_auth::SignedRequestHeaders> {
        let signer = self.signer()?;
        let session = self.session.read();
        let session = session.as_ref()?;
        Some(signer.sign(
            method,
            path,
            audience,
            session.epoch,
            unix_seconds(),
            body,
            &session.token,
        ))
    }

    pub fn set_virtual_ip(&self, ip: String) {
        *self.virtual_ip.write() = Some(ip);
    }

    pub fn get_virtual_ip(&self) -> Option<String> {
        self.virtual_ip.read().clone()
    }

    pub fn get_chat_token(&self) -> Option<String> {
        self.session
            .read()
            .as_ref()
            .map(|session| session.token.clone())
    }

    pub fn get_local_identity(&self) -> Option<ChatPeerIdentity> {
        self.session
            .read()
            .as_ref()
            .map(|session| session.local_identity.clone())
    }

    pub fn set_session(
        &self,
        token: String,
        epoch: u64,
        player_id: String,
        player_name: String,
        host_id: Option<String>,
        peers: Vec<ChatPeerIdentity>,
    ) -> Result<(), String> {
        if !is_valid_chat_token(&token) {
            return Err("聊天令牌格式无效".to_string());
        }
        if epoch == 0 {
            return Err("聊天令牌 epoch 无效".to_string());
        }
        let virtual_ip = self
            .get_virtual_ip()
            .ok_or_else(|| "虚拟IP未设置".to_string())?;
        // The local signing key must exist before a session opens, otherwise
        // this peer could neither sign its own sends nor be verified by others.
        let local_public_key = self
            .signing_public_key()
            .ok_or_else(|| "聊天签名密钥尚未生成".to_string())?;
        let local = ChatPeerIdentity {
            player_id,
            player_name,
            virtual_ip,
            chat_public_key: Some(local_public_key),
        };
        let map = build_identity_map(&local, peers)?;
        validate_host_id(host_id.as_deref(), &map)?;
        let peers_by_key = build_key_map(&map)?;

        let mut session = self.session.write();
        if let Some(current) = session.as_ref() {
            if current.local_identity != local {
                return Err("聊天会话身份发生变化，必须先停止旧会话".to_string());
            }
            if epoch < current.epoch {
                return Err("拒绝过期的聊天令牌 epoch".to_string());
            }
            if epoch == current.epoch && token != current.token {
                return Err("同一聊天 epoch 收到不一致令牌".to_string());
            }
        }
        *session = Some(ChatSession {
            token,
            epoch,
            identities: map,
            peers_by_key,
            local_identity: local,
            host_id,
        });
        Ok(())
    }

    pub fn update_peer_identities(
        &self,
        peers: Vec<ChatPeerIdentity>,
        host_id: Option<String>,
    ) -> Result<(), String> {
        let mut session = self.session.write();
        let current = session
            .as_mut()
            .ok_or_else(|| "聊天会话尚未初始化".to_string())?;
        let local = current.local_identity.clone();
        let map = build_identity_map(&local, peers)?;
        validate_host_id(host_id.as_deref(), &map)?;
        let peers_by_key = build_key_map(&map)?;
        current.host_id = host_id;
        current.identities = map;
        current.peers_by_key = peers_by_key;
        Ok(())
    }

    pub fn allowed_peer_ips(&self, requested: &[String]) -> Vec<String> {
        let session = self.session.read();
        let Some(session) = session.as_ref() else {
            return Vec::new();
        };
        requested
            .iter()
            .filter_map(|raw| {
                let ip = raw.parse::<IpAddr>().ok()?;
                let identity = session.identities.get(&ip)?;
                if session.local_identity.player_id == identity.player_id {
                    return None;
                }
                Some(ip.to_string())
            })
            .collect()
    }

    pub fn authoritative_peers(&self) -> Vec<ChatPeerIdentity> {
        let session = self.session.read();
        let Some(session) = session.as_ref() else {
            return Vec::new();
        };
        let mut peers = session
            .identities
            .values()
            .filter(|identity| identity.player_id != session.local_identity.player_id)
            .cloned()
            .collect::<Vec<_>>();
        peers.sort_by(|left, right| left.player_id.cmp(&right.player_id));
        peers
    }

    pub fn local_is_host(&self) -> bool {
        self.session.read().as_ref().is_some_and(|session| {
            session.host_id.as_deref() == Some(session.local_identity.player_id.as_str())
        })
    }

    pub fn get_host_id(&self) -> Option<String> {
        self.session
            .read()
            .as_ref()
            .and_then(|session| session.host_id.clone())
    }

    /// Clearing a session is a security boundary: the signing key is retired
    /// and the replay window is forgotten along with the roster.
    pub fn clear_session(&self) {
        *self.session.write() = None;
        *self.signer.write() = None;
    }

    /// Start only after a signaling-issued token has configured this session.
    pub async fn start_server(&self) -> Result<(), Box<dyn std::error::Error>> {
        if self.is_running() {
            return Ok(());
        }
        let session = self
            .session
            .read()
            .clone()
            .ok_or_else(|| "聊天会话未就绪".to_string())?;
        if !is_valid_chat_token(&session.token) {
            return Err("聊天令牌格式无效".into());
        }
        let virtual_ip = self
            .get_virtual_ip()
            .ok_or_else(|| "虚拟IP未设置".to_string())?;
        let ip = parse_chat_ipv4(&virtual_ip)
            .ok_or_else(|| "聊天服务只能绑定可用的 EasyTier 虚拟 IPv4".to_string())?;
        if session.local_identity.virtual_ip != ip.to_string() {
            return Err("聊天会话身份与绑定虚拟 IP 不一致".into());
        }

        let app = Router::new()
            .route("/api/chat/messages", get(get_messages))
            .route("/api/chat/send", post(send_message))
            .route("/api/chat/stream", get(stream_messages))
            .layer(DefaultBodyLimit::max(MAX_HTTP_BODY_BYTES))
            .layer(lan_cors_layer())
            .with_state(AppState {
                local_messages: Arc::clone(&self.local_messages),
                history_bytes: Arc::clone(&self.history_bytes),
                message_tx: self.message_tx.clone(),
                session: Arc::clone(&self.session),
                rate_limiter: Arc::clone(&self.rate_limiter),
                replay_guard: Arc::clone(&self.replay_guard),
            });
        let listener =
            tokio::net::TcpListener::bind(SocketAddr::new(IpAddr::V4(ip), CHAT_SERVER_PORT))
                .await?;
        let server_task = tokio::spawn(async move {
            if let Err(error) = axum::serve(
                listener,
                app.into_make_service_with_connect_info::<SocketAddr>(),
            )
            .await
            {
                log::error!("聊天服务器运行错误: {}", error);
            }
        });
        *self.server_handle.write() = Some(server_task);
        Ok(())
    }

    pub async fn stop_server(&self) {
        if let Some(handle) = self.server_handle.write().take() {
            handle.abort();
        }
        self.clear_session();
        self.clear_local_messages();
        self.rate_limiter.lock().await.clear();
        self.replay_guard.lock().await.clear();
        *self.virtual_ip.write() = None;
    }

    pub fn is_running(&self) -> bool {
        self.server_handle.read().is_some()
    }

    pub fn add_local_message(&self, message: ChatMessage) -> bool {
        store_message(
            &self.local_messages,
            &self.history_bytes,
            &self.message_tx,
            message,
        )
    }

    pub fn get_local_messages(&self, since: Option<u64>) -> Vec<ChatMessage> {
        let messages = self.local_messages.read();
        messages
            .iter()
            .filter(|message| since.is_none_or(|timestamp| message.timestamp > timestamp))
            .cloned()
            .collect()
    }

    pub fn clear_local_messages(&self) {
        self.local_messages.write().clear();
        *self.history_bytes.write() = 0;
    }
}

fn build_identity_map(
    local: &ChatPeerIdentity,
    peers: Vec<ChatPeerIdentity>,
) -> Result<HashMap<IpAddr, ChatPeerIdentity>, String> {
    if peers.len() > MAX_CHAT_PEERS {
        return Err("大厅聊天成员数量超过限制".to_string());
    }
    let mut map = HashMap::new();
    let mut player_ids = HashSet::new();
    for identity in std::iter::once(local.clone()).chain(peers) {
        if identity.player_id.is_empty()
            || identity.player_id.len() > MAX_ID_BYTES
            || identity.player_id.chars().any(char::is_control)
            || identity.player_name.is_empty()
            || identity.player_name.len() > MAX_PLAYER_NAME_BYTES
            || identity.player_name.chars().any(char::is_control)
        {
            return Err("大厅成员身份字段超出限制".to_string());
        }
        if !player_ids.insert(identity.player_id.clone()) {
            return Err("大厅成员玩家ID重复".to_string());
        }
        let ip = parse_chat_ipv4(&identity.virtual_ip)
            .ok_or_else(|| "大厅成员必须使用可用的 EasyTier 虚拟 IPv4".to_string())?;
        let normalized = ChatPeerIdentity {
            virtual_ip: ip.to_string(),
            ..identity
        };
        if map.insert(IpAddr::V4(ip), normalized).is_some() {
            return Err("大厅成员虚拟IP重复".to_string());
        }
    }
    Ok(map)
}

/// Index the roster by signing key id.
///
/// A duplicate key id is refused outright: two members presenting the same
/// public key would make attribution ambiguous, which is exactly the property
/// this mechanism exists to guarantee. Members without a published key are
/// simply absent from the map, so their requests cannot be verified.
fn build_key_map(
    identities: &HashMap<IpAddr, ChatPeerIdentity>,
) -> Result<HashMap<String, VerifiedPeer>, String> {
    let mut by_key = HashMap::new();
    for identity in identities.values() {
        let Some(encoded) = identity.chat_public_key.as_deref() else {
            continue;
        };
        let public_key_der = parse_public_key_b64(encoded)
            .ok_or_else(|| "大厅成员的聊天签名公钥无效".to_string())?;
        let key_id = key_id_for_public_key(&public_key_der);
        let entry = VerifiedPeer {
            identity: identity.clone(),
            public_key_der,
        };
        if by_key.insert(key_id, entry).is_some() {
            return Err("大厅成员聊天签名公钥重复".to_string());
        }
    }
    Ok(by_key)
}

fn parse_chat_ipv4(raw: &str) -> Option<Ipv4Addr> {
    let ip = raw.trim().parse::<Ipv4Addr>().ok()?;
    let octets = ip.octets();
    if octets[..3] != [10, 126, 126] || octets[3] == 0 || octets[3] == 255 {
        return None;
    }
    Some(ip)
}

fn validate_host_id(
    host_id: Option<&str>,
    identities: &HashMap<IpAddr, ChatPeerIdentity>,
) -> Result<(), String> {
    if host_id.is_some_and(|host| {
        !identities
            .values()
            .any(|identity| identity.player_id == host)
    }) {
        return Err("房主身份不在当前大厅成员列表中".to_string());
    }
    Ok(())
}

fn is_valid_chat_token(token: &str) -> bool {
    token.len() == CHAT_TOKEN_HEX_BYTES
        && token.as_bytes().iter().all(|byte| byte.is_ascii_hexdigit())
}

pub fn is_message_id_for_player(id: &str, player_id: &str) -> bool {
    !id.is_empty()
        && id.len() <= MAX_ID_BYTES
        && !id.chars().any(char::is_control)
        && [format!("msg-{player_id}-"), format!("recall-{player_id}-")]
            .iter()
            .any(|prefix| id.starts_with(prefix) && id.len() > prefix.len())
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    let mut difference = (left.len() ^ right.len()) as u8;
    let max_len = left.len().max(right.len());
    for index in 0..max_len {
        let lhs = left.get(index).copied().unwrap_or(0);
        let rhs = right.get(index).copied().unwrap_or(0);
        difference |= lhs ^ rhs;
    }
    difference == 0
}

/// Outcome of a fully authenticated request.
struct SignedAuth {
    identity: ChatPeerIdentity,
    key_id: String,
    nonce: String,
    timestamp: u64,
}

/// Membership gate: the shared per-lobby token.
///
/// This proves the caller is in the lobby but says nothing about *which*
/// member it is, because every member holds the same value.
fn authenticated_session_token(headers: &HeaderMap, state: &AppState) -> Result<(), StatusCode> {
    let supplied = headers
        .get(CHAT_TOKEN_HEADER)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    let session = state.session.read();
    let session = session.as_ref().ok_or(StatusCode::UNAUTHORIZED)?;
    if !constant_time_eq(supplied.as_bytes(), session.token.as_bytes()) {
        return Err(StatusCode::UNAUTHORIZED);
    }
    Ok(())
}

/// Resolve and verify the caller's identity from its request signature.
///
/// The order matters: the token is checked first so unauthenticated probes
/// never reach the verifier, then the signer is resolved *by key id* and the
/// signature is verified against the roster-published public key. Only after
/// that is the source address examined, and then merely to confirm it matches
/// the address signaling recorded for that member.
///
/// Consequence: forging a virtual IP is useless. The attacker would still have
/// to produce a signature under the victim's key, and lacking the private key
/// it cannot. Conversely a member signing with its own key but arriving from
/// someone else's address is refused as inconsistent.
///
/// Replay protection is applied by the caller, which owns the async lock.
fn authenticate_signed_request(
    headers: &HeaderMap,
    peer: SocketAddr,
    state: &AppState,
    method: &str,
    path: &str,
    body: &[u8],
) -> Result<SignedAuth, StatusCode> {
    authenticated_session_token(headers, state)?;

    let header_value = |name: &str| -> Result<&str, StatusCode> {
        let mut values = headers.get_all(name).iter();
        let first = values.next().ok_or(StatusCode::UNAUTHORIZED)?;
        // A duplicated header is ambiguous; refuse rather than pick one.
        if values.next().is_some() {
            return Err(StatusCode::BAD_REQUEST);
        }
        first.to_str().map_err(|_| StatusCode::BAD_REQUEST)
    };

    let key_id = header_value(CHAT_KEY_ID_HEADER)?.trim().to_string();
    let signature = header_value(CHAT_SIGNATURE_HEADER)?.trim().to_string();
    let nonce = header_value(CHAT_NONCE_HEADER)?.trim().to_string();
    let timestamp =
        parse_timestamp(header_value(CHAT_TIMESTAMP_HEADER)?).ok_or(StatusCode::BAD_REQUEST)?;
    if !is_valid_key_id(&key_id) || !is_valid_nonce(&nonce) {
        return Err(StatusCode::BAD_REQUEST);
    }
    if !is_fresh_timestamp(timestamp, unix_seconds()) {
        return Err(StatusCode::UNAUTHORIZED);
    }

    let session = state.session.read();
    let session = session.as_ref().ok_or(StatusCode::UNAUTHORIZED)?;
    // Unknown key id means the member is not in the authoritative roster, or
    // published no key at all. Either way it cannot be attributed.
    let peer_entry = session
        .peers_by_key
        .get(&key_id)
        .ok_or(StatusCode::FORBIDDEN)?;

    // We are the audience: the signature must have been produced for this
    // member specifically, not for some other peer in the lobby.
    let canonical = canonical_request(
        method,
        path,
        &session.local_identity.virtual_ip,
        session.epoch,
        timestamp,
        &nonce,
        body,
        &session.token,
    );
    if !verify_signature(&peer_entry.public_key_der, &signature, &canonical) {
        return Err(StatusCode::UNAUTHORIZED);
    }

    // Source address is now only a consistency check against the roster.
    if peer_entry.identity.virtual_ip != peer.ip().to_string() {
        log::warn!(
            "拒绝签名与来源地址不一致的聊天请求: signer={}, 来源={}",
            peer_entry.identity.player_id,
            peer.ip()
        );
        return Err(StatusCode::FORBIDDEN);
    }

    Ok(SignedAuth {
        identity: peer_entry.identity.clone(),
        key_id,
        nonce,
        timestamp,
    })
}

/// Full authentication for one request, including replay rejection.
async fn authorize_request(
    headers: &HeaderMap,
    peer: SocketAddr,
    state: &AppState,
    method: &str,
    path: &str,
    body: &[u8],
) -> Result<ChatPeerIdentity, StatusCode> {
    let auth = authenticate_signed_request(headers, peer, state, method, path, body)?;
    let accepted = state.replay_guard.lock().await.accept(
        &auth.key_id,
        &auth.nonce,
        auth.timestamp,
        unix_seconds(),
    );
    if !accepted {
        log::warn!("拒绝重放的聊天请求: signer={}", auth.identity.player_id);
        return Err(StatusCode::UNAUTHORIZED);
    }
    if !allow_request(state, &auth.identity, peer.ip()).await {
        return Err(StatusCode::TOO_MANY_REQUESTS);
    }
    Ok(auth.identity)
}

fn require_json_body(headers: &HeaderMap, body: &Bytes) -> Result<(), StatusCode> {
    let mut content_lengths = headers.get_all(header::CONTENT_LENGTH).iter();
    let content_length = content_lengths
        .next()
        .and_then(|value| value.to_str().ok())
        .ok_or(StatusCode::LENGTH_REQUIRED)?;
    if content_lengths.next().is_some() {
        return Err(StatusCode::BAD_REQUEST);
    }
    let declared = content_length
        .parse::<usize>()
        .map_err(|_| StatusCode::BAD_REQUEST)?;
    if declared != body.len() {
        return Err(StatusCode::BAD_REQUEST);
    }
    if declared > MAX_HTTP_BODY_BYTES {
        return Err(StatusCode::PAYLOAD_TOO_LARGE);
    }
    let media_type = headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .map(str::trim)
        .unwrap_or("");
    if !media_type.eq_ignore_ascii_case("application/json") {
        return Err(StatusCode::UNSUPPORTED_MEDIA_TYPE);
    }
    Ok(())
}

async fn allow_request(state: &AppState, identity: &ChatPeerIdentity, ip: IpAddr) -> bool {
    let key = RateLimitKey {
        player_id: identity.player_id.clone(),
        ip,
    };
    let now = Instant::now();
    let mut limiter = state.rate_limiter.lock().await;
    let entries = limiter.entry(key).or_default();
    while entries
        .front()
        .is_some_and(|timestamp| now.duration_since(*timestamp) > Duration::from_secs(3))
    {
        entries.pop_front();
    }
    if entries.len() >= 12 {
        return false;
    }
    entries.push_back(now);
    if limiter.len() > 256 {
        limiter.retain(|_, entries| !entries.is_empty());
    }
    true
}

fn validate_request(
    request: &SendMessageRequest,
    identity: &ChatPeerIdentity,
    state: &AppState,
) -> Result<(), StatusCode> {
    if request
        .id
        .as_deref()
        .is_some_and(|id| !is_message_id_for_player(id, identity.player_id.as_str()))
    {
        return Err(StatusCode::BAD_REQUEST);
    }
    let content_bytes = request.content.as_bytes().len();
    match request.message_type {
        MessageType::Text => {
            if content_bytes == 0 || content_bytes > MAX_TEXT_BYTES || request.image_data.is_some()
            {
                return Err(StatusCode::PAYLOAD_TOO_LARGE);
            }
        }
        MessageType::Image => {
            if content_bytes > MAX_IMAGE_CONTENT_BYTES {
                return Err(StatusCode::PAYLOAD_TOO_LARGE);
            }
            let image = request.image_data.as_ref().ok_or(StatusCode::BAD_REQUEST)?;
            if image.is_empty() || image.len() > MAX_IMAGE_BYTES {
                return Err(StatusCode::PAYLOAD_TOO_LARGE);
            }
        }
        MessageType::Announce => {
            if content_bytes > MAX_ANNOUNCE_BYTES || request.image_data.is_some() {
                return Err(StatusCode::PAYLOAD_TOO_LARGE);
            }
            if state
                .session
                .read()
                .as_ref()
                .and_then(|session| session.host_id.as_deref())
                != Some(identity.player_id.as_str())
            {
                return Err(StatusCode::FORBIDDEN);
            }
        }
        MessageType::VoiceGroup => {
            if content_bytes > MAX_VOICE_GROUP_BYTES || request.image_data.is_some() {
                return Err(StatusCode::PAYLOAD_TOO_LARGE);
            }
            let group = request
                .content
                .parse::<u8>()
                .map_err(|_| StatusCode::BAD_REQUEST)?;
            if group > 4 {
                return Err(StatusCode::BAD_REQUEST);
            }
        }
        MessageType::Clipboard => {
            if content_bytes > MAX_CLIPBOARD_BYTES || request.image_data.is_some() {
                return Err(StatusCode::PAYLOAD_TOO_LARGE);
            }
        }
        MessageType::Todo => {
            if content_bytes > MAX_TODO_BYTES || request.image_data.is_some() {
                return Err(StatusCode::PAYLOAD_TOO_LARGE);
            }
        }
        MessageType::Whiteboard => {
            if content_bytes > MAX_WHITEBOARD_BYTES || request.image_data.is_some() {
                return Err(StatusCode::PAYLOAD_TOO_LARGE);
            }
        }
        MessageType::Recall => {
            if content_bytes == 0
                || content_bytes > MAX_RECALL_BYTES
                || request.image_data.is_some()
            {
                return Err(StatusCode::BAD_REQUEST);
            }
            let messages = state.local_messages.read();
            let target = messages
                .iter()
                .find(|message| message.id == request.content)
                .ok_or(StatusCode::FORBIDDEN)?;
            if target.player_id != identity.player_id
                || unix_seconds().saturating_sub(target.timestamp) > RECALL_WINDOW_SECS
            {
                return Err(StatusCode::FORBIDDEN);
            }
        }
        MessageType::Avatar => {
            if content_bytes > MAX_AVATAR_BYTES
                || request.image_data.is_some()
                || (!request.content.is_empty() && !request.content.starts_with("data:image/"))
            {
                return Err(StatusCode::PAYLOAD_TOO_LARGE);
            }
        }
    }
    Ok(())
}

fn unix_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn message_size(message: &ChatMessage) -> Option<usize> {
    serde_json::to_vec(message).ok().map(|bytes| bytes.len())
}

fn store_message(
    local_messages: &Arc<RwLock<VecDeque<ChatMessage>>>,
    history_bytes: &Arc<RwLock<usize>>,
    message_tx: &broadcast::Sender<ChatMessage>,
    message: ChatMessage,
) -> bool {
    let Some(size) = message_size(&message) else {
        return false;
    };
    if size > MAX_HISTORY_BYTES {
        return false;
    }
    let mut messages = local_messages.write();
    let mut bytes = history_bytes.write();
    if messages.iter().any(|stored| stored.id == message.id) {
        return false;
    }
    while messages.len() >= MAX_HISTORY_MESSAGES || *bytes + size > MAX_HISTORY_BYTES {
        if let Some(oldest) = messages.pop_front() {
            *bytes = bytes.saturating_sub(message_size(&oldest).unwrap_or(0));
        } else {
            break;
        }
    }
    *bytes += size;
    messages.push_back(message.clone());
    let _ = message_tx.send(message);
    true
}

async fn get_messages(
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(params): Query<GetMessagesQuery>,
) -> Result<Json<Vec<ChatMessage>>, StatusCode> {
    // History reads are signed too: otherwise a member could spoof another
    // member's address and harvest the history attributed to them.
    authorize_request(&headers, peer, &state, "GET", "/api/chat/messages", &[]).await?;
    let messages = state.local_messages.read();
    let result = messages
        .iter()
        .filter(|message| {
            params
                .since
                .is_none_or(|timestamp| message.timestamp > timestamp)
        })
        .cloned()
        .collect();
    Ok(Json(result))
}

async fn send_message(
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<ChatMessage>, StatusCode> {
    // The signature covers the exact body bytes, so attribution and content
    // are bound together: neither can be swapped without invalidating it.
    let identity =
        authorize_request(&headers, peer, &state, "POST", "/api/chat/send", &body).await?;
    require_json_body(&headers, &body)?;
    let request =
        serde_json::from_slice::<SendMessageRequest>(&body).map_err(|_| StatusCode::BAD_REQUEST)?;
    validate_request(&request, &identity, &state)?;
    let message = ChatMessage {
        id: request
            .id
            .unwrap_or_else(|| format!("msg-{}-{}", identity.player_id, uuid::Uuid::new_v4())),
        player_id: identity.player_id,
        player_name: identity.player_name,
        content: request.content,
        message_type: request.message_type,
        timestamp: unix_seconds(),
        image_data: request.image_data,
    };
    if !store_message(
        &state.local_messages,
        &state.history_bytes,
        &state.message_tx,
        message.clone(),
    ) {
        return Err(StatusCode::PAYLOAD_TOO_LARGE);
    }
    Ok(Json(message))
}

async fn stream_messages(
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Sse<impl Stream<Item = Result<Event, std::convert::Infallible>>>, StatusCode> {
    // This endpoint exists purely for the local WebView to receive its own
    // messages, and the renderer holds no private key, so it cannot sign.
    // Instead it is restricted to the loopback-equivalent case: the request
    // must arrive from this host's own virtual IP. Traffic addressed to our own
    // address never leaves the machine, so a remote peer - even one that has
    // hijacked the overlay route for some other member - cannot reach it.
    authenticated_session_token(&headers, &state)?;
    let identity = {
        let session = state.session.read();
        let session = session.as_ref().ok_or(StatusCode::UNAUTHORIZED)?;
        if session.local_identity.virtual_ip != peer.ip().to_string() {
            return Err(StatusCode::FORBIDDEN);
        }
        session.local_identity.clone()
    };
    if !allow_request(&state, &identity, peer.ip()).await {
        return Err(StatusCode::TOO_MANY_REQUESTS);
    }
    let receiver = state.message_tx.subscribe();
    let stream = BroadcastStream::new(receiver).filter_map(|result| match result {
        Ok(message) => serde_json::to_string(&message)
            .ok()
            .map(|json| Ok(Event::default().data(json))),
        Err(_) => None,
    });
    Ok(Sse::new(stream).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("keep-alive"),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn identity(ip: &str, id: &str) -> ChatPeerIdentity {
        ChatPeerIdentity {
            player_id: id.to_string(),
            player_name: id.to_string(),
            virtual_ip: ip.to_string(),
            chat_public_key: None,
        }
    }

    /// Identity carrying a real, freshly generated signing key.
    fn keyed_identity(ip: &str, id: &str) -> (ChatPeerIdentity, ChatSigner) {
        let signer = ChatSigner::generate().expect("generate signer");
        let mut identity = identity(ip, id);
        identity.chat_public_key = Some(signer.public_key_b64());
        (identity, signer)
    }

    #[test]
    fn key_map_indexes_members_by_their_signing_key() {
        let (local, local_signer) = keyed_identity("10.126.126.1", "local");
        let (peer, peer_signer) = keyed_identity("10.126.126.2", "peer");
        let identities =
            build_identity_map(&local, vec![peer.clone()]).expect("identity map should build");
        let by_key = build_key_map(&identities).expect("key map should build");

        assert_eq!(by_key.len(), 2);
        let local_key = key_id_for_public_key(
            &parse_public_key_b64(&local_signer.public_key_b64()).expect("local key"),
        );
        let peer_key = key_id_for_public_key(
            &parse_public_key_b64(&peer_signer.public_key_b64()).expect("peer key"),
        );
        assert_eq!(by_key[&local_key].identity.player_id, "local");
        assert_eq!(by_key[&peer_key].identity.player_id, "peer");
        // Attribution comes from the key, so the mapped virtual IP is the one
        // signaling published rather than anything the sender asserted.
        assert_eq!(by_key[&peer_key].identity.virtual_ip, "10.126.126.2");
    }

    #[test]
    fn key_map_rejects_two_members_sharing_one_signing_key() {
        // Duplicate keys would make attribution ambiguous, defeating the whole
        // mechanism, so the roster is refused rather than silently collapsed.
        let (local, signer) = keyed_identity("10.126.126.1", "local");
        let mut impostor = identity("10.126.126.2", "impostor");
        impostor.chat_public_key = Some(signer.public_key_b64());
        let identities = build_identity_map(&local, vec![impostor]).expect("identity map");
        assert!(build_key_map(&identities).is_err());
    }

    #[test]
    fn key_map_rejects_malformed_public_keys_and_skips_absent_ones() {
        let (local, _) = keyed_identity("10.126.126.1", "local");

        let mut broken = identity("10.126.126.2", "broken");
        broken.chat_public_key = Some("not-a-key".to_string());
        let identities = build_identity_map(&local, vec![broken]).expect("identity map");
        assert!(build_key_map(&identities).is_err());

        // A peer with no published key is simply not verifiable: it is absent
        // from the map instead of being trusted on address alone.
        let identities =
            build_identity_map(&local, vec![identity("10.126.126.3", "legacy")]).expect("map");
        let by_key = build_key_map(&identities).expect("key map");
        assert_eq!(by_key.len(), 1);
        assert!(by_key
            .values()
            .all(|entry| entry.identity.player_id != "legacy"));
    }

    #[test]
    fn a_session_signs_with_the_key_it_published() {
        let service = ChatService::new();
        service.set_virtual_ip("10.126.126.1".to_string());
        let published = service.ensure_signing_key().expect("key generation");
        // Repeated calls must not rotate the key, or the value handed to
        // signaling would stop matching the value used to sign.
        assert_eq!(service.ensure_signing_key().expect("stable key"), published);

        let (peer, _) = keyed_identity("10.126.126.2", "peer");
        service
            .set_session(
                "a".repeat(CHAT_TOKEN_HEX_BYTES),
                1,
                "local".to_string(),
                "local".to_string(),
                None,
                vec![peer],
            )
            .expect("session should install");

        let body = br#"{"content":"hi"}"#;
        let signed = service
            .sign_request("POST", "/api/chat/send", "10.126.126.2", body)
            .expect("request should be signable");
        let der = parse_public_key_b64(&published).expect("published key must parse");
        assert_eq!(signed.key_id, key_id_for_public_key(&der));
        let canonical = canonical_request(
            "POST",
            "/api/chat/send",
            "10.126.126.2",
            1,
            signed.timestamp.parse().expect("numeric timestamp"),
            &signed.nonce,
            body,
            &"a".repeat(CHAT_TOKEN_HEX_BYTES),
        );
        assert!(verify_signature(&der, &signed.signature, &canonical));
        // The same signature must not satisfy a different recipient.
        let other_audience = canonical_request(
            "POST",
            "/api/chat/send",
            "10.126.126.3",
            1,
            signed.timestamp.parse().expect("numeric timestamp"),
            &signed.nonce,
            body,
            &"a".repeat(CHAT_TOKEN_HEX_BYTES),
        );
        assert!(!verify_signature(&der, &signed.signature, &other_audience));

        // Clearing the session retires the key and disables signing.
        service.clear_session();
        assert!(service.signing_public_key().is_none());
        assert!(service
            .sign_request("POST", "/api/chat/send", "10.126.126.2", body)
            .is_none());
    }

    #[test]
    fn a_session_cannot_open_before_a_signing_key_exists() {
        let service = ChatService::new();
        service.set_virtual_ip("10.126.126.1".to_string());
        let error = service
            .set_session(
                "a".repeat(CHAT_TOKEN_HEX_BYTES),
                1,
                "local".to_string(),
                "local".to_string(),
                None,
                Vec::new(),
            )
            .expect_err("session must require a signing key");
        assert!(error.contains("签名密钥"));
    }

    #[test]
    fn token_validation_requires_32_bytes_hex() {
        assert!(is_valid_chat_token(&"a".repeat(CHAT_TOKEN_HEX_BYTES)));
        assert!(!is_valid_chat_token(&"a".repeat(CHAT_TOKEN_HEX_BYTES - 1)));
        assert!(!is_valid_chat_token(&format!(
            "{}g",
            "a".repeat(CHAT_TOKEN_HEX_BYTES - 1)
        )));
    }

    #[test]
    fn token_comparison_is_exact() {
        assert!(constant_time_eq(b"abc", b"abc"));
        assert!(!constant_time_eq(b"abc", b"abd"));
        assert!(!constant_time_eq(b"abc", b"abc\0"));
    }

    #[test]
    fn identity_map_rejects_duplicate_or_loopback_ips() {
        assert!(build_identity_map(
            &identity("10.126.126.1", "one"),
            vec![identity("10.126.126.1", "two")],
        )
        .is_err());
        assert!(build_identity_map(&identity("127.0.0.1", "one"), Vec::new()).is_err());
        assert!(build_identity_map(&identity("169.254.1.1", "one"), Vec::new()).is_err());
        assert!(build_identity_map(&identity("224.0.0.1", "one"), Vec::new()).is_err());
        assert!(build_identity_map(&identity("10.126.125.1", "one"), Vec::new()).is_err());
        assert!(build_identity_map(&identity("192.168.1.10", "one"), Vec::new()).is_err());
        assert!(build_identity_map(&identity("8.8.8.8", "one"), Vec::new()).is_err());
        assert!(build_identity_map(&identity("2001:db8::1", "one"), Vec::new()).is_err());
        assert!(build_identity_map(
            &identity("10.126.126.1", "one"),
            vec![identity("10.126.126.2", "one")],
        )
        .is_err());
    }

    #[test]
    fn message_ids_are_bound_to_the_authoritative_sender() {
        assert!(is_message_id_for_player("msg-player-123", "player"));
        assert!(is_message_id_for_player("recall-player-123", "player"));
        assert!(!is_message_id_for_player("msg-other-123", "player"));
        assert!(!is_message_id_for_player("msg-player-", "player"));
    }

    #[test]
    fn session_rejects_epoch_rollback_and_equivocation() {
        let service = ChatService::new();
        service.set_virtual_ip("10.126.126.1".to_string());
        service.ensure_signing_key().expect("signing key");
        service
            .set_session(
                "a".repeat(CHAT_TOKEN_HEX_BYTES),
                2,
                "local".to_string(),
                "Local".to_string(),
                Some("local".to_string()),
                vec![identity("10.126.126.2", "peer")],
            )
            .unwrap();
        assert!(service
            .set_session(
                "b".repeat(CHAT_TOKEN_HEX_BYTES),
                1,
                "local".to_string(),
                "Local".to_string(),
                Some("local".to_string()),
                vec![identity("10.126.126.2", "peer")],
            )
            .is_err());
        assert!(service
            .set_session(
                "b".repeat(CHAT_TOKEN_HEX_BYTES),
                2,
                "local".to_string(),
                "Local".to_string(),
                Some("local".to_string()),
                vec![identity("10.126.126.2", "peer")],
            )
            .is_err());
    }

    #[test]
    fn history_is_bounded_by_total_bytes() {
        let messages = Arc::new(RwLock::new(VecDeque::new()));
        let bytes = Arc::new(RwLock::new(0));
        let (tx, _) = broadcast::channel(8);
        for index in 0..20 {
            let message = ChatMessage {
                id: format!("{index}"),
                player_id: "one".to_string(),
                player_name: "one".to_string(),
                content: "x".repeat(300_000),
                message_type: MessageType::Text,
                timestamp: index,
                image_data: None,
            };
            assert!(store_message(&messages, &bytes, &tx, message));
        }
        assert!(*bytes.read() <= MAX_HISTORY_BYTES);
        assert!(messages.read().len() < 20);
    }

    #[test]
    fn duplicate_message_ids_are_not_stored_twice() {
        let messages = Arc::new(RwLock::new(VecDeque::new()));
        let bytes = Arc::new(RwLock::new(0));
        let (tx, _) = broadcast::channel(8);
        let message = ChatMessage {
            id: "msg-one-1".to_string(),
            player_id: "one".to_string(),
            player_name: "one".to_string(),
            content: "hello".to_string(),
            message_type: MessageType::Text,
            timestamp: 1,
            image_data: None,
        };
        assert!(store_message(&messages, &bytes, &tx, message.clone()));
        assert!(!store_message(&messages, &bytes, &tx, message));
        assert_eq!(messages.read().len(), 1);
    }

    #[tokio::test]
    async fn stopping_service_clears_session_history_and_bind_ip() {
        let service = ChatService::new();
        service.set_virtual_ip("10.126.126.1".to_string());
        service.ensure_signing_key().expect("signing key");
        service
            .set_session(
                "a".repeat(CHAT_TOKEN_HEX_BYTES),
                1,
                "local".to_string(),
                "Local".to_string(),
                Some("local".to_string()),
                Vec::new(),
            )
            .unwrap();
        assert!(service.add_local_message(ChatMessage {
            id: "msg-local-1".to_string(),
            player_id: "local".to_string(),
            player_name: "Local".to_string(),
            content: "hello".to_string(),
            message_type: MessageType::Text,
            timestamp: 1,
            image_data: None,
        }));

        service.stop_server().await;

        assert!(service.get_chat_token().is_none());
        assert!(service.get_virtual_ip().is_none());
        assert!(service.get_local_messages(None).is_empty());
    }

    #[test]
    fn request_identity_fields_do_not_authorize_recall() {
        let state = AppState {
            local_messages: Arc::new(RwLock::new(VecDeque::from([ChatMessage {
                id: "target".to_string(),
                player_id: "owner".to_string(),
                player_name: "Owner".to_string(),
                content: "hello".to_string(),
                message_type: MessageType::Text,
                timestamp: unix_seconds(),
                image_data: None,
            }]))),
            history_bytes: Arc::new(RwLock::new(0)),
            message_tx: broadcast::channel(8).0,
            session: Arc::new(RwLock::new(Some(ChatSession {
                token: "a".repeat(CHAT_TOKEN_HEX_BYTES),
                epoch: 1,
                identities: HashMap::new(),
                peers_by_key: HashMap::new(),
                local_identity: identity("10.126.126.1", "owner"),
                host_id: Some("owner".to_string()),
            }))),
            rate_limiter: Arc::new(Mutex::new(HashMap::new())),
            replay_guard: Arc::new(Mutex::new(ReplayGuard::new())),
        };
        let request = SendMessageRequest {
            id: None,
            player_id: "owner".to_string(),
            player_name: "Owner".to_string(),
            content: "target".to_string(),
            message_type: MessageType::Recall,
            image_data: None,
        };
        assert!(validate_request(&request, &identity("10.126.126.2", "attacker"), &state).is_err());
    }
}
