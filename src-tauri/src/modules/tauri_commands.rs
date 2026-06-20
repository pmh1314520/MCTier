// Tauri Command 接口模块
// 提供前端调用的所有命令接口

use tauri::State;
use tauri::Emitter;
use tauri::Manager;
use crate::modules::app_core::{AppCore, AppState as CoreAppState};
use crate::modules::lobby_manager::{Lobby, Player};
use crate::modules::voice_service::AudioDevice;
use crate::modules::config_manager::UserConfig;
use std::sync::Arc;
use std::sync::OnceLock;
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::sync::Mutex;

/// 远程文件下载的取消标志注册表（task_id -> 取消标志）
fn download_cancels() -> &'static dashmap::DashMap<String, Arc<AtomicBool>> {
    static CANCELS: OnceLock<dashmap::DashMap<String, Arc<AtomicBool>>> = OnceLock::new();
    CANCELS.get_or_init(dashmap::DashMap::new)
}

/// 应用状态包装器（用于 Tauri State）
pub struct AppState {
    pub core: Arc<Mutex<AppCore>>,
}

// ==================== 大厅操作命令 ====================

/// 创建大厅
/// 
/// # 参数
/// * `name` - 大厅名称
/// * `password` - 大厅密码
/// * `player_name` - 玩家名称
/// * `player_id` - 玩家ID（由前端生成）
/// * `server_node` - 服务器节点地址
/// * `signaling_server` - 信令服务器地址
/// 
/// # 返回
/// * `Ok(Lobby)` - 成功创建的大厅信息
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn create_lobby(
    name: String,
    password: String,
    player_name: String,
    player_id: String,
    server_node: String,
    signaling_server: String,
    use_domain: Option<bool>,
    virtual_domain: Option<String>,
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Lobby, String> {
    log::info!("收到创建大厅命令: name={}, player={}, player_id={}, signaling_server={}, use_domain={:?}, virtual_domain={:?}", name, player_name, player_id, signaling_server, use_domain, virtual_domain);
    
    let core = state.core.lock().await;
    
    // 更新应用状态为连接中
    core.set_state(CoreAppState::Connecting).await;
    
    // 【关键修复】在这里读取配置，避免在 start_easytier 中再次获取 core 的锁
    let (global_config, lobby_config) = {
        let config_manager = core.get_config_manager();
        let cfg_mgr = config_manager.lock().await;
        let user_config = cfg_mgr.get_config();
        
        let global_cfg = user_config.global_easytier_advanced_config.clone();
        let lobby_cfg = user_config.lobby_easytier_advanced_config.clone();
        
        (global_cfg, lobby_cfg)
    };
    
    // 获取各个服务的引用
    let lobby_manager = core.get_lobby_manager();
    let network_service = core.get_network_service();
    let file_transfer = core.get_file_transfer();
    let chat_service = core.get_chat_service();
    
    // 释放 core 的锁，避免死锁
    drop(core);
    
    // 创建大厅
    let mut lobby_mgr = lobby_manager.lock().await;
    let network_svc = network_service.lock().await;
    
    match lobby_mgr.create_lobby_with_config(
        name,
        password,
        player_name.clone(),
        server_node,
        signaling_server.clone(),
        use_domain.unwrap_or(false),
        virtual_domain,
        &*network_svc,
        &app_handle,
        global_config,
        lobby_config,
    ).await {
        Ok(lobby) => {
            log::info!("大厅创建成功: {}", lobby.name);
            
            // 输出序列化后的JSON用于调试
            if let Ok(json) = serde_json::to_string(&lobby) {
                log::info!("大厅JSON: {}", json);
            }
            
            // 获取虚拟IP
            let virtual_ip = lobby.virtual_ip.clone();
            drop(lobby_mgr);
            drop(network_svc);
            
            log::info!("使用前端提供的玩家ID: {}", player_id);
            
            // 所有客户端都连接到官方 WebSockets 信令服务器 (wss://mctier.pmhs.top/signaling)
            log::info!("客户端将连接到官方 WebSockets 信令服务器: wss://mctier.pmhs.top/signaling");
            
            // 不再在创建大厅时自动启动HTTP文件服务器
            // HTTP服务器将在第一次添加共享时按需启动
            log::info!("📝 HTTP文件服务器将在添加共享时按需启动");
            let ft_service = file_transfer.lock().await;
            ft_service.set_virtual_ip(virtual_ip.clone());
            drop(ft_service);
            
            // 启动P2P聊天服务器
            log::info!("正在启动P2P聊天服务器...");
            let chat_svc = chat_service.lock().await;
            chat_svc.set_virtual_ip(virtual_ip.clone());
            match chat_svc.start_server().await {
                Ok(_) => {
                    log::info!("✅ P2P聊天服务器启动成功");
                }
                Err(e) => {
                    log::error!("❌ P2P聊天服务器启动失败: {}", e);
                }
            }
            drop(chat_svc);
            
            // 更新应用状态为在大厅中
            let core = state.core.lock().await;
            core.set_state(CoreAppState::InLobby).await;
            drop(core);
            
            Ok(lobby)
        }
        Err(e) => {
            log::error!("创建大厅失败: {}", e);
            
            // 更新应用状态为错误
            let core = state.core.lock().await;
            core.set_state(CoreAppState::Error(e.to_string())).await;
            drop(core);
            
            Err(e.to_string())
        }
    }
}

/// 加入大厅
/// 
/// # 参数
/// * `name` - 大厅名称
/// * `password` - 大厅密码
/// * `player_name` - 玩家名称
/// * `player_id` - 玩家ID（由前端生成）
/// * `server_node` - 服务器节点地址
/// * `signaling_server` - 信令服务器地址
/// 
/// # 返回
/// * `Ok(Lobby)` - 成功加入的大厅信息
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn join_lobby(
    name: String,
    password: String,
    player_name: String,
    player_id: String,
    server_node: String,
    signaling_server: String,
    use_domain: Option<bool>,
    virtual_domain: Option<String>,
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Lobby, String> {
    log::info!("收到加入大厅命令: name={}, player={}, player_id={}, signaling_server={}, use_domain={:?}, virtual_domain={:?}", name, player_name, player_id, signaling_server, use_domain, virtual_domain);
    
    let core = state.core.lock().await;
    
    // 更新应用状态为连接中
    core.set_state(CoreAppState::Connecting).await;
    
    // 【关键修复】在这里读取配置，避免在 start_easytier 中再次获取 core 的锁
    let (global_config, lobby_config) = {
        let config_manager = core.get_config_manager();
        let cfg_mgr = config_manager.lock().await;
        let user_config = cfg_mgr.get_config();
        
        let global_cfg = user_config.global_easytier_advanced_config.clone();
        let lobby_cfg = user_config.lobby_easytier_advanced_config.clone();
        
        (global_cfg, lobby_cfg)
    };
    
    // 获取各个服务的引用
    let lobby_manager = core.get_lobby_manager();
    let network_service = core.get_network_service();
    let voice_service = core.get_voice_service();
    let p2p_signaling = core.get_p2p_signaling();
    let file_transfer = core.get_file_transfer();
    let chat_service = core.get_chat_service();
    
    // 释放 core 的锁，避免死锁
    drop(core);
    
    // 加入大厅
    let mut lobby_mgr = lobby_manager.lock().await;
    let network_svc = network_service.lock().await;
    
    match lobby_mgr.join_lobby_with_config(
        name,
        password,
        player_name.clone(),
        server_node,
        signaling_server.clone(),
        use_domain.unwrap_or(false),
        virtual_domain,
        &*network_svc,
        &app_handle,
        global_config,
        lobby_config,
    ).await {
        Ok(lobby) => {
            log::info!("成功加入大厅: {}", lobby.name);
            
            // 初始化语音服务
            let voice_svc = voice_service.lock().await;
            if let Err(e) = voice_svc.initialize().await {
                log::warn!("语音服务初始化失败: {}", e);
                // 语音服务失败不应该阻止加入大厅
            }
            drop(voice_svc);
            
            // 获取虚拟IP（用于P2P信令服务和HTTP文件服务器）
            let virtual_ip = lobby.virtual_ip.clone();
            drop(lobby_mgr);
            drop(network_svc);
            
            log::info!("使用前端提供的玩家ID: {}", player_id);
            
            // 所有客户端都连接到官方 WebSockets 信令服务器 (wss://mctier.pmhs.top/signaling)
            log::info!("客户端将连接到官方 WebSockets 信令服务器: wss://mctier.pmhs.top/signaling");
            
            // 启动P2P信令服务
            log::info!("正在启动P2P信令服务（加入大厅）...");
            let p2p_svc = p2p_signaling.lock().await;
            match p2p_svc.start(player_id, player_name, virtual_ip.clone()).await {
                Ok(_) => {
                    log::info!("✅ P2P信令服务启动成功（加入大厅）");
                }
                Err(e) => {
                    log::error!("❌ 启动P2P信令服务失败（加入大厅）: {}", e);
                    // P2P信令服务启动失败应该返回错误，因为没有它就无法发现其他玩家
                    drop(p2p_svc);
                    let core = state.core.lock().await;
                    core.set_state(CoreAppState::Error(format!("P2P信令服务启动失败: {}", e))).await;
                    drop(core);
                    return Err(format!("P2P信令服务启动失败: {}", e));
                }
            }
            drop(p2p_svc);
            
            // 不再在加入大厅时自动启动HTTP文件服务器
            // HTTP服务器将在第一次添加共享时按需启动
            log::info!("📝 HTTP文件服务器将在添加共享时按需启动");
            let ft_service = file_transfer.lock().await;
            ft_service.set_virtual_ip(virtual_ip.clone());
            drop(ft_service);
            
            // 启动P2P聊天服务器
            log::info!("正在启动P2P聊天服务器...");
            let chat_svc = chat_service.lock().await;
            chat_svc.set_virtual_ip(virtual_ip.clone());
            match chat_svc.start_server().await {
                Ok(_) => {
                    log::info!("✅ P2P聊天服务器启动成功");
                }
                Err(e) => {
                    log::error!("❌ P2P聊天服务器启动失败: {}", e);
                }
            }
            drop(chat_svc);
            
            // 更新应用状态为在大厅中
            let core = state.core.lock().await;
            core.set_state(CoreAppState::InLobby).await;
            drop(core);
            
            Ok(lobby)
        }
        Err(e) => {
            log::error!("加入大厅失败: {}", e);
            
            // 更新应用状态为错误
            let core = state.core.lock().await;
            core.set_state(CoreAppState::Error(e.to_string())).await;
            drop(core);
            
            Err(e.to_string())
        }
    }
}

/// 退出大厅
/// 
/// # 返回
/// * `Ok(())` - 成功退出
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn leave_lobby(state: State<'_, AppState>) -> Result<(), String> {
    log::info!("收到退出大厅命令");
    
    let core = state.core.lock().await;
    
    // 获取各个服务的引用
    let lobby_manager = core.get_lobby_manager();
    let network_service = core.get_network_service();
    let voice_service = core.get_voice_service();
    let p2p_signaling = core.get_p2p_signaling();
    let file_transfer = core.get_file_transfer();
    
    // 【修复】尽早释放 core 锁，避免在数秒级的 stop_easytier（netsh/pnputil/PowerShell）
    // 期间一直占用 core 锁，导致其它命令阻塞、界面卡死
    drop(core);
    
    // 停止HTTP文件服务器
    let ft_service = file_transfer.lock().await;
    ft_service.stop_server().await;
    drop(ft_service);
    
    // 停止P2P信令服务
    let p2p_svc = p2p_signaling.lock().await;
    if let Err(e) = p2p_svc.stop().await {
        log::warn!("停止P2P信令服务失败: {}", e);
    }
    drop(p2p_svc);
    
    // 清理语音服务
    let voice_svc = voice_service.lock().await;
    if let Err(e) = voice_svc.cleanup().await {
        log::warn!("清理语音服务时发生错误: {}", e);
    }
    drop(voice_svc);
    
    // 退出大厅
    let mut lobby_mgr = lobby_manager.lock().await;
    let network_svc = network_service.lock().await;
    
    match lobby_mgr.leave_lobby(&*network_svc).await {
        Ok(_) => {
            log::info!("成功退出大厅");
            drop(lobby_mgr);
            drop(network_svc);
            
            // 更新应用状态为空闲（重新短暂加锁）
            let core = state.core.lock().await;
            core.set_state(CoreAppState::Idle).await;
            drop(core);
            
            Ok(())
        }
        Err(e) => {
            log::error!("退出大厅失败: {}", e);
            Err(e.to_string())
        }
    }
}

// ==================== 语音控制命令 ====================

/// 切换麦克风状态
/// 
/// # 返回
/// * `Ok(bool)` - 新的麦克风状态（true=开启，false=关闭）
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn toggle_mic(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<bool, String> {
    log::info!("收到切换麦克风命令");
    
    let core = state.core.lock().await;
    
    // 使用 AppCore 的 toggle_mic 方法，它会正确处理状态切换
    match core.toggle_mic().await {
        Ok(new_state) => {
            log::info!("麦克风状态已切换: {}", new_state);
            
            // 发送事件到前端更新UI
            if let Err(e) = app.emit("mic-toggled", new_state) {
                log::error!("发送麦克风状态事件失败: {}", e);
            }
            
            Ok(new_state)
        }
        Err(e) => {
            log::error!("切换麦克风失败: {}", e);
            Err(e.to_string())
        }
    }
}

/// 静音或取消静音指定玩家
/// 
/// # 参数
/// * `player_id` - 玩家 ID
/// * `muted` - true=静音，false=取消静音
/// 
/// # 返回
/// * `Ok(())` - 操作成功
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn mute_player(
    player_id: String,
    muted: bool,
    state: State<'_, AppState>,
) -> Result<(), String> {
    log::info!("收到静音玩家命令: player_id={}, muted={}", player_id, muted);
    
    let core = state.core.lock().await;
    let voice_service = core.get_voice_service();
    let voice_svc = voice_service.lock().await;
    
    match voice_svc.mute_player(&player_id, muted).await {
        Ok(_) => {
            log::info!("玩家 {} 静音状态已更新: {}", player_id, muted);
            Ok(())
        }
        Err(e) => {
            log::error!("更新玩家静音状态失败: {}", e);
            Err(e.to_string())
        }
    }
}

/// 全局静音或取消静音所有玩家
/// 
/// # 参数
/// * `muted` - true=静音所有玩家，false=取消静音所有玩家
/// 
/// # 返回
/// * `Ok(())` - 操作成功
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn mute_all(muted: bool, state: State<'_, AppState>) -> Result<(), String> {
    log::info!("收到全局静音命令: muted={}", muted);
    
    let core = state.core.lock().await;
    let voice_service = core.get_voice_service();
    let voice_svc = voice_service.lock().await;
    
    match voice_svc.mute_all(muted).await {
        Ok(_) => {
            log::info!("全局静音状态已更新: {}", muted);
            Ok(())
        }
        Err(e) => {
            log::error!("更新全局静音状态失败: {}", e);
            Err(e.to_string())
        }
    }
}

// ==================== 配置管理命令 ====================

/// 获取用户配置
/// 
/// # 返回
/// * `Ok(UserConfig)` - 用户配置
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn get_config(state: State<'_, AppState>) -> Result<UserConfig, String> {
    log::info!("收到获取配置命令");
    
    let core = state.core.lock().await;
    let config_manager = core.get_config_manager();
    let config_mgr = config_manager.lock().await;
    
    let config = config_mgr.get_config_clone();
    
    log::debug!("返回配置: {:?}", config);
    
    Ok(config)
}

/// 更新用户配置
/// 
/// # 参数
/// * `config` - 新的用户配置
/// 
/// # 返回
/// * `Ok(())` - 更新成功
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn update_config(
    config: UserConfig,
    state: State<'_, AppState>,
) -> Result<(), String> {
    log::info!("收到更新配置命令");
    
    let core = state.core.lock().await;
    let config_manager = core.get_config_manager();
    let mut config_mgr = config_manager.lock().await;
    
    match config_mgr.update_config(|cfg| {
        *cfg = config.clone();
    }).await {
        Ok(_) => {
            log::info!("配置已更新");
            Ok(())
        }
        Err(e) => {
            log::error!("更新配置失败: {}", e);
            Err(e.to_string())
        }
    }
}

/// 保存窗口透明度
/// 
/// # 参数
/// * `opacity` - 透明度值 (0.0-1.0)
/// 
/// # 返回
/// * `Ok(())` - 保存成功
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn save_opacity(
    opacity: f64,
    state: State<'_, AppState>,
) -> Result<(), String> {
    log::info!("收到保存透明度命令: {}", opacity);
    
    let core = state.core.lock().await;
    let config_manager = core.get_config_manager();
    let mut config_mgr = config_manager.lock().await;
    
    match config_mgr.set_opacity(opacity).await {
        Ok(_) => {
            log::info!("透明度已保存: {}", opacity);
            Ok(())
        }
        Err(e) => {
            log::error!("保存透明度失败: {}", e);
            Err(e.to_string())
        }
    }
}

// ==================== 系统信息命令 ====================

/// 获取可用的音频设备列表
/// 
/// # 返回
/// * `Ok(Vec<AudioDevice>)` - 音频设备列表
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn get_audio_devices(state: State<'_, AppState>) -> Result<Vec<AudioDevice>, String> {
    log::info!("收到获取音频设备命令");
    
    let core = state.core.lock().await;
    let voice_service = core.get_voice_service();
    let voice_svc = voice_service.lock().await;
    
    let devices = voice_svc.get_audio_devices().await;
    
    log::info!("返回 {} 个音频设备", devices.len());
    
    Ok(devices)
}

/// 获取当前应用状态
/// 
/// # 返回
/// * `Ok(String)` - 应用状态的字符串表示
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn get_app_state(state: State<'_, AppState>) -> Result<String, String> {
    let core = state.core.lock().await;
    let app_state = core.get_state().await;
    Ok(format!("{:?}", app_state))
}

/// 获取当前大厅信息
/// 
/// # 返回
/// * `Ok(Option<Lobby>)` - 当前大厅信息，如果未加入大厅则返回 None
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn get_current_lobby(state: State<'_, AppState>) -> Result<Option<Lobby>, String> {
    log::info!("收到获取当前大厅命令");
    
    let core = state.core.lock().await;
    let lobby_manager = core.get_lobby_manager();
    let lobby_mgr = lobby_manager.lock().await;
    
    let lobby = lobby_mgr.get_current_lobby().cloned();
    
    Ok(lobby)
}

/// 获取玩家列表
/// 
/// # 返回
/// * `Ok(Vec<Player>)` - 玩家列表
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn get_players(state: State<'_, AppState>) -> Result<Vec<Player>, String> {
    log::info!("收到获取玩家列表命令");
    
    let core = state.core.lock().await;
    let lobby_manager = core.get_lobby_manager();
    let lobby_mgr = lobby_manager.lock().await;
    
    let players = lobby_mgr.get_players();
    
    log::info!("返回 {} 个玩家", players.len());
    
    Ok(players)
}

/// 获取麦克风状态
/// 
/// # 返回
/// * `Ok(bool)` - 麦克风状态（true=开启，false=关闭）
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn get_mic_status(state: State<'_, AppState>) -> Result<bool, String> {
    let core = state.core.lock().await;
    let voice_service = core.get_voice_service();
    let voice_svc = voice_service.lock().await;
    
    let status = voice_svc.is_mic_enabled();
    
    Ok(status)
}

/// 获取全局静音状态
/// 
/// # 返回
/// * `Ok(bool)` - 全局静音状态（true=静音，false=未静音）
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn get_global_mute_status(state: State<'_, AppState>) -> Result<bool, String> {
    let core = state.core.lock().await;
    let voice_service = core.get_voice_service();
    let voice_svc = voice_service.lock().await;
    
    let status = voice_svc.is_global_muted();
    
    Ok(status)
}

/// 检查玩家是否被静音
/// 
/// # 参数
/// * `player_id` - 玩家 ID
/// 
/// # 返回
/// * `Ok(bool)` - 是否被静音（true=静音，false=未静音）
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn is_player_muted(
    player_id: String,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    let core = state.core.lock().await;
    let voice_service = core.get_voice_service();
    let voice_svc = voice_service.lock().await;
    
    let is_muted = voice_svc.is_player_muted(&player_id).await;
    
    Ok(is_muted)
}

/// 保存窗口位置
/// 
/// # 参数
/// * `x` - X 坐标
/// * `y` - Y 坐标
/// * `width` - 窗口宽度
/// * `height` - 窗口高度
/// 
/// # 返回
/// * `Ok(())` - 保存成功
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn save_window_position(
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    state: State<'_, AppState>,
) -> Result<(), String> {
    use crate::modules::config_manager::WindowPosition;
    
    log::info!("保存窗口位置: x={}, y={}, width={}, height={}", x, y, width, height);
    
    let core = state.core.lock().await;
    let config_manager = core.get_config_manager();
    let mut cfg_mgr = config_manager.lock().await;
    
    // 检查是否启用了记住窗口位置
    let remember = cfg_mgr.get_config().remember_window_position.unwrap_or(false);
    
    if remember {
        let position = WindowPosition { x, y, width, height };
        cfg_mgr.set_window_position(position).await
            .map_err(|e| format!("保存窗口位置失败: {}", e))?;
        log::info!("窗口位置已保存");
    } else {
        log::debug!("未启用记住窗口位置，跳过保存");
    }
    
    Ok(())
}

/// 退出应用程序
/// 
/// # 返回
/// * `Ok(())` - 退出成功
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn exit_app(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    log::info!("收到退出应用命令");
    
    // 先清理资源
    let core = state.core.lock().await;
    
    // 如果在大厅中，先退出大厅
    let lobby_manager = core.get_lobby_manager();
    let lobby_mgr = lobby_manager.lock().await;
    if lobby_mgr.get_current_lobby().is_some() {
        drop(lobby_mgr);
        let network_service = core.get_network_service();
        let voice_service = core.get_voice_service();
        
        // 清理语音服务
        let voice_svc = voice_service.lock().await;
        if let Err(e) = voice_svc.cleanup().await {
            log::warn!("清理语音服务时发生错误: {}", e);
        }
        drop(voice_svc);
        
        // 退出大厅
        let mut lobby_mgr = lobby_manager.lock().await;
        let network_svc = network_service.lock().await;
        if let Err(e) = lobby_mgr.leave_lobby(&*network_svc).await {
            log::warn!("退出大厅时发生错误: {}", e);
        }
    }
    
    drop(core);
    
    log::info!("资源清理完成，正在退出应用...");
    
    // 退出应用
    app.exit(0);
    
    Ok(())
}

/// 获取网络连接状态
/// 
/// # 返回
/// * `Ok(String)` - 连接状态的 JSON 字符串
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn get_network_status(state: State<'_, AppState>) -> Result<String, String> {
    let core = state.core.lock().await;
    let network_service = core.get_network_service();
    let network_svc = network_service.lock().await;
    
    let status = network_svc.check_connection().await;
    
    match serde_json::to_string(&status) {
        Ok(json) => Ok(json),
        Err(e) => Err(format!("序列化连接状态失败: {}", e)),
    }
}

/// 获取虚拟 IP 地址
/// 
/// # 返回
/// * `Ok(Option<String>)` - 虚拟 IP 地址，如果未连接则返回 None
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn get_virtual_ip(state: State<'_, AppState>) -> Result<Option<String>, String> {
    let core = state.core.lock().await;
    let network_service = core.get_network_service();
    let network_svc = network_service.lock().await;
    
    let ip = network_svc.get_virtual_ip().await;
    
    Ok(ip)
}

/// 对等连接类型（虚拟IP -> p2p/relay）
#[derive(serde::Serialize)]
pub struct PeerConnType {
    pub ip: String,
    #[serde(rename = "connType")]
    pub conn_type: String,
}

/// 查询大厅内各对等节点的连接类型（P2P 直连 / 中继）。
/// 通过 easytier-cli 连接 easytier-core 的 RPC 端口获取 peer 路由，cost==1 即 P2P 直连。
#[tauri::command]
pub async fn get_peer_connection_types(
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<PeerConnType>, String> {
    // 取当前 RPC 端口
    let rpc_port = {
        let core = state.core.lock().await;
        let ns = core.get_network_service();
        let svc = ns.lock().await;
        svc.get_rpc_port().await
    };
    let port = match rpc_port {
        Some(p) => p,
        None => return Ok(vec![]),
    };

    let cli_path = crate::modules::resource_manager::ResourceManager::get_easytier_cli_path(&app_handle)
        .map_err(|e| format!("获取 easytier-cli 失败: {}", e))?;

    let mut cmd = tokio::process::Command::new(&cli_path);
    cmd.args(["-p", &format!("127.0.0.1:{}", port), "-o", "json", "peer"]);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let output = tokio::time::timeout(std::time::Duration::from_secs(5), cmd.output())
        .await
        .map_err(|_| "easytier-cli 查询超时".to_string())?
        .map_err(|e| format!("运行 easytier-cli 失败: {}", e))?;
    if !output.status.success() {
        return Ok(vec![]);
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let parsed: serde_json::Value = serde_json::from_str(stdout.trim()).unwrap_or(serde_json::Value::Null);

    // 递归收集所有含 ipv4 + cost 的对象（兼容单/多实例的 JSON 结构）
    let mut result: Vec<PeerConnType> = Vec::new();
    fn walk(v: &serde_json::Value, out: &mut Vec<PeerConnType>) {
        match v {
            serde_json::Value::Array(arr) => arr.iter().for_each(|x| walk(x, out)),
            serde_json::Value::Object(map) => {
                let ip = map.get("ipv4").and_then(|x| x.as_str()).unwrap_or("");
                let cost = map.get("cost").and_then(|x| x.as_str());
                if let (false, Some(cost)) = (ip.is_empty(), cost) {
                    if !cost.eq_ignore_ascii_case("local") {
                        let conn = if cost.eq_ignore_ascii_case("p2p") { "p2p" } else { "relay" };
                        out.push(PeerConnType { ip: ip.to_string(), conn_type: conn.to_string() });
                    }
                }
                // 继续向下遍历（多实例结构里 peer 列表可能在子字段）
                map.values().for_each(|x| walk(x, out));
            }
            _ => {}
        }
    }
    walk(&parsed, &mut result);
    // 去重（同一 IP 保留首个）
    let mut seen = std::collections::HashSet::new();
    result.retain(|e| seen.insert(e.ip.clone()));
    Ok(result)
}

// ==================== 窗口控制命令 ====================

/// 设置窗口置顶状态
/// 
/// # 参数
/// * `always_on_top` - true=置顶，false=取消置顶
/// 
/// # 返回
/// * `Ok(())` - 操作成功
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn set_always_on_top(
    always_on_top: bool,
    window: tauri::Window,
) -> Result<(), String> {
    log::info!("设置窗口置顶状态: {}", always_on_top);
    
    window
        .set_always_on_top(always_on_top)
        .map_err(|e| format!("设置窗口置顶失败: {}", e))?;
    
    Ok(())
}

/// 切换迷你模式
/// 
/// # 参数
/// * `mini_mode` - true=迷你模式，false=正常模式
/// 
/// # 返回
/// * `Ok(())` - 操作成功
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn toggle_mini_mode(
    mini_mode: bool,
    window: tauri::Window,
) -> Result<(), String> {
    log::info!("切换迷你模式: {}", mini_mode);
    
    if mini_mode {
        // 迷你模式：小窗口 + 置顶
        window
            .set_size(tauri::Size::Physical(tauri::PhysicalSize {
                width: 320,
                height: 480,
            }))
            .map_err(|e| format!("设置窗口大小失败: {}", e))?;
        
        window
            .set_always_on_top(true)
            .map_err(|e| format!("设置窗口置顶失败: {}", e))?;
        
        window
            .set_resizable(false)
            .map_err(|e| format!("设置窗口不可调整大小失败: {}", e))?;
    } else {
        // 正常模式：恢复原始大小 + 取消置顶
        window
            .set_size(tauri::Size::Physical(tauri::PhysicalSize {
                width: 1000,
                height: 700,
            }))
            .map_err(|e| format!("设置窗口大小失败: {}", e))?;
        
        window
            .set_always_on_top(false)
            .map_err(|e| format!("取消窗口置顶失败: {}", e))?;
        
        window
            .set_resizable(true)
            .map_err(|e| format!("设置窗口可调整大小失败: {}", e))?;
    }
    
    Ok(())
}

/// 设置窗口透明度
/// 
/// # 参数
/// * `opacity` - 透明度值（0.0-1.0）
/// 
/// # 返回
/// * `Ok(())` - 操作成功
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn set_window_opacity(
    opacity: f64,
    window: tauri::Window,
) -> Result<(), String> {
    let clamped_opacity = opacity.max(0.3).min(1.0);

    // 注意：不再使用 WS_EX_LAYERED + SetLayeredWindowAttributes(LWA_ALPHA)。
    // 该方式会用“整窗统一 alpha”覆盖 Tauri 的逐像素真透明（transparent:true），
    // 导致窗口无法真正透明（圆角/留白处看不到桌面）。
    // 透明度改由前端 CSS（.mini-window 背景 rgba 的 alpha）实现，可保留真透明。
    // 这里仅广播事件，保持兼容。
    window
        .emit("opacity-changed", clamped_opacity)
        .map_err(|e| format!("发送透明度事件失败: {}", e))?;
    Ok(())
}


// ==================== WebRTC 语音通信命令 ====================

/// 发送信令消息
/// 
/// # 参数
/// * `message` - 信令消息内容（JSON格式）
/// 
/// # 返回
/// * `Ok(())` - 发送成功
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn send_signaling_message(
    message: serde_json::Value,
    state: State<'_, AppState>,
) -> Result<(), String> {
    log::info!("收到信令消息: {:?}", message);
    
    let core = state.core.lock().await;
    let p2p_signaling = core.get_p2p_signaling();
    let p2p_svc = p2p_signaling.lock().await;
    
    // 解析信令消息
    let msg_type = message.get("type").and_then(|v| v.as_str()).unwrap_or("");
    let from = message.get("from").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let to = message.get("to").and_then(|v| v.as_str());
    
    let p2p_message = match msg_type {
        "offer" => {
            let sdp = message.get("sdp").and_then(|v| v.as_str()).unwrap_or("").to_string();
            crate::modules::p2p_signaling::P2PMessage::Offer { from, sdp }
        }
        "answer" => {
            let sdp = message.get("sdp").and_then(|v| v.as_str()).unwrap_or("").to_string();
            crate::modules::p2p_signaling::P2PMessage::Answer { from, sdp }
        }
        "ice-candidate" => {
            let candidate = message.get("candidate").and_then(|v| v.as_str()).unwrap_or("").to_string();
            crate::modules::p2p_signaling::P2PMessage::IceCandidate { from, candidate }
        }
        _ => {
            return Err("未知的信令消息类型".to_string());
        }
    };
    
    // 发送消息
    if let Some(target) = to {
        p2p_svc.send_to_player(target, p2p_message).await
            .map_err(|e| e.to_string())?;
    } else {
        p2p_svc.broadcast_to_all(p2p_message).await
            .map_err(|e| e.to_string())?;
    }
    
    log::debug!("信令消息已处理");
    Ok(())
}

/// 广播状态更新
/// 
/// # 参数
/// * `player_id` - 玩家ID
/// * `mic_enabled` - 麦克风状态
/// 
/// # 返回
/// * `Ok(())` - 广播成功
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn broadcast_status_update(
    player_id: String,
    mic_enabled: bool,
    state: State<'_, AppState>,
) -> Result<(), String> {
    log::info!("广播状态更新: player={}, mic={}", player_id, mic_enabled);
    
    let core = state.core.lock().await;
    let p2p_signaling = core.get_p2p_signaling();
    let p2p_svc = p2p_signaling.lock().await;
    
    // 创建状态更新消息
    let message = crate::modules::p2p_signaling::P2PMessage::StatusUpdate {
        player_id,
        mic_enabled,
    };
    
    // 广播消息
    p2p_svc.broadcast_to_all(message).await
        .map_err(|e| e.to_string())?;
    
    log::debug!("状态更新已广播");
    Ok(())
}

/// 发送心跳
/// 
/// # 参数
/// * `player_id` - 玩家ID
/// * `timestamp` - 时间戳
/// 
/// # 返回
/// * `Ok(())` - 发送成功
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn send_heartbeat(
    player_id: String,
    timestamp: i64,
    state: State<'_, AppState>,
) -> Result<(), String> {
    log::debug!("收到心跳: player={}, timestamp={}", player_id, timestamp);
    
    let core = state.core.lock().await;
    let voice_service = core.get_voice_service();
    let voice_svc = voice_service.lock().await;
    
    voice_svc.send_heartbeat(&player_id).await
        .map_err(|e| e.to_string())?;
    
    log::debug!("心跳已发送");
    Ok(())
}


// ==================== 网络管理命令 ====================

/// 强制停止所有EasyTier进程
/// 
/// 在创建或加入大厅前调用，确保没有残留的EasyTier进程
/// 
/// # 返回
/// * `Ok(())` - 停止成功
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn force_stop_easytier(state: State<'_, AppState>) -> Result<(), String> {
    log::info!("🔧 收到强制停止EasyTier进程命令");
    
    let core = state.core.lock().await;
    let network_service = core.get_network_service();
    let network_svc = network_service.lock().await;
    
    // 调用NetworkService的stop_easytier方法
    // 该方法已经包含了完整的清理逻辑：
    // 1. 优雅关闭进程（SIGTERM）
    // 2. 强制终止（taskkill /F）
    // 3. 清理虚拟网卡
    // 4. 刷新DNS缓存
    match network_svc.stop_easytier().await {
        Ok(_) => {
            log::info!("✅ EasyTier进程已强制停止并清理完成");
            Ok(())
        }
        Err(e) => {
            log::warn!("⚠️ 强制停止EasyTier进程时出现警告: {}", e);
            // 即使出现错误，也返回成功，因为可能只是没有进程在运行
            Ok(())
        }
    }
}

/// 【#4】取消创建/加入大厅过程中的连接（强制手动停止）
///
/// 关键点：create_lobby/join_lobby 在 start_easytier 的等待期间会一直持有
/// network_service 锁，因此不能通过会抢同一把锁的 force_stop_easytier 来取消。
/// 这里直接用 taskkill 终止 easytier-core 进程（不加任何锁），进程退出后
/// start_easytier 的进程监控任务会把 is_running 置为 false，等待循环随即
/// 返回错误，create_lobby/join_lobby 得以结束并释放锁。
#[tauri::command]
pub async fn cancel_lobby_connecting() -> Result<(), String> {
    log::info!("🛑 收到取消连接命令，直接终止 easytier-core 进程以解除阻塞");

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        for image in ["easytier-core.exe", "easytier-cli.exe"] {
            let _ = tokio::process::Command::new("taskkill")
                .args(["/F", "/IM", image])
                .creation_flags(CREATE_NO_WINDOW)
                .output()
                .await;
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = tokio::process::Command::new("pkill")
            .args(["-9", "-f", "easytier-core"])
            .output()
            .await;
    }

    log::info!("✅ 已发送终止信号给 easytier-core 进程");
    Ok(())
}

/// 【#14/#15/#16】客户端内一键更新：下载安装包到临时目录并运行，然后退出应用
///
/// * `url` - 最新安装包(.exe) 的直链地址
/// 下载过程通过 "update-download-progress" 事件向前端汇报进度。
#[tauri::command]
pub async fn download_and_run_installer(
    url: String,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    use tauri::Emitter;
    use tokio::io::AsyncWriteExt;
    use futures_util::StreamExt;

    log::info!("📥 开始客户端内更新，下载地址: {}", url);

    // 目标临时文件
    let mut tmp_path = std::env::temp_dir();
    tmp_path.push("MCTier_update_setup.exe");

    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(false)
        .build()
        .map_err(|e| format!("创建下载客户端失败: {}", e))?;

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("请求下载失败: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("下载失败，服务器返回状态: {}", resp.status()));
    }

    let total = resp.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;

    let mut file = tokio::fs::File::create(&tmp_path)
        .await
        .map_err(|e| format!("创建临时文件失败: {}", e))?;

    let mut stream = resp.bytes_stream();
    let mut last_emit = std::time::Instant::now();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("下载数据出错: {}", e))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("写入文件失败: {}", e))?;
        downloaded += chunk.len() as u64;

        // 限制事件频率，避免过于频繁
        if last_emit.elapsed().as_millis() >= 150 {
            let _ = app_handle.emit(
                "update-download-progress",
                serde_json::json!({ "downloaded": downloaded, "total": total }),
            );
            last_emit = std::time::Instant::now();
        }
    }
    file.flush().await.map_err(|e| format!("刷新文件失败: {}", e))?;
    drop(file);

    // 最终进度
    let _ = app_handle.emit(
        "update-download-progress",
        serde_json::json!({ "downloaded": downloaded, "total": total }),
    );

    log::info!("✅ 安装包下载完成: {:?}（{} 字节）", tmp_path, downloaded);

    // 启动安装包（NSIS，currentUser 模式会自动覆盖安装并重启应用）
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new(&tmp_path)
            .spawn()
            .map_err(|e| format!("启动安装包失败: {}", e))?;
    }

    // 稍作延迟后退出应用，让安装程序接管覆盖文件
    let ah = app_handle.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(tokio::time::Duration::from_millis(800)).await;
        ah.exit(0);
    });

    Ok(())
}

// ==================== 网络诊断命令 ====================

/// 检查虚拟网卡是否存在
/// 
/// # 返回
/// * `Ok(bool)` - true 表示虚拟网卡存在
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn check_virtual_adapter() -> Result<bool, String> {
    log::info!("检查虚拟网卡...");
    
    #[cfg(windows)]
    {
        use std::process::Command;
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        
        // 使用 ipconfig 命令查找 EasyTier 创建的虚拟网卡
        let output = Command::new("ipconfig")
            .arg("/all")
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|e| format!("执行 ipconfig 失败: {}", e))?;
        
        let output_str = String::from_utf8_lossy(&output.stdout);
        
        // 查找包含 "EasyTier" 或 "WinTun" 的网卡
        let has_adapter = output_str.contains("EasyTier") || 
                         output_str.contains("WinTun") ||
                         output_str.contains("wintun");
        
        log::info!("虚拟网卡检查结果: {}", has_adapter);
        Ok(has_adapter)
    }
    
    #[cfg(not(windows))]
    {
        // 非 Windows 平台暂不支持
        Ok(true)
    }
}

/// 检查防火墙规则
/// 
/// # 返回
/// * `Ok(bool)` - true 表示防火墙规则正常
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn check_firewall_rules() -> Result<bool, String> {
    log::info!("检查防火墙规则...");
    
    #[cfg(windows)]
    {
        use std::process::Command;
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        
        // 检查 Windows 防火墙是否已存在 MCTier 的放行规则
        // 注意：必须与 add_firewall_rules 中添加的规则名保持一致
        let output = Command::new("netsh")
            .args(&["advfirewall", "firewall", "show", "rule", "name=all"])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|e| format!("执行 netsh 失败: {}", e))?;
        
        let output_str = String::from_utf8_lossy(&output.stdout);
        
        // 检查是否存在 MCTier 自身添加的放行规则
        // add_firewall_rules 添加的规则名为：MCTier-in/-out、MCTier-EasyTier-in/-out
        let has_rules = output_str.contains("MCTier");
        
        log::info!("防火墙规则检查结果: {}", has_rules);
        Ok(has_rules)
    }
    
    #[cfg(not(windows))]
    {
        Ok(true)
    }
}

/// 查询当前是否以管理员身份运行
#[tauri::command]
pub async fn is_admin() -> bool {
    #[cfg(windows)]
    {
        use windows::Win32::Foundation::HANDLE;
        use windows::Win32::Security::{GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY};
        use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};
        unsafe {
            let mut token: HANDLE = HANDLE::default();
            if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token).is_err() {
                return false;
            }
            let mut elevation = TOKEN_ELEVATION { TokenIsElevated: 0 };
            let mut ret_len = 0u32;
            let ok = GetTokenInformation(
                token,
                TokenElevation,
                Some(&mut elevation as *mut _ as *mut _),
                std::mem::size_of::<TOKEN_ELEVATION>() as u32,
                &mut ret_len,
            );
            ok.is_ok() && elevation.TokenIsElevated != 0
        }
    }
    #[cfg(not(windows))]
    {
        true
    }
}

/// 一键添加防火墙放行规则（按程序放行，覆盖该程序所有端口）
///
/// 为 MCTier 主程序与 easytier-core 添加入站/出站允许规则。需要管理员权限。
#[tauri::command]
pub async fn add_firewall_rules(app_handle: tauri::AppHandle) -> Result<String, String> {
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        // 收集要放行的程序路径：MCTier 主程序 + easytier-core
        let mut programs: Vec<(String, std::path::PathBuf)> = Vec::new();
        if let Ok(exe) = std::env::current_exe() {
            programs.push(("MCTier".to_string(), exe));
        }
        if let Ok(et) = crate::modules::resource_manager::ResourceManager::get_easytier_path(&app_handle) {
            programs.push(("MCTier-EasyTier".to_string(), et));
        }

        if programs.is_empty() {
            return Err("无法确定程序路径".to_string());
        }

        let mut added = 0;
        let mut last_err = String::new();
        for (base_name, path) in &programs {
            let path_str = path.to_string_lossy().to_string();
            for (suffix, dir) in [("-in", "in"), ("-out", "out")] {
                let rule_name = format!("{}{}", base_name, suffix);
                // 先删除同名旧规则避免重复堆积
                let _ = tokio::process::Command::new("netsh")
                    .args(&["advfirewall", "firewall", "delete", "rule", &format!("name={}", rule_name)])
                    .creation_flags(CREATE_NO_WINDOW)
                    .output()
                    .await;

                let output = tokio::process::Command::new("netsh")
                    .args(&[
                        "advfirewall", "firewall", "add", "rule",
                        &format!("name={}", rule_name),
                        &format!("dir={}", dir),
                        "action=allow",
                        &format!("program={}", path_str),
                        "enable=yes",
                        "profile=any",
                    ])
                    .creation_flags(CREATE_NO_WINDOW)
                    .output()
                    .await
                    .map_err(|e| format!("执行 netsh 失败: {}", e))?;

                if output.status.success() {
                    added += 1;
                } else {
                    last_err = String::from_utf8_lossy(&output.stderr).to_string();
                    if last_err.trim().is_empty() {
                        last_err = String::from_utf8_lossy(&output.stdout).to_string();
                    }
                }
            }
        }

        if added > 0 {
            log::info!("✅ 已添加 {} 条防火墙放行规则", added);
            Ok(format!("已添加 {} 条防火墙放行规则", added))
        } else {
            Err(format!("添加防火墙规则失败（可能需要管理员权限）: {}", last_err))
        }
    }
    #[cfg(not(windows))]
    {
        let _ = app_handle;
        Ok("非 Windows 平台无需配置防火墙".to_string())
    }
}

/// 以管理员身份重启应用
#[tauri::command]
pub async fn restart_as_admin(app_handle: tauri::AppHandle) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        let exe = std::env::current_exe().map_err(|e| format!("无法获取程序路径: {}", e))?;
        let exe_str = exe.to_string_lossy().replace('\'', "''");

        // 用 PowerShell 以管理员身份(RunAs)重新启动
        let spawn = std::process::Command::new("powershell")
            .args(&[
                "-NoProfile",
                "-WindowStyle", "Hidden",
                "-Command",
                &format!("Start-Process -FilePath '{}' -Verb RunAs", exe_str),
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn();

        match spawn {
            Ok(_) => {
                log::info!("已请求以管理员身份重启，当前实例即将退出");
                // 稍等片刻让新进程的 UAC 弹出
                tokio::time::sleep(std::time::Duration::from_millis(600)).await;
                app_handle.exit(0);
                Ok(())
            }
            Err(e) => Err(format!("以管理员身份重启失败: {}", e)),
        }
    }
    #[cfg(not(windows))]
    {
        let _ = app_handle;
        Err("当前平台不支持".to_string())
    }
}
/// 
/// # 参数
/// * `ip` - 要 ping 的 IP 地址
/// 
/// # 返回
/// * `Ok(bool)` - true 表示可以 ping 通
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn ping_virtual_ip(ip: String) -> Result<bool, String> {
    log::info!("Ping 虚拟 IP: {}", ip);
    
    use std::process::Command;
    
    #[cfg(windows)]
    let output = {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        Command::new("ping")
            .args(&["-n", "2", "-w", "1000", &ip])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|e| format!("执行 ping 失败: {}", e))?
    };
    
    #[cfg(not(windows))]
    let output = Command::new("ping")
        .args(&["-c", "2", "-W", "1", &ip])
        .output()
        .map_err(|e| format!("执行 ping 失败: {}", e))?;
    
    let success = output.status.success();
    log::info!("Ping 结果: {}", success);
    
    Ok(success)
}

/// 检查 UDP 端口是否可用
/// 
/// # 参数
/// * `port` - 要检查的端口号
/// 
/// # 返回
/// * `Ok(bool)` - true 表示端口可用
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn check_udp_port(port: u16) -> Result<bool, String> {
    log::info!("检查 UDP 端口: {}", port);
    
    use std::net::UdpSocket;
    
    // 尝试绑定端口
    match UdpSocket::bind(format!("0.0.0.0:{}", port)) {
        Ok(_) => {
            log::info!("UDP 端口 {} 可用", port);
            Ok(true)
        }
        Err(e) => {
            log::warn!("UDP 端口 {} 不可用: {}", port, e);
            Ok(false)
        }
    }
}

// ==================== 系统设置命令 ====================

/// 设置开机自启动
/// 
/// # 参数
/// * `enable` - true=启用自启动，false=禁用自启动
/// 
/// # 返回
/// * `Ok(())` - 操作成功
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn set_auto_start(enable: bool) -> Result<(), String> {
    log::info!("设置开机自启动: {}", enable);

    #[cfg(windows)]
    {
        use std::process::Command;
        use std::os::windows::process::CommandExt;
        let app_name = "MCTier";
        let app_path = std::env::current_exe()
            .map_err(|e| format!("获取程序路径失败: {}", e))?
            .to_string_lossy()
            .replace("/", "\\");

        if enable {
            // 获取exe所在目录
            let exe_dir = std::path::Path::new(&app_path)
                .parent()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();
            
            // 使用 PowerShell 的 -WindowStyle Hidden 参数实现完全无窗口启动
            // 同时设置工作目录，确保便携版能找到资源文件
            let reg_value = format!(
                "powershell -WindowStyle Hidden -Command \"Set-Location '{}'; Start-Process '{}'\"",
                exe_dir.replace("\\", "\\\\"),
                app_path.replace("\\", "\\\\")
            );
            
            let output = Command::new("reg")
                .args([
                    "add",
                    "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
                    "/v", app_name,
                    "/t", "REG_SZ",
                    "/d", &reg_value,
                    "/f",
                ])
                .creation_flags(0x08000000)
                .output()
                .map_err(|e| format!("写入注册表失败: {}", e))?;

            if !output.status.success() {
                let error = String::from_utf8_lossy(&output.stderr);
                log::error!("写入注册表开机自启失败: {}", error);
                return Err(format!("写入注册表失败: {}", error));
            }
            log::info!("开机自启动已启用（无窗口模式），路径: {}", app_path);
            Ok(())
        } else {
            // 删除注册表项
            let output = Command::new("reg")
                .args([
                    "delete",
                    "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
                    "/v", app_name,
                    "/f",
                ])
                .creation_flags(0x08000000)
                .output()
                .map_err(|e| format!("删除注册表失败: {}", e))?;

            if !output.status.success() {
                log::warn!("删除注册表开机自启项时出现警告（可能本就不存在）");
            }
            
            log::info!("开机自启动已禁用");
            Ok(())
        }
    }

    #[cfg(not(windows))]
    {
        log::warn!("当前平台不支持开机自启动设置");
        Err("当前平台不支持开机自启动设置".to_string())
    }
}

/// 检查开机自启动状态
///
/// # 返回
/// * `Ok(bool)` - true=已启用，false=未启用
#[tauri::command]
pub async fn check_auto_start() -> Result<bool, String> {
    log::info!("检查开机自启动状态");

    #[cfg(windows)]
    {
        use std::process::Command;
        use std::os::windows::process::CommandExt;
        let app_name = "MCTier";
        let output = Command::new("reg")
            .args([
                "query",
                "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
                "/v", app_name,
            ])
            .creation_flags(0x08000000)
            .output()
            .map_err(|e| format!("查询注册表失败: {}", e))?;

        let is_enabled = output.status.success();
        log::info!("开机自启动状态（注册表）: {}", is_enabled);
        Ok(is_enabled)
    }

    #[cfg(not(windows))]
    {
        Ok(false)
    }
}

// ==================== Magic DNS 命令 ====================

/// 添加玩家域名映射到hosts文件
/// 
/// # 参数
/// * `domain` - 域名（如：qyzz.mct.net）
/// * `ip` - 虚拟IP地址
/// * `state` - 应用状态
/// 
/// # 返回
/// * `Ok(())` - 添加成功
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn add_player_domain(
    domain: String,
    ip: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    log::info!("收到添加玩家域名映射命令: {} -> {}", domain, ip);
    
    let core = state.core.lock().await;
    let lobby_manager = core.get_lobby_manager();
    let manager = lobby_manager.lock().await;
    
    // 获取当前大厅信息
    let lobby_name = if let Some(lobby) = manager.get_current_lobby() {
        lobby.name.clone()
    } else {
        log::warn!("⚠️ 当前不在大厅中，无法添加域名映射");
        return Err("当前不在大厅中".to_string());
    };
    
    // 获取或创建HostsManager
    let hosts_manager = if let Some(hm) = manager.get_hosts_manager() {
        // 已存在，直接使用
        hm.add_entry(&domain, &ip)
            .map_err(|e| format!("添加域名映射失败: {}", e))?;
        
        log::info!("✅ 域名映射已添加: {} -> {}", domain, ip);
        Ok(())
    } else {
        // 不存在，动态创建
        log::info!("📝 HostsManager不存在，动态创建...");
        drop(manager); // 释放锁，以便调用set_hosts_manager
        
        let new_hosts_manager = crate::modules::hosts_manager::HostsManager::new(&lobby_name);
        new_hosts_manager.add_entry(&domain, &ip)
            .map_err(|e| format!("添加域名映射失败: {}", e))?;
        
        // 重新获取锁并设置HostsManager
        let mut manager = lobby_manager.lock().await;
        manager.set_hosts_manager(Some(new_hosts_manager));
        
        log::info!("✅ 域名映射已添加（动态创建HostsManager）: {} -> {}", domain, ip);
        Ok(())
    };
    
    hosts_manager
}

/// 删除玩家域名映射
/// 
/// # 参数
/// * `domain` - 要删除的域名
/// * `state` - 应用状态
/// 
/// # 返回
/// * `Ok(())` - 删除成功
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn remove_player_domain(
    domain: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    log::info!("收到删除玩家域名映射命令: {}", domain);
    
    let core = state.core.lock().await;
    let lobby_manager = core.get_lobby_manager();
    let manager = lobby_manager.lock().await;
    
    // 获取HostsManager
    if let Some(hosts_manager) = manager.get_hosts_manager() {
        hosts_manager.remove_entry(&domain)
            .map_err(|e| format!("删除域名映射失败: {}", e))?;
        
        log::info!("✅ 域名映射已删除: {}", domain);
        Ok(())
    } else {
        // HostsManager不存在，说明没有域名映射需要删除，直接返回成功
        log::info!("⚠️ HostsManager不存在，跳过删除域名映射");
        Ok(())
    }
}


// ==================== 文件共享操作命令 ====================

use serde::{Deserialize, Serialize};
use std::path::Path;

/// 文件信息结构
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileInfo {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub size: u64,
    pub modified_time: u64,
}

/// 获取文件夹名称
///
/// # 参数
/// * `path` - 文件夹路径
///
/// # 返回
/// * `Ok(String)` - 文件夹名称
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn get_folder_name(path: String) -> Result<String, String> {
    log::info!("获取文件夹名称: {}", path);
    
    let path_obj = Path::new(&path);
    
    if let Some(name) = path_obj.file_name() {
        if let Some(name_str) = name.to_str() {
            Ok(name_str.to_string())
        } else {
            Err("无法转换文件夹名称".to_string())
        }
    } else {
        Err("无效的文件夹路径".to_string())
    }
}

/// 获取文件夹信息（文件数量和总大小）
///
/// # 参数
/// * `path` - 文件夹路径
///
/// # 返回
/// * `Ok((file_count, total_size))` - 文件数量和总大小
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn get_folder_info(path: String) -> Result<serde_json::Value, String> {
    log::info!("获取文件夹信息: {}", path);
    
    let path_obj = Path::new(&path);
    
    if !path_obj.exists() {
        return Err("文件夹不存在".to_string());
    }
    
    if !path_obj.is_dir() {
        return Err("路径不是文件夹".to_string());
    }
    
    let (file_count, total_size) = count_files_and_size(path_obj)
        .map_err(|e| format!("统计文件失败: {}", e))?;
    
    Ok(serde_json::json!({
        "fileCount": file_count,
        "totalSize": total_size,
    }))
}

/// 递归统计文件数量和总大小
fn count_files_and_size(path: &Path) -> std::io::Result<(usize, u64)> {
    let mut file_count = 0;
    let mut total_size = 0;
    
    if path.is_file() {
        file_count = 1;
        total_size = path.metadata()?.len();
    } else if path.is_dir() {
        for entry in std::fs::read_dir(path)? {
            let entry = entry?;
            let entry_path = entry.path();
            
            let (count, size) = count_files_and_size(&entry_path)?;
            file_count += count;
            total_size += size;
        }
    }
    
    Ok((file_count, total_size))
}

/// 列出目录中的文件和文件夹
///
/// # 参数
/// * `path` - 目录路径
///
/// # 返回
/// * `Ok(Vec<FileInfo>)` - 文件列表
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn list_directory_files(path: String) -> Result<Vec<FileInfo>, String> {
    log::info!("📂 列出目录文件: {}", path);
    
    let path_obj = Path::new(&path);
    
    if !path_obj.exists() {
        log::error!("❌ 目录不存在: {}", path);
        return Err("目录不存在".to_string());
    }
    
    if !path_obj.is_dir() {
        log::error!("❌ 路径不是目录: {}", path);
        return Err("路径不是目录".to_string());
    }
    
    let mut files = Vec::new();
    
    let entries = std::fs::read_dir(path_obj)
        .map_err(|e| format!("读取目录失败: {}", e))?;
    
    for entry in entries {
        let entry = entry.map_err(|e| format!("读取条目失败: {}", e))?;
        let entry_path = entry.path();
        
        let metadata = entry_path.metadata()
            .map_err(|e| format!("获取元数据失败: {}", e))?;
        
        let name = entry.file_name()
            .to_str()
            .unwrap_or("未知")
            .to_string();
        
        let relative_path = entry_path.strip_prefix(path_obj)
            .unwrap_or(&entry_path)
            .to_str()
            .unwrap_or("")
            .to_string();
        
        let modified_time = metadata.modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);
        
        let is_dir = metadata.is_dir();
        
        log::info!("  - {}: {} (is_directory: {})", 
            if is_dir { "📁" } else { "📄" }, 
            name, 
            is_dir
        );
        
        files.push(FileInfo {
            name,
            path: relative_path,
            is_directory: is_dir,
            size: metadata.len(),
            modified_time,
        });
    }
    
    // 按名称排序（文件夹在前）
    files.sort_by(|a, b| {
        if a.is_directory == b.is_directory {
            a.name.cmp(&b.name)
        } else if a.is_directory {
            std::cmp::Ordering::Less
        } else {
            std::cmp::Ordering::Greater
        }
    });
    
    log::info!("✅ 返回 {} 个文件/文件夹", files.len());
    
    Ok(files)
}

/// 读取文件内容（字节数组）
///
/// # 参数
/// * `path` - 文件路径
///
/// # 返回
/// * `Ok(Vec<u8>)` - 文件内容
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn read_file_bytes(path: String) -> Result<Vec<u8>, String> {
    log::info!("读取文件: {}", path);
    
    let path_obj = Path::new(&path);
    
    if !path_obj.exists() {
        return Err("文件不存在".to_string());
    }
    
    if !path_obj.is_file() {
        return Err("路径不是文件".to_string());
    }
    
    std::fs::read(path_obj)
        .map_err(|e| format!("读取文件失败: {}", e))
}

/// 写入文件内容（字节数组）
///
/// # 参数
/// * `path` - 文件路径
/// * `data` - 文件内容
///
/// # 返回
/// * `Ok(())` - 写入成功
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn write_file_bytes(path: String, data: Vec<u8>) -> Result<(), String> {
    log::info!("写入文件: {} ({} 字节)", path, data.len());
    
    let path_obj = Path::new(&path);
    
    // 确保父目录存在
    if let Some(parent) = path_obj.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("创建目录失败: {}", e))?;
    }
    
    std::fs::write(path_obj, data)
        .map_err(|e| format!("写入文件失败: {}", e))
}

/// 选择文件夹
///
/// # 返回
/// * `Ok(Option<String>)` - 选择的文件夹路径，None表示取消
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn select_folder() -> Result<Option<String>, String> {
    log::info!("打开文件夹选择对话框");
    
    use rfd::FileDialog;
    
    let result = FileDialog::new()
        .set_title("选择要共享的文件夹")
        .pick_folder();
    
    if let Some(path) = result {
        if let Some(path_str) = path.to_str() {
            log::info!("用户选择了文件夹: {}", path_str);
            Ok(Some(path_str.to_string()))
        } else {
            Err("无法转换文件夹路径".to_string())
        }
    } else {
        log::info!("用户取消了选择");
        Ok(None)
    }
}

/// 选择保存位置
///
/// # 参数
/// * `default_name` - 默认文件名
///
/// # 返回
/// * `Ok(Option<String>)` - 选择的保存路径，None表示取消
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn select_save_location(default_name: String) -> Result<Option<String>, String> {
    log::info!("打开保存位置选择对话框: {}", default_name);
    
    use rfd::FileDialog;
    
    let result = FileDialog::new()
        .set_title("选择保存位置")
        .set_file_name(&default_name)
        .save_file();
    
    if let Some(path) = result {
        if let Some(path_str) = path.to_str() {
            log::info!("用户选择了保存位置: {}", path_str);
            Ok(Some(path_str.to_string()))
        } else {
            Err("无法转换保存路径".to_string())
        }
    } else {
        log::info!("用户取消了选择");
        Ok(None)
    }
}

/// 选择文件
///
/// # 返回
/// * `Ok(Option<String>)` - 选择的文件路径，None表示取消
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn select_file() -> Result<Option<String>, String> {
    log::info!("打开文件选择对话框");
    
    use rfd::FileDialog;
    
    let result = FileDialog::new()
        .set_title("选择配置文件")
        .add_filter("JSON 文件", &["json"])
        .pick_file();
    
    if let Some(path) = result {
        if let Some(path_str) = path.to_str() {
            log::info!("用户选择了文件: {}", path_str);
            Ok(Some(path_str.to_string()))
        } else {
            Err("无法转换文件路径".to_string())
        }
    } else {
        log::info!("用户取消了选择");
        Ok(None)
    }
}

/// 打开文件所在文件夹并选中文件
///
/// # 参数
/// * `path` - 文件的完整路径
///
/// # 返回
/// * `Ok(())` - 成功打开
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn open_file_location(path: String) -> Result<(), String> {
    log::info!("打开文件位置: {}", path);
    
    use std::process::Command;
    
    #[cfg(target_os = "windows")]
    {
        // Windows: 使用 explorer.exe /select,<path>
        match Command::new("explorer.exe")
            .args(&["/select,", &path])
            .spawn()
        {
            Ok(_) => {
                log::info!("成功打开文件位置");
                Ok(())
            }
            Err(e) => {
                log::error!("打开文件位置失败: {}", e);
                Err(format!("打开文件位置失败: {}", e))
            }
        }
    }
    
    #[cfg(target_os = "macos")]
    {
        // macOS: 使用 open -R <path>
        match Command::new("open")
            .args(&["-R", &path])
            .spawn()
        {
            Ok(_) => {
                log::info!("成功打开文件位置");
                Ok(())
            }
            Err(e) => {
                log::error!("打开文件位置失败: {}", e);
                Err(format!("打开文件位置失败: {}", e))
            }
        }
    }
    
    #[cfg(target_os = "linux")]
    {
        // Linux: 使用 xdg-open 打开父目录
        use std::path::Path;
        let path_obj = Path::new(&path);
        if let Some(parent) = path_obj.parent() {
            if let Some(parent_str) = parent.to_str() {
                match Command::new("xdg-open")
                    .arg(parent_str)
                    .spawn()
                {
                    Ok(_) => {
                        log::info!("成功打开文件位置");
                        Ok(())
                    }
                    Err(e) => {
                        log::error!("打开文件位置失败: {}", e);
                        Err(format!("打开文件位置失败: {}", e))
                    }
                }
            } else {
                Err("无法转换父目录路径".to_string())
            }
        } else {
            Err("无法获取父目录".to_string())
        }
    }
    
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        Err("不支持的操作系统".to_string())
    }
}

/// 直接打开文件夹
///
/// # 参数
/// * `path` - 文件夹路径
///
/// # 返回
/// * `Ok(())` - 成功打开
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn open_folder(path: String) -> Result<(), String> {
    log::info!("打开文件夹: {}", path);
    
    use std::process::Command;
    
    #[cfg(target_os = "windows")]
    {
        // Windows: 直接使用 explorer.exe 打开文件夹
        match Command::new("explorer.exe")
            .arg(&path)
            .spawn()
        {
            Ok(_) => {
                log::info!("成功打开文件夹");
                Ok(())
            }
            Err(e) => {
                log::error!("打开文件夹失败: {}", e);
                Err(format!("打开文件夹失败: {}", e))
            }
        }
    }
    
    #[cfg(target_os = "macos")]
    {
        // macOS: 使用 open 打开文件夹
        match Command::new("open")
            .arg(&path)
            .spawn()
        {
            Ok(_) => {
                log::info!("成功打开文件夹");
                Ok(())
            }
            Err(e) => {
                log::error!("打开文件夹失败: {}", e);
                Err(format!("打开文件夹失败: {}", e))
            }
        }
    }
    
    #[cfg(target_os = "linux")]
    {
        // Linux: 使用 xdg-open 打开文件夹
        match Command::new("xdg-open")
            .arg(&path)
            .spawn()
        {
            Ok(_) => {
                log::info!("成功打开文件夹");
                Ok(())
            }
            Err(e) => {
                log::error!("打开文件夹失败: {}", e);
                Err(format!("打开文件夹失败: {}", e))
            }
        }
    }
    
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        Err("不支持的操作系统".to_string())
    }
}

// ==================== Rust高性能文件传输命令 ====================

// 注意：由于Rust文件传输模块的复杂性，暂时保留JavaScript实现
// 未来可以考虑完全迁移到Rust后端以获得更好的性能

// ==================== HTTP 文件共享命令 ====================

use crate::modules::file_transfer::{SharedFolder, FileInfo as FileTransferFileInfo};

/// 启动HTTP文件服务器
#[tauri::command]
pub async fn start_file_server(
    virtual_ip: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    log::info!("启动HTTP文件服务器: {}", virtual_ip);
    
    let core = state.core.lock().await;
    let file_transfer = core.get_file_transfer();
    let ft_service = file_transfer.lock().await;
    
    // 先尝试停止旧的服务器（如果存在）
    ft_service.stop_server().await;
    log::info!("已停止旧的HTTP文件服务器（如果存在）");
    
    // 等待端口完全释放
    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
    
    // 设置虚拟IP
    ft_service.set_virtual_ip(virtual_ip);
    
    // 启动服务器
    match ft_service.start_server().await {
        Ok(_) => {
            log::info!("✅ HTTP文件服务器启动成功");
            Ok(())
        }
        Err(e) => {
            log::error!("❌ HTTP文件服务器启动失败: {}", e);
            Err(e.to_string())
        }
    }
}

/// 停止HTTP文件服务器
#[tauri::command]
pub async fn stop_file_server(state: State<'_, AppState>) -> Result<(), String> {
    log::info!("停止HTTP文件服务器");
    
    let core = state.core.lock().await;
    let file_transfer = core.get_file_transfer();
    let ft_service = file_transfer.lock().await;
    
    ft_service.stop_server().await;
    log::info!("✅ HTTP文件服务器已停止");
    Ok(())
}

/// 检查HTTP文件服务器状态
#[tauri::command]
pub async fn check_file_server_status(state: State<'_, AppState>) -> Result<bool, String> {
    let core = state.core.lock().await;
    let file_transfer = core.get_file_transfer();
    let ft_service = file_transfer.lock().await;
    
    // 检查服务器句柄是否存在
    let is_running = ft_service.is_running();
    log::info!("📊 HTTP文件服务器状态: {}", if is_running { "运行中" } else { "未运行" });
    Ok(is_running)
}

/// 添加共享文件夹
#[tauri::command]
pub async fn add_shared_folder(
    share: SharedFolder,
    state: State<'_, AppState>,
) -> Result<(), String> {
    log::info!("📁 添加共享文件夹: {} ({})", share.name, share.id);
    
    let core = state.core.lock().await;
    let file_transfer = core.get_file_transfer();
    let ft_service = file_transfer.lock().await;
    
    // 检查HTTP服务器是否已启动
    let is_running = ft_service.is_running();
    
    if !is_running {
        log::info!("🚀 首次添加共享，启动HTTP文件服务器...");
        
        // 启动HTTP服务器
        match ft_service.start_server().await {
            Ok(_) => {
                log::info!("✅ HTTP文件服务器启动成功");
            }
            Err(e) => {
                log::error!("❌ HTTP文件服务器启动失败: {}", e);
                return Err(format!("启动HTTP文件服务器失败: {}", e));
            }
        }
    } else {
        log::info!("📡 HTTP文件服务器已在运行中");
    }
    
    // 添加共享
    ft_service.add_share(share)
}

/// 删除共享文件夹
#[tauri::command]
pub async fn remove_shared_folder(
    share_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    log::debug!("删除共享文件夹: {}", share_id);
    
    let core = state.core.lock().await;
    let file_transfer = core.get_file_transfer();
    let ft_service = file_transfer.lock().await;
    
    ft_service.remove_share(&share_id)
}

/// 获取本地共享列表
#[tauri::command]
pub async fn get_local_shares(state: State<'_, AppState>) -> Result<Vec<SharedFolder>, String> {
    let core = state.core.lock().await;
    let file_transfer = core.get_file_transfer();
    let ft_service = file_transfer.lock().await;
    
    Ok(ft_service.get_shares())
}

/// 清理过期共享
#[tauri::command]
pub async fn cleanup_expired_shares(state: State<'_, AppState>) -> Result<(), String> {
    log::debug!("清理过期共享");
    
    let core = state.core.lock().await;
    let file_transfer = core.get_file_transfer();
    let ft_service = file_transfer.lock().await;
    
    ft_service.cleanup_expired_shares();
    Ok(())
}

/// 获取远程共享列表（通过HTTP API）
#[tauri::command]
pub async fn get_remote_shares(peer_ip: String) -> Result<Vec<SharedFolder>, String> {
    log::debug!("📡 正在获取远程共享列表: {}", peer_ip);
    
    let url = format!("http://{}:14539/api/shares", peer_ip);
    log::info!("🔗 请求URL: {}", url);
    
    // 设置超时时间为5秒
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| {
            log::error!("❌ 创建HTTP客户端失败: {}", e);
            format!("创建HTTP客户端失败: {}", e)
        })?;
    
    match client.get(&url).send().await {
        Ok(response) => {
            let status = response.status();
            log::info!("📥 收到响应，状态码: {}", status);
            
            if !status.is_success() {
                log::error!("❌ HTTP请求失败，状态码: {}", status);
                return Err(format!("HTTP请求失败: {}", status));
            }
            
            match response.json::<serde_json::Value>().await {
                Ok(json) => {
                    log::info!("📦 响应JSON: {}", json);
                    
                    if let Some(shares) = json.get("shares") {
                        match serde_json::from_value::<Vec<SharedFolder>>(shares.clone()) {
                            Ok(shares_vec) => {
                                log::debug!("✅ 成功获取 {} 个共享", shares_vec.len());
                                for (i, share) in shares_vec.iter().enumerate() {
                                    log::debug!("  {}. {} (ID: {})", i + 1, share.name, share.id);
                                }
                                Ok(shares_vec)
                            }
                            Err(e) => {
                                log::error!("❌ 解析共享列表失败: {}", e);
                                Err(format!("解析共享列表失败: {}", e))
                            }
                        }
                    } else {
                        log::warn!("⚠️ 响应中没有shares字段，返回空列表");
                        Ok(Vec::new())
                    }
                }
                Err(e) => {
                    log::error!("❌ 解析响应JSON失败: {}", e);
                    Err(format!("解析响应失败: {}", e))
                }
            }
        }
        Err(e) => {
            log::error!("❌ HTTP请求失败: {}", e);
            log::error!("💡 可能原因:");
            log::error!("   1. 对方的HTTP文件服务器未启动");
            log::error!("   2. 虚拟网络连接不通（尝试ping {}）", peer_ip);
            log::error!("   3. 防火墙阻止了14539端口");
            log::error!("   4. 对方的虚拟IP地址不正确");
            Err(format!("请求失败: {}", e))
        }
    }
}

/// 获取远程文件列表
#[tauri::command]
pub async fn get_remote_files(
    peer_ip: String,
    share_id: String,
    path: Option<String>,
    password: Option<String>,
) -> Result<Vec<FileTransferFileInfo>, String> {
    log::info!("获取远程文件列表: {} / {} / {:?}", peer_ip, share_id, path);
    
    let mut url = format!("http://{}:14539/api/shares/{}/files", peer_ip, share_id);
    if let Some(p) = path {
        url = format!("{}?path={}", url, urlencoding::encode(&p));
    }
    
    let client = reqwest::Client::new();
    let mut req = client.get(&url);
    // 携带共享密码头，否则有密码保护的共享会返回 401
    if let Some(pwd) = password {
        if !pwd.is_empty() {
            req = req.header("x-share-password", pwd);
        }
    }
    
    match req.send().await {
        Ok(response) => {
            if response.status().as_u16() == 401 {
                return Err("访问被拒绝：密码错误或未提供密码".to_string());
            }
            match response.json::<serde_json::Value>().await {
                Ok(json) => {
                    if let Some(files) = json.get("files") {
                        match serde_json::from_value::<Vec<FileTransferFileInfo>>(files.clone()) {
                            Ok(files_vec) => {
                                log::info!("✅ 获取到 {} 个文件", files_vec.len());
                                Ok(files_vec)
                            }
                            Err(e) => {
                                log::error!("❌ 解析文件列表失败: {}", e);
                                Err(format!("解析文件列表失败: {}", e))
                            }
                        }
                    } else {
                        Ok(Vec::new())
                    }
                }
                Err(e) => {
                    log::error!("❌ 解析响应失败: {}", e);
                    Err(format!("解析响应失败: {}", e))
                }
            }
        }
        Err(e) => {
            log::error!("❌ 请求失败: {}", e);
            Err(format!("请求失败: {}", e))
        }
    }
}

/// 验证共享密码
#[tauri::command]
pub async fn verify_share_password(
    peer_ip: String,
    share_id: String,
    password: String,
) -> Result<bool, String> {
    log::debug!("验证共享密码: {} / {}", peer_ip, share_id);
    
    let url = format!("http://{}:14539/api/shares/{}/verify", peer_ip, share_id);
    let client = reqwest::Client::new();
    
    let body = serde_json::json!({
        "password": password
    });
    
    match client.post(&url).json(&body).send().await {
        Ok(response) => {
            match response.json::<serde_json::Value>().await {
                Ok(json) => {
                    if let Some(success) = json.get("success").and_then(|v| v.as_bool()) {
                        log::info!("✅ 密码验证结果: {}", success);
                        Ok(success)
                    } else {
                        Err("无效的响应格式".to_string())
                    }
                }
                Err(e) => {
                    log::error!("❌ 解析响应失败: {}", e);
                    Err(format!("解析响应失败: {}", e))
                }
            }
        }
        Err(e) => {
            log::error!("❌ 请求失败: {}", e);
            Err(format!("请求失败: {}", e))
        }
    }
}

/// 获取文件下载URL
#[tauri::command]
pub async fn get_download_url(
    peer_ip: String,
    share_id: String,
    file_path: String,
) -> Result<String, String> {
    let url = format!(
        "http://{}:14539/api/shares/{}/download/{}",
        peer_ip,
        share_id,
        urlencoding::encode(&file_path)
    );
    Ok(url)
}

/// 流式下载远程文件到本地磁盘（边下边写，避免大文件占满内存导致 OOM/卡死）
///
/// - 自动携带共享密码头（x-share-password），解决有密码共享下载失败的问题
/// - 通过 `download-progress` 事件上报进度（taskId/downloaded/total）
/// - 支持通过 `cancel_remote_download` 取消
#[tauri::command]
pub async fn download_remote_file(
    task_id: String,
    peer_ip: String,
    share_id: String,
    file_path: String,
    save_path: String,
    password: Option<String>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    use futures_util::StreamExt;
    use tokio::io::AsyncWriteExt;

    log::info!("⬇️ 开始流式下载: task={} {}/{} -> {}", task_id, peer_ip, share_id, save_path);

    let cancel_flag = Arc::new(AtomicBool::new(false));
    download_cancels().insert(task_id.clone(), cancel_flag.clone());

    // 用闭包包裹，确保无论成功失败都能清理取消标志
    let result: Result<(), String> = async {
        let url = format!(
            "http://{}:14539/api/shares/{}/download/{}",
            peer_ip,
            share_id,
            urlencoding::encode(&file_path)
        );

        let client = reqwest::Client::new();
        let mut req = client.get(&url);
        if let Some(pwd) = &password {
            if !pwd.is_empty() {
                req = req.header("x-share-password", pwd);
            }
        }

        let resp = req.send().await.map_err(|e| format!("请求失败: {}", e))?;
        let status = resp.status();
        if status.as_u16() == 401 {
            return Err("访问被拒绝：密码错误或未提供密码".to_string());
        }
        if !status.is_success() {
            return Err(format!("下载失败: HTTP {}", status));
        }

        let total = resp.content_length().unwrap_or(0);

        // 确保父目录存在
        if let Some(parent) = std::path::Path::new(&save_path).parent() {
            let _ = tokio::fs::create_dir_all(parent).await;
        }

        let mut file = tokio::fs::File::create(&save_path)
            .await
            .map_err(|e| format!("创建文件失败: {}", e))?;

        let mut downloaded: u64 = 0;
        let mut stream = resp.bytes_stream();
        let mut last_emit = std::time::Instant::now();

        while let Some(chunk) = stream.next().await {
            // 检查取消
            if cancel_flag.load(Ordering::Relaxed) {
                drop(file);
                let _ = tokio::fs::remove_file(&save_path).await;
                return Err("已取消".to_string());
            }

            let chunk = chunk.map_err(|e| format!("下载中断: {}", e))?;
            file.write_all(&chunk)
                .await
                .map_err(|e| format!("写入文件失败: {}", e))?;
            downloaded += chunk.len() as u64;

            // 每 200ms 上报一次进度
            if last_emit.elapsed().as_millis() >= 200 {
                let _ = app_handle.emit(
                    "download-progress",
                    serde_json::json!({
                        "taskId": task_id,
                        "downloaded": downloaded,
                        "total": total,
                    }),
                );
                last_emit = std::time::Instant::now();
            }
        }

        file.flush().await.map_err(|e| format!("刷新文件失败: {}", e))?;

        // 最后上报一次 100% 进度
        let _ = app_handle.emit(
            "download-progress",
            serde_json::json!({
                "taskId": task_id,
                "downloaded": downloaded,
                "total": if total == 0 { downloaded } else { total },
            }),
        );

        log::info!("✅ 流式下载完成: task={} ({} 字节)", task_id, downloaded);
        Ok(())
    }
    .await;

    download_cancels().remove(&task_id);
    result
}

/// 取消正在进行的远程文件下载
#[tauri::command]
pub fn cancel_remote_download(task_id: String) {
    if let Some(flag) = download_cancels().get(&task_id) {
        flag.store(true, Ordering::Relaxed);
        log::info!("🛑 已请求取消下载: {}", task_id);
    }
}

/// 流式批量打包下载：POST file_paths 到对端 batch-download，边收边写盘到 save_path
#[tauri::command]
pub async fn download_remote_batch(
    task_id: String,
    peer_ip: String,
    share_id: String,
    file_paths: Vec<String>,
    save_path: String,
    password: Option<String>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    use futures_util::StreamExt;
    use tokio::io::AsyncWriteExt;

    log::info!("⬇️ 开始流式批量下载: task={} {}/{} ({} 个文件)", task_id, peer_ip, share_id, file_paths.len());

    let cancel_flag = Arc::new(AtomicBool::new(false));
    download_cancels().insert(task_id.clone(), cancel_flag.clone());

    let result: Result<(), String> = async {
        let url = format!("http://{}:14539/api/shares/{}/batch-download", peer_ip, share_id);
        let client = reqwest::Client::new();
        let mut req = client
            .post(&url)
            .json(&serde_json::json!({ "file_paths": file_paths }));
        if let Some(pwd) = &password {
            if !pwd.is_empty() {
                req = req.header("x-share-password", pwd);
            }
        }

        let resp = req.send().await.map_err(|e| format!("请求失败: {}", e))?;
        let status = resp.status();
        if status.as_u16() == 401 {
            return Err("访问被拒绝：密码错误或未提供密码".to_string());
        }
        if !status.is_success() {
            return Err(format!("打包下载失败: HTTP {}", status));
        }

        let total = resp.content_length().unwrap_or(0);
        if let Some(parent) = std::path::Path::new(&save_path).parent() {
            let _ = tokio::fs::create_dir_all(parent).await;
        }
        let mut file = tokio::fs::File::create(&save_path)
            .await
            .map_err(|e| format!("创建文件失败: {}", e))?;

        let mut downloaded: u64 = 0;
        let mut stream = resp.bytes_stream();
        let mut last_emit = std::time::Instant::now();
        while let Some(chunk) = stream.next().await {
            if cancel_flag.load(Ordering::Relaxed) {
                drop(file);
                let _ = tokio::fs::remove_file(&save_path).await;
                return Err("已取消".to_string());
            }
            let chunk = chunk.map_err(|e| format!("下载中断: {}", e))?;
            file.write_all(&chunk).await.map_err(|e| format!("写入文件失败: {}", e))?;
            downloaded += chunk.len() as u64;
            if last_emit.elapsed().as_millis() >= 200 {
                let _ = app_handle.emit(
                    "download-progress",
                    serde_json::json!({ "taskId": task_id, "downloaded": downloaded, "total": total }),
                );
                last_emit = std::time::Instant::now();
            }
        }
        file.flush().await.map_err(|e| format!("刷新文件失败: {}", e))?;
        let _ = app_handle.emit(
            "download-progress",
            serde_json::json!({ "taskId": task_id, "downloaded": downloaded, "total": if total == 0 { downloaded } else { total } }),
        );
        log::info!("✅ 流式批量下载完成: task={} ({} 字节)", task_id, downloaded);
        Ok(())
    }
    .await;

    download_cancels().remove(&task_id);
    result
}

/// 节点延迟测试结果
#[derive(serde::Serialize)]
pub struct NodeLatencyResult {
    pub address: String,
    pub reachable: bool,
    pub latency_ms: Option<u64>,
}

/// 从节点地址解析出 host 和 port（best-effort）
fn parse_node_host_port(address: &str) -> Option<(String, u16)> {
    let trimmed = address.trim();
    // 去掉 scheme
    let (scheme, rest) = match trimmed.split_once("://") {
        Some((s, r)) => (s.to_lowercase(), r),
        None => ("".to_string(), trimmed),
    };
    // 去掉路径部分
    let host_port = rest.split('/').next().unwrap_or(rest);
    // 默认端口：wss/https->443, ws/http->80, 其它(tcp/udp)->11010
    let default_port: u16 = match scheme.as_str() {
        "wss" | "https" => 443,
        "ws" | "http" => 80,
        _ => 11010,
    };
    if let Some((h, p)) = host_port.rsplit_once(':') {
        // 处理 IPv6 不在此范围，简单处理
        if let Ok(port) = p.parse::<u16>() {
            return Some((h.to_string(), port));
        }
        return Some((host_port.to_string(), default_port));
    }
    if host_port.is_empty() {
        return None;
    }
    Some((host_port.to_string(), default_port))
}

/// 测试单个节点的延迟（通过 TCP 连接测时；连接成功或被拒绝都视为可达）
#[tauri::command]
pub async fn test_node_latency(address: String) -> NodeLatencyResult {
    use tokio::net::TcpStream;

    let (host, port) = match parse_node_host_port(&address) {
        Some(hp) => hp,
        None => {
            return NodeLatencyResult {
                address,
                reachable: false,
                latency_ms: None,
            }
        }
    };

    let start = std::time::Instant::now();
    let connect = TcpStream::connect((host.as_str(), port));
    match tokio::time::timeout(std::time::Duration::from_secs(3), connect).await {
        Ok(Ok(_stream)) => {
            // 连接成功 = 可达
            NodeLatencyResult {
                address,
                reachable: true,
                latency_ms: Some(start.elapsed().as_millis() as u64),
            }
        }
        Ok(Err(e)) => {
            // 连接被拒绝(ConnectionRefused)说明主机可达、端口未开（如UDP节点）
            let refused = e.kind() == std::io::ErrorKind::ConnectionRefused;
            NodeLatencyResult {
                address,
                reachable: refused,
                latency_ms: if refused {
                    Some(start.elapsed().as_millis() as u64)
                } else {
                    None
                },
            }
        }
        Err(_) => NodeLatencyResult {
            address,
            reachable: false,
            latency_ms: None,
        },
    }
}

/// 检测系统中正在运行的常见安全软件 / 杀毒软件（用于排障：被拦截是组网失败的常见原因）
///
/// 返回检测到的安全软件名称列表（中文友好名）。仅 Windows 有效。
#[tauri::command]
pub async fn detect_security_software() -> Vec<String> {
    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        // 进程名(小写) -> 友好名
        let known: &[(&str, &str)] = &[
            ("360tray.exe", "360安全卫士"),
            ("360safe.exe", "360安全卫士"),
            ("360sd.exe", "360杀毒"),
            ("zhudongfangyu.exe", "360主动防御"),
            ("huorong.exe", "火绒安全"),
            ("hipstray.exe", "火绒安全"),
            ("wsctrl.exe", "火绒安全"),
            ("qqpctray.exe", "腾讯电脑管家"),
            ("qqpcrtp.exe", "腾讯电脑管家"),
            ("kxetray.exe", "金山毒霸"),
            ("kxescore.exe", "金山毒霸"),
            ("ksafe.exe", "金山卫士"),
            ("baidusdtray.exe", "百度卫士"),
            ("avp.exe", "卡巴斯基"),
            ("avgui.exe", "AVG"),
            ("avastui.exe", "Avast"),
            ("msmpeng.exe", "Windows Defender"),
            ("nortonsecurity.exe", "诺顿"),
            ("mcshield.exe", "McAfee"),
            ("ecls.exe", "ESET NOD32"),
            ("egui.exe", "ESET NOD32"),
        ];

        let output = tokio::process::Command::new("tasklist")
            .args(&["/fo", "csv", "/nh"])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .await;

        let mut detected: Vec<String> = Vec::new();
        if let Ok(out) = output {
            // tasklist 输出可能是 GBK，这里用 lossy 处理；进程名是 ASCII，匹配不受影响
            let text = String::from_utf8_lossy(&out.stdout).to_lowercase();
            for (proc_name, friendly) in known {
                if text.contains(proc_name) {
                    let f = friendly.to_string();
                    if !detected.contains(&f) {
                        detected.push(f);
                    }
                }
            }
        }
        detected
    }

    #[cfg(not(target_os = "windows"))]
    {
        Vec::new()
    }
}

/// 一键导出日志：将日志目录打包为 zip，返回生成的 zip 路径
#[tauri::command]
pub async fn export_logs(_app_handle: tauri::AppHandle) -> Result<String, String> {
    // 日志目录：%LOCALAPPDATA%/MCTier（与 get_log_file_path 保持一致）
    let log_dir = dirs::data_local_dir()
        .map(|d| d.join("MCTier"))
        .ok_or_else(|| "无法获取日志目录".to_string())?;

    if !log_dir.exists() {
        return Err("日志目录不存在".to_string());
    }

    // 输出到桌面（无法获取时回退到日志目录）
    let out_dir = dirs::desktop_dir().unwrap_or_else(|| log_dir.clone());

    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let zip_path = out_dir.join(format!("MCTier_logs_{}.zip", ts));

    // 在阻塞线程里打包，避免阻塞异步运行时
    let log_dir_clone = log_dir.clone();
    let zip_path_clone = zip_path.clone();
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        let zip_file = std::fs::File::create(&zip_path_clone)
            .map_err(|e| format!("创建zip失败: {}", e))?;
        let mut zip = zip::ZipWriter::new(zip_file);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated)
            .compression_level(Some(6));

        let entries = std::fs::read_dir(&log_dir_clone)
            .map_err(|e| format!("读取日志目录失败: {}", e))?;
        let mut count = 0;
        for entry in entries.flatten() {
            let path = entry.path();
            // 只打包日志相关文件（.log / .txt），跳过子目录与其它文件
            let is_log = path
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.eq_ignore_ascii_case("log") || e.eq_ignore_ascii_case("txt"))
                .unwrap_or(false);
            if path.is_file() && is_log {
                let name = entry.file_name().to_string_lossy().to_string();
                if let Ok(mut f) = std::fs::File::open(&path) {
                    if zip.start_file(name, options).is_ok() {
                        let _ = std::io::copy(&mut f, &mut zip);
                        count += 1;
                    }
                }
            }
        }
        zip.finish().map_err(|e| format!("完成zip失败: {}", e))?;
        if count == 0 {
            return Err("没有可导出的日志文件".to_string());
        }
        Ok(())
    })
    .await
    .map_err(|e| format!("打包任务失败: {}", e))??;

    Ok(zip_path.to_string_lossy().to_string())
}

/// 诊断文件共享连接
/// 
/// # 参数
/// * `peer_ip` - 对方的虚拟IP
/// 
/// # 返回
/// * `Ok(String)` - 诊断结果（JSON格式）
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn diagnose_file_share_connection(peer_ip: String) -> Result<String, String> {
    log::info!("🔍 开始诊断文件共享连接: {}", peer_ip);
    
    let mut results = serde_json::json!({
        "peer_ip": peer_ip,
        "tests": []
    });
    
    // 测试1: Ping虚拟IP
    log::info!("📡 测试1: Ping虚拟IP...");
    let ping_result = ping_virtual_ip(peer_ip.clone()).await;
    let ping_success = ping_result.is_ok() && ping_result.unwrap_or(false);
    results["tests"].as_array_mut().unwrap().push(serde_json::json!({
        "name": "Ping虚拟IP",
        "success": ping_success,
        "message": if ping_success {
            "✅ 虚拟网络连接正常"
        } else {
            "❌ 无法ping通虚拟IP，虚拟网络可能未连接"
        }
    }));
    
    // 测试2: 检查HTTP服务器端口
    log::info!("🔌 测试2: 检查HTTP服务器端口...");
    let url = format!("http://{}:14539/api/shares", peer_ip);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .map_err(|e| format!("创建HTTP客户端失败: {}", e))?;
    
    let http_result = client.get(&url).send().await;
    let http_message = if http_result.is_ok() {
        "✅ HTTP文件服务器可访问".to_string()
    } else {
        format!("❌ 无法连接HTTP服务器: {}", http_result.as_ref().err().unwrap())
    };
    
    results["tests"].as_array_mut().unwrap().push(serde_json::json!({
        "name": "HTTP服务器连接",
        "success": http_result.is_ok(),
        "message": http_message
    }));
    
    // 测试3: 获取共享列表
    if http_result.is_ok() {
        log::info!("📋 测试3: 获取共享列表...");
        match get_remote_shares(peer_ip.clone()).await {
            Ok(shares) => {
                results["tests"].as_array_mut().unwrap().push(serde_json::json!({
                    "name": "获取共享列表",
                    "success": true,
                    "message": format!("✅ 成功获取 {} 个共享", shares.len())
                }));
            }
            Err(e) => {
                results["tests"].as_array_mut().unwrap().push(serde_json::json!({
                    "name": "获取共享列表",
                    "success": false,
                    "message": format!("❌ 获取共享列表失败: {}", e)
                }));
            }
        }
    }
    
    log::info!("✅ 诊断完成");
    
    Ok(serde_json::to_string_pretty(&results).unwrap())
}

// ==================== 文件下载命令 ====================

/// 解压ZIP文件到指定目录
/// 
/// # 参数
/// * `zip_path` - ZIP文件路径
/// * `extract_dir` - 解压目标目录
/// 
/// # 返回
/// * `Ok(Vec<String>)` - 解压的文件列表
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn extract_zip(zip_path: String, extract_dir: String) -> Result<Vec<String>, String> {
    log::info!("📦 解压ZIP文件: {} -> {}", zip_path, extract_dir);
    
    use std::fs::File;
    use std::path::Path;
    use zip::ZipArchive;
    
    // 打开ZIP文件
    let file = File::open(&zip_path)
        .map_err(|e| format!("打开ZIP文件失败: {}", e))?;
    
    let mut archive = ZipArchive::new(file)
        .map_err(|e| format!("读取ZIP文件失败: {}", e))?;
    
    let mut extracted_files = Vec::new();
    
    // 解压所有文件
    for i in 0..archive.len() {
        let mut file = archive.by_index(i)
            .map_err(|e| format!("读取ZIP条目失败: {}", e))?;
        
        let outpath = Path::new(&extract_dir).join(file.name());
        
        if file.is_dir() {
            log::info!("📁 创建目录: {:?}", outpath);
            std::fs::create_dir_all(&outpath)
                .map_err(|e| format!("创建目录失败: {}", e))?;
        } else {
            log::info!("📄 解压文件: {:?}", outpath);
            
            // 确保父目录存在
            if let Some(parent) = outpath.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("创建父目录失败: {}", e))?;
            }
            
            // 写入文件
            let mut outfile = File::create(&outpath)
                .map_err(|e| format!("创建文件失败: {}", e))?;
            
            std::io::copy(&mut file, &mut outfile)
                .map_err(|e| format!("写入文件失败: {}", e))?;
            
            extracted_files.push(outpath.to_string_lossy().to_string());
        }
    }
    
    log::info!("✅ ZIP文件解压完成，共 {} 个文件", extracted_files.len());
    Ok(extracted_files)
}

/// 删除文件
/// 
/// # 参数
/// * `path` - 文件路径
/// 
/// # 返回
/// * `Ok(())` - 成功
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn delete_file(path: String) -> Result<(), String> {
    log::info!("🗑️ 删除文件: {}", path);
    
    use tokio::fs;
    
    fs::remove_file(&path)
        .await
        .map_err(|e| format!("删除文件失败: {}", e))?;
    
    log::info!("✅ 文件已删除: {}", path);
    Ok(())
}

/// 保存文件
/// 
/// # 参数
/// * `path` - 文件路径
/// * `data` - 文件数据（字节数组）
/// 
/// # 返回
/// * `Ok(())` - 保存成功
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn save_file(path: String, data: Vec<u8>) -> Result<(), String> {
    log::info!("保存文件: {}, 大小: {} bytes", path, data.len());
    
    use tokio::fs;
    use std::path::Path;
    
    // 确保父目录存在
    if let Some(parent) = Path::new(&path).parent() {
        if !parent.exists() {
            fs::create_dir_all(parent)
                .await
                .map_err(|e| format!("创建目录失败: {}", e))?;
        }
    }
    
    // 写入文件
    fs::write(&path, data)
        .await
        .map_err(|e| format!("写入文件失败: {}", e))?;
    
    log::info!("✅ 文件保存成功: {}", path);
    Ok(())
}

/// 保存聊天图片
/// 
/// # 参数
/// * `image_data` - Base64编码的图片数据
/// 
/// # 返回
/// * `Ok(String)` - 保存的文件路径
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn save_chat_image(image_data: String) -> Result<String, String> {
    use tokio::fs;
    use base64::{Engine as _, engine::general_purpose};
    
    log::info!("保存聊天图片，数据长度: {} bytes", image_data.len());
    
    // 解码Base64数据
    let bytes = general_purpose::STANDARD
        .decode(&image_data)
        .map_err(|e| format!("Base64解码失败: {}", e))?;
    
    log::info!("解码后图片大小: {} bytes", bytes.len());
    
    // 获取下载目录
    let download_dir = dirs::download_dir()
        .ok_or_else(|| "无法获取下载目录".to_string())?;
    
    // 生成文件名
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let filename = format!("MCTier_聊天图片_{}.png", timestamp);
    
    // 构建完整路径
    let file_path = download_dir.join(filename);
    let path_str = file_path.to_string_lossy().to_string();
    
    log::info!("保存图片到: {}", path_str);
    
    // 写入文件
    fs::write(&file_path, bytes)
        .await
        .map_err(|e| format!("写入文件失败: {}", e))?;
    
    log::info!("✅ 聊天图片保存成功: {}", path_str);
    Ok(path_str)
}

/// 读取文件
/// 
/// # 参数
/// * `path` - 文件路径
/// 
/// # 返回
/// * `Ok(Vec<u8>)` - 文件内容
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn read_file(path: String) -> Result<Vec<u8>, String> {
    log::info!("读取文件: {}", path);
    
    use tokio::fs;
    
    // 读取文件
    let data = fs::read(&path)
        .await
        .map_err(|e| format!("读取文件失败: {}", e))?;
    
    log::info!("✅ 文件读取成功: {}, 大小: {} bytes", path, data.len());
    Ok(data)
}

// ==================== P2P 聊天命令 ====================

use crate::modules::chat_service::{ChatMessage as ChatServiceMessage, MessageType, SendMessageRequest};

/// 发送P2P聊天消息
/// 
/// # 参数
/// * `player_id` - 玩家ID
/// * `player_name` - 玩家名称
/// * `content` - 消息内容
/// * `message_type` - 消息类型（text/image）
/// * `image_data` - 图片数据（可选）
/// * `peer_ips` - 目标玩家的虚拟IP列表
/// 
/// # 返回
/// * `Ok(())` - 发送成功
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn send_p2p_chat_message(
    player_id: String,
    player_name: String,
    content: String,
    message_type: String,
    image_data: Option<Vec<u8>>,
    peer_ips: Vec<String>,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    log::info!("💬 发送P2P聊天消息: {} - {}", player_name, content);
    
    let core = state.core.lock().await;
    let chat_service = core.get_chat_service();
    let chat_svc = chat_service.lock().await;
    
    // 解析消息类型
    let msg_type = match message_type.as_str() {
        "image" => MessageType::Image,
        "announce" => MessageType::Announce,
        "voicegroup" => MessageType::VoiceGroup,
        "clipboard" => MessageType::Clipboard,
        "todo" => MessageType::Todo,
        "whiteboard" => MessageType::Whiteboard,
        _ => MessageType::Text,
    };
    
    // 创建消息
    let message = ChatServiceMessage {
        id: format!("msg-{}-{}", player_id, std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis()),
        player_id: player_id.clone(),
        player_name: player_name.clone(),
        content: content.clone(),
        message_type: msg_type.clone(),
        timestamp: std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs(),
        image_data: image_data.clone(),
    };
    
    // 保存到本地消息队列
    let message_id = message.id.clone();
    chat_svc.add_local_message(message);
    
    // 【修复】获取本机虚拟IP，避免发送消息给自己
    let my_virtual_ip = chat_svc.get_virtual_ip();
    
    drop(chat_svc);
    drop(core);
    
    // 【修复】过滤掉自己的IP
    let other_peer_ips: Vec<String> = peer_ips.into_iter()
        .filter(|ip| {
            if let Some(ref my_ip) = my_virtual_ip {
                ip != my_ip
            } else {
                true
            }
        })
        .collect();
    
    log::info!("📤 [ChatService] 向 {} 个其他玩家并发发送消息 (排除自己)", other_peer_ips.len());
    
    let total = other_peer_ips.len();

    // 【优化】使用并发发送，提高图片传输速度
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10)) // 设置超时
        .build()
        .map_err(|e| format!("创建HTTP客户端失败: {}", e))?;
    
    let mut tasks = Vec::new();
    
    for peer_ip in other_peer_ips {
        let url = format!("http://{}:14540/api/chat/send", peer_ip);
        let request = SendMessageRequest {
            id: Some(message_id.clone()),
            player_id: player_id.clone(),
            player_name: player_name.clone(),
            content: content.clone(),
            message_type: msg_type.clone(),
            image_data: image_data.clone(),
        };
        
        let client_clone = client.clone();
        let url_clone = url.clone();
        
        // 创建并发任务，返回是否送达成功（带一次快速重试，降低瞬时抖动导致的漏发）
        let task = tokio::spawn(async move {
            for attempt in 0..2 {
                let start = std::time::Instant::now();
                match client_clone.post(&url_clone).json(&request).send().await {
                    Ok(response) => {
                        let elapsed = start.elapsed();
                        if response.status().is_success() {
                            log::info!("✅ 消息已发送到: {} (耗时: {:?}, 第{}次)", url_clone, elapsed, attempt + 1);
                            return true;
                        } else {
                            log::warn!("⚠️ 发送消息失败 ({}): HTTP {} (第{}次)", url_clone, response.status(), attempt + 1);
                        }
                    }
                    Err(e) => {
                        let elapsed = start.elapsed();
                        log::warn!("⚠️ 发送消息失败 ({}, 耗时: {:?}, 第{}次): {}", url_clone, elapsed, attempt + 1, e);
                    }
                }
                if attempt == 0 {
                    // 第一次失败后稍等再重试一次
                    tokio::time::sleep(std::time::Duration::from_millis(400)).await;
                }
            }
            false
        });
        
        tasks.push(task);
    }
    
    // 等待所有发送完成，统计送达数量（用于给前端回执）
    let mut delivered = 0usize;
    for task in tasks {
        if let Ok(true) = task.await {
            delivered += 1;
        }
    }
    log::info!("🎉 [ChatService] 消息发送完成：送达 {}/{}", delivered, total);
    
    Ok(serde_json::json!({ "delivered": delivered, "total": total }))
}

/// 获取P2P聊天消息
/// 
/// # 参数
/// * `peer_ips` - 玩家的虚拟IP列表
/// * `since` - 获取此时间戳之后的消息（可选）
/// 
/// # 返回
/// * `Ok(Vec<ChatMessage>)` - 消息列表
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn get_p2p_chat_messages(
    peer_ips: Vec<String>,
    since: Option<u64>,
    state: State<'_, AppState>,
) -> Result<Vec<ChatServiceMessage>, String> {
    let core = state.core.lock().await;
    let chat_service = core.get_chat_service();
    let chat_svc = chat_service.lock().await;
    
    // 获取本地消息
    let mut all_messages = chat_svc.get_local_messages(since);
    
    // 【修复】获取本机虚拟IP，避免从自己这里重复获取消息
    let my_virtual_ip = chat_svc.get_virtual_ip();
    
    drop(chat_svc);
    drop(core);
    
    // 【修复】过滤掉自己的IP，只从其他玩家获取消息
    let other_peer_ips: Vec<String> = peer_ips.into_iter()
        .filter(|ip| {
            if let Some(ref my_ip) = my_virtual_ip {
                ip != my_ip
            } else {
                true
            }
        })
        .collect();
    
    log::info!("📥 [ChatService] 从 {} 个其他玩家获取消息 (排除自己)", other_peer_ips.len());
    
    // 【优化】创建HTTP客户端，设置更短的超时时间以减少延迟
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(800)) // 800ms超时
        .connect_timeout(std::time::Duration::from_millis(300)) // 300ms连接超时
        .build()
        .map_err(|e| format!("创建HTTP客户端失败: {}", e))?;

    // 【#13 修复】并发从所有其他玩家获取消息。
    // 之前是顺序 await，某个玩家若发送了大图片，其响应体大、耗时长，会阻塞
    // 拉取其它所有玩家的消息（队头阻塞）。改为每个 peer 一个并发任务后，
    // 单个大响应不再拖慢其他人的消息接收。
    let mut tasks = Vec::new();
    for peer_ip in other_peer_ips {
        let url = if let Some(ts) = since {
            format!("http://{}:14540/api/chat/messages?since={}", peer_ip, ts)
        } else {
            format!("http://{}:14540/api/chat/messages", peer_ip)
        };
        let client_clone = client.clone();
        let peer_ip_clone = peer_ip.clone();
        tasks.push(tokio::spawn(async move {
            match client_clone.get(&url).send().await {
                Ok(response) => {
                    if response.status().is_success() {
                        match response.json::<Vec<ChatServiceMessage>>().await {
                            Ok(messages) => {
                                log::debug!("✅ 从 {} 获取到 {} 条消息", peer_ip_clone, messages.len());
                                messages
                            }
                            Err(e) => {
                                log::warn!("⚠️ 解析消息失败 ({}): {}", peer_ip_clone, e);
                                Vec::new()
                            }
                        }
                    } else {
                        log::warn!("⚠️ HTTP请求失败 ({}): 状态码 {}", peer_ip_clone, response.status());
                        Vec::new()
                    }
                }
                Err(e) => {
                    // 超时或连接失败不打印警告，避免日志刷屏
                    log::debug!("⚠️ 获取消息失败 ({}): {}", peer_ip_clone, e);
                    Vec::new()
                }
            }
        }));
    }

    // 汇总所有并发任务的结果
    for task in tasks {
        if let Ok(messages) = task.await {
            all_messages.extend(messages);
        }
    }
    
    // 按时间戳排序
    all_messages.sort_by_key(|msg| msg.timestamp);
    
    // 去重（基于消息ID）
    let mut seen_ids = std::collections::HashSet::new();
    all_messages.retain(|msg| seen_ids.insert(msg.id.clone()));
    
    Ok(all_messages)
}

/// 清空本地聊天消息
/// 
/// # 返回
/// * `Ok(())` - 清空成功
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn clear_p2p_chat_messages(
    state: State<'_, AppState>,
) -> Result<(), String> {
    log::info!("🗑️ 清空本地聊天消息");
    
    let core = state.core.lock().await;
    let chat_service = core.get_chat_service();
    let chat_svc = chat_service.lock().await;
    
    chat_svc.clear_local_messages();
    
    Ok(())
}


// ==================== 屏幕共享命令 ====================

/// 打开屏幕查看窗口
/// 
/// # 参数
/// * `share_id` - 共享ID
/// 打开屏幕查看窗口
/// 
/// # 参数
/// * `share_id` - 共享ID
/// * `player_name` - 共享者名称
/// * `app` - Tauri应用句柄
/// 
/// # 返回
/// * `Ok(())` - 成功
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn open_screen_viewer_window(
    share_id: String,
    player_name: String,
    app: tauri::AppHandle,
) -> Result<(), String> {
    log::info!("打开屏幕查看窗口: share_id={}, player_name={}", share_id, player_name);
    
    use tauri::Manager;
    use tauri::WebviewWindowBuilder;
    
    // 检查窗口是否已存在
    let window_label = "screen-viewer";
    if let Some(existing_window) = app.get_webview_window(window_label) {
        log::info!("屏幕查看窗口已存在，关闭旧窗口");
        let _ = existing_window.close();
        // 等待窗口关闭
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
    }
    
    // 构建URL，包含查询参数
    let url = format!("index.html?screen-viewer=true&shareId={}&playerName={}", 
        urlencoding::encode(&share_id), 
        urlencoding::encode(&player_name)
    );
    
    // 创建新窗口
    let _window = WebviewWindowBuilder::new(
        &app,
        window_label,
        tauri::WebviewUrl::App(url.into())
    )
    .title(format!("{} 的屏幕", player_name))
    .inner_size(1280.0, 720.0)
    .min_inner_size(800.0, 600.0)
    .resizable(true)
    .decorations(true)
    .always_on_top(true)  // 设置窗口始终置顶
    .center()
    .build()
    .map_err(|e| format!("创建窗口失败: {}", e))?;
    
    log::info!("✅ 屏幕查看窗口已打开");
    Ok(())
}

// ==================== 弹幕覆盖窗口 ====================

/// 打开弹幕覆盖窗口：置顶、透明、无边框、鼠标穿透、覆盖整个主屏幕。
/// 用于在玩游戏时让聊天消息以弹幕形式飘过屏幕顶部，且不遮挡操作。
#[tauri::command]
pub async fn open_danmaku_window(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    use tauri::WebviewWindowBuilder;

    let window_label = "danmaku";
    if let Some(existing) = app.get_webview_window(window_label) {
        // 已存在则确保可见并置顶穿透
        let _ = existing.show();
        let _ = existing.set_always_on_top(true);
        let _ = existing.set_ignore_cursor_events(true);
        return Ok(());
    }

    let window = WebviewWindowBuilder::new(
        &app,
        window_label,
        tauri::WebviewUrl::App("index.html?danmaku=true".into()),
    )
    .title("MCTier Danmaku")
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .shadow(false)
    .resizable(false)
    .focused(false)
    .visible(false)
    .build()
    .map_err(|e| format!("创建弹幕窗口失败: {}", e))?;

    // 覆盖主屏幕（含任务栏区域，尽量铺满）
    if let Ok(Some(monitor)) = window.primary_monitor() {
        let size = monitor.size();
        let pos = monitor.position();
        let _ = window.set_position(tauri::PhysicalPosition::new(pos.x, pos.y));
        let _ = window.set_size(tauri::PhysicalSize::new(size.width, size.height));
    }
    let _ = window.set_ignore_cursor_events(true);
    let _ = window.set_always_on_top(true);
    let _ = window.show();

    log::info!("✅ 弹幕窗口已打开");
    Ok(())
}

/// 关闭弹幕覆盖窗口
#[tauri::command]
pub async fn close_danmaku_window(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    if let Some(window) = app.get_webview_window("danmaku") {
        let _ = window.close();
        log::info!("弹幕窗口已关闭");
    }
    Ok(())
}

/// 打开日志文件所在的文件夹
/// 
/// # 返回
/// * `Ok(())` - 成功
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn open_log_folder() -> Result<(), String> {
    log::info!("打开日志文件夹");
    
    // 获取日志文件路径
    let log_path = if let Some(data_dir) = dirs::data_local_dir() {
        data_dir.join("MCTier")
    } else {
        std::env::current_dir()
            .map_err(|e| format!("获取当前目录失败: {}", e))?
    };
    
    log::info!("日志文件夹路径: {:?}", log_path);
    
    // 确保目录存在
    if !log_path.exists() {
        return Err("日志文件夹不存在".to_string());
    }
    
    // 打开文件夹
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        match Command::new("explorer.exe")
            .arg(&log_path)
            .spawn()
        {
            Ok(_) => {
                log::info!("✅ 成功打开日志文件夹");
                Ok(())
            }
            Err(e) => {
                log::error!("❌ 打开日志文件夹失败: {}", e);
                Err(format!("打开日志文件夹失败: {}", e))
            }
        }
    }
    
    #[cfg(not(target_os = "windows"))]
    {
        Err("当前平台不支持此功能".to_string())
    }
}

/// 打开日志文件（使用默认文本编辑器）
/// 
/// # 返回
/// * `Ok(())` - 成功
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn open_log_file() -> Result<(), String> {
    log::info!("打开日志文件");
    
    // 获取日志文件路径
    let log_path = if let Some(data_dir) = dirs::data_local_dir() {
        data_dir.join("MCTier").join("mctier.log")
    } else {
        std::path::PathBuf::from("mctier.log")
    };
    
    log::info!("日志文件路径: {:?}", log_path);
    
    // 确保文件存在
    if !log_path.exists() {
        return Err("日志文件不存在".to_string());
    }
    
    // 打开文件
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        // 使用notepad打开日志文件
        match Command::new("notepad.exe")
            .arg(&log_path)
            .spawn()
        {
            Ok(_) => {
                log::info!("✅ 成功打开日志文件");
                Ok(())
            }
            Err(e) => {
                log::error!("❌ 打开日志文件失败: {}", e);
                Err(format!("打开日志文件失败: {}", e))
            }
        }
    }
    
    #[cfg(not(target_os = "windows"))]
    {
        Err("当前平台不支持此功能".to_string())
    }
}

/// 获取日志文件路径
/// 
/// # 返回
/// * `Ok(String)` - 日志文件路径
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn get_log_file_path() -> Result<String, String> {
    let log_path = if let Some(data_dir) = dirs::data_local_dir() {
        data_dir.join("MCTier").join("mctier.log")
    } else {
        std::path::PathBuf::from("mctier.log")
    };
    
    Ok(log_path.to_string_lossy().to_string())
}

/// 保存设置配置（开机自启 + 自动大厅）
///
/// # 参数
/// * `auto_startup` - 是否开机自启
/// * `auto_lobby_enabled` - 是否启用自动大厅
/// * `lobby_name` - 大厅名称
/// * `lobby_password` - 大厅密码
/// 保存设置
/// 
/// # 参数
/// * `auto_startup` - 开机自启
/// * `auto_lobby_enabled` - 自动大厅启用
/// * `lobby_name` - 大厅名称
/// * `lobby_password` - 大厅密码
/// * `player_name` - 玩家名称
/// * `use_domain` - 是否使用虚拟域名
/// * `use_private_server` - 是否使用私有服务器
/// * `private_easytier_server` - 私有 EasyTier 节点服务器地址
/// * `private_signaling_server` - 私有信令服务器地址
/// * `always_on_top` - 窗口是否置顶
/// * `remember_window_position` - 是否记住窗口位置
/// * `enable_gpu_rendering` - 是否启用 GPU 渲染
#[tauri::command]
pub async fn save_settings(
    auto_startup: bool,
    auto_lobby_enabled: bool,
    lobby_name: Option<String>,
    lobby_password: Option<String>,
    player_name: Option<String>,
    use_domain: bool,
    virtual_domain: Option<String>,
    use_private_server: bool,
    private_easytier_server: Option<String>,
    private_signaling_server: Option<String>,
    always_on_top: Option<bool>,
    remember_window_position: Option<bool>,
    custom_easytier_nodes: Option<Vec<serde_json::Value>>,
    voice_volume: Option<f64>,
    enable_gpu_rendering: Option<bool>,
    mic_hotkey: Option<String>,
    global_mute_hotkey: Option<String>,
    push_to_talk_hotkey: Option<String>,
    enable_exit_node: Option<bool>,
    enable_as_exit_node: Option<bool>,
    proxy_cidrs: Option<String>,
    exit_nodes: Option<String>,
    subnet_proxy_cidrs: Option<String>,
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    use crate::modules::config_manager::{AutoLobbyConfig, EasyTierNode};
    log::info!("保存设置: auto_startup={}, auto_lobby_enabled={}, use_private_server={}, always_on_top={:?}, remember_window_position={:?}, voice_volume={:?}, enable_gpu_rendering={:?}, mic_hotkey={:?}, global_mute_hotkey={:?}, push_to_talk_hotkey={:?}, enable_exit_node={:?}, subnet_proxy_cidrs={:?}, virtual_domain={:?}", 
        auto_startup, auto_lobby_enabled, use_private_server, always_on_top, remember_window_position, voice_volume, enable_gpu_rendering, mic_hotkey, global_mute_hotkey, push_to_talk_hotkey, enable_exit_node, subnet_proxy_cidrs, virtual_domain);

    // 1. 保存配置到文件
    {
        let core = state.core.lock().await;
        let config_manager = core.get_config_manager();
        let mut cfg_mgr = config_manager.lock().await;
        cfg_mgr.update_config(|config| {
            config.auto_startup = Some(auto_startup);
            // 读取已有的auto_lobby配置，只更新非None的字段
            let existing = config.auto_lobby.clone().unwrap_or_default();
            
            // 如果传入了 lobby_name、lobby_password 或 player_name，则更新这些字段
            // 如果传入了 use_domain 或 virtual_domain，则更新这些字段（独立于其他字段）
            let updated_use_domain = if lobby_name.is_some() || lobby_password.is_some() || player_name.is_some() || virtual_domain.is_some() {
                use_domain
            } else {
                existing.use_domain
            };
            
            let updated_virtual_domain = if virtual_domain.is_some() {
                virtual_domain.clone()
            } else {
                existing.virtual_domain.clone()
            };
            
            log::info!("更新 auto_lobby 配置: use_domain={}, virtual_domain={:?}", updated_use_domain, updated_virtual_domain);
            
            config.auto_lobby = Some(AutoLobbyConfig {
                enabled: auto_lobby_enabled,
                lobby_name: lobby_name.clone().or(existing.lobby_name),
                lobby_password: lobby_password.clone().or(existing.lobby_password),
                player_name: player_name.clone().or(existing.player_name),
                use_domain: updated_use_domain,
                virtual_domain: updated_virtual_domain,
            });
            // 保存私有服务器配置
            config.use_private_server = Some(use_private_server);
            // 【修复】仅在调用方明确传入时才更新私有服务器地址，
            // 避免「保存节点列表」等只关心部分设置的调用传 null 时，把已保存的地址抹掉
            if private_easytier_server.is_some() {
                config.private_easytier_server = private_easytier_server.clone();
            }
            if private_signaling_server.is_some() {
                config.private_signaling_server = private_signaling_server.clone();
            }
            // 保存窗口置顶配置
            if let Some(on_top) = always_on_top {
                config.always_on_top = Some(on_top);
            }
            // 保存记住窗口位置配置
            if let Some(remember) = remember_window_position {
                config.remember_window_position = Some(remember);
                // 如果关闭记住位置，清除已保存的位置
                if !remember {
                    config.window_position = None;
                }
            }
            // 保存自定义 EasyTier 节点
            if let Some(nodes_json) = custom_easytier_nodes.clone() {
                let nodes: Vec<EasyTierNode> = nodes_json.iter().filter_map(|n| {
                    if let (Some(name), Some(address)) = (n.get("name").and_then(|v| v.as_str()), n.get("address").and_then(|v| v.as_str())) {
                        Some(EasyTierNode {
                            name: name.to_string(),
                            address: address.to_string(),
                        })
                    } else {
                        None
                    }
                }).collect();
                config.custom_easytier_nodes = Some(nodes);
            }
            // 保存语音音量
            if let Some(volume) = voice_volume {
                config.voice_volume = Some(volume.clamp(0.0, 1.0));
            }
            // 保存 GPU 渲染设置
            if let Some(enable) = enable_gpu_rendering {
                config.enable_gpu_rendering = Some(enable);
            }
            // 保存快捷键设置
            if let Some(hotkey) = mic_hotkey {
                config.mic_hotkey = Some(hotkey);
            }
            if let Some(hotkey) = global_mute_hotkey {
                config.global_mute_hotkey = Some(hotkey);
            }
            if let Some(hotkey) = push_to_talk_hotkey {
                config.push_to_talk_hotkey = Some(hotkey);
            }
            // 保存出口节点配置
            if let Some(enable) = enable_exit_node {
                if config.exit_node_config.is_none() {
                    config.exit_node_config = Some(crate::modules::config_manager::ExitNodeConfig::default());
                }
                if let Some(ref mut exit_config) = config.exit_node_config {
                    exit_config.enable_exit_node = enable;
                }
            }
            if let Some(enable) = enable_as_exit_node {
                if config.exit_node_config.is_none() {
                    config.exit_node_config = Some(crate::modules::config_manager::ExitNodeConfig::default());
                }
                if let Some(ref mut exit_config) = config.exit_node_config {
                    exit_config.enable_as_exit_node = enable;
                }
            }
            if let Some(cidrs) = proxy_cidrs {
                if config.exit_node_config.is_none() {
                    config.exit_node_config = Some(crate::modules::config_manager::ExitNodeConfig::default());
                }
                if let Some(ref mut exit_config) = config.exit_node_config {
                    // 将字符串按行分割成 Vec<String>
                    exit_config.proxy_cidrs = cidrs
                        .lines()
                        .map(|s| s.trim().to_string())
                        .filter(|s| !s.is_empty())
                        .collect();
                }
            }
            if let Some(nodes) = exit_nodes {
                if config.exit_node_config.is_none() {
                    config.exit_node_config = Some(crate::modules::config_manager::ExitNodeConfig::default());
                }
                if let Some(ref mut exit_config) = config.exit_node_config {
                    // 将字符串按行分割成 Vec<String>
                    exit_config.exit_nodes = nodes
                        .lines()
                        .map(|s| s.trim().to_string())
                        .filter(|s| !s.is_empty())
                        .collect();
                }
            }
            if let Some(subnet_cidrs) = subnet_proxy_cidrs {
                if config.exit_node_config.is_none() {
                    config.exit_node_config = Some(crate::modules::config_manager::ExitNodeConfig::default());
                }
                if let Some(ref mut exit_config) = config.exit_node_config {
                    // 将字符串按行分割成 Vec<String>
                    exit_config.subnet_proxy_cidrs = subnet_cidrs
                        .lines()
                        .map(|s| s.trim().to_string())
                        .filter(|s| !s.is_empty())
                        .collect();
                }
            }
        }).await.map_err(|e| format!("保存配置失败: {}", e))?;
    }

    // 2. 应用窗口置顶设置到主窗口
    if let Some(on_top) = always_on_top {
        if let Some(window) = app_handle.get_webview_window("main") {
            if let Err(e) = window.set_always_on_top(on_top) {
                log::warn!("设置主窗口置顶失败: {}", e);
            } else {
                log::info!("主窗口置顶设置成功: {}", on_top);
            }
        }
    }

    // 3. 处理开机自启
    match set_auto_start(auto_startup).await {
        Ok(_) => log::info!("开机自启设置成功: {}", auto_startup),
        Err(e) => log::warn!("开机自启设置失败（非致命）: {}", e),
    }

    log::info!("设置保存完成");
    Ok(())
}

/// 读取当前设置配置
#[tauri::command]
pub async fn get_settings(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    log::info!("开始读取设置配置");
    
    let core = state.core.lock().await;
    let config_manager = core.get_config_manager();
    let cfg_mgr = config_manager.lock().await;
    let config = cfg_mgr.get_config();

    let _auto_startup = config.auto_startup.unwrap_or(false);
    let auto_lobby = config.auto_lobby.clone().unwrap_or_default();

    // 同时读取实际的开机自启状态
    // 直接查询注册表，不通过command函数（避免嵌套async调用死锁）
    // 添加超时保护，避免 reg 命令卡住
    let actual_auto_start = {
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            use std::time::Duration;
            
            log::info!("查询注册表中的开机自启状态");
            
            // 使用 tokio::time::timeout 添加超时保护
            let result = tokio::time::timeout(
                Duration::from_secs(2), // 2秒超时
                tokio::task::spawn_blocking(|| {
                    std::process::Command::new("reg")
                        .args(["query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "/v", "MCTier"])
                        .creation_flags(0x08000000)
                        .output()
                        .map(|o| o.status.success())
                        .unwrap_or(false)
                })
            ).await;
            
            match result {
                Ok(Ok(status)) => {
                    log::info!("注册表查询成功: {}", status);
                    status
                }
                Ok(Err(e)) => {
                    log::warn!("注册表查询任务失败: {}", e);
                    false
                }
                Err(_) => {
                    log::warn!("注册表查询超时，使用默认值 false");
                    false
                }
            }
        }
        #[cfg(not(windows))]
        { false }
    };

    log::info!("设置配置读取完成");

    // 读取出口节点配置
    let exit_node_config = config.exit_node_config.clone().unwrap_or_default();

    Ok(serde_json::json!({
        "autoStartup": actual_auto_start,
        "autoLobbyEnabled": auto_lobby.enabled,
        "lobbyName": auto_lobby.lobby_name,
        "lobbyPassword": auto_lobby.lobby_password,
        "playerName": auto_lobby.player_name,
        "useDomain": auto_lobby.use_domain,
        "virtualDomain": auto_lobby.virtual_domain,
        "usePrivateServer": config.use_private_server.unwrap_or(false),
        // 返回实际保存的值，如果是 None 就返回 null，让前端决定默认值
        "privateEasytierServer": config.private_easytier_server.clone(),
        "privateSignalingServer": config.private_signaling_server.clone(),
        "alwaysOnTop": config.always_on_top.unwrap_or(true),
        "rememberWindowPosition": config.remember_window_position.unwrap_or(false),
        "customEasytierNodes": config.custom_easytier_nodes.clone().unwrap_or_default(),
        "voiceVolume": config.voice_volume.unwrap_or(1.0),
        "enableGpuRendering": config.enable_gpu_rendering.unwrap_or(true),
        "micHotkey": config.mic_hotkey.clone().unwrap_or_else(|| "Ctrl+M".to_string()),
        "globalMuteHotkey": config.global_mute_hotkey.clone().unwrap_or_else(|| "Ctrl+T".to_string()),
        "pushToTalkHotkey": config.push_to_talk_hotkey.clone().unwrap_or_else(|| "F2".to_string()),
        "enableExitNode": exit_node_config.enable_exit_node,
        "enableAsExitNode": exit_node_config.enable_as_exit_node,
        // 将 Vec<String> 转换为换行分隔的字符串
        "proxyCidrs": exit_node_config.proxy_cidrs.join("\n"),
        "exitNodes": exit_node_config.exit_nodes.join("\n"),
        "subnetProxyCidrs": exit_node_config.subnet_proxy_cidrs.join("\n"),
    }))
}

/// 保存语音音量
/// 
/// # 参数
/// * `volume` - 音量值 (0.0-1.0)
/// * `state` - 应用状态
/// 
/// # 返回
/// * `Ok(())` - 保存成功
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn save_voice_volume(volume: f64, state: State<'_, AppState>) -> Result<(), String> {
    log::info!("保存语音音量: {}", volume);
    
    let core = state.core.lock().await;
    let config_manager = core.get_config_manager();
    let mut cfg_mgr = config_manager.lock().await;
    
    cfg_mgr.set_voice_volume(volume).await
        .map_err(|e| format!("保存音量失败: {}", e))?;
    
    log::info!("语音音量保存成功");
    Ok(())
}

// ==================== 配置重置命令 ====================

/// 重置配置为默认值
/// 
/// # 返回
/// * `Ok(())` - 重置成功
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn reset_config_to_default(state: State<'_, AppState>) -> Result<(), String> {
    log::info!("收到重置配置命令");
    
    let core = state.core.lock().await;
    let config_manager = core.get_config_manager();
    let mut cfg_mgr = config_manager.lock().await;
    
    match cfg_mgr.reset_to_default().await {
        Ok(_) => {
            log::info!("配置已重置为默认值");
            Ok(())
        }
        Err(e) => {
            log::error!("重置配置失败: {}", e);
            Err(format!("重置配置失败: {}", e))
        }
    }
}

// ==================== 配置导入导出命令 ====================

/// 导出配置到文件
/// 
/// # 参数
/// * `export_path` - 导出文件路径
/// * `state` - 应用状态
/// 
/// # 返回
/// * `Ok(())` - 导出成功
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn export_config(export_path: String, state: State<'_, AppState>) -> Result<(), String> {
    log::info!("导出配置到: {}", export_path);

    let core = state.core.lock().await;
    let config_manager = core.get_config_manager();
    let cfg_mgr = config_manager.lock().await;

    cfg_mgr.export_config(std::path::PathBuf::from(export_path)).await
        .map_err(|e| format!("导出配置失败: {}", e))?;

    log::info!("配置导出成功");
    Ok(())
}

/// 从文件导入配置
/// 
/// # 参数
/// * `import_path` - 导入文件路径
/// * `state` - 应用状态
/// 
/// # 返回
/// * `Ok(())` - 导入成功
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn import_config(import_path: String, state: State<'_, AppState>) -> Result<(), String> {
    log::info!("从文件导入配置: {}", import_path);

    let core = state.core.lock().await;
    let config_manager = core.get_config_manager();
    let mut cfg_mgr = config_manager.lock().await;

    cfg_mgr.import_config(std::path::PathBuf::from(import_path)).await
        .map_err(|e| format!("导入配置失败: {}", e))?;

    log::info!("配置导入成功");
    Ok(())
}

// ==================== GPU 设置命令 ====================

/// 重启应用并应用 GPU 设置
/// 
/// # 参数
/// * `enable_gpu` - 是否启用 GPU 渲染
/// * `app` - 应用句柄
/// 
/// # 返回
/// * `Ok(())` - 重启成功
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn restart_app_with_gpu_settings(enable_gpu: bool, app: tauri::AppHandle) -> Result<(), String> {
    log::info!("重启应用以应用 GPU 设置: enable_gpu={}", enable_gpu);
    
    use std::process::Command;
    
    // 获取当前可执行文件路径
    let exe_path = std::env::current_exe()
        .map_err(|e| format!("获取程序路径失败: {}", e))?;
    
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        
        // 使用 PowerShell 启动新进程，确保环境变量正确传递
        let ps_script = if !enable_gpu {
            // 完全禁用 GPU（包括GPU进程）
            format!(
                "$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--disable-gpu --disable-software-rasterizer --disable-gpu-compositing --disable-gpu-process-crash-limit --in-process-gpu'; Start-Process -FilePath '{}' -WindowStyle Hidden",
                exe_path.to_string_lossy().replace("\\", "\\\\")
            )
        } else {
            // 启用 GPU，明确设置启用硬件加速的参数
            format!(
                "$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--enable-gpu-rasterization --enable-zero-copy --ignore-gpu-blocklist'; Start-Process -FilePath '{}' -WindowStyle Hidden",
                exe_path.to_string_lossy().replace("\\", "\\\\")
            )
        };
        
        log::info!("执行 PowerShell 脚本启动新进程");
        
        // 使用 PowerShell 启动新进程
        Command::new("powershell")
            .args(["-WindowStyle", "Hidden", "-Command", &ps_script])
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .spawn()
            .map_err(|e| format!("启动新进程失败: {}", e))?;
    }
    
    #[cfg(not(windows))]
    {
        // 非 Windows 平台的实现
        let mut cmd = Command::new(&exe_path);
        
        if !enable_gpu {
            cmd.env("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", "--disable-gpu --disable-software-rasterizer --disable-gpu-compositing --disable-gpu-process-crash-limit --in-process-gpu");
        } else {
            cmd.env("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", "--enable-gpu-rasterization --enable-zero-copy --ignore-gpu-blocklist");
        }
        
        cmd.spawn()
            .map_err(|e| format!("启动新进程失败: {}", e))?;
    }
    
    log::info!("新进程已启动，准备退出当前进程");
    
    // 延迟退出当前进程，确保新进程已启动
    tokio::time::sleep(tokio::time::Duration::from_millis(800)).await;
    app.exit(0);
    
    Ok(())
}






/// 保存出口节点高级配置
/// 
/// # 参数
/// * `enable_socks5` - 是否启用 SOCKS5 代理
/// * `socks5_port` - SOCKS5 代理端口
/// * `port_forward_rules` - 端口转发规则列表
/// * `no_tun` - 是否启用无 TUN 模式
/// * `proxy_forward_by_system` - 是否启用系统转发
/// * `bind_device` - 是否仅使用物理网卡
/// * `multi_thread` - 是否启用多线程
/// * `multi_thread_count` - 多线程数量
/// * `use_smoltcp` - 是否启用 smoltcp
/// * `enable_kcp_proxy` - 是否启用 KCP 代理
/// * `enable_quic_proxy` - 是否启用 QUIC 代理
/// * `latency_first` - 是否启用延迟优先模式
/// 
/// # 返回
/// * `Ok(())` - 保存成功
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn save_exit_node_advanced_config(
    enable_socks5: Option<bool>,
    socks5_port: Option<u16>,
    port_forward_rules: Option<Vec<serde_json::Value>>,
    no_tun: Option<bool>,
    proxy_forward_by_system: Option<bool>,
    bind_device: Option<bool>,
    multi_thread: Option<bool>,
    multi_thread_count: Option<u32>,
    use_smoltcp: Option<bool>,
    enable_kcp_proxy: Option<bool>,
    enable_quic_proxy: Option<bool>,
    latency_first: Option<bool>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    use crate::modules::config_manager::PortForwardRule;
    
    log::info!("保存出口节点高级配置");
    log::info!("  - enable_socks5: {:?}", enable_socks5);
    log::info!("  - socks5_port: {:?}", socks5_port);
    log::info!("  - no_tun: {:?}", no_tun);
    log::info!("  - proxy_forward_by_system: {:?}", proxy_forward_by_system);
    log::info!("  - bind_device: {:?}", bind_device);
    log::info!("  - multi_thread: {:?}", multi_thread);
    log::info!("  - multi_thread_count: {:?}", multi_thread_count);
    log::info!("  - use_smoltcp: {:?}", use_smoltcp);
    log::info!("  - enable_kcp_proxy: {:?}", enable_kcp_proxy);
    log::info!("  - enable_quic_proxy: {:?}", enable_quic_proxy);
    log::info!("  - latency_first: {:?}", latency_first);
    
    let core = state.core.lock().await;
    let config_manager = core.get_config_manager();
    let mut cfg_mgr = config_manager.lock().await;
    
    cfg_mgr.update_config(|config| {
        // 确保 exit_node_config 存在
        if config.exit_node_config.is_none() {
            config.exit_node_config = Some(crate::modules::config_manager::ExitNodeConfig::default());
        }
        
        if let Some(ref mut exit_config) = config.exit_node_config {
            // 更新 SOCKS5 配置
            if let Some(enable) = enable_socks5 {
                exit_config.enable_socks5 = enable;
            }
            if let Some(port) = socks5_port {
                exit_config.socks5_port = Some(port);
            }
            
            // 更新端口转发规则
            if let Some(rules_json) = port_forward_rules {
                let rules: Vec<PortForwardRule> = rules_json.iter().filter_map(|r| {
                    if let (Some(protocol), Some(bind_addr), Some(dst_addr)) = (
                        r.get("protocol").and_then(|v| v.as_str()),
                        r.get("bind_addr").and_then(|v| v.as_str()),
                        r.get("dst_addr").and_then(|v| v.as_str()),
                    ) {
                        Some(PortForwardRule {
                            protocol: protocol.to_string(),
                            bind_addr: bind_addr.to_string(),
                            dst_addr: dst_addr.to_string(),
                        })
                    } else {
                        None
                    }
                }).collect();
                exit_config.port_forward_rules = rules;
            }
            
            // 更新其他高级配置
            if let Some(no_tun_val) = no_tun {
                exit_config.no_tun = no_tun_val;
            }
            if let Some(proxy_forward) = proxy_forward_by_system {
                exit_config.proxy_forward_by_system = proxy_forward;
            }
            if let Some(bind_dev) = bind_device {
                exit_config.bind_device = bind_dev;
            }
            if let Some(multi_thread_val) = multi_thread {
                exit_config.multi_thread = multi_thread_val;
            }
            if let Some(thread_count) = multi_thread_count {
                exit_config.multi_thread_count = Some(thread_count);
            }
            if let Some(smoltcp) = use_smoltcp {
                exit_config.use_smoltcp = smoltcp;
            }
            if let Some(kcp) = enable_kcp_proxy {
                exit_config.enable_kcp_proxy = kcp;
            }
            if let Some(quic) = enable_quic_proxy {
                exit_config.enable_quic_proxy = quic;
            }
            if let Some(latency) = latency_first {
                exit_config.latency_first = latency;
            }
        }
    }).await.map_err(|e| format!("保存出口节点高级配置失败: {}", e))?;
    
    log::info!("出口节点高级配置保存成功");
    Ok(())
}

/// 获取出口节点高级配置
/// 
/// # 返回
/// * `Ok(serde_json::Value)` - 出口节点高级配置
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn get_exit_node_advanced_config(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    log::info!("获取出口节点高级配置");
    
    let core = state.core.lock().await;
    let config_manager = core.get_config_manager();
    let cfg_mgr = config_manager.lock().await;
    let config = cfg_mgr.get_config();
    
    let exit_config = config.exit_node_config.clone().unwrap_or_default();
    
    Ok(serde_json::json!({
        "enableSocks5": exit_config.enable_socks5,
        "socks5Port": exit_config.socks5_port,
        "portForwardRules": exit_config.port_forward_rules,
        "noTun": exit_config.no_tun,
        "proxyForwardBySystem": exit_config.proxy_forward_by_system,
        "bindDevice": exit_config.bind_device,
        "multiThread": exit_config.multi_thread,
        "multiThreadCount": exit_config.multi_thread_count,
        "useSmoltcp": exit_config.use_smoltcp,
        "enableKcpProxy": exit_config.enable_kcp_proxy,
        "enableQuicProxy": exit_config.enable_quic_proxy,
        "latencyFirst": exit_config.latency_first,
    }))
}
