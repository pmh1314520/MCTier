use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::sync::RwLock;
use serde::{Deserialize, Serialize};
use tauri::Emitter;
use crate::modules::error::AppError;
use tokio_tungstenite::{accept_async, tungstenite::Message};
use tokio::net::{TcpListener, TcpStream};
use futures_util::{StreamExt, SinkExt};

/// WebSocket 信令消息
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum SignalingMessage {
    /// 注册客户端
    Register {
        #[serde(rename = "clientId")]
        client_id: String,
        #[serde(rename = "playerName")]
        player_name: String,
    },
    /// 玩家列表
    PlayersList {
        players: Vec<PlayerInfo>,
    },
    /// 玩家加入
    PlayerJoined {
        #[serde(rename = "playerId")]
        player_id: String,
        #[serde(rename = "playerName")]
        player_name: String,
    },
    /// 玩家离开
    PlayerLeft {
        #[serde(rename = "playerId")]
        player_id: String,
    },
    /// WebRTC Offer
    Offer {
        from: String,
        to: String,
        offer: OfferData,
        #[serde(rename = "playerName", skip_serializing_if = "Option::is_none")]
        player_name: Option<String>,
    },
    /// WebRTC Answer
    Answer {
        from: String,
        to: String,
        answer: AnswerData,
    },
    /// ICE Candidate
    IceCandidate {
        from: String,
        to: String,
        candidate: CandidateData,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayerInfo {
    #[serde(rename = "playerId")]
    pub player_id: String,
    #[serde(rename = "playerName")]
    pub player_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OfferData {
    #[serde(rename = "type")]
    pub sdp_type: String,
    pub sdp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnswerData {
    #[serde(rename = "type")]
    pub sdp_type: String,
    pub sdp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CandidateData {
    pub candidate: String,
    #[serde(rename = "sdpMLineIndex")]
    pub sdp_m_line_index: Option<u16>,
    #[serde(rename = "sdpMid")]
    pub sdp_mid: Option<String>,
}

/// 客户端信息
#[derive(Debug, Clone)]
struct ClientInfo {
    player_id: String,
    player_name: String,
    sender: Arc<RwLock<futures_util::stream::SplitSink<tokio_tungstenite::WebSocketStream<TcpStream>, Message>>>,
}

/// WebSocket 信令服务器
pub struct WebSocketSignalingServer {
    /// 监听地址
    listen_addr: String,
    /// 已连接的客户端
    clients: Arc<RwLock<HashMap<String, ClientInfo>>>,
    /// 服务器是否正在运行
    is_running: Arc<RwLock<bool>>,
    /// Tauri 应用句柄
    app_handle: Arc<RwLock<Option<tauri::AppHandle>>>,
}

impl WebSocketSignalingServer {
    /// 创建新的 WebSocket 信令服务器
    pub fn new(virtual_ip: &str, port: u16) -> Self {
        // 在 no-tun 模式下，虚拟IP不存在于系统网卡中
        // 所以我们绑定到 0.0.0.0（所有接口），但记录虚拟IP用于前端连接
        let listen_addr = format!("0.0.0.0:{}", port);
        log::info!("创建 WebSocket 信令服务器");
        log::info!("  监听地址: {}", listen_addr);
        log::info!("  虚拟IP: {} (用于前端连接)", virtual_ip);
        
        Self {
            listen_addr,
            clients: Arc::new(RwLock::new(HashMap::new())),
            is_running: Arc::new(RwLock::new(false)),
            app_handle: Arc::new(RwLock::new(None)),
        }
    }
    
    /// 设置 Tauri 应用句柄
    pub async fn set_app_handle(&self, app_handle: tauri::AppHandle) {
        let mut handle = self.app_handle.write().await;
        *handle = Some(app_handle);
        log::info!("WebSocket 信令服务器已设置应用句柄");
    }
    
    /// 启动服务器
    pub async fn start(&self) -> Result<(), AppError> {
        log::info!("启动 WebSocket 信令服务器: {}", self.listen_addr);
        
        // 检查是否已经在运行
        {
            let is_running = self.is_running.read().await;
            if *is_running {
                log::warn!("WebSocket 信令服务器已经在运行");
                return Ok(());
            }
        }
        
        // 绑定监听地址
        let listener = TcpListener::bind(&self.listen_addr).await
            .map_err(|e| AppError::NetworkError(format!("无法绑定地址 {}: {}", self.listen_addr, e)))?;
        
        log::info!("✅ WebSocket 信令服务器已绑定到: {}", self.listen_addr);
        
        // 标记为正在运行
        *self.is_running.write().await = true;
        
        // 克隆需要的数据
        let clients = Arc::clone(&self.clients);
        let is_running = Arc::clone(&self.is_running);
        let app_handle = Arc::clone(&self.app_handle);
        
        // 启动接受连接的任务
        tokio::spawn(async move {
            while *is_running.read().await {
                match listener.accept().await {
                    Ok((stream, addr)) => {
                        log::info!("新客户端连接: {}", addr);
                        
                        let clients_clone = Arc::clone(&clients);
                        let app_handle_clone = Arc::clone(&app_handle);
                        
                        tokio::spawn(async move {
                            if let Err(e) = Self::handle_connection(stream, addr, clients_clone, app_handle_clone).await {
                                log::error!("处理客户端连接失败 ({}): {}", addr, e);
                            }
                        });
                    }
                    Err(e) => {
                        log::error!("接受连接失败: {}", e);
                        tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
                    }
                }
            }
            
            log::info!("WebSocket 信令服务器已停止接受新连接");
        });
        
        log::info!("✅ WebSocket 信令服务器启动成功");
        Ok(())
    }
    
    /// 处理客户端连接
    async fn handle_connection(
        stream: TcpStream,
        addr: SocketAddr,
        clients: Arc<RwLock<HashMap<String, ClientInfo>>>,
        app_handle: Arc<RwLock<Option<tauri::AppHandle>>>,
    ) -> Result<(), AppError> {
        // 升级到 WebSocket
        let ws_stream = accept_async(stream).await
            .map_err(|e| AppError::NetworkError(format!("WebSocket 握手失败: {}", e)))?;
        
        log::info!("✅ WebSocket 连接已建立: {}", addr);
        
        let (write, mut read) = ws_stream.split();
        let write = Arc::new(RwLock::new(write));
        
        let mut client_id: Option<String> = None;
        
        // 处理消息
        while let Some(msg_result) = read.next().await {
            match msg_result {
                Ok(msg) => {
                    if msg.is_text() {
                        let text = msg.to_text().unwrap();
                        
                        match serde_json::from_str::<SignalingMessage>(text) {
                            Ok(message) => {
                                match message {
                                    SignalingMessage::Register { client_id: cid, player_name } => {
                                        log::info!("客户端注册: {} ({})", player_name, cid);
                                        
                                        // 保存客户端信息
                                        let client_info = ClientInfo {
                                            player_id: cid.clone(),
                                            player_name: player_name.clone(),
                                            sender: Arc::clone(&write),
                                        };
                                        
                                        clients.write().await.insert(cid.clone(), client_info);
                                        client_id = Some(cid.clone());
                                        
                                        log::info!("当前在线: {} 人", clients.read().await.len());
                                        
                                        // 发送当前在线玩家列表
                                        let players: Vec<PlayerInfo> = clients.read().await
                                            .iter()
                                            .filter(|(id, _)| **id != cid)
                                            .map(|(_, info)| PlayerInfo {
                                                player_id: info.player_id.clone(),
                                                player_name: info.player_name.clone(),
                                            })
                                            .collect();
                                        
                                        let players_list = SignalingMessage::PlayersList { players };
                                        if let Ok(json) = serde_json::to_string(&players_list) {
                                            let _ = write.write().await.send(Message::Text(json)).await;
                                        }
                                        
                                        // 通知其他客户端有新玩家加入
                                        Self::broadcast_except(
                                            &clients,
                                            &cid,
                                            SignalingMessage::PlayerJoined {
                                                player_id: cid.clone(),
                                                player_name: player_name.clone(),
                                            },
                                        ).await;
                                        
                                        // 通知前端（如果是本地客户端）
                                        if let Some(app) = app_handle.read().await.as_ref() {
                                            let _ = app.emit("player-joined", serde_json::json!({
                                                "playerId": cid,
                                                "playerName": player_name,
                                            }));
                                        }
                                    }
                                    SignalingMessage::Offer { from, to, offer, .. } => {
                                        log::info!("转发 Offer from {} to {}", from, to);
                                        
                                        // 获取发送者名称
                                        let player_name = clients.read().await
                                            .get(&from)
                                            .map(|info| info.player_name.clone());
                                        
                                        // 转发到目标客户端
                                        if let Some(target) = clients.read().await.get(&to) {
                                            let forward_msg = SignalingMessage::Offer {
                                                from,
                                                to,
                                                offer,
                                                player_name,
                                            };
                                            
                                            if let Ok(json) = serde_json::to_string(&forward_msg) {
                                                let _ = target.sender.write().await.send(Message::Text(json)).await;
                                            }
                                        } else {
                                            log::warn!("目标客户端不存在: {}", to);
                                        }
                                    }
                                    SignalingMessage::Answer { from, to, answer } => {
                                        log::info!("转发 Answer from {} to {}", from, to);
                                        
                                        // 转发到目标客户端
                                        if let Some(target) = clients.read().await.get(&to) {
                                            let forward_msg = SignalingMessage::Answer { from, to, answer };
                                            
                                            if let Ok(json) = serde_json::to_string(&forward_msg) {
                                                let _ = target.sender.write().await.send(Message::Text(json)).await;
                                            }
                                        } else {
                                            log::warn!("目标客户端不存在: {}", to);
                                        }
                                    }
                                    SignalingMessage::IceCandidate { from, to, candidate } => {
                                        log::debug!("转发 ICE Candidate from {} to {}", from, to);
                                        
                                        // 转发到目标客户端
                                        if let Some(target) = clients.read().await.get(&to) {
                                            let forward_msg = SignalingMessage::IceCandidate { from, to, candidate };
                                            
                                            if let Ok(json) = serde_json::to_string(&forward_msg) {
                                                let _ = target.sender.write().await.send(Message::Text(json)).await;
                                            }
                                        } else {
                                            log::warn!("目标客户端不存在: {}", to);
                                        }
                                    }
                                    _ => {
                                        log::warn!("未知消息类型");
                                    }
                                }
                            }
                            Err(e) => {
                                log::error!("解析消息失败: {}", e);
                            }
                        }
                    } else if msg.is_close() {
                        log::info!("客户端关闭连接: {}", addr);
                        break;
                    }
                }
                Err(e) => {
                    log::error!("接收消息失败: {}", e);
                    break;
                }
            }
        }
        
        // 客户端断开连接，清理资源
        if let Some(cid) = client_id {
            log::info!("客户端断开: {}", cid);
            clients.write().await.remove(&cid);
            
            // 通知其他客户端
            Self::broadcast_except(
                &clients,
                &cid,
                SignalingMessage::PlayerLeft {
                    player_id: cid.clone(),
                },
            ).await;
            
            // 通知前端
            if let Some(app) = app_handle.read().await.as_ref() {
                let _ = app.emit("player-left", serde_json::json!({
                    "playerId": cid,
                }));
            }
        }
        
        Ok(())
    }
    
    /// 广播消息（排除指定客户端）
    async fn broadcast_except(
        clients: &Arc<RwLock<HashMap<String, ClientInfo>>>,
        exclude_id: &str,
        message: SignalingMessage,
    ) {
        if let Ok(json) = serde_json::to_string(&message) {
            let clients_read = clients.read().await;
            for (id, client) in clients_read.iter() {
                if id != exclude_id {
                    let _ = client.sender.write().await.send(Message::Text(json.clone())).await;
                }
            }
        }
    }
    
    /// 停止服务器
    pub async fn stop(&self) -> Result<(), AppError> {
        log::info!("停止 WebSocket 信令服务器");
        
        *self.is_running.write().await = false;
        
        // 关闭所有客户端连接
        self.clients.write().await.clear();
        
        Ok(())
    }
    
    /// 获取在线客户端数量
    pub async fn get_client_count(&self) -> usize {
        self.clients.read().await.len()
    }
}
