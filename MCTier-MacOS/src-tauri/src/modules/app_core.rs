// AppCore 模块 - 应用程序核心
// 负责应用程序生命周期管理、模块初始化、全局状态维护

use log::{info, warn};
use std::sync::Arc;
use tokio::sync::Mutex;

use super::chat_service::ChatService;
use super::config_manager::ConfigManager;
use super::error::AppError;
use super::file_transfer::FileTransferService;
use super::lobby_manager::{LobbyError, LobbyManager};
use super::network_service::{NetworkConfig, NetworkService};
use super::p2p_signaling::P2PSignalingService;
use super::voice_service::VoiceService;
use super::websocket_signaling::WebSocketSignalingServer;

/// 应用程序状态枚举
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AppState {
    /// 空闲状态 - 应用启动后的初始状态
    Idle,
    /// 连接中 - 正在建立网络连接
    Connecting,
    /// 在大厅中 - 已成功加入大厅
    InLobby,
    /// 错误状态 - 发生错误
    Error(String),
}

/// 应用程序核心结构体
///
/// 负责协调所有子模块的交互，管理应用程序的生命周期
pub struct AppCore {
    /// 大厅管理器
    lobby_manager: Arc<Mutex<LobbyManager>>,
    /// 网络服务
    network_service: Arc<Mutex<NetworkService>>,
    /// 语音服务
    voice_service: Arc<Mutex<VoiceService>>,
    /// P2P信令服务
    p2p_signaling: Arc<Mutex<P2PSignalingService>>,
    /// WebSocket信令服务器（创建大厅时使用）
    websocket_signaling: Arc<Mutex<Option<WebSocketSignalingServer>>>,
    /// 文件传输服务
    file_transfer: Arc<Mutex<FileTransferService>>,
    /// P2P聊天服务
    chat_service: Arc<Mutex<ChatService>>,
    /// 配置管理器
    config_manager: Arc<Mutex<ConfigManager>>,
    /// 应用程序状态
    state: Arc<Mutex<AppState>>,
}

impl AppCore {
    /// 初始化应用核心
    ///
    /// 创建所有子模块实例并初始化配置
    ///
    /// # 返回
    ///
    /// * `Ok(AppCore)` - 成功初始化的应用核心实例
    /// * `Err(AppError)` - 初始化失败的错误信息
    ///
    /// # 示例
    ///
    /// ```no_run
    /// use mctier_lib::modules::app_core::AppCore;
    ///
    /// #[tokio::main]
    /// async fn main() {
    ///     let app_core = AppCore::new().await.unwrap();
    /// }
    /// ```
    pub async fn new() -> Result<Self, AppError> {
        info!("正在初始化应用核心...");

        // 初始化配置管理器
        let config_manager = match ConfigManager::load().await {
            Ok(manager) => {
                info!("配置管理器初始化成功");
                Arc::new(Mutex::new(manager))
            }
            Err(e) => {
                warn!("配置加载失败，使用默认配置: {}", e);
                // 使用默认配置
                let default_manager = ConfigManager::default();
                Arc::new(Mutex::new(default_manager))
            }
        };

        Ok(Self::with_config_manager(config_manager))
    }

    fn with_config_manager(config_manager: Arc<Mutex<ConfigManager>>) -> Self {
        // 初始化网络服务
        let network_config = NetworkConfig::default();
        let network_service = Arc::new(Mutex::new(NetworkService::new(network_config)));
        info!("网络服务初始化成功");

        // 初始化大厅管理器
        let lobby_manager = Arc::new(Mutex::new(LobbyManager::new()));
        info!("大厅管理器初始化成功");

        // 初始化语音服务
        let voice_service = Arc::new(Mutex::new(VoiceService::new()));
        info!("语音服务初始化成功");

        // 初始化P2P信令服务
        let p2p_signaling = Arc::new(Mutex::new(P2PSignalingService::new(47777)));
        info!("P2P信令服务初始化成功");

        // 初始化WebSocket信令服务器（初始为None，创建大厅时才创建）
        let websocket_signaling = Arc::new(Mutex::new(None));
        info!("WebSocket信令服务器已准备");

        // 初始化文件传输服务
        let file_transfer = Arc::new(Mutex::new(FileTransferService::new()));
        info!("文件传输服务初始化成功");

        // 初始化P2P聊天服务
        let chat_service = Arc::new(Mutex::new(ChatService::new()));
        info!("P2P聊天服务初始化成功");

        // 初始化应用状态
        let state = Arc::new(Mutex::new(AppState::Idle));

        info!("应用核心初始化完成");

        AppCore {
            lobby_manager,
            network_service,
            voice_service,
            p2p_signaling,
            websocket_signaling,
            file_transfer,
            chat_service,
            config_manager,
            state,
        }
    }

    /// 启动应用
    ///
    /// 执行应用启动时的必要操作
    ///
    /// # 返回
    ///
    /// * `Ok(())` - 启动成功
    /// * `Err(AppError)` - 启动失败的错误信息
    pub async fn start(&self) -> Result<(), AppError> {
        info!("正在启动应用...");

        // 检查当前状态
        let current_state = self.state.lock().await;
        if *current_state != AppState::Idle {
            warn!("应用已经启动，当前状态: {:?}", *current_state);
            return Ok(());
        }
        drop(current_state);

        // 初始化语音服务
        match self.voice_service.lock().await.initialize().await {
            Ok(_) => info!("语音服务启动成功"),
            Err(e) => {
                warn!("语音服务启动失败: {}，语音功能可能不可用", e);
                // 语音服务失败不应该阻止应用启动
            }
        }

        info!("应用启动完成");
        Ok(())
    }

    /// 关闭应用
    ///
    /// 执行应用关闭时的清理操作，包括：
    /// - 断开所有网络连接
    /// - 停止所有音频流
    /// - 终止子进程
    /// - 清理资源
    ///
    /// # 返回
    ///
    /// * `Ok(())` - 关闭成功
    /// * `Err(AppError)` - 关闭失败的错误信息
    pub async fn shutdown(&self) -> Result<(), AppError> {
        info!("正在关闭应用...");

        // 更新状态
        *self.state.lock().await = AppState::Idle;

        // 停止P2P信令服务
        match self.p2p_signaling.lock().await.stop().await {
            Ok(_) => info!("P2P信令服务已停止"),
            Err(e) => warn!("停止P2P信令服务时发生错误: {}", e),
        }

        // 停止WebSocket信令服务器（如果正在运行）
        {
            let mut signaling = self.websocket_signaling.lock().await;
            if let Some(ws_server) = signaling.as_ref() {
                match ws_server.stop().await {
                    Ok(_) => info!("WebSocket信令服务器已停止"),
                    Err(e) => warn!("停止WebSocket信令服务器时发生错误: {}", e),
                }
            }
            *signaling = None;
        }

        // 退出大厅（如果在大厅中）
        match self.leave_lobby_for_shutdown().await {
            Ok(_) => info!("已退出大厅"),
            Err(e) => {
                // 如果不在大厅中，这是正常的
                if !matches!(e, LobbyError::NotInLobby) {
                    warn!("退出大厅时发生错误: {}", e);
                }
            }
        }

        // 额外的hosts清理：确保清理所有可能的MCTier hosts记录
        // 这是一个保险措施，防止因为异常退出导致hosts文件残留
        info!("执行彻底的hosts文件清理...");
        match crate::modules::hosts_manager::HostsManager::cleanup_all_mctier_entries() {
            Ok(_) => info!("✅ 所有MCTier hosts记录已彻底清理"),
            Err(e) => warn!("⚠️ hosts文件清理失败: {}", e),
        }

        // 停止网络服务
        match self.network_service.lock().await.stop_easytier().await {
            Ok(_) => info!("网络服务已停止"),
            Err(e) => warn!("停止网络服务时发生错误: {}", e),
        }

        // 保存配置
        match self.config_manager.lock().await.save().await {
            Ok(_) => info!("配置已保存"),
            Err(e) => warn!("保存配置时发生错误: {}", e),
        }

        info!("应用关闭完成");
        Ok(())
    }

    async fn leave_lobby_for_shutdown(&self) -> Result<(), LobbyError> {
        // Lobby transitions always acquire lobby before network, including exit.
        let mut lobby = self.lobby_manager.lock().await;
        let network = self.network_service.lock().await;
        lobby.leave_lobby(&network).await
    }

    /// 设置 Tauri 应用句柄
    ///
    /// 必须在使用网络服务之前调用此方法
    ///
    /// # 参数
    ///
    /// * `app_handle` - Tauri 应用句柄
    pub async fn set_app_handle(&self, app_handle: tauri::AppHandle) {
        info!("设置 Tauri 应用句柄");
        self.network_service
            .lock()
            .await
            .set_app_handle(app_handle.clone());
        self.p2p_signaling
            .lock()
            .await
            .set_app_handle(app_handle.clone())
            .await;

        // 如果WebSocket信令服务器已创建，也设置其app_handle
        if let Some(ws_server) = self.websocket_signaling.lock().await.as_ref() {
            ws_server.set_app_handle(app_handle).await;
        }
    }

    /// 获取应用状态
    ///
    /// # 返回
    ///
    /// 当前应用状态的克隆
    pub async fn get_state(&self) -> AppState {
        self.state.lock().await.clone()
    }

    /// 设置应用状态
    ///
    /// # 参数
    ///
    /// * `new_state` - 新的应用状态
    pub async fn set_state(&self, new_state: AppState) {
        let mut state = self.state.lock().await;
        info!("应用状态变更: {:?} -> {:?}", *state, new_state);
        *state = new_state;
    }

    /// 获取大厅管理器的引用
    pub fn get_lobby_manager(&self) -> Arc<Mutex<LobbyManager>> {
        Arc::clone(&self.lobby_manager)
    }

    /// 获取网络服务的引用
    pub fn get_network_service(&self) -> Arc<Mutex<NetworkService>> {
        Arc::clone(&self.network_service)
    }

    /// 获取语音服务的引用
    pub fn get_voice_service(&self) -> Arc<Mutex<VoiceService>> {
        Arc::clone(&self.voice_service)
    }

    /// 获取配置管理器的引用
    pub fn get_config_manager(&self) -> Arc<Mutex<ConfigManager>> {
        Arc::clone(&self.config_manager)
    }

    /// 获取P2P信令服务的引用
    pub fn get_p2p_signaling(&self) -> Arc<Mutex<P2PSignalingService>> {
        Arc::clone(&self.p2p_signaling)
    }

    /// 获取文件传输服务的引用
    pub fn get_file_transfer(&self) -> Arc<Mutex<FileTransferService>> {
        Arc::clone(&self.file_transfer)
    }

    /// 获取P2P聊天服务的引用
    pub fn get_chat_service(&self) -> Arc<Mutex<ChatService>> {
        Arc::clone(&self.chat_service)
    }

    /// 启动WebSocket信令服务器（创建大厅时调用）
    ///
    /// # 参数
    ///
    /// * `virtual_ip` - 虚拟IP地址
    /// * `port` - 监听端口（默认8445）
    ///
    /// # 返回
    ///
    /// * `Ok(())` - 启动成功
    /// * `Err(AppError)` - 启动失败
    pub async fn start_websocket_signaling(
        &self,
        virtual_ip: String,
        port: u16,
    ) -> Result<(), AppError> {
        info!("启动WebSocket信令服务器: {}:{}", virtual_ip, port);

        // 创建WebSocket信令服务器
        let ws_server = WebSocketSignalingServer::new(&virtual_ip, port);

        // 启动服务器
        ws_server.start().await?;

        // 保存服务器实例
        *self.websocket_signaling.lock().await = Some(ws_server);

        info!("✅ WebSocket信令服务器启动成功");
        Ok(())
    }

    /// 停止WebSocket信令服务器
    pub async fn stop_websocket_signaling(&self) -> Result<(), AppError> {
        info!("停止WebSocket信令服务器");

        let mut signaling = self.websocket_signaling.lock().await;
        if let Some(ws_server) = signaling.as_ref() {
            ws_server.stop().await?;
        }

        *signaling = None;

        info!("✅ WebSocket信令服务器已停止");
        Ok(())
    }

    /// 切换麦克风状态
    ///
    /// # 返回
    ///
    /// * `Ok(bool)` - 新的麦克风状态（true=开启，false=关闭）
    /// * `Err(AppError)` - 切换失败的错误信息
    pub async fn toggle_mic(&self) -> Result<bool, AppError> {
        info!("切换麦克风状态");

        // 获取当前麦克风状态
        let voice_service = self.voice_service.lock().await;
        let current_state = voice_service.is_mic_enabled();
        let new_state = !current_state;

        // Keep read/modify/write in one service guard, even without a core guard.
        match voice_service.set_mic_enabled(new_state).await {
            Ok(state) => {
                info!("麦克风状态已切换: {} -> {}", current_state, state);
                Ok(state)
            }
            Err(e) => {
                warn!("切换麦克风状态失败: {}", e);
                Err(AppError::VoiceError(e.to_string()))
            }
        }
    }
}

// 实现 Drop trait 以确保资源正确清理
impl Drop for AppCore {
    fn drop(&mut self) {
        info!("AppCore 正在被销毁，清理资源...");
        // 注意：Drop 中不能使用 async，所以这里只记录日志
        // 实际的异步清理应该在 shutdown() 中完成
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::future::{poll_fn, Future};
    use std::task::Poll;
    use std::time::Duration;

    fn isolated_core() -> AppCore {
        AppCore::with_config_manager(Arc::new(Mutex::new(ConfigManager::default())))
    }

    #[tokio::test]
    async fn shutdown_waits_for_lobby_without_holding_network() {
        let core = isolated_core();
        let lobby = core.get_lobby_manager();
        let network = core.get_network_service();
        let lobby_guard = lobby.lock().await;
        let mut leaving = Box::pin(core.leave_lobby_for_shutdown());

        poll_fn(|cx| {
            assert!(leaving.as_mut().poll(cx).is_pending());
            Poll::Ready(())
        })
        .await;

        assert!(
            network.try_lock().is_ok(),
            "shutdown must not lock network while waiting for lobby"
        );
        drop(lobby_guard);
        let result = tokio::time::timeout(Duration::from_secs(1), leaving)
            .await
            .expect("lobby shutdown helper must finish after the lobby lock is released");
        assert!(matches!(result, Err(LobbyError::NotInLobby)));
    }

    #[tokio::test]
    async fn queued_microphone_toggles_do_not_lose_updates() {
        let core = isolated_core();
        let voice = core.get_voice_service();
        let voice_guard = voice.lock().await;
        voice_guard.initialize().await.unwrap();
        let mut toggles = (0..20)
            .map(|_| Box::pin(core.toggle_mic()))
            .collect::<Vec<_>>();

        // Queue every toggle before releasing the service, so read/relock code
        // would allow all requests to observe the same initial value.
        for toggle in &mut toggles {
            poll_fn(|cx| {
                assert!(toggle.as_mut().poll(cx).is_pending());
                Poll::Ready(())
            })
            .await;
        }
        drop(voice_guard);

        let results = futures_util::future::join_all(toggles).await;
        let enabled = results
            .into_iter()
            .map(Result::unwrap)
            .filter(|value| *value)
            .count();
        assert_eq!(enabled, 10);
        assert!(!voice.lock().await.is_mic_enabled());
    }

    #[tokio::test]
    async fn ordinary_service_waits_do_not_hold_the_core_gate() {
        let state = crate::modules::tauri_commands::AppState {
            core: Arc::new(Mutex::new(isolated_core())),
        };
        let config = state.config_manager().await;
        let config_guard = config.lock().await;
        let mut waiting = Box::pin(async {
            let config = state.config_manager().await;
            let _guard = config.lock().await;
        });

        poll_fn(|cx| {
            assert!(waiting.as_mut().poll(cx).is_pending());
            Poll::Ready(())
        })
        .await;

        assert!(
            state.core.try_lock().is_ok(),
            "waiting for configuration must not retain the core lifecycle gate"
        );
        drop(waiting);
        drop(config_guard);
    }

    #[tokio::test]
    async fn test_app_core_initialization() {
        // 测试应用核心初始化
        let app_core = AppCore::new().await;
        assert!(app_core.is_ok(), "应用核心初始化应该成功");

        let app_core = app_core.unwrap();
        let state = app_core.get_state().await;
        assert_eq!(state, AppState::Idle, "初始状态应该是 Idle");
    }

    #[tokio::test]
    async fn test_app_core_start() {
        // 测试应用启动
        let app_core = AppCore::new().await.unwrap();
        let result = app_core.start().await;
        assert!(result.is_ok(), "应用启动应该成功");
    }

    #[tokio::test]
    #[ignore = "requires an isolated host: stops EasyTier and updates system hosts/config"]
    async fn test_app_core_shutdown() {
        // 测试应用关闭
        let app_core = AppCore::new().await.unwrap();
        app_core.start().await.unwrap();

        let result = app_core.shutdown().await;
        assert!(result.is_ok(), "应用关闭应该成功");

        let state = app_core.get_state().await;
        assert_eq!(state, AppState::Idle, "关闭后状态应该是 Idle");
    }

    #[tokio::test]
    async fn test_state_transitions() {
        // 测试状态转换
        let app_core = AppCore::new().await.unwrap();

        // 初始状态
        assert_eq!(app_core.get_state().await, AppState::Idle);

        // 设置为连接中
        app_core.set_state(AppState::Connecting).await;
        assert_eq!(app_core.get_state().await, AppState::Connecting);

        // 设置为在大厅中
        app_core.set_state(AppState::InLobby).await;
        assert_eq!(app_core.get_state().await, AppState::InLobby);

        // 设置为错误状态
        app_core
            .set_state(AppState::Error("测试错误".to_string()))
            .await;
        assert_eq!(
            app_core.get_state().await,
            AppState::Error("测试错误".to_string())
        );
    }

    #[tokio::test]
    async fn test_module_references() {
        // 测试模块引用获取
        let app_core = AppCore::new().await.unwrap();

        // 获取各个模块的引用
        let lobby_manager = app_core.get_lobby_manager();
        let network_service = app_core.get_network_service();
        let voice_service = app_core.get_voice_service();
        let config_manager = app_core.get_config_manager();

        // 验证可以锁定这些引用
        assert!(lobby_manager.try_lock().is_ok());
        assert!(network_service.try_lock().is_ok());
        assert!(voice_service.try_lock().is_ok());
        assert!(config_manager.try_lock().is_ok());
    }
}
