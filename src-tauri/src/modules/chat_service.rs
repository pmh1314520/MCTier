/**
 * P2P 聊天服务模块
 * 基于 HTTP over WireGuard 的点对点聊天
 * 不依赖中心服务器，直接在虚拟局域网中传输
 */

use std::collections::VecDeque;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use axum::{
    extract::{Query, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use tower_http::cors::CorsLayer;

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
}

/// 获取消息请求参数
#[derive(Debug, Deserialize)]
pub struct GetMessagesQuery {
    pub since: Option<u64>, // 获取此时间戳之后的消息
}

/// 发送消息请求
#[derive(Debug, Serialize, Deserialize)]
pub struct SendMessageRequest {
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
}

impl ChatService {
    pub fn new() -> Self {
        Self {
            local_messages: Arc::new(RwLock::new(VecDeque::new())),
            virtual_ip: Arc::new(RwLock::new(None)),
            server_handle: Arc::new(RwLock::new(None)),
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

    /// 启动HTTP聊天服务器
    pub async fn start_server(&self) -> Result<(), Box<dyn std::error::Error>> {
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

        let addr = format!("0.0.0.0:{}", CHAT_SERVER_PORT);
        log::info!("📍 [ChatService] 聊天服务器将监听: {}", addr);

        let local_messages = self.local_messages.clone();

        // 创建路由
        let app = Router::new()
            .route("/api/chat/messages", get(get_messages))
            .route("/api/chat/send", post(send_message))
            .layer(CorsLayer::permissive())
            .with_state(AppState {
                local_messages: local_messages.clone(),
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
            if let Err(e) = axum::serve(listener, app).await {
                log::error!("❌ [ChatService] 服务器运行错误: {}", e);
            } else {
                log::info!("🛑 [ChatService] 聊天服务器已正常停止");
            }
        });

        *self.server_handle.write() = Some(server_task);

        log::info!("✅ [ChatService] 聊天服务器启动成功！");
        log::info!("📡 [ChatService] 监听地址: 0.0.0.0:{}", CHAT_SERVER_PORT);
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
        messages.push_back(message);
        
        // 限制消息数量
        while messages.len() > MAX_MESSAGES_PER_PLAYER {
            messages.pop_front();
        }
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
}

/// 获取消息列表
async fn get_messages(
    State(state): State<AppState>,
    Query(params): Query<GetMessagesQuery>,
) -> Json<Vec<ChatMessage>> {
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
    
    Json(result)
}

/// 发送消息（接收其他玩家发送的消息）
async fn send_message(
    State(state): State<AppState>,
    Json(req): Json<SendMessageRequest>,
) -> Result<Json<ChatMessage>, StatusCode> {
    log::info!("💬 [ChatService] 收到消息: {} - {}", req.player_name, req.content);
    
    let message = ChatMessage {
        id: format!("msg-{}-{}", req.player_id, SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis()),
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
    
    Ok(Json(message))
}
