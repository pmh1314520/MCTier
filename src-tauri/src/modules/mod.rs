// MCTier 后端模块
// 本文件作为后端模块的入口点，用于组织和导出各个子模块

// 错误处理模块
pub mod error;

// 配置管理模块
pub mod config_manager;

// 资源管理模块
pub mod resource_manager;

// 网络服务模块
pub mod network_service;

// 大厅管理模块
pub mod lobby_manager;

// Hosts文件管理模块（Magic DNS）
pub mod hosts_manager;

// 语音服务模块
pub mod voice_service;

// P2P信令服务模块
pub mod p2p_signaling;

// WebSocket信令服务模块
pub mod websocket_signaling;

// 应用核心模块
pub mod app_core;

// Tauri 命令接口模块
pub mod tauri_commands;

// Tauri 事件推送模块
pub mod tauri_events;

// 高性能文件传输模块
pub mod file_transfer;

// P2P聊天服务模块
pub mod chat_service;
