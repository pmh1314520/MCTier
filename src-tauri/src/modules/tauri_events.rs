// Tauri Event 推送模块
// 负责向前端推送各种事件通知

use tauri::{AppHandle, Emitter};
use serde::{Deserialize, Serialize};
use crate::modules::lobby_manager::Player;
use crate::modules::network_service::ConnectionStatus;
use crate::modules::voice_service::PlayerStatus;

// ==================== 事件数据结构 ====================

/// 玩家加入事件数据
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayerJoinedEvent {
    /// 玩家信息
    pub player: Player,
    /// 事件时间戳
    pub timestamp: i64,
}

/// 玩家离开事件数据
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayerLeftEvent {
    /// 玩家 ID
    pub player_id: String,
    /// 玩家名称
    pub player_name: String,
    /// 事件时间戳
    pub timestamp: i64,
}

/// 玩家状态更新事件数据
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayerStatusUpdateEvent {
    /// 玩家状态
    pub status: PlayerStatus,
}

/// 网络状态变化事件数据
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkStatusChangeEvent {
    /// 连接状态
    pub status: ConnectionStatus,
    /// 事件时间戳
    pub timestamp: i64,
}

/// 错误通知事件数据
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorEvent {
    /// 错误消息
    pub message: String,
    /// 错误代码（可选）
    pub code: Option<String>,
    /// 是否可恢复
    pub recoverable: bool,
    /// 事件时间戳
    pub timestamp: i64,
}

/// 大厅信息更新事件数据
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LobbyUpdateEvent {
    /// 大厅 ID
    pub lobby_id: String,
    /// 大厅名称
    pub lobby_name: String,
    /// 玩家数量
    pub player_count: usize,
    /// 事件时间戳
    pub timestamp: i64,
}

/// 麦克风状态变化事件数据
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MicStatusChangeEvent {
    /// 麦克风是否开启
    pub enabled: bool,
    /// 事件时间戳
    pub timestamp: i64,
}

/// 应用状态变化事件数据
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppStateChangeEvent {
    /// 新状态
    pub state: String,
    /// 事件时间戳
    pub timestamp: i64,
}

// ==================== 事件名称常量 ====================

/// 玩家加入事件名称
pub const EVENT_PLAYER_JOINED: &str = "player-joined";

/// 玩家离开事件名称
pub const EVENT_PLAYER_LEFT: &str = "player-left";

/// 玩家状态更新事件名称
pub const EVENT_PLAYER_STATUS_UPDATE: &str = "player-status-update";

/// 网络状态变化事件名称
pub const EVENT_NETWORK_STATUS_CHANGE: &str = "network-status-change";

/// 错误通知事件名称
pub const EVENT_ERROR: &str = "error";

/// 大厅信息更新事件名称
pub const EVENT_LOBBY_UPDATE: &str = "lobby-update";

/// 麦克风状态变化事件名称
pub const EVENT_MIC_STATUS_CHANGE: &str = "mic-status-change";

/// 应用状态变化事件名称
pub const EVENT_APP_STATE_CHANGE: &str = "app-state-change";

// ==================== 事件推送函数 ====================

/// 推送玩家加入事件
/// 
/// # 参数
/// * `app_handle` - Tauri 应用句柄
/// * `player` - 加入的玩家信息
/// 
/// # 返回
/// * `Ok(())` - 推送成功
/// * `Err(String)` - 推送失败
pub fn emit_player_joined(app_handle: &AppHandle, player: Player) -> Result<(), String> {
    let event = PlayerJoinedEvent {
        player: player.clone(),
        timestamp: chrono::Utc::now().timestamp(),
    };
    
    log::info!("推送玩家加入事件: {} ({})", player.name, player.id);
    
    app_handle
        .emit(EVENT_PLAYER_JOINED, event)
        .map_err(|e| format!("推送玩家加入事件失败: {}", e))
}

/// 推送玩家离开事件
/// 
/// # 参数
/// * `app_handle` - Tauri 应用句柄
/// * `player_id` - 离开的玩家 ID
/// * `player_name` - 离开的玩家名称
/// 
/// # 返回
/// * `Ok(())` - 推送成功
/// * `Err(String)` - 推送失败
pub fn emit_player_left(
    app_handle: &AppHandle,
    player_id: String,
    player_name: String,
) -> Result<(), String> {
    let event = PlayerLeftEvent {
        player_id: player_id.clone(),
        player_name: player_name.clone(),
        timestamp: chrono::Utc::now().timestamp(),
    };
    
    log::info!("推送玩家离开事件: {} ({})", player_name, player_id);
    
    app_handle
        .emit(EVENT_PLAYER_LEFT, event)
        .map_err(|e| format!("推送玩家离开事件失败: {}", e))
}

/// 推送玩家状态更新事件
/// 
/// # 参数
/// * `app_handle` - Tauri 应用句柄
/// * `status` - 玩家状态信息
/// 
/// # 返回
/// * `Ok(())` - 推送成功
/// * `Err(String)` - 推送失败
pub fn emit_player_status_update(
    app_handle: &AppHandle,
    status: PlayerStatus,
) -> Result<(), String> {
    let event = PlayerStatusUpdateEvent {
        status: status.clone(),
    };
    
    log::debug!(
        "推送玩家状态更新事件: {} (麦克风: {})",
        status.player_id,
        status.mic_enabled
    );
    
    app_handle
        .emit(EVENT_PLAYER_STATUS_UPDATE, event)
        .map_err(|e| format!("推送玩家状态更新事件失败: {}", e))
}

/// 推送网络状态变化事件
/// 
/// # 参数
/// * `app_handle` - Tauri 应用句柄
/// * `status` - 网络连接状态
/// 
/// # 返回
/// * `Ok(())` - 推送成功
/// * `Err(String)` - 推送失败
pub fn emit_network_status_change(
    app_handle: &AppHandle,
    status: ConnectionStatus,
) -> Result<(), String> {
    let event = NetworkStatusChangeEvent {
        status: status.clone(),
        timestamp: chrono::Utc::now().timestamp(),
    };
    
    log::info!("推送网络状态变化事件: {:?}", status);
    
    app_handle
        .emit(EVENT_NETWORK_STATUS_CHANGE, event)
        .map_err(|e| format!("推送网络状态变化事件失败: {}", e))
}

/// 推送错误通知事件
/// 
/// # 参数
/// * `app_handle` - Tauri 应用句柄
/// * `message` - 错误消息
/// * `code` - 错误代码（可选）
/// * `recoverable` - 是否可恢复
/// 
/// # 返回
/// * `Ok(())` - 推送成功
/// * `Err(String)` - 推送失败
pub fn emit_error(
    app_handle: &AppHandle,
    message: String,
    code: Option<String>,
    recoverable: bool,
) -> Result<(), String> {
    let event = ErrorEvent {
        message: message.clone(),
        code,
        recoverable,
        timestamp: chrono::Utc::now().timestamp(),
    };
    
    log::error!("推送错误通知事件: {}", message);
    
    app_handle
        .emit(EVENT_ERROR, event)
        .map_err(|e| format!("推送错误通知事件失败: {}", e))
}

/// 推送大厅信息更新事件
/// 
/// # 参数
/// * `app_handle` - Tauri 应用句柄
/// * `lobby_id` - 大厅 ID
/// * `lobby_name` - 大厅名称
/// * `player_count` - 玩家数量
/// 
/// # 返回
/// * `Ok(())` - 推送成功
/// * `Err(String)` - 推送失败
pub fn emit_lobby_update(
    app_handle: &AppHandle,
    lobby_id: String,
    lobby_name: String,
    player_count: usize,
) -> Result<(), String> {
    let event = LobbyUpdateEvent {
        lobby_id,
        lobby_name: lobby_name.clone(),
        player_count,
        timestamp: chrono::Utc::now().timestamp(),
    };
    
    log::info!("推送大厅信息更新事件: {} ({} 个玩家)", lobby_name, player_count);
    
    app_handle
        .emit(EVENT_LOBBY_UPDATE, event)
        .map_err(|e| format!("推送大厅信息更新事件失败: {}", e))
}

/// 推送麦克风状态变化事件
/// 
/// # 参数
/// * `app_handle` - Tauri 应用句柄
/// * `enabled` - 麦克风是否开启
/// 
/// # 返回
/// * `Ok(())` - 推送成功
/// * `Err(String)` - 推送失败
pub fn emit_mic_status_change(app_handle: &AppHandle, enabled: bool) -> Result<(), String> {
    let event = MicStatusChangeEvent {
        enabled,
        timestamp: chrono::Utc::now().timestamp(),
    };
    
    log::info!("推送麦克风状态变化事件: {}", if enabled { "开启" } else { "关闭" });
    
    app_handle
        .emit(EVENT_MIC_STATUS_CHANGE, event)
        .map_err(|e| format!("推送麦克风状态变化事件失败: {}", e))
}

/// 推送应用状态变化事件
/// 
/// # 参数
/// * `app_handle` - Tauri 应用句柄
/// * `state` - 新的应用状态
/// 
/// # 返回
/// * `Ok(())` - 推送成功
/// * `Err(String)` - 推送失败
pub fn emit_app_state_change(app_handle: &AppHandle, state: String) -> Result<(), String> {
    let event = AppStateChangeEvent {
        state: state.clone(),
        timestamp: chrono::Utc::now().timestamp(),
    };
    
    log::info!("推送应用状态变化事件: {}", state);
    
    app_handle
        .emit(EVENT_APP_STATE_CHANGE, event)
        .map_err(|e| format!("推送应用状态变化事件失败: {}", e))
}

// ==================== 批量事件推送 ====================

/// 推送多个玩家加入事件
/// 
/// # 参数
/// * `app_handle` - Tauri 应用句柄
/// * `players` - 玩家列表
/// 
/// # 返回
/// * `Ok(usize)` - 成功推送的事件数量
/// * `Err(String)` - 推送失败
pub fn emit_players_joined(app_handle: &AppHandle, players: Vec<Player>) -> Result<usize, String> {
    let mut success_count = 0;
    
    for player in players {
        if emit_player_joined(app_handle, player).is_ok() {
            success_count += 1;
        }
    }
    
    Ok(success_count)
}

/// 推送多个玩家状态更新事件
/// 
/// # 参数
/// * `app_handle` - Tauri 应用句柄
/// * `statuses` - 玩家状态列表
/// 
/// # 返回
/// * `Ok(usize)` - 成功推送的事件数量
/// * `Err(String)` - 推送失败
pub fn emit_player_statuses_update(
    app_handle: &AppHandle,
    statuses: Vec<PlayerStatus>,
) -> Result<usize, String> {
    let mut success_count = 0;
    
    for status in statuses {
        if emit_player_status_update(app_handle, status).is_ok() {
            success_count += 1;
        }
    }
    
    Ok(success_count)
}

// ==================== 辅助函数 ====================

/// 安全地推送事件（捕获所有错误）
/// 
/// # 参数
/// * `app_handle` - Tauri 应用句柄
/// * `event_name` - 事件名称
/// * `payload` - 事件数据
/// 
/// # 说明
/// 此函数会捕获所有错误并记录日志，不会向上传播错误
pub fn emit_safe<T: Serialize + Clone>(app_handle: &AppHandle, event_name: &str, payload: T) {
    if let Err(e) = app_handle.emit(event_name, payload) {
        log::error!("推送事件 {} 失败: {}", event_name, e);
    }
}

/// 获取当前时间戳（毫秒）
pub fn get_timestamp_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// 获取当前时间戳（秒）
pub fn get_timestamp() -> i64 {
    chrono::Utc::now().timestamp()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_player_joined_event_serialization() {
        use crate::modules::lobby_manager::Player;
        
        let player = Player::new("测试玩家".to_string());
        let event = PlayerJoinedEvent {
            player,
            timestamp: 1234567890,
        };
        
        let json = serde_json::to_string(&event).unwrap();
        let deserialized: PlayerJoinedEvent = serde_json::from_str(&json).unwrap();
        
        assert_eq!(deserialized.timestamp, 1234567890);
        assert_eq!(deserialized.player.name, "测试玩家");
    }

    #[test]
    fn test_player_left_event_serialization() {
        let event = PlayerLeftEvent {
            player_id: "player_123".to_string(),
            player_name: "测试玩家".to_string(),
            timestamp: 1234567890,
        };
        
        let json = serde_json::to_string(&event).unwrap();
        let deserialized: PlayerLeftEvent = serde_json::from_str(&json).unwrap();
        
        assert_eq!(deserialized.player_id, "player_123");
        assert_eq!(deserialized.player_name, "测试玩家");
        assert_eq!(deserialized.timestamp, 1234567890);
    }

    #[test]
    fn test_error_event_serialization() {
        let event = ErrorEvent {
            message: "测试错误".to_string(),
            code: Some("ERR_001".to_string()),
            recoverable: true,
            timestamp: 1234567890,
        };
        
        let json = serde_json::to_string(&event).unwrap();
        let deserialized: ErrorEvent = serde_json::from_str(&json).unwrap();
        
        assert_eq!(deserialized.message, "测试错误");
        assert_eq!(deserialized.code, Some("ERR_001".to_string()));
        assert_eq!(deserialized.recoverable, true);
        assert_eq!(deserialized.timestamp, 1234567890);
    }

    #[test]
    fn test_network_status_change_event_serialization() {
        let event = NetworkStatusChangeEvent {
            status: ConnectionStatus::Connected("10.144.144.1".to_string()),
            timestamp: 1234567890,
        };
        
        let json = serde_json::to_string(&event).unwrap();
        let deserialized: NetworkStatusChangeEvent = serde_json::from_str(&json).unwrap();
        
        assert_eq!(
            deserialized.status,
            ConnectionStatus::Connected("10.144.144.1".to_string())
        );
        assert_eq!(deserialized.timestamp, 1234567890);
    }

    #[test]
    fn test_mic_status_change_event_serialization() {
        let event = MicStatusChangeEvent {
            enabled: true,
            timestamp: 1234567890,
        };
        
        let json = serde_json::to_string(&event).unwrap();
        let deserialized: MicStatusChangeEvent = serde_json::from_str(&json).unwrap();
        
        assert_eq!(deserialized.enabled, true);
        assert_eq!(deserialized.timestamp, 1234567890);
    }

    #[test]
    fn test_lobby_update_event_serialization() {
        let event = LobbyUpdateEvent {
            lobby_id: "lobby_123".to_string(),
            lobby_name: "测试大厅".to_string(),
            player_count: 5,
            timestamp: 1234567890,
        };
        
        let json = serde_json::to_string(&event).unwrap();
        let deserialized: LobbyUpdateEvent = serde_json::from_str(&json).unwrap();
        
        assert_eq!(deserialized.lobby_id, "lobby_123");
        assert_eq!(deserialized.lobby_name, "测试大厅");
        assert_eq!(deserialized.player_count, 5);
        assert_eq!(deserialized.timestamp, 1234567890);
    }

    #[test]
    fn test_event_name_constants() {
        assert_eq!(EVENT_PLAYER_JOINED, "player-joined");
        assert_eq!(EVENT_PLAYER_LEFT, "player-left");
        assert_eq!(EVENT_PLAYER_STATUS_UPDATE, "player-status-update");
        assert_eq!(EVENT_NETWORK_STATUS_CHANGE, "network-status-change");
        assert_eq!(EVENT_ERROR, "error");
        assert_eq!(EVENT_LOBBY_UPDATE, "lobby-update");
        assert_eq!(EVENT_MIC_STATUS_CHANGE, "mic-status-change");
        assert_eq!(EVENT_APP_STATE_CHANGE, "app-state-change");
    }

    #[test]
    fn test_timestamp_functions() {
        let ts = get_timestamp();
        let ts_ms = get_timestamp_ms();
        
        // 验证时间戳在合理范围内（2020年之后）
        assert!(ts > 1577836800); // 2020-01-01
        assert!(ts_ms > 1577836800000); // 2020-01-01 in milliseconds
        
        // 验证毫秒时间戳是秒时间戳的约1000倍
        assert!((ts_ms / 1000 - ts).abs() < 2); // 允许1-2秒的误差
    }
}
