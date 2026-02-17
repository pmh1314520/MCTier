// Tauri Command 接口模块
// 提供前端调用的所有命令接口

use tauri::State;
use tauri::Emitter;
use crate::modules::app_core::{AppCore, AppState as CoreAppState};
use crate::modules::lobby_manager::{Lobby, Player};
use crate::modules::voice_service::AudioDevice;
use crate::modules::config_manager::UserConfig;
use std::sync::Arc;
use tokio::sync::Mutex;

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
    state: State<'_, AppState>,
) -> Result<Lobby, String> {
    log::info!("收到创建大厅命令: name={}, player={}, player_id={}", name, player_name, player_id);
    
    let core = state.core.lock().await;
    
    // 更新应用状态为连接中
    core.set_state(CoreAppState::Connecting).await;
    
    // 获取各个服务的引用
    let lobby_manager = core.get_lobby_manager();
    let network_service = core.get_network_service();
    
    // 创建大厅
    let mut lobby_mgr = lobby_manager.lock().await;
    let network_svc = network_service.lock().await;
    
    match lobby_mgr.create_lobby(
        name,
        password,
        player_name.clone(),
        server_node,
        &*network_svc,
    ).await {
        Ok(lobby) => {
            log::info!("大厅创建成功: {}", lobby.name);
            
            // 输出序列化后的JSON用于调试
            if let Ok(json) = serde_json::to_string(&lobby) {
                log::info!("大厅JSON: {}", json);
            }
            
            // 获取虚拟IP（虽然不再使用，但保留用于日志）
            let _virtual_ip = lobby.virtual_ip.clone();
            drop(lobby_mgr);
            drop(network_svc);
            
            log::info!("使用前端提供的玩家ID: {}", player_id);
            
            // 不再启动本地 WebSocket 信令服务器
            // 所有客户端都连接到公网信令服务器 (24.233.29.43:8445)
            log::info!("客户端将连接到公网信令服务器: ws://24.233.29.43:8445");
            
            // 更新应用状态为在大厅中
            core.set_state(CoreAppState::InLobby).await;
            
            Ok(lobby)
        }
        Err(e) => {
            log::error!("创建大厅失败: {}", e);
            
            // 更新应用状态为错误
            core.set_state(CoreAppState::Error(e.to_string())).await;
            
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
    state: State<'_, AppState>,
) -> Result<Lobby, String> {
    log::info!("收到加入大厅命令: name={}, player={}, player_id={}", name, player_name, player_id);
    
    let core = state.core.lock().await;
    
    // 更新应用状态为连接中
    core.set_state(CoreAppState::Connecting).await;
    
    // 获取各个服务的引用
    let lobby_manager = core.get_lobby_manager();
    let network_service = core.get_network_service();
    let voice_service = core.get_voice_service();
    let p2p_signaling = core.get_p2p_signaling();
    
    // 加入大厅
    let mut lobby_mgr = lobby_manager.lock().await;
    let network_svc = network_service.lock().await;
    
    match lobby_mgr.join_lobby(
        name,
        password,
        player_name.clone(),
        server_node,
        &*network_svc,
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
            
            // 获取虚拟IP（用于P2P信令服务）
            let virtual_ip = lobby.virtual_ip.clone();
            drop(lobby_mgr);
            drop(network_svc);
            
            log::info!("使用前端提供的玩家ID: {}", player_id);
            
            // 不再启动本地 WebSocket 信令服务器
            // 所有客户端都连接到公网信令服务器 (24.233.29.43:8445)
            log::info!("客户端将连接到公网信令服务器: ws://24.233.29.43:8445");
            
            // 启动P2P信令服务
            log::info!("正在启动P2P信令服务（加入大厅）...");
            let p2p_svc = p2p_signaling.lock().await;
            match p2p_svc.start(player_id, player_name, virtual_ip).await {
                Ok(_) => {
                    log::info!("✅ P2P信令服务启动成功（加入大厅）");
                }
                Err(e) => {
                    log::error!("❌ 启动P2P信令服务失败（加入大厅）: {}", e);
                    // P2P信令服务启动失败应该返回错误，因为没有它就无法发现其他玩家
                    drop(p2p_svc);
                    core.set_state(CoreAppState::Error(format!("P2P信令服务启动失败: {}", e))).await;
                    return Err(format!("P2P信令服务启动失败: {}", e));
                }
            }
            drop(p2p_svc);
            
            // 更新应用状态为在大厅中
            core.set_state(CoreAppState::InLobby).await;
            
            Ok(lobby)
        }
        Err(e) => {
            log::error!("加入大厅失败: {}", e);
            
            // 更新应用状态为错误
            core.set_state(CoreAppState::Error(e.to_string())).await;
            
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
            
            // 更新应用状态为空闲
            core.set_state(CoreAppState::Idle).await;
            
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
    log::info!("设置窗口透明度: {}", opacity);
    
    // 限制透明度范围在 0.3 到 1.0 之间
    let clamped_opacity = opacity.max(0.3).min(1.0);
    
    // 在Windows上设置真实的窗口透明度
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::WindowsAndMessaging::{SetLayeredWindowAttributes, LWA_ALPHA};
        
        if let Ok(hwnd) = window.hwnd() {
            let hwnd = HWND(hwnd.0 as *mut _);
            let alpha = (clamped_opacity * 255.0) as u8;
            
            unsafe {
                if let Err(e) = SetLayeredWindowAttributes(
                    hwnd,
                    windows::Win32::Foundation::COLORREF(0),
                    alpha,
                    LWA_ALPHA,
                ) {
                    log::error!("设置Windows窗口透明度失败: {:?}", e);
                    return Err(format!("设置窗口透明度失败: {:?}", e));
                }
            }
            
            log::info!("Windows窗口透明度已设置为: {} (alpha: {})", clamped_opacity, alpha);
        }
    }
    
    // 同时发送事件到前端，让前端通过 CSS 控制UI透明度
    window
        .emit("opacity-changed", clamped_opacity)
        .map_err(|e| format!("发送透明度事件失败: {}", e))?;
    
    log::info!("窗口透明度已设置为: {}", clamped_opacity);
    
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
        
        // 使用 ipconfig 命令查找 EasyTier 创建的虚拟网卡
        let output = Command::new("ipconfig")
            .arg("/all")
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
        
        // 检查 Windows 防火墙是否允许 Minecraft
        let output = Command::new("netsh")
            .args(&["advfirewall", "firewall", "show", "rule", "name=all"])
            .output()
            .map_err(|e| format!("执行 netsh 失败: {}", e))?;
        
        let output_str = String::from_utf8_lossy(&output.stdout);
        
        // 简单检查是否有相关规则（这只是一个基本检查）
        let has_rules = output_str.contains("Minecraft") || 
                       output_str.contains("Java");
        
        log::info!("防火墙规则检查结果: {}", has_rules);
        Ok(has_rules)
    }
    
    #[cfg(not(windows))]
    {
        Ok(true)
    }
}

/// Ping 虚拟 IP 检查连通性
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
    let output = Command::new("ping")
        .args(&["-n", "2", "-w", "1000", &ip])
        .output()
        .map_err(|e| format!("执行 ping 失败: {}", e))?;
    
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
