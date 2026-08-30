/**
 * P2P chat service.
 *
 * The HTTP service is deliberately scoped to the current EasyTier interface.
 * A signaling-issued, per-lobby token authenticates every request; the TCP
 * peer address is then mapped to the authoritative player identity received
 * from signaling. Request fields such as player_id/player_name are never used
 * for authorization or attribution.
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
}

#[derive(Debug, Clone)]
struct ChatSession {
    token: String,
    epoch: u64,
    identities: HashMap<IpAddr, ChatPeerIdentity>,
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
        }
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
        let local = ChatPeerIdentity {
            player_id,
            player_name,
            virtual_ip,
        };
        let map = build_identity_map(&local, peers)?;
        validate_host_id(host_id.as_deref(), &map)?;

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
        current.host_id = host_id;
        current.identities = map;
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

    pub fn clear_session(&self) {
        *self.session.write() = None;
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

fn authenticated_identity(
    headers: &HeaderMap,
    peer: SocketAddr,
    state: &AppState,
) -> Result<ChatPeerIdentity, StatusCode> {
    let supplied = headers
        .get(CHAT_TOKEN_HEADER)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    let session = state.session.read();
    let session = session.as_ref().ok_or(StatusCode::UNAUTHORIZED)?;
    if !constant_time_eq(supplied.as_bytes(), session.token.as_bytes()) {
        return Err(StatusCode::UNAUTHORIZED);
    }
    session
        .identities
        .get(&peer.ip())
        .cloned()
        .ok_or(StatusCode::FORBIDDEN)
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
    let identity = authenticated_identity(&headers, peer, &state)?;
    if !allow_request(&state, &identity, peer.ip()).await {
        return Err(StatusCode::TOO_MANY_REQUESTS);
    }
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
    let identity = authenticated_identity(&headers, peer, &state)?;
    if !allow_request(&state, &identity, peer.ip()).await {
        return Err(StatusCode::TOO_MANY_REQUESTS);
    }
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
    let identity = authenticated_identity(&headers, peer, &state)?;
    if state
        .session
        .read()
        .as_ref()
        .is_none_or(|session| session.local_identity.player_id != identity.player_id)
    {
        return Err(StatusCode::FORBIDDEN);
    }
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
        }
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
                local_identity: identity("10.126.126.1", "owner"),
                host_id: Some("owner".to_string()),
            }))),
            rate_limiter: Arc::new(Mutex::new(HashMap::new())),
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
