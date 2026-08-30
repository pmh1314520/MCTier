/**
 * P2P 聊天服务模块
 * 基于 HTTP over WireGuard 的点对点聊天
 * 不依赖中心服务器，直接在虚拟局域网中传输
 */

use std::collections::{HashMap, HashSet, VecDeque};
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use axum::{
    extract::{ConnectInfo, Query, State},
    http::StatusCode,
    response::sse::{Event, Sse},
    routing::{get, post},
    Json, Router,
};
use futures_util::stream::Stream;
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::StreamExt;
use super::http_cors::lan_cors_layer;

const CHAT_SERVER_PORT: u16 = 14540; // 聊天服务端口
const MAX_MESSAGES_PER_PLAYER: usize = 1000; // 每个玩家最多保存1000条消息

/// 聊天消息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub id: String,
    pub player_id: String,
    pub player_name: String,
    pub content: String,
    pub message_type: MessageType,
    pub timestamp: u64,
    pub image_data: Option<Vec<u8>>, // 图片数据（Base64编码后的字节）
}

/// 消息类型
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum MessageType {
    Text,
    Image,
    /// 大厅公告（控制消息，不计入聊天记录）
    Announce,
    /// 语音小队组别（控制消息）
    VoiceGroup,
    /// 共享剪贴板（控制消息，content 为文本）
    Clipboard,
    /// 个人待办（控制消息，content 为待办列表 JSON）
    Todo,
    /// 共享白板（控制消息，content 为单笔画/清空指令 JSON）
    Whiteboard,
    /// 撤回聊天消息（控制消息，content 为目标消息 ID）
    Recall,
    /// 头像同步（控制消息，content 为头像 data URL）
    Avatar,
}

/// 获取消息请求参数
#[derive(Debug, Deserialize)]
pub struct GetMessagesQuery {
    pub since: Option<u64>, // 获取此时间戳之后的消息
}

/// 发送消息请求
#[derive(Debug, Serialize, Deserialize)]
pub struct SendMessageRequest {
    /// 消息ID（由发送方生成并随 POST 传递，保证同一条消息在所有端 ID 一致，便于去重与历史同步）
    #[serde(default)]
    pub id: Option<String>,
    pub player_id: String,
    pub player_name: String,
    pub content: String,
    pub message_type: MessageType,
    pub image_data: Option<Vec<u8>>,
}

/// 聊天服务状态
pub struct ChatService {
    /// 本地消息队列（保存自己发送的消息）
    local_messages: Arc<RwLock<VecDeque<ChatMessage>>>,
    /// 虚拟IP地址
    virtual_ip: Arc<RwLock<Option<String>>>,
    /// 服务器句柄
    server_handle: Arc<RwLock<Option<tokio::task::JoinHandle<()>>>>,
    /// 消息广播通道（用于SSE推送）
    message_tx: broadcast::Sender<ChatMessage>,
    /// 大厅身份名册：player_id -> 虚拟 IP。
    ///
    /// 由前端在玩家列表变化时下发（数据源是信令服务器的大厅成员列表），
    /// 用于校验 `/api/chat/send` 里自称的 `player_id` 是否与其真实来源 IP 相符。
    peer_roster: Arc<RwLock<HashMap<String, String>>>,
    /// 允许读取本机聊天记录的成员 IP 集合。
    ///
    /// 读取类接口（历史与 SSE 流）不携带 player_id，只能按来源 IP 判断，
    /// 因此单独维护一份 IP 集合。前端仅在"所有成员虚拟IP均已就绪"时才下发，
    /// 避免 IP 尚未同步的合法成员被误拒。
    allowed_readers: Arc<RwLock<HashSet<String>>>,
}

impl ChatService {
    pub fn new() -> Self {
        // 【优化】创建广播通道，容量增加到500条消息，支持大图片传输
        let (tx, _rx) = broadcast::channel(500);
        
        Self {
            local_messages: Arc::new(RwLock::new(VecDeque::new())),
            virtual_ip: Arc::new(RwLock::new(None)),
            server_handle: Arc::new(RwLock::new(None)),
            message_tx: tx,
            peer_roster: Arc::new(RwLock::new(HashMap::new())),
            allowed_readers: Arc::new(RwLock::new(HashSet::new())),
        }
    }

    /// 设置虚拟IP地址
    pub fn set_virtual_ip(&self, ip: String) {
        log::info!("📡 [ChatService] 设置虚拟IP: {}", ip);
        *self.virtual_ip.write() = Some(ip);
    }

    /// 获取虚拟IP地址
    pub fn get_virtual_ip(&self) -> Option<String> {
        self.virtual_ip.read().clone()
    }

    /// 更新大厅身份名册（player_id -> 虚拟 IP）。
    ///
    /// 只保留同时具备 ID 与 IP 的条目：缺 IP 的玩家无法参与身份校验，
    /// 塞进名册反而会把合法消息判成冒名。
    pub fn set_peer_roster(&self, entries: Vec<(String, String)>) {
        let roster: HashMap<String, String> = entries
            .into_iter()
            .filter(|(id, ip)| !id.trim().is_empty() && !ip.trim().is_empty())
            .collect();
        log::info!("🪪 [ChatService] 更新身份名册，共 {} 名玩家", roster.len());
        *self.peer_roster.write() = roster;
    }

    /// 更新允许读取聊天记录的成员 IP 集合（必须含本机：本机要自订阅 SSE 流）
    pub fn set_allowed_readers(&self, ips: Vec<String>) {
        let readers: HashSet<String> = ips
            .into_iter()
            .filter(|ip| !ip.trim().is_empty())
            .collect();
        log::info!("🪪 [ChatService] 更新可读取成员，共 {} 个地址", readers.len());
        *self.allowed_readers.write() = readers;
    }

    /// 清空身份名册与可读取成员（退出大厅时调用，避免影响下一个大厅）
    pub fn clear_peer_roster(&self) {
        self.peer_roster.write().clear();
        self.allowed_readers.write().clear();
    }

    /// 启动HTTP聊天服务器
    pub async fn start_server(&self) -> Result<(), Box<dyn std::error::Error>> {
        // 【修复】启动前先停止可能存在的旧实例，避免端口占用与任务句柄泄漏（重进大厅场景）
        self.stop_server().await;

        let virtual_ip = match self.get_virtual_ip() {
            Some(ip) => ip,
            None => {
                log::error!("❌ [ChatService] 虚拟IP未设置，无法启动聊天服务器");
                return Err("虚拟IP未设置".into());
            }
        };

        log::info!("🔍 [ChatService] 检查虚拟IP是否就绪: {}", virtual_ip);
        
        // 等待虚拟IP就绪
        let mut attempts = 0;
        let max_attempts = 20;
        loop {
            match tokio::net::TcpListener::bind(format!("{}:0", virtual_ip)).await {
                Ok(test_listener) => {
                    drop(test_listener);
                    log::info!("✅ [ChatService] 虚拟IP已就绪");
                    break;
                }
                Err(e) => {
                    attempts += 1;
                    if attempts >= max_attempts {
                        log::error!("❌ [ChatService] 虚拟IP未就绪，超时: {}", e);
                        return Err(format!("虚拟IP未就绪: {}", e).into());
                    }
                    log::warn!("⏳ [ChatService] 虚拟IP尚未就绪，等待中... ({}/{})", attempts, max_attempts);
                    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
                }
            }
        }

        let addr = format!("{}:{}", virtual_ip, CHAT_SERVER_PORT);
        log::info!("📍 [ChatService] 聊天服务器将监听虚拟IP: {}", addr);

        let local_messages = self.local_messages.clone();
        let message_tx = self.message_tx.clone();

        // 创建路由
        let app = Router::new()
            .route("/api/chat/messages", get(get_messages))
            .route("/api/chat/send", post(send_message))
            .route("/api/chat/stream", get(stream_messages)) // 新增SSE端点
            .layer(lan_cors_layer())
            .with_state(AppState {
                local_messages: local_messages.clone(),
                message_tx: message_tx.clone(),
                peer_roster: self.peer_roster.clone(),
                allowed_readers: self.allowed_readers.clone(),
            });

        log::info!("🚀 [ChatService] 正在启动聊天服务器...");

        // 绑定端口
        let listener = match tokio::net::TcpListener::bind(&addr).await {
            Ok(l) => {
                log::info!("✅ [ChatService] 成功绑定端口 {}", CHAT_SERVER_PORT);
                l
            }
            Err(e) => {
                log::error!("❌ [ChatService] 绑定端口失败: {} - 错误: {}", CHAT_SERVER_PORT, e);
                return Err(format!("绑定端口失败: {}", e).into());
            }
        };

        // 启动服务器
        let server_task = tokio::spawn(async move {
            log::info!("🌐 [ChatService] 聊天服务器开始监听请求...");
            // 需要 ConnectInfo 才能拿到对端真实地址，用于校验消息发送者身份
            let service = app.into_make_service_with_connect_info::<SocketAddr>();
            if let Err(e) = axum::serve(listener, service).await {
                log::error!("❌ [ChatService] 服务器运行错误: {}", e);
            } else {
                log::info!("🛑 [ChatService] 聊天服务器已正常停止");
            }
        });

        *self.server_handle.write() = Some(server_task);

        log::info!("✅ [ChatService] 聊天服务器启动成功！");
        log::info!("📡 [ChatService] 监听地址: {}:{}（仅虚拟网卡）", virtual_ip, CHAT_SERVER_PORT);
        log::info!("📡 [ChatService] 虚拟IP: {}", virtual_ip);
        
        tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
        log::info!("🎉 [ChatService] 聊天服务器已完全就绪");

        Ok(())
    }

    /// 停止聊天服务器
    pub async fn stop_server(&self) {
        if let Some(handle) = self.server_handle.write().take() {
            handle.abort();
            log::info!("🛑 [ChatService] 聊天服务器已停止");
        }
    }

    /// 检查服务器是否正在运行
    pub fn is_running(&self) -> bool {
        self.server_handle.read().is_some()
    }

    /// 添加本地消息
    pub fn add_local_message(&self, message: ChatMessage) {
        let mut messages = self.local_messages.write();
        messages.push_back(message.clone());
        
        // 限制消息数量
        while messages.len() > MAX_MESSAGES_PER_PLAYER {
            messages.pop_front();
        }
        
        // 广播消息到所有SSE订阅者
        let _ = self.message_tx.send(message);
    }

    /// 获取本地消息
    pub fn get_local_messages(&self, since: Option<u64>) -> Vec<ChatMessage> {
        let messages = self.local_messages.read();
        
        if let Some(timestamp) = since {
            messages
                .iter()
                .filter(|msg| msg.timestamp > timestamp)
                .cloned()
                .collect()
        } else {
            messages.iter().cloned().collect()
        }
    }

    /// 清空本地消息
    pub fn clear_local_messages(&self) {
        self.local_messages.write().clear();
        log::info!("🗑️ [ChatService] 已清空本地消息");
    }
}

/// Axum 应用状态
#[derive(Clone)]
struct AppState {
    local_messages: Arc<RwLock<VecDeque<ChatMessage>>>,
    message_tx: broadcast::Sender<ChatMessage>,
    peer_roster: Arc<RwLock<HashMap<String, String>>>,
    allowed_readers: Arc<RwLock<HashSet<String>>>,
}

/// 判断调用方是否有权读取本机聊天记录。
///
/// 集合为空时放行（尚未下发、或对端为旧版本客户端）；非空则要求来源 IP 在册，
/// 从而阻止被移出大厅但仍留在 EasyTier 虚拟网内的节点继续拉取聊天历史。
fn is_allowed_reader(allowed: &HashSet<String>, peer_ip: std::net::IpAddr) -> bool {
    if allowed.is_empty() {
        return true;
    }
    allowed.iter().any(|entry| {
        entry
            .parse::<std::net::IpAddr>()
            .map(|ip| ip == peer_ip)
            .unwrap_or(false)
    })
}

/// 获取消息列表
async fn get_messages(
    State(state): State<AppState>,
    ConnectInfo(peer_addr): ConnectInfo<SocketAddr>,
    Query(params): Query<GetMessagesQuery>,
) -> Result<Json<Vec<ChatMessage>>, StatusCode> {
    // 非大厅成员不得拉取聊天历史
    {
        let allowed = state.allowed_readers.read();
        if !is_allowed_reader(&allowed, peer_addr.ip()) {
            log::warn!(
                "🚫 [ChatService] 拒绝非大厅成员拉取聊天历史：来源 {}",
                peer_addr.ip()
            );
            return Err(StatusCode::FORBIDDEN);
        }
    }

    let messages = state.local_messages.read();
    
    let result: Vec<ChatMessage> = if let Some(since) = params.since {
        messages
            .iter()
            .filter(|msg| msg.timestamp > since)
            .cloned()
            .collect()
    } else {
        messages.iter().cloned().collect()
    };
    
    log::info!("📋 [ChatService] 收到获取消息请求，返回 {} 条消息", result.len());

    Ok(Json(result))
}

/// 简单的按玩家滑动窗口限流：防止同大厅恶意成员刷屏。
/// 规则：每个 player_id 在最近 3 秒内最多 12 条消息，超出则拒绝（429）。
fn rate_limit_allow(player_id: &str) -> bool {
    use std::collections::VecDeque;
    use std::sync::{Mutex, OnceLock};
    static LIMITER: OnceLock<Mutex<std::collections::HashMap<String, VecDeque<u128>>>> = OnceLock::new();
    let m = LIMITER.get_or_init(|| Mutex::new(std::collections::HashMap::new()));
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    let window_ms: u128 = 3000;
    let max_in_window = 12usize;
    let mut map = match m.lock() {
        Ok(g) => g,
        Err(_) => return true, // 锁异常时放行，不影响正常聊天
    };
    let dq = map.entry(player_id.to_string()).or_default();
    while let Some(&front) = dq.front() {
        if now.saturating_sub(front) > window_ms {
            dq.pop_front();
        } else {
            break;
        }
    }
    if dq.len() >= max_in_window {
        return false;
    }
    dq.push_back(now);
    // 防止 map 无限增长：超过 256 个发送者时清理空队列
    if map.len() > 256 {
        map.retain(|_, v| !v.is_empty());
    }
    true
}

/// 校验消息里自称的 `player_id` 是否确实来自该玩家的虚拟 IP。
///
/// 攻击场景：同一大厅内任何成员都能直连他人的 14540 端口，此前 `/api/chat/send`
/// 完全信任请求体里的 `player_id` / `player_name`，因此任意成员都可以伪造成
/// 房主或其他玩家发言（含 `announce`、`recall`、`avatar` 等控制消息，危害不止于
/// 聊天内容）。这里把自称身份与 TCP 连接的真实来源地址做绑定。
///
/// 判定规则（在"可用性优先"与"防冒名"之间取平衡）：
/// - 名册为空（尚未下发或旧版本前端）时放行，避免升级过程中聊天直接不可用；
/// - 名册中不存在该 `player_id` 时放行，交由上层去重/展示逻辑处理（新玩家刚加入、
///   名册还没同步到本机是正常现象）；
/// - 名册中存在该 `player_id` 但登记 IP 与来源 IP 不一致时拒绝，这就是冒名。
///
/// 消息不经任何中继，均由发送方直连接收方（见 `send_p2p_chat_message`），
/// 所以来源 IP 就是发送方的真实虚拟 IP，可以直接作为身份凭据。
fn sender_identity_matches(
    roster: &std::collections::HashMap<String, String>,
    player_id: &str,
    peer_ip: std::net::IpAddr,
) -> bool {
    if roster.is_empty() {
        return true;
    }
    match roster.get(player_id) {
        Some(expected_ip) => expected_ip
            .parse::<std::net::IpAddr>()
            .map(|ip| ip == peer_ip)
            .unwrap_or(true),
        None => true,
    }
}

/// 发送消息（接收其他玩家发送的消息）
async fn send_message(
    State(state): State<AppState>,
    ConnectInfo(peer_addr): ConnectInfo<SocketAddr>,
    Json(req): Json<SendMessageRequest>,
) -> Result<Json<ChatMessage>, StatusCode> {
    // 身份绑定：拒绝冒用他人 player_id 的消息（含控制类消息）
    if !req.player_id.is_empty() {
        let roster = state.peer_roster.read();
        if !sender_identity_matches(&roster, &req.player_id, peer_addr.ip()) {
            log::warn!(
                "🚫 [ChatService] 拒绝冒名消息：自称 {} 但来源为 {}",
                req.player_id,
                peer_addr.ip()
            );
            return Err(StatusCode::FORBIDDEN);
        }
    }

    // 限流：防止恶意成员刷屏（控制类消息如 voicegroup 不计入更严格限制，这里统一按 player 限流）
    if !req.player_id.is_empty() && !rate_limit_allow(&req.player_id) {
        log::warn!("⚠️ [ChatService] 玩家 {} 发送过于频繁，已限流", req.player_id);
        return Err(StatusCode::TOO_MANY_REQUESTS);
    }
    log::info!("💬 [ChatService] 收到消息: {} - {}", req.player_name, req.content);
    
    let message = ChatMessage {
        id: req.id.clone().unwrap_or_else(|| format!("msg-{}-{}", req.player_id, SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis())),
        player_id: req.player_id,
        player_name: req.player_name,
        content: req.content,
        message_type: req.message_type,
        timestamp: SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs(),
        image_data: req.image_data,
    };
    
    // 保存到本地消息队列
    let mut messages = state.local_messages.write();
    messages.push_back(message.clone());
    
    // 限制消息数量
    while messages.len() > MAX_MESSAGES_PER_PLAYER {
        messages.pop_front();
    }
    
    // 广播消息到所有SSE订阅者
    let _ = state.message_tx.send(message.clone());
    
    Ok(Json(message))
}

/// SSE流式推送消息
async fn stream_messages(
    State(state): State<AppState>,
    ConnectInfo(peer_addr): ConnectInfo<SocketAddr>,
) -> Result<Sse<impl Stream<Item = Result<Event, std::convert::Infallible>>>, StatusCode> {
    // 非大厅成员不得订阅本机消息流
    {
        let allowed = state.allowed_readers.read();
        if !is_allowed_reader(&allowed, peer_addr.ip()) {
            log::warn!(
                "🚫 [ChatService] 拒绝非大厅成员订阅消息流：来源 {}",
                peer_addr.ip()
            );
            return Err(StatusCode::FORBIDDEN);
        }
    }

    log::info!("📡 [ChatService] 新的SSE连接建立");
    
    let rx = state.message_tx.subscribe();
    let stream = BroadcastStream::new(rx);
    
    let stream = stream.filter_map(|result| {
        match result {
            Ok(message) => {
                // 将消息序列化为JSON
                match serde_json::to_string(&message) {
                    Ok(json) => Some(Ok(Event::default().data(json))),
                    Err(e) => {
                        log::error!("❌ [ChatService] 序列化消息失败: {}", e);
                        None
                    }
                }
            }
            Err(e) => {
                log::warn!("⚠️ [ChatService] 广播接收错误: {}", e);
                None
            }
        }
    });
    
    Ok(Sse::new(stream).keep_alive(
        axum::response::sse::KeepAlive::new()
            .interval(std::time::Duration::from_secs(15))
            .text("keep-alive"),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::IpAddr;

    fn roster(entries: &[(&str, &str)]) -> HashMap<String, String> {
        entries
            .iter()
            .map(|(id, ip)| (id.to_string(), ip.to_string()))
            .collect()
    }

    fn ip(value: &str) -> IpAddr {
        value.parse().expect("测试用 IP 应可解析")
    }

    #[test]
    fn rejects_a_member_impersonating_another_player() {
        // 大厅成员 10.126.126.9 自称是房主 host-1（真实 IP 为 .1）
        let table = roster(&[("host-1", "10.126.126.1"), ("evil-9", "10.126.126.9")]);
        assert!(
            !sender_identity_matches(&table, "host-1", ip("10.126.126.9")),
            "冒用他人 player_id 必须被拒绝，否则任意成员都能伪造房主公告"
        );
    }

    #[test]
    fn accepts_a_player_sending_from_its_own_ip() {
        let table = roster(&[("host-1", "10.126.126.1"), ("peer-2", "10.126.126.2")]);
        assert!(sender_identity_matches(&table, "peer-2", ip("10.126.126.2")));
        assert!(sender_identity_matches(&table, "host-1", ip("10.126.126.1")));
    }

    #[test]
    fn accepts_everything_when_the_roster_is_not_ready() {
        // 名册尚未下发（刚进大厅）或对端为旧版本前端时，不能让聊天直接不可用
        let table = roster(&[]);
        assert!(sender_identity_matches(&table, "host-1", ip("10.126.126.9")));
    }

    #[test]
    fn accepts_players_that_are_not_in_the_local_roster_yet() {
        // 新玩家刚加入、名册还没同步到本机是正常现象，不应误判为冒名
        let table = roster(&[("host-1", "10.126.126.1")]);
        assert!(sender_identity_matches(&table, "newcomer-7", ip("10.126.126.7")));
    }

    #[test]
    fn accepts_when_the_registered_ip_is_unparsable() {
        // 名册里的 IP 异常时放行，避免脏数据把合法消息全部拦掉
        let table = roster(&[("host-1", "not-an-ip")]);
        assert!(sender_identity_matches(&table, "host-1", ip("10.126.126.1")));
    }

    #[test]
    fn set_peer_roster_drops_entries_without_an_ip() {
        let service = ChatService::new();
        service.set_peer_roster(vec![
            ("host-1".to_string(), "10.126.126.1".to_string()),
            ("no-ip".to_string(), String::new()),
            (String::new(), "10.126.126.5".to_string()),
            ("blank-ip".to_string(), "   ".to_string()),
        ]);
        let table = service.peer_roster.read().clone();
        assert_eq!(table.len(), 1, "缺 ID 或缺 IP 的条目不得进入名册：{:?}", table);
        assert_eq!(table.get("host-1").map(String::as_str), Some("10.126.126.1"));
    }

    #[test]
    fn clear_peer_roster_resets_identity_checks() {
        let service = ChatService::new();
        service.set_peer_roster(vec![("host-1".to_string(), "10.126.126.1".to_string())]);
        service.set_allowed_readers(vec!["10.126.126.1".to_string()]);
        service.clear_peer_roster();
        assert!(
            service.peer_roster.read().is_empty(),
            "退出大厅后必须清空名册，否则旧名册会影响下一个大厅"
        );
        assert!(
            service.allowed_readers.read().is_empty(),
            "退出大厅后必须一并清空可读取成员"
        );
    }

    #[test]
    fn rejects_history_reads_from_a_peer_that_left_the_lobby() {
        // 被移出大厅的成员仍在虚拟网内，但不应还能拉取聊天历史或订阅消息流
        let allowed: HashSet<String> =
            ["10.126.126.1", "10.126.126.2"].iter().map(|s| s.to_string()).collect();
        assert!(!is_allowed_reader(&allowed, ip("10.126.126.9")));
    }

    #[test]
    fn allows_history_reads_from_members_including_self() {
        // 本机要自订阅 SSE 流，因此本机地址必须在册
        let allowed: HashSet<String> =
            ["10.126.126.1", "10.126.126.2"].iter().map(|s| s.to_string()).collect();
        assert!(is_allowed_reader(&allowed, ip("10.126.126.1")));
        assert!(is_allowed_reader(&allowed, ip("10.126.126.2")));
    }

    #[test]
    fn allows_history_reads_before_the_reader_list_is_pushed() {
        // 名单未就绪（刚进大厅、成员IP 尚未补齐）时放行，避免聊天历史直接读不到
        assert!(is_allowed_reader(&HashSet::new(), ip("10.126.126.9")));
    }

    #[test]
    fn set_allowed_readers_drops_blank_entries() {
        let service = ChatService::new();
        service.set_allowed_readers(vec![
            "10.126.126.1".to_string(),
            String::new(),
            "   ".to_string(),
        ]);
        let readers = service.allowed_readers.read().clone();
        assert_eq!(readers.len(), 1, "空白地址不得进入名单：{:?}", readers);
    }
}