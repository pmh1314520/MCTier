use std::net::{UdpSocket, SocketAddr};
use std::sync::Arc;
use tokio::sync::RwLock;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::Emitter;
use crate::modules::error::AppError;

/// P2P 信令消息
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum P2PMessage {
    /// 玩家发现广播
    PlayerDiscovery {
        #[serde(rename = "playerId")]
        player_id: String,
        #[serde(rename = "playerName")]
        player_name: String,
        port: u16,
    },
    /// 玩家发现响应
    PlayerDiscoveryResponse {
        #[serde(rename = "playerId")]
        player_id: String,
        #[serde(rename = "playerName")]
        player_name: String,
        port: u16,
    },
    /// WebRTC Offer
    Offer {
        from: String,
        sdp: String,
    },
    /// WebRTC Answer
    Answer {
        from: String,
        sdp: String,
    },
    /// ICE Candidate
    IceCandidate {
        from: String,
        candidate: String,
    },
    /// 状态更新
    StatusUpdate {
        #[serde(rename = "playerId")]
        player_id: String,
        #[serde(rename = "micEnabled")]
        mic_enabled: bool,
    },
    /// 心跳
    Heartbeat {
        #[serde(rename = "playerId")]
        player_id: String,
        timestamp: i64,
    },
    /// 玩家离开
    PlayerLeft {
        #[serde(rename = "playerId")]
        player_id: String,
    },
}

/// 对等节点信息
#[derive(Debug, Clone)]
pub struct PeerInfo {
    pub player_id: String,
    pub player_name: String,
    pub addr: SocketAddr,
    pub last_seen: std::time::Instant,
}

/// P2P 信令服务
/// 
/// 使用UDP在局域网中进行P2P通信，不需要中心化服务器
pub struct P2PSignalingService {
    /// UDP套接字
    socket: Arc<RwLock<Option<UdpSocket>>>,
    
    /// 已发现的对等节点
    peers: Arc<RwLock<HashMap<String, PeerInfo>>>,
    
    /// 本地玩家信息
    local_player_id: Arc<RwLock<Option<String>>>,
    local_player_name: Arc<RwLock<Option<String>>>,
    
    /// 虚拟IP地址
    virtual_ip: Arc<RwLock<Option<String>>>,
    
    /// 监听端口（初始端口，实际可能不同）
    listen_port: u16,
    
    /// 实际使用的端口
    actual_port: Arc<RwLock<u16>>,
    
    /// Tauri 应用句柄
    app_handle: Arc<RwLock<Option<tauri::AppHandle>>>,
}

impl P2PSignalingService {
    /// 创建新的P2P信令服务
    pub fn new(listen_port: u16) -> Self {
        log::info!("创建P2P信令服务，初始监听端口: {}", listen_port);
        
        Self {
            socket: Arc::new(RwLock::new(None)),
            peers: Arc::new(RwLock::new(HashMap::new())),
            local_player_id: Arc::new(RwLock::new(None)),
            local_player_name: Arc::new(RwLock::new(None)),
            virtual_ip: Arc::new(RwLock::new(None)),
            listen_port,
            actual_port: Arc::new(RwLock::new(listen_port)),
            app_handle: Arc::new(RwLock::new(None)),
        }
    }
    
    /// 设置 Tauri 应用句柄
    pub async fn set_app_handle(&self, app_handle: tauri::AppHandle) {
        let mut handle = self.app_handle.write().await;
        *handle = Some(app_handle);
        log::info!("P2P信令服务已设置应用句柄");
    }
    
    /// 启动P2P信令服务
    pub async fn start(&self, player_id: String, player_name: String, virtual_ip: String) -> Result<(), AppError> {
        log::info!("启动P2P信令服务: player={}, virtual_ip={}", player_name, virtual_ip);
        
        // 保存本地玩家信息
        *self.local_player_id.write().await = Some(player_id.clone());
        *self.local_player_name.write().await = Some(player_name.clone());
        *self.virtual_ip.write().await = Some(virtual_ip.clone());
        
        // 在 no-tun 模式下，虚拟IP不存在于系统网卡中
        // 我们需要使用真实的本地IP进行UDP通信
        // 绑定到 0.0.0.0 监听所有接口
        let mut actual_port = self.listen_port;
        let socket = loop {
            let bind_addr = format!("0.0.0.0:{}", actual_port);
            log::info!("尝试绑定UDP套接字到: {}", bind_addr);
            
            match UdpSocket::bind(&bind_addr) {
                Ok(sock) => {
                    log::info!("✅ UDP套接字成功绑定到: {}", bind_addr);
                    break sock;
                }
                Err(e) => {
                    if actual_port < self.listen_port + 100 {
                        // 端口被占用，尝试下一个端口
                        log::warn!("端口 {} 被占用，尝试下一个端口: {}", actual_port, e);
                        actual_port += 1;
                    } else {
                        // 尝试了100个端口都失败，返回错误
                        return Err(AppError::NetworkError(format!(
                            "无法绑定UDP套接字（尝试了端口 {} 到 {}）: {}",
                            self.listen_port,
                            actual_port,
                            e
                        )));
                    }
                }
            }
        };
        
        // 设置为非阻塞模式
        socket.set_nonblocking(true)
            .map_err(|e| AppError::NetworkError(format!("设置非阻塞模式失败: {}", e)))?;
        
        // 启用广播
        socket.set_broadcast(true)
            .map_err(|e| AppError::NetworkError(format!("启用广播失败: {}", e)))?;
        
        log::info!("UDP套接字配置完成，实际端口: {}", actual_port);
        
        // 保存实际使用的端口
        *self.actual_port.write().await = actual_port;
        
        *self.socket.write().await = Some(socket);
        
        // 启动接收线程
        self.start_receiver().await?;
        
        // 启动持续的玩家发现广播任务（前10秒每秒发送一次，之后每5秒发送一次）
        self.start_discovery_broadcast().await;
        
        // 启动心跳任务
        self.start_heartbeat().await;
        
        Ok(())
    }
    
    /// 启动接收线程
    async fn start_receiver(&self) -> Result<(), AppError> {
        let socket = self.socket.read().await;
        let socket_clone = socket.as_ref()
            .ok_or_else(|| AppError::NetworkError("套接字未初始化".to_string()))?
            .try_clone()
            .map_err(|e| AppError::NetworkError(format!("克隆套接字失败: {}", e)))?;
        
        // 再克隆一个用于发送响应
        let socket_for_response = socket.as_ref()
            .ok_or_else(|| AppError::NetworkError("套接字未初始化".to_string()))?
            .try_clone()
            .map_err(|e| AppError::NetworkError(format!("克隆套接字失败: {}", e)))?;
        drop(socket);
        
        let peers = Arc::clone(&self.peers);
        let app_handle = Arc::clone(&self.app_handle);
        let local_player_id = Arc::clone(&self.local_player_id);
        let local_player_name = Arc::clone(&self.local_player_name);
        let actual_port = Arc::clone(&self.actual_port);
        
        tokio::spawn(async move {
            let mut buf = [0u8; 65536];
            
            loop {
                match socket_clone.recv_from(&mut buf) {
                    Ok((len, src_addr)) => {
                        if let Ok(msg_str) = std::str::from_utf8(&buf[..len]) {
                            if let Ok(message) = serde_json::from_str::<P2PMessage>(msg_str) {
                                // 如果是PlayerDiscovery消息，立即发送响应
                                if let P2PMessage::PlayerDiscovery { ref player_id, ref player_name, port } = message {
                                    // 检查是否是自己的广播
                                    let is_self = {
                                        let local_id = local_player_id.read().await;
                                        local_id.as_ref() == Some(player_id)
                                    };
                                    
                                    if !is_self {
                                        // 立即发送响应
                                        if let (Some(my_id), Some(my_name)) = (
                                            local_player_id.read().await.as_ref(),
                                            local_player_name.read().await.as_ref(),
                                        ) {
                                            let response = P2PMessage::PlayerDiscoveryResponse {
                                                player_id: my_id.clone(),
                                                player_name: my_name.clone(),
                                                port: *actual_port.read().await,
                                            };
                                            
                                            if let Ok(response_json) = serde_json::to_string(&response) {
                                                let mut response_addr = src_addr;
                                                response_addr.set_port(port);
                                                
                                                if let Err(e) = socket_for_response.send_to(response_json.as_bytes(), response_addr) {
                                                    log::warn!("发送发现响应失败: {}", e);
                                                } else {
                                                    log::info!("✅ 已发送发现响应给 {} ({})", player_name, player_id);
                                                }
                                            }
                                        }
                                    }
                                }
                                
                                Self::handle_message_static(
                                    message,
                                    src_addr,
                                    &peers,
                                    &app_handle,
                                    &local_player_id,
                                ).await;
                            }
                        }
                    }
                    Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        // 非阻塞模式下没有数据，等待一下
                        tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;
                    }
                    Err(e) => {
                        log::error!("接收UDP消息失败: {}", e);
                        tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
                    }
                }
            }
        });
        
        log::info!("UDP接收线程已启动");
        Ok(())
    }
    
    /// 处理接收到的消息（静态方法）
    async fn handle_message_static(
        message: P2PMessage,
        src_addr: SocketAddr,
        peers: &Arc<RwLock<HashMap<String, PeerInfo>>>,
        app_handle: &Arc<RwLock<Option<tauri::AppHandle>>>,
        local_player_id: &Arc<RwLock<Option<String>>>,
    ) {
        match message {
            P2PMessage::PlayerDiscovery { player_id, player_name, port } => {
                log::info!("📡 收到玩家发现广播: {} ({})", player_name, player_id);
                
                // 忽略自己的广播
                let local_id = local_player_id.read().await;
                if local_id.as_ref() == Some(&player_id) {
                    log::debug!("忽略自己的广播");
                    return;
                }
                drop(local_id);
                
                // 检查是否已经存在
                let already_exists = {
                    let peers_read = peers.read().await;
                    peers_read.contains_key(&player_id)
                };
                
                // 添加到对等节点列表（必须在发送事件之前完成）
                let mut addr = src_addr;
                addr.set_port(port);
                
                let peer_info = PeerInfo {
                    player_id: player_id.clone(),
                    player_name: player_name.clone(),
                    addr,
                    last_seen: std::time::Instant::now(),
                };
                
                {
                    let mut peers_write = peers.write().await;
                    peers_write.insert(player_id.clone(), peer_info);
                }
                
                // 只有新玩家才发送 player-joined 事件
                if !already_exists {
                    log::info!("✅ 新玩家加入: {} ({})", player_name, player_id);
                    log::info!("   玩家地址: {}", addr);
                    
                    // 等待200ms确保peers列表已完全更新
                    tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
                    
                    // 发送事件到前端
                    if let Some(app) = app_handle.read().await.as_ref() {
                        let _ = app.emit("player-joined", serde_json::json!({
                            "playerId": player_id,
                            "playerName": player_name,
                        }));
                        log::info!("   已发送 player-joined 事件到前端");
                    }
                } else {
                    log::debug!("更新已存在玩家的心跳: {}", player_id);
                }
            }
            P2PMessage::PlayerDiscoveryResponse { player_id, player_name, port } => {
                log::info!("📡 收到玩家发现响应: {} ({})", player_name, player_id);
                
                // 忽略自己的响应
                let local_id = local_player_id.read().await;
                if local_id.as_ref() == Some(&player_id) {
                    log::debug!("忽略自己的响应");
                    return;
                }
                drop(local_id);
                
                // 检查是否已经存在
                let already_exists = {
                    let peers_read = peers.read().await;
                    peers_read.contains_key(&player_id)
                };
                
                // 添加到对等节点列表（必须在发送事件之前完成）
                let mut addr = src_addr;
                addr.set_port(port);
                
                let peer_info = PeerInfo {
                    player_id: player_id.clone(),
                    player_name: player_name.clone(),
                    addr,
                    last_seen: std::time::Instant::now(),
                };
                
                {
                    let mut peers_write = peers.write().await;
                    peers_write.insert(player_id.clone(), peer_info);
                }
                
                // 只有新玩家才发送 player-joined 事件
                if !already_exists {
                    log::info!("✅ 新玩家加入（通过响应）: {} ({})", player_name, player_id);
                    log::info!("   玩家地址: {}", addr);
                    
                    // 等待200ms确保peers列表已更新
                    tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
                    
                    // 发送事件到前端
                    if let Some(app) = app_handle.read().await.as_ref() {
                        let _ = app.emit("player-joined", serde_json::json!({
                            "playerId": player_id,
                            "playerName": player_name,
                        }));
                        log::info!("   已发送 player-joined 事件到前端");
                    }
                } else {
                    log::debug!("更新已存在玩家的心跳（通过响应）: {}", player_id);
                }
            }
            P2PMessage::Offer { from, sdp } => {
                log::info!("收到Offer from {}", from);
                if let Some(app) = app_handle.read().await.as_ref() {
                    let _ = app.emit("webrtc-signaling", serde_json::json!({
                        "type": "offer",
                        "from": from,
                        "sdp": sdp,
                    }));
                }
            }
            P2PMessage::Answer { from, sdp } => {
                log::info!("收到Answer from {}", from);
                if let Some(app) = app_handle.read().await.as_ref() {
                    let _ = app.emit("webrtc-signaling", serde_json::json!({
                        "type": "answer",
                        "from": from,
                        "sdp": sdp,
                    }));
                }
            }
            P2PMessage::IceCandidate { from, candidate } => {
                log::debug!("收到ICE Candidate from {}", from);
                if let Some(app) = app_handle.read().await.as_ref() {
                    let _ = app.emit("webrtc-signaling", serde_json::json!({
                        "type": "ice-candidate",
                        "from": from,
                        "candidate": candidate,
                    }));
                }
            }
            P2PMessage::StatusUpdate { player_id, mic_enabled } => {
                log::info!("收到状态更新: {} mic={}", player_id, mic_enabled);
                if let Some(app) = app_handle.read().await.as_ref() {
                    let _ = app.emit("player-status-update", serde_json::json!({
                        "playerId": player_id,
                        "micEnabled": mic_enabled,
                    }));
                }
            }
            P2PMessage::Heartbeat { player_id, .. } => {
                // 更新最后见到时间
                if let Some(peer) = peers.write().await.get_mut(&player_id) {
                    peer.last_seen = std::time::Instant::now();
                }
            }
            P2PMessage::PlayerLeft { player_id } => {
                log::info!("玩家离开: {}", player_id);
                peers.write().await.remove(&player_id);
                
                if let Some(app) = app_handle.read().await.as_ref() {
                    let _ = app.emit("player-left", serde_json::json!({
                        "playerId": player_id,
                    }));
                }
            }
        }
    }
    
    /// 启动持续的玩家发现广播任务
    async fn start_discovery_broadcast(&self) {
        let local_player_id = Arc::clone(&self.local_player_id);
        let local_player_name = Arc::clone(&self.local_player_name);
        let socket = Arc::clone(&self.socket);
        let actual_port = Arc::clone(&self.actual_port);
        
        tokio::spawn(async move {
            let mut count = 0;
            
            loop {
                // 前10秒每秒发送一次，之后每5秒发送一次
                let interval = if count < 10 {
                    tokio::time::Duration::from_secs(1)
                } else {
                    tokio::time::Duration::from_secs(5)
                };
                
                tokio::time::sleep(interval).await;
                count += 1;
                
                // 发送玩家发现广播
                if let (Some(player_id), Some(player_name)) = (
                    local_player_id.read().await.as_ref(),
                    local_player_name.read().await.as_ref(),
                ) {
                    let message = P2PMessage::PlayerDiscovery {
                        player_id: player_id.clone(),
                        player_name: player_name.clone(),
                        port: *actual_port.read().await,
                    };
                    
                    if let Some(sock) = socket.read().await.as_ref() {
                        if let Ok(msg_json) = serde_json::to_string(&message) {
                            let port = *actual_port.read().await;
                            // 使用真实的局域网广播地址，而不是虚拟IP的广播地址
                            // 因为在 no-tun 模式下，虚拟IP不存在于系统网卡中
                            let broadcast_addr = format!("255.255.255.255:{}", port);
                            
                            if let Err(e) = sock.send_to(msg_json.as_bytes(), &broadcast_addr) {
                                log::warn!("发送玩家发现广播失败: {}", e);
                            } else {
                                log::debug!("已发送玩家发现广播到 {} (第{}次)", broadcast_addr, count);
                            }
                        }
                    }
                }
            }
        });
        
        log::info!("✅ 玩家发现广播任务已启动");
    }
    
    
    /// 广播消息到局域网
    async fn broadcast(&self, message: P2PMessage) -> Result<(), AppError> {
        let socket = self.socket.read().await;
        let socket_ref = socket.as_ref()
            .ok_or_else(|| AppError::NetworkError("套接字未初始化".to_string()))?;
        
        let msg_json = serde_json::to_string(&message)
            .map_err(|e| AppError::NetworkError(format!("序列化消息失败: {}", e)))?;
        
        // 获取实际端口
        let actual_port = *self.actual_port.read().await;
        
        // 使用真实的局域网广播地址
        let broadcast_addr = format!("255.255.255.255:{}", actual_port);
        
        log::debug!("广播消息到: {}", broadcast_addr);
        
        socket_ref.send_to(msg_json.as_bytes(), &broadcast_addr)
            .map_err(|e| AppError::NetworkError(format!("发送广播失败: {}", e)))?;
        
        Ok(())
    }
    
    /// 发送消息到指定玩家
    pub async fn send_to_player(&self, player_id: &str, message: P2PMessage) -> Result<(), AppError> {
        let peers = self.peers.read().await;
        let peer = peers.get(player_id)
            .ok_or_else(|| AppError::NetworkError(format!("玩家不存在: {}", player_id)))?;
        
        let addr = peer.addr;
        drop(peers);
        
        let socket = self.socket.read().await;
        let socket_ref = socket.as_ref()
            .ok_or_else(|| AppError::NetworkError("套接字未初始化".to_string()))?;
        
        let msg_json = serde_json::to_string(&message)
            .map_err(|e| AppError::NetworkError(format!("序列化消息失败: {}", e)))?;
        
        socket_ref.send_to(msg_json.as_bytes(), addr)
            .map_err(|e| AppError::NetworkError(format!("发送消息失败: {}", e)))?;
        
        Ok(())
    }
    
    /// 广播消息到所有玩家
    pub async fn broadcast_to_all(&self, message: P2PMessage) -> Result<(), AppError> {
        self.broadcast(message).await
    }
    
    /// 启动心跳任务
    async fn start_heartbeat(&self) {
        let local_player_id = Arc::clone(&self.local_player_id);
        let socket = Arc::clone(&self.socket);
        let actual_port = Arc::clone(&self.actual_port);
        let peers = Arc::clone(&self.peers);
        let app_handle = Arc::clone(&self.app_handle);
        
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(tokio::time::Duration::from_secs(30)).await;
                
                // 发送心跳
                if let Some(player_id) = local_player_id.read().await.as_ref() {
                    let message = P2PMessage::Heartbeat {
                        player_id: player_id.clone(),
                        timestamp: chrono::Utc::now().timestamp(),
                    };
                    
                    if let Some(sock) = socket.read().await.as_ref() {
                        if let Ok(msg_json) = serde_json::to_string(&message) {
                            let port = *actual_port.read().await;
                            // 使用虚拟网络的广播地址
                            let broadcast_addr = format!("192.168.0.255:{}", port);
                            let _ = sock.send_to(msg_json.as_bytes(), broadcast_addr);
                        }
                    }
                }
                
                // 检测超时的玩家（90秒未收到心跳）
                let timeout_duration = std::time::Duration::from_secs(90);
                let now = std::time::Instant::now();
                let mut timeout_players = Vec::new();
                
                {
                    let peers_read = peers.read().await;
                    for (player_id, peer_info) in peers_read.iter() {
                        if now.duration_since(peer_info.last_seen) > timeout_duration {
                            timeout_players.push(player_id.clone());
                        }
                    }
                }
                
                // 移除超时的玩家并通知前端
                if !timeout_players.is_empty() {
                    let mut peers_write = peers.write().await;
                    for player_id in timeout_players {
                        log::warn!("玩家超时: {}", player_id);
                        peers_write.remove(&player_id);
                        
                        // 通知前端玩家离开
                        if let Some(app) = app_handle.read().await.as_ref() {
                            let _ = app.emit("player-left", serde_json::json!({
                                "playerId": player_id,
                            }));
                        }
                    }
                }
            }
        });
    }
    
    /// 停止服务
    pub async fn stop(&self) -> Result<(), AppError> {
        log::info!("停止P2P信令服务");
        
        // 发送离开消息
        if let Some(player_id) = self.local_player_id.read().await.as_ref() {
            let message = P2PMessage::PlayerLeft {
                player_id: player_id.clone(),
            };
            let _ = self.broadcast(message).await;
        }
        
        // 关闭套接字
        *self.socket.write().await = None;
        
        // 清理对等节点
        self.peers.write().await.clear();
        
        Ok(())
    }
    
    /// 获取所有对等节点
    pub async fn get_peers(&self) -> Vec<PeerInfo> {
        self.peers.read().await.values().cloned().collect()
    }
}

impl Default for P2PSignalingService {
    fn default() -> Self {
        Self::new(47777) // 默认端口
    }
}
