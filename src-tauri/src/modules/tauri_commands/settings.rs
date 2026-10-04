use super::network::*;
use super::shared::*;

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
    language: Option<String>,
    auto_startup: bool,
    auto_lobby_enabled: Option<bool>,
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
    close_to_tray: Option<bool>,
    start_minimized: Option<bool>,
    custom_easytier_nodes: Option<Vec<serde_json::Value>>,
    voice_volume: Option<f64>,
    enable_gpu_rendering: Option<bool>,
    mic_hotkey: Option<String>,
    global_mute_hotkey: Option<String>,
    push_to_talk_hotkey: Option<String>,
    summon_hotkey: Option<String>,
    enable_exit_node: Option<bool>,
    enable_as_exit_node: Option<bool>,
    proxy_cidrs: Option<String>,
    exit_nodes: Option<String>,
    subnet_proxy_cidrs: Option<String>,
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    use crate::modules::config_manager::{AutoLobbyConfig, EasyTierNode};
    log::info!("保存设置: auto_startup={}, auto_lobby_enabled={:?}, use_private_server={}, always_on_top={:?}, remember_window_position={:?}, voice_volume={:?}, enable_gpu_rendering={:?}, mic_hotkey={:?}, global_mute_hotkey={:?}, push_to_talk_hotkey={:?}, enable_exit_node={:?}, subnet_proxy_cidrs={:?}, virtual_domain={:?}",
        auto_startup, auto_lobby_enabled, use_private_server, always_on_top, remember_window_position, voice_volume, enable_gpu_rendering, mic_hotkey, global_mute_hotkey, push_to_talk_hotkey, enable_exit_node, subnet_proxy_cidrs, virtual_domain);

    let legacy_config_password = {
        let config_manager = state.config_manager().await;
        let cfg_mgr = config_manager.lock().await;
        cfg_mgr
            .get_config()
            .auto_lobby
            .as_ref()
            .and_then(|auto_lobby| auto_lobby.lobby_password.clone())
    };
    if let Some(password) = lobby_password.clone().or(legacy_config_password) {
        let password = crate::modules::secret_store::resolve(&password)?;
        tokio::task::spawn_blocking(move || write_auto_lobby_secret(&password))
            .await
            .map_err(|error| format!("保存系统凭据任务失败: {}", error))??;
    }

    // 1. 保存配置到文件
    {
        let config_manager = state.config_manager().await;
        let mut cfg_mgr = config_manager.lock().await;
        cfg_mgr
            .update_config(|config| {
                if let Some(value) = language.as_deref() {
                    if matches!(value, "system" | "zh" | "en") {
                        config.language = Some(value.to_string());
                    }
                }
                config.auto_startup = Some(auto_startup);
                // 读取已有的auto_lobby配置，只更新非None的字段
                let existing = config.auto_lobby.clone().unwrap_or_default();

                // 如果传入了 lobby_name、lobby_password 或 player_name，则更新这些字段
                // 如果传入了 use_domain 或 virtual_domain，则更新这些字段（独立于其他字段）
                let updated_use_domain = if lobby_name.is_some()
                    || lobby_password.is_some()
                    || player_name.is_some()
                    || virtual_domain.is_some()
                {
                    use_domain
                } else {
                    existing.use_domain
                };

                let updated_virtual_domain = if virtual_domain.is_some() {
                    virtual_domain.clone()
                } else {
                    existing.virtual_domain.clone()
                };

                log::info!(
                    "更新 auto_lobby 配置: use_domain={}, virtual_domain={:?}",
                    updated_use_domain,
                    updated_virtual_domain
                );

                config.auto_lobby = Some(AutoLobbyConfig {
                    enabled: auto_lobby_enabled.unwrap_or(existing.enabled),
                    lobby_name: lobby_name.clone().or(existing.lobby_name),
                    lobby_password: None,
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
                // 保存「关闭时最小化到托盘」配置
                if let Some(v) = close_to_tray {
                    config.close_to_tray = Some(v);
                }
                // 保存「启动后自动隐藏到托盘」配置
                if let Some(v) = start_minimized {
                    config.start_minimized = Some(v);
                }
                // 保存自定义 EasyTier 节点
                if let Some(nodes_json) = custom_easytier_nodes.clone() {
                    let nodes: Vec<EasyTierNode> = nodes_json
                        .iter()
                        .filter_map(|n| {
                            if let (Some(name), Some(address)) = (
                                n.get("name").and_then(|v| v.as_str()),
                                n.get("address").and_then(|v| v.as_str()),
                            ) {
                                Some(EasyTierNode {
                                    name: name.to_string(),
                                    address: address.to_string(),
                                })
                            } else {
                                None
                            }
                        })
                        .collect();
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
                if let Some(hotkey) = summon_hotkey {
                    config.summon_hotkey = Some(hotkey);
                }
                // 保存出口节点配置
                if let Some(enable) = enable_exit_node {
                    if config.exit_node_config.is_none() {
                        config.exit_node_config =
                            Some(crate::modules::config_manager::ExitNodeConfig::default());
                    }
                    if let Some(ref mut exit_config) = config.exit_node_config {
                        exit_config.enable_exit_node = enable;
                    }
                }
                if let Some(enable) = enable_as_exit_node {
                    if config.exit_node_config.is_none() {
                        config.exit_node_config =
                            Some(crate::modules::config_manager::ExitNodeConfig::default());
                    }
                    if let Some(ref mut exit_config) = config.exit_node_config {
                        exit_config.enable_as_exit_node = enable;
                    }
                }
                if let Some(cidrs) = proxy_cidrs {
                    if config.exit_node_config.is_none() {
                        config.exit_node_config =
                            Some(crate::modules::config_manager::ExitNodeConfig::default());
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
                        config.exit_node_config =
                            Some(crate::modules::config_manager::ExitNodeConfig::default());
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
                        config.exit_node_config =
                            Some(crate::modules::config_manager::ExitNodeConfig::default());
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
            })
            .await
            .map_err(|e| format!("保存配置失败: {}", e))?;
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

    let config = {
        let config_manager = state.config_manager().await;
        let cfg_mgr = config_manager.lock().await;
        cfg_mgr.get_config().clone()
    };

    let _auto_startup = config.auto_startup.unwrap_or(false);
    let auto_lobby = config.auto_lobby.clone().unwrap_or_default();
    let mut lobby_password = tokio::task::spawn_blocking(read_auto_lobby_secret)
        .await
        .map_err(|error| format!("读取系统凭据任务失败: {}", error))??;
    if let Some(legacy_password) = auto_lobby.lobby_password.clone() {
        if lobby_password.is_none() {
            let password = crate::modules::secret_store::resolve(&legacy_password)?;
            tokio::task::spawn_blocking(move || write_auto_lobby_secret(&password))
                .await
                .map_err(|_| "Cannot migrate lobby password")??;
            lobby_password = Some(legacy_password);
        }

        let config_manager = state.config_manager().await;
        let mut cfg_mgr = config_manager.lock().await;
        cfg_mgr
            .update_config(|config| {
                if let Some(auto_lobby) = config.auto_lobby.as_mut() {
                    auto_lobby.lobby_password = None;
                }
            })
            .await
            .map_err(|error| format!("清理配置中的明文密码失败: {}", error))?;
    }

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
                    std::process::Command::new(windows_system_command("reg.exe"))
                        .args([
                            "query",
                            "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
                            "/v",
                            "MCTier",
                        ])
                        .creation_flags(0x08000000)
                        .output()
                        .map(|o| o.status.success())
                        .unwrap_or(false)
                }),
            )
            .await;

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
        #[cfg(target_os = "linux")]
        {
            crate::modules::linux_platform::auto_start_enabled()
        }

        #[cfg(not(any(windows, target_os = "linux")))]
        {
            false
        }
    };

    log::info!("设置配置读取完成");

    // 读取出口节点配置
    let exit_node_config = config.exit_node_config.clone().unwrap_or_default();

    Ok(serde_json::json!({
        "language": config.language.clone(),
        "autoStartup": actual_auto_start,
        "autoLobbyEnabled": auto_lobby.enabled,
        "lobbyName": auto_lobby.lobby_name,
        "lobbyPassword": lobby_password.map(crate::modules::secret_store::protect_lobby_password).transpose()?,
        "playerName": auto_lobby.player_name,
        "avatarData": config.avatar_data.clone(),
        "useDomain": auto_lobby.use_domain,
        "virtualDomain": auto_lobby.virtual_domain,
        "usePrivateServer": config.use_private_server.unwrap_or(false),
        // 返回实际保存的值，如果是 None 就返回 null，让前端决定默认值
        "privateEasytierServer": config.private_easytier_server.clone(),
        "privateSignalingServer": config.private_signaling_server.clone(),
        "alwaysOnTop": config.always_on_top.unwrap_or(true),
        "rememberWindowPosition": config.remember_window_position.unwrap_or(false),
        "closeToTray": config.close_to_tray.unwrap_or(false),
        "startMinimized": config.start_minimized.unwrap_or(false),
        "customEasytierNodes": config.custom_easytier_nodes.clone().unwrap_or_default(),
        "voiceVolume": config.voice_volume.unwrap_or(1.0),
        "enableGpuRendering": config.enable_gpu_rendering.unwrap_or(true),
        "micHotkey": config.mic_hotkey.clone().unwrap_or_else(|| "Ctrl+M".to_string()),
        "globalMuteHotkey": config.global_mute_hotkey.clone().unwrap_or_else(|| "Ctrl+T".to_string()),
        "pushToTalkHotkey": config.push_to_talk_hotkey.clone().unwrap_or_else(|| "F2".to_string()),
        "summonHotkey": config.summon_hotkey.clone().unwrap_or_else(|| "Ctrl+Alt+M".to_string()),
        "enableExitNode": exit_node_config.enable_exit_node,
        "enableAsExitNode": exit_node_config.enable_as_exit_node,
        // 将 Vec<String> 转换为换行分隔的字符串
        "proxyCidrs": exit_node_config.proxy_cidrs.join("\n"),
        "exitNodes": exit_node_config.exit_nodes.join("\n"),
        "subnetProxyCidrs": exit_node_config.subnet_proxy_cidrs.join("\n"),
        "fileShareDownloadDir": config.file_share_download_dir.clone(),
        "recordingDirectory": config.recording_directory.clone(),
    }))
}

/// 保存全局用户头像。头像由前端压缩后以 data URL 传入，清空时传 null。
#[tauri::command]
pub async fn set_avatar_data(
    avatar_data: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if let Some(data) = avatar_data.as_deref() {
        if !data.starts_with("data:image/") || data.len() > 180_000 {
            return Err("头像格式或大小无效".to_string());
        }
    }
    let config_manager = state.config_manager().await;
    let mut cfg_mgr = config_manager.lock().await;
    cfg_mgr
        .update_config(|config| {
            config.avatar_data = avatar_data.clone();
        })
        .await
        .map_err(|e| format!("保存头像失败: {}", e))
}

#[tauri::command]
pub async fn clear_avatar_cache() -> Result<(), String> {
    let cache_dir = crate::modules::app_paths::data_root()
        .map_err(|e| e.to_string())?.join("avatar-cache");
    match tokio::fs::remove_dir_all(&cache_dir).await {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("清理头像缓存失败: {}", error)),
    }
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

    let config_manager = state.config_manager().await;
    let mut cfg_mgr = config_manager.lock().await;

    cfg_mgr
        .set_voice_volume(volume)
        .await
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

    let config_manager = state.config_manager().await;
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

    let export_path = require_path_grant(&export_path, PathAccess::WriteFile, true)?;
    if export_path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_none_or(|extension| !extension.eq_ignore_ascii_case("json"))
    {
        return Err("配置导出路径必须使用 .json 扩展名".to_string());
    }

    let config_manager = state.config_manager().await;
    let cfg_mgr = config_manager.lock().await;

    cfg_mgr
        .export_config(export_path)
        .await
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

    let import_path = require_existing_file_grant(&import_path, PathAccess::ReadFile)?;
    if import_path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_none_or(|extension| !extension.eq_ignore_ascii_case("json"))
    {
        return Err("配置导入路径必须使用 .json 扩展名".to_string());
    }

    let config_manager = state.config_manager().await;
    let mut cfg_mgr = config_manager.lock().await;

    cfg_mgr
        .import_config(import_path)
        .await
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
pub async fn restart_app_with_gpu_settings(
    enable_gpu: bool,
    app: tauri::AppHandle,
) -> Result<(), String> {
    log::info!("重启应用以应用 GPU 设置: enable_gpu={}", enable_gpu);

    use std::process::Command;

    // 获取当前可执行文件路径
    let exe_path = std::env::current_exe().map_err(|e| format!("获取程序路径失败: {}", e))?;

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;

        let browser_arguments = if !enable_gpu {
            "--disable-gpu --disable-software-rasterizer --disable-gpu-compositing --disable-gpu-process-crash-limit --in-process-gpu"
        } else {
            "--enable-gpu-rasterization --enable-zero-copy --ignore-gpu-blocklist"
        };
        log::info!("直接启动新进程以应用 GPU 设置");
        Command::new(&exe_path)
            .env("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", browser_arguments)
            .creation_flags(0x08000000)
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
            cmd.env(
                "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
                "--enable-gpu-rasterization --enable-zero-copy --ignore-gpu-blocklist",
            );
        }

        cmd.spawn().map_err(|e| format!("启动新进程失败: {}", e))?;
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

    let config_manager = state.config_manager().await;
    let mut cfg_mgr = config_manager.lock().await;

    cfg_mgr
        .update_config(|config| {
            // 确保 exit_node_config 存在
            if config.exit_node_config.is_none() {
                config.exit_node_config =
                    Some(crate::modules::config_manager::ExitNodeConfig::default());
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
                    let rules: Vec<PortForwardRule> = rules_json
                        .iter()
                        .filter_map(|r| {
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
                        })
                        .collect();
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
        })
        .await
        .map_err(|e| format!("保存出口节点高级配置失败: {}", e))?;

    log::info!("出口节点高级配置保存成功");
    Ok(())
}

/// 获取出口节点高级配置
///
/// # 返回
/// * `Ok(serde_json::Value)` - 出口节点高级配置
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn get_exit_node_advanced_config(
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    log::info!("获取出口节点高级配置");

    let config_manager = state.config_manager().await;
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

#[tauri::command]
pub async fn get_compliance_consent(state: State<'_, AppState>) -> Result<bool, String> {
    let manager = state.config_manager().await;
    let cfg = manager.lock().await;
    Ok(cfg.get_config().compliance_accepted == Some(true))
}
#[tauri::command]
pub async fn accept_compliance(window: tauri::WebviewWindow, state: State<'_, AppState>) -> Result<(), String> {
    if window.label() != "main" || !crate::modules::media_permission::trusted(window.url().map_err(|e| e.to_string())?.as_str()) {
        return Err("Only the main window can accept the agreement".into());
    }
    let manager = state.config_manager().await;
    let mut cfg = manager.lock().await;
    cfg.update_config(|config| config.compliance_accepted = Some(true)).await.map_err(|e| e.to_string())
}
