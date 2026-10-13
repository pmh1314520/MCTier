use super::shared::*;

/// Open a user-supplied web URL with the operating system's default browser.
/// Chat links are deliberately handled here instead of through the shell
/// plugin's fixed-domain allowlist: the URL is parsed and constrained to HTTP(S)
/// before it reaches a platform launcher.
#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), String> {
    if url.len() > 8192 || url.chars().any(|character| character.is_control()) {
        return Err("链接格式无效".into());
    }
    let parsed = reqwest::Url::parse(url.trim()).map_err(|_| "链接格式无效")?;
    if !matches!(parsed.scheme(), "http" | "https")
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Err("仅支持不带账号信息的 HTTP(S) 链接".into());
    }

    #[cfg(windows)]
    {
        std::process::Command::new(windows_system_command("explorer.exe"))
            .arg(parsed.as_str())
            .spawn()
            .map_err(|error| format!("无法打开系统浏览器: {error}"))?;
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new(unix_system_command("open")?)
            .arg(parsed.as_str())
            .spawn()
            .map_err(|error| format!("无法打开系统浏览器: {error}"))?;
        return Ok(());
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new(unix_system_command("xdg-open")?)
            .arg(parsed.as_str())
            .spawn()
            .map_err(|error| format!("无法打开系统浏览器: {error}"))?;
        return Ok(());
    }
    #[allow(unreachable_code)]
    Err("当前系统不支持打开外部链接".into())
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
    address_attempt: Option<u16>,
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Lobby, String> {
    let password = crate::modules::secret_store::resolve(&password)?;
    require_secure_signaling(&signaling_server)?;
    log::info!(
        "收到创建大厅命令: name={}, player={}, player_id={}, signaling_server={}, use_domain={:?}",
        name,
        player_name,
        player_id,
        signaling_server,
        use_domain
    );

    let core = state.core.lock().await;

    // Claim the transition while holding core: overlapping requests must not
    // overwrite state or roll back a session owned by another request.
    if matches!(
        core.get_state().await,
        CoreAppState::Connecting | CoreAppState::InLobby
    ) {
        return Err("大厅正在连接或已连接，请先退出当前大厅".to_string());
    }
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
    let p2p_signaling = core.get_p2p_signaling();
    let file_transfer = core.get_file_transfer();
    let chat_service = core.get_chat_service();

    // 释放 core 的锁，避免死锁
    drop(core);

    // 创建大厅
    let mut lobby_mgr = lobby_manager.lock().await;
    let network_svc = network_service.lock().await;

    match lobby_mgr
        .create_lobby_with_config(
            name,
            password,
            player_name.clone(),
            &player_id,
            server_node,
            signaling_server.clone(),
            use_domain.unwrap_or(false),
            &*network_svc,
            &app_handle,
            global_config,
            lobby_config,
            address_attempt.unwrap_or(0),
        )
        .await
    {
        Ok(lobby) => {
            log::info!("大厅创建成功: {}", lobby.name);

            // Never put the EasyTier/lobby secret into the persistent log.
            let mut log_lobby = lobby.clone();
            log_lobby.password = None;
            if let Ok(json) = serde_json::to_string(&log_lobby) {
                log::info!("大厅JSON: {}", json);
            }

            // 获取虚拟IP
            let virtual_ip = lobby.virtual_ip.clone();
            drop(lobby_mgr);
            drop(network_svc);

            log::info!("使用前端提供的玩家ID: {}", player_id);

            log::info!("客户端将连接到 WebSockets 信令服务器: {}", signaling_server);

            // 创建者也必须注册到远程信令服务器。此前只有加入大厅路径启动
            // P2P 信令，导致创建者没有向 Android/其他客户端发布大厅成员、
            // 聊天凭据和 WebRTC 信令，加入端会误判大厅不存在并自行成为房主。
            log::info!("正在启动P2P信令服务（创建大厅）...");
            let p2p_svc = p2p_signaling.lock().await;
            match p2p_svc
                .start(player_id, player_name, virtual_ip.clone())
                .await
            {
                Ok(_) => log::info!("✅ P2P信令服务启动成功（创建大厅）"),
                Err(e) => {
                    log::error!("❌ 启动P2P信令服务失败（创建大厅）: {}", e);
                    drop(p2p_svc);
                    lobby_manager.lock().await.force_clear_state();
                    let _ = network_service.lock().await.stop_easytier().await;
                    let core = state.core.lock().await;
                    core.set_state(CoreAppState::Error(format!("P2P信令服务启动失败: {}", e)))
                        .await;
                    drop(core);
                    return Err(format!("P2P信令服务启动失败: {}", e));
                }
            }
            drop(p2p_svc);

            // 不再在创建大厅时自动启动HTTP文件服务器
            // HTTP服务器将在第一次添加共享时按需启动
            log::info!("📝 HTTP文件服务器将在添加共享时按需启动");
            let ft_service = file_transfer.lock().await;
            ft_service.set_virtual_ip(virtual_ip.clone());
            drop(ft_service);

            // 聊天服务必须等待信令服务器下发 lobby token 后才能启动。
            let chat_svc = chat_service.lock().await;
            chat_svc.reset_for_lobby().await;
            chat_svc.set_virtual_ip(virtual_ip.clone());
            drop(chat_svc);

            // 更新应用状态为在大厅中
            let core = state.core.lock().await;
            core.set_state(CoreAppState::InLobby).await;
            drop(core);

            Ok(lobby)
        }
        Err(e) => {
            log::error!("创建大厅失败: {}", e);

            // Roll back partial setup.  EasyTier may already be running and
            // LobbyManager may already contain a lobby when the later P2P
            // signaling step fails; leaving either behind makes the next
            // click fail immediately with AlreadyInLobby.
            if matches!(e, crate::modules::lobby_manager::LobbyError::AlreadyInLobby) {
                drop(lobby_mgr);
                drop(network_svc);
                state
                    .core
                    .lock()
                    .await
                    .set_state(CoreAppState::InLobby)
                    .await;
                return Err(e.to_string());
            }
            lobby_mgr.force_clear_state();
            let _ = network_svc.stop_easytier().await;

            // 更新应用状态为错误
            drop(lobby_mgr);
            drop(network_svc);
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
    address_attempt: Option<u16>,
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Lobby, String> {
    let password = crate::modules::secret_store::resolve(&password)?;
    require_secure_signaling(&signaling_server)?;
    log::info!(
        "收到加入大厅命令: name={}, player={}, player_id={}, signaling_server={}, use_domain={:?}",
        name,
        player_name,
        player_id,
        signaling_server,
        use_domain
    );

    let core = state.core.lock().await;

    if matches!(
        core.get_state().await,
        CoreAppState::Connecting | CoreAppState::InLobby
    ) {
        return Err("大厅正在连接或已连接，请先退出当前大厅".to_string());
    }
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

    match lobby_mgr
        .join_lobby_with_config(
            name,
            password,
            player_name.clone(),
            &player_id,
            server_node,
            signaling_server.clone(),
            use_domain.unwrap_or(false),
            &*network_svc,
            &app_handle,
            global_config,
            lobby_config,
            address_attempt.unwrap_or(0),
        )
        .await
    {
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

            log::info!("客户端将连接到 WebSockets 信令服务器: {}", signaling_server);

            // 启动P2P信令服务
            log::info!("正在启动P2P信令服务（加入大厅）...");
            let p2p_svc = p2p_signaling.lock().await;
            match p2p_svc
                .start(player_id, player_name, virtual_ip.clone())
                .await
            {
                Ok(_) => {
                    log::info!("✅ P2P信令服务启动成功（加入大厅）");
                }
                Err(e) => {
                    log::error!("❌ 启动P2P信令服务失败（加入大厅）: {}", e);
                    // P2P信令服务启动失败应该返回错误，因为没有它就无法发现其他玩家
                    drop(p2p_svc);
                    lobby_manager.lock().await.force_clear_state();
                    let _ = network_service.lock().await.stop_easytier().await;
                    let core = state.core.lock().await;
                    core.set_state(CoreAppState::Error(format!("P2P信令服务启动失败: {}", e)))
                        .await;
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

            // 聊天服务必须等待信令服务器下发 lobby token 后才能启动。
            let chat_svc = chat_service.lock().await;
            chat_svc.reset_for_lobby().await;
            chat_svc.set_virtual_ip(virtual_ip.clone());
            drop(chat_svc);

            // 更新应用状态为在大厅中
            let core = state.core.lock().await;
            core.set_state(CoreAppState::InLobby).await;
            drop(core);

            Ok(lobby)
        }
        Err(e) => {
            log::error!("加入大厅失败: {}", e);

            // Roll back partial setup so a failed join can be retried without
            // requiring an application restart or a separate force-stop.
            if matches!(e, crate::modules::lobby_manager::LobbyError::AlreadyInLobby) {
                drop(lobby_mgr);
                drop(network_svc);
                state
                    .core
                    .lock()
                    .await
                    .set_state(CoreAppState::InLobby)
                    .await;
                return Err(e.to_string());
            }
            lobby_mgr.force_clear_state();
            let _ = network_svc.stop_easytier().await;

            // 更新应用状态为错误
            drop(lobby_mgr);
            drop(network_svc);
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
    crate::modules::voice_ice::stop();
    log::info!("收到退出大厅命令");

    let core = state.core.lock().await;

    // 获取各个服务的引用
    let lobby_manager = core.get_lobby_manager();
    let network_service = core.get_network_service();
    let voice_service = core.get_voice_service();
    let p2p_signaling = core.get_p2p_signaling();
    let file_transfer = core.get_file_transfer();
    let chat_service = core.get_chat_service();

    // 【修复】尽早释放 core 锁，避免在数秒级的 stop_easytier（netsh/pnputil/PowerShell）
    // 期间一直占用 core 锁，导致其它命令阻塞、界面卡死
    drop(core);

    // 先撤销聊天 token、身份映射和历史，再停止虚拟网络。
    let chat_svc = chat_service.lock().await;
    chat_svc.stop_server().await;
    drop(chat_svc);

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
pub async fn toggle_mic(state: State<'_, AppState>, app: tauri::AppHandle) -> Result<bool, String> {
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

/// 显式设置麦克风状态。用于浏览器权限请求失败后把 Rust 与前端状态一起回滚。
#[tauri::command]
pub async fn set_mic_enabled(
    enabled: bool,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<bool, String> {
    let core = state.core.lock().await;
    let voice_service = core.get_voice_service();
    let new_state = voice_service
        .lock()
        .await
        .set_mic_enabled(enabled)
        .await
        .map_err(|e| e.to_string())?;

    if let Err(e) = app.emit("mic-toggled", new_state) {
        log::error!("发送麦克风状态事件失败: {}", e);
    }
    Ok(new_state)
}

/// 打开操作系统的麦克风隐私设置，供永久拒绝权限的用户恢复授权。
#[tauri::command]
pub fn open_microphone_privacy_settings() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new(windows_system_command("explorer.exe"))
            .arg("ms-settings:privacy-microphone")
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new(unix_system_command("open")?)
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone")
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    #[cfg(target_os = "linux")]
    {
        return Err(
            "当前 Linux 桌面环境无法自动定位麦克风权限页，请在系统设置中手动允许 MCTier 使用麦克风"
                .to_string(),
        );
    }

    #[allow(unreachable_code)]
    Ok(())
}

/// 打开 macOS 辅助功能隐私设置：被远程控制需要 MCTier 出现在辅助功能授权
/// 列表里，该权限无法由应用发起系统弹窗，只能引导用户到对应设置页手动添加。
#[tauri::command]
pub fn open_accessibility_privacy_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        crate::modules::macos_platform::open_privacy_settings("accessibility")
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err("该功能仅 macOS 需要".to_string())
    }
}

/// 设置 Dock 图标角标（macOS）。`count` 为 0 时清除角标，超过 99 显示 "99+"。
/// 非 macOS 平台为空操作（Windows 的任务栏未读提示另有实现）。
#[tauri::command]
pub fn set_dock_badge(count: u32) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let label = if count == 0 {
            String::new()
        } else if count > 99 {
            "99+".to_string()
        } else {
            count.to_string()
        };
        crate::modules::macos_platform::set_dock_badge(&label);
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = count;
        Ok(())
    }
}

/// Restart into the permission-reset startup path. The new process waits for this
/// WebView to exit before deleting EBWebView, avoiding locked-file failures.
#[tauri::command]
pub fn reset_microphone_permission(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(any(windows, not(target_os = "macos")))]
    let exe = std::env::current_exe().map_err(|e| format!("获取程序路径失败: {}", e))?;
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new(&exe)
            .arg("--reset-microphone-permission")
            .creation_flags(0x08000000)
            .spawn()
            .map_err(|e| format!("重启 MCTier 失败: {}", e))?;
        app.exit(0);
        Ok(())
    }
    #[cfg(target_os = "macos")]
    {
        let _ = app;
        return open_microphone_privacy_settings();
    }

    #[cfg(not(any(windows, target_os = "macos")))]
    {
        std::process::Command::new(&exe)
            .arg("--reset-microphone-permission")
            .spawn()
            .map_err(|e| format!("重启 MCTier 失败: {}", e))?;
        app.exit(0);
        Ok(())
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

    let mut config = config_mgr.get_config_clone();
    if let Some(auto) = config.auto_lobby.as_mut() {
        auto.lobby_password = auto
            .lobby_password
            .take()
            .map(crate::modules::secret_store::protect_lobby_password)
            .transpose()?;
    }

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
    mut config: UserConfig,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if let Some(auto) = config.auto_lobby.as_mut() {
        auto.lobby_password = auto
            .lobby_password
            .take()
            .map(crate::modules::secret_store::protect_lobby_password)
            .transpose()?;
    }
    log::info!("收到更新配置命令");

    let core = state.core.lock().await;
    let config_manager = core.get_config_manager();
    let mut config_mgr = config_manager.lock().await;

    match config_mgr
        .update_config(|cfg| {
            *cfg = config.clone();
        })
        .await
    {
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
pub async fn save_opacity(opacity: f64, state: State<'_, AppState>) -> Result<(), String> {
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

    log::info!(
        "保存窗口位置: x={}, y={}, width={}, height={}",
        x,
        y,
        width,
        height
    );

    let core = state.core.lock().await;
    let config_manager = core.get_config_manager();
    let mut cfg_mgr = config_manager.lock().await;

    // 检查是否启用了记住窗口位置
    let remember = cfg_mgr
        .get_config()
        .remember_window_position
        .unwrap_or(false);

    if remember {
        let position = WindowPosition {
            x,
            y,
            width,
            height,
        };
        cfg_mgr
            .set_window_position(position)
            .await
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
pub async fn exit_app(state: State<'_, AppState>, app: tauri::AppHandle) -> Result<(), String> {
    if crate::modules::screen_recording::finish_before_exit(&app) { return Ok(()); }
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
    /// 链路延迟（毫秒，来自 EasyTier 自身统计），None 表示未知
    #[serde(rename = "latencyMs", skip_serializing_if = "Option::is_none")]
    pub latency_ms: Option<u64>,
    /// 累计接收字节（用于上层计算下行速率）
    #[serde(rename = "rxBytes", skip_serializing_if = "Option::is_none")]
    pub rx_bytes: Option<u64>,
    /// 累计发送字节（用于上层计算上行速率）
    #[serde(rename = "txBytes", skip_serializing_if = "Option::is_none")]
    pub tx_bytes: Option<u64>,
    /// 丢包率（百分比 0~100），None 表示未知
    #[serde(rename = "lossRate", skip_serializing_if = "Option::is_none")]
    pub loss_rate: Option<u8>,
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

    let cli_path =
        crate::modules::resource_manager::ResourceManager::get_easytier_cli_path(&app_handle)
            .map_err(|e| format!("获取 easytier-cli 失败: {}", e))?;

    let mut cmd = tokio::process::Command::new(&cli_path);
    cmd.args(["-p", &format!("127.0.0.1:{}", port), "-o", "json", "peer"]);
    #[cfg(target_os = "windows")]
    {
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
    let parsed: serde_json::Value =
        serde_json::from_str(stdout.trim()).unwrap_or(serde_json::Value::Null);

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
                        let conn = if cost.eq_ignore_ascii_case("p2p") {
                            "p2p"
                        } else {
                            "relay"
                        };
                        // 从 stats 提取延迟/收发字节/丢包（字段名兼容大小写差异）
                        let stats = map.get("stats");
                        let latency_ms = stats
                            .and_then(|s| s.get("latency_us"))
                            .and_then(|v| v.as_u64())
                            .map(|us| us / 1000);
                        let rx_bytes = stats
                            .and_then(|s| s.get("rx_bytes"))
                            .and_then(|v| v.as_u64());
                        let tx_bytes = stats
                            .and_then(|s| s.get("tx_bytes"))
                            .and_then(|v| v.as_u64());
                        let loss_rate = map
                            .get("loss_rate")
                            .and_then(|v| v.as_f64())
                            .map(|f| ((f.clamp(0.0, 1.0)) * 100.0).round() as u8);
                        out.push(PeerConnType {
                            ip: ip.to_string(),
                            conn_type: conn.to_string(),
                            latency_ms,
                            rx_bytes,
                            tx_bytes,
                            loss_rate,
                        });
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
pub async fn set_always_on_top(always_on_top: bool, window: tauri::Window) -> Result<(), String> {
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
pub async fn toggle_mini_mode(mini_mode: bool, window: tauri::Window) -> Result<(), String> {
    log::info!("切换迷你模式: {}", mini_mode);

    if mini_mode {
        // Mini mode stays compact on every platform.
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
        // Restore the desktop window to the platform's intended logical size.
        #[cfg(target_os = "macos")]
        let (width, height) = (980.0, 680.0);
        #[cfg(not(target_os = "macos"))]
        let (width, height) = (1000.0, 700.0);
        window
            .set_size(tauri::Size::Logical(tauri::LogicalSize { width, height }))
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
pub async fn set_window_opacity(opacity: f64, window: tauri::Window) -> Result<(), String> {
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
