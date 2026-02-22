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
    use_domain: Option<bool>,
    state: State<'_, AppState>,
) -> Result<Lobby, String> {
    log::info!("收到创建大厅命令: name={}, player={}, player_id={}, use_domain={:?}", name, player_name, player_id, use_domain);
    
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
        use_domain.unwrap_or(false),
        &*network_svc,
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
            
            // 不再启动本地 WebSocket 信令服务器
            // 所有客户端都连接到公网信令服务器 (ws://24.233.29.43:8445)
            log::info!("客户端将连接到公网信令服务器: ws://24.233.29.43:8445");
            
            // 启动HTTP文件服务器
            log::info!("正在启动HTTP文件服务器...");
            let file_transfer = core.get_file_transfer();
            let ft_service = file_transfer.lock().await;
            ft_service.set_virtual_ip(virtual_ip.clone());
            match ft_service.start_server().await {
                Ok(_) => {
                    log::info!("✅ HTTP文件服务器启动成功");
                }
                Err(e) => {
                    log::error!("❌ HTTP文件服务器启动失败: {}", e);
                    // 文件服务器启动失败不应该阻止创建大厅
                }
            }
            drop(ft_service);
            
            // 启动P2P聊天服务器
            log::info!("正在启动P2P聊天服务器...");
            let chat_service = core.get_chat_service();
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
    use_domain: Option<bool>,
    state: State<'_, AppState>,
) -> Result<Lobby, String> {
    log::info!("收到加入大厅命令: name={}, player={}, player_id={}, use_domain={:?}", name, player_name, player_id, use_domain);
    
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
        use_domain.unwrap_or(false),
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
            
            // 获取虚拟IP（用于P2P信令服务和HTTP文件服务器）
            let virtual_ip = lobby.virtual_ip.clone();
            drop(lobby_mgr);
            drop(network_svc);
            
            log::info!("使用前端提供的玩家ID: {}", player_id);
            
            // 不再启动本地 WebSocket 信令服务器
            // 所有客户端都连接到公网信令服务器 (ws://24.233.29.43:8445)
            log::info!("客户端将连接到公网信令服务器: ws://24.233.29.43:8445");
            
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
                    core.set_state(CoreAppState::Error(format!("P2P信令服务启动失败: {}", e))).await;
                    return Err(format!("P2P信令服务启动失败: {}", e));
                }
            }
            drop(p2p_svc);
            
            // 启动HTTP文件服务器
            log::info!("正在启动HTTP文件服务器...");
            let file_transfer = core.get_file_transfer();
            let ft_service = file_transfer.lock().await;
            ft_service.set_virtual_ip(virtual_ip.clone());
            match ft_service.start_server().await {
                Ok(_) => {
                    log::info!("✅ HTTP文件服务器启动成功");
                }
                Err(e) => {
                    log::error!("❌ HTTP文件服务器启动失败: {}", e);
                    // 文件服务器启动失败不应该阻止加入大厅
                }
            }
            drop(ft_service);
            
            // 启动P2P聊天服务器
            log::info!("正在启动P2P聊天服务器...");
            let chat_service = core.get_chat_service();
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
    let file_transfer = core.get_file_transfer();
    
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
        use windows::Win32::UI::WindowsAndMessaging::{
            SetLayeredWindowAttributes, GetWindowLongW, SetWindowLongW,
            GWL_EXSTYLE, WS_EX_LAYERED, LWA_ALPHA
        };
        
        if let Ok(hwnd) = window.hwnd() {
            let hwnd = HWND(hwnd.0 as *mut _);
            let alpha = (clamped_opacity * 255.0) as u8;
            
            unsafe {
                // 确保窗口有 WS_EX_LAYERED 样式
                let ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE);
                if (ex_style & WS_EX_LAYERED.0 as i32) == 0 {
                    SetWindowLongW(hwnd, GWL_EXSTYLE, ex_style | WS_EX_LAYERED.0 as i32);
                    log::info!("已添加 WS_EX_LAYERED 样式");
                }
                
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
        
        let app_name = "MCTier";
        let app_path = std::env::current_exe()
            .map_err(|e| format!("获取程序路径失败: {}", e))?
            .to_string_lossy()
            .replace("/", "\\");
        
        if enable {
            // 创建任务计划：启用自启
            let task_command = format!("\"{}\" --auto-start", app_path);
            let args = vec![
                "/create",
                "/tn", app_name,
                "/tr", &task_command,
                "/sc", "onlogon",
                "/delay", "0000:02",
                "/rl", "highest",
                "/f",
            ];
            
            log::info!("执行命令: schtasks.exe {}", args.join(" "));
            
            let output = Command::new("schtasks.exe")
                .args(&args)
                .output()
                .map_err(|e| format!("执行 schtasks 命令失败: {}", e))?;
            
            if !output.status.success() {
                let error = String::from_utf8_lossy(&output.stderr);
                log::error!("创建自启任务失败: {}", error);
                return Err(format!("创建自启任务失败: {}", error));
            }
            
            log::info!("开机自启动已启用");
            Ok(())
        } else {
            // 删除任务计划：禁用自启
            let args = vec![
                "/delete",
                "/tn", app_name,    // 任务名称
                "/f",               // 强制删除
            ];
            
            log::info!("执行命令: schtasks.exe {}", args.join(" "));
            
            let output = Command::new("schtasks.exe")
                .args(&args)
                .output()
                .map_err(|e| format!("执行 schtasks 命令失败: {}", e))?;
            
            if !output.status.success() {
                let error = String::from_utf8_lossy(&output.stderr);
                log::error!("删除自启任务失败: {}", error);
                return Err(format!("删除自启任务失败: {}", error));
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
/// * `Ok(bool)` - true=已启用自启动，false=未启用自启动
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn check_auto_start() -> Result<bool, String> {
    log::info!("检查开机自启动状态");
    
    #[cfg(windows)]
    {
        use std::process::Command;
        
        let app_name = "MCTier";
        
        // 查询任务计划
        let args = vec![
            "/query",
            "/tn", app_name,
            "/fo", "list",
        ];
        
        let output = Command::new("schtasks.exe")
            .args(&args)
            .output()
            .map_err(|e| format!("执行 schtasks 命令失败: {}", e))?;
        
        // 如果任务存在，exitCode 为 0
        let is_enabled = output.status.success();
        
        log::info!("开机自启动状态: {}", is_enabled);
        Ok(is_enabled)
    }
    
    #[cfg(not(windows))]
    {
        log::warn!("当前平台不支持开机自启动检查");
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
    log::debug!("添加共享文件夹: {} ({})", share.name, share.id);
    
    let core = state.core.lock().await;
    let file_transfer = core.get_file_transfer();
    let ft_service = file_transfer.lock().await;
    
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
) -> Result<Vec<FileTransferFileInfo>, String> {
    log::info!("获取远程文件列表: {} / {} / {:?}", peer_ip, share_id, path);
    
    let mut url = format!("http://{}:14539/api/shares/{}/files", peer_ip, share_id);
    if let Some(p) = path {
        url = format!("{}?path={}", url, urlencoding::encode(&p));
    }
    
    match reqwest::get(&url).await {
        Ok(response) => {
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

/// 删除文件
/// 
/// # 参数
/// * `path` - 文件路径
/// 
/// # 返回
/// * `Ok(())` - 删除成功
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn delete_file(path: String) -> Result<(), String> {
    log::info!("删除文件: {}", path);
    
    use tokio::fs;
    
    // 删除文件
    fs::remove_file(&path)
        .await
        .map_err(|e| format!("删除文件失败: {}", e))?;
    
    log::info!("✅ 文件删除成功: {}", path);
    Ok(())
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
) -> Result<(), String> {
    log::info!("💬 发送P2P聊天消息: {} - {}", player_name, content);
    
    let core = state.core.lock().await;
    let chat_service = core.get_chat_service();
    let chat_svc = chat_service.lock().await;
    
    // 解析消息类型
    let msg_type = match message_type.as_str() {
        "image" => MessageType::Image,
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
    chat_svc.add_local_message(message);
    
    drop(chat_svc);
    drop(core);
    
    // 向所有其他玩家发送消息
    let client = reqwest::Client::new();
    for peer_ip in peer_ips {
        let url = format!("http://{}:14540/api/chat/send", peer_ip);
        let request = SendMessageRequest {
            player_id: player_id.clone(),
            player_name: player_name.clone(),
            content: content.clone(),
            message_type: msg_type.clone(),
            image_data: image_data.clone(),
        };
        
        // 异步发送，不等待响应
        let client_clone = client.clone();
        let url_clone = url.clone();
        tokio::spawn(async move {
            match client_clone.post(&url_clone).json(&request).send().await {
                Ok(_) => {
                    log::info!("✅ 消息已发送到: {}", url_clone);
                }
                Err(e) => {
                    log::warn!("⚠️ 发送消息失败 ({}): {}", url_clone, e);
                }
            }
        });
    }
    
    Ok(())
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
    
    drop(chat_svc);
    drop(core);
    
    // 从所有其他玩家获取消息
    let client = reqwest::Client::new();
    for peer_ip in peer_ips {
        let url = if let Some(ts) = since {
            format!("http://{}:14540/api/chat/messages?since={}", peer_ip, ts)
        } else {
            format!("http://{}:14540/api/chat/messages", peer_ip)
        };
        
        match client.get(&url).send().await {
            Ok(response) => {
                if response.status().is_success() {
                    match response.json::<Vec<ChatServiceMessage>>().await {
                        Ok(messages) => {
                            all_messages.extend(messages);
                        }
                        Err(e) => {
                            log::warn!("⚠️ 解析消息失败 ({}): {}", peer_ip, e);
                        }
                    }
                }
            }
            Err(e) => {
                log::warn!("⚠️ 获取消息失败 ({}): {}", peer_ip, e);
            }
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
