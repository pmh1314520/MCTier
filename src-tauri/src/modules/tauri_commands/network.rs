use super::shared::*;

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

    let p2p_signaling = state.p2p_signaling().await;
    let p2p_svc = p2p_signaling.lock().await;

    // 解析信令消息
    let msg_type = message.get("type").and_then(|v| v.as_str()).unwrap_or("");
    let from = message
        .get("from")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let to = message.get("to").and_then(|v| v.as_str());

    let p2p_message = match msg_type {
        "offer" => {
            let sdp = message
                .get("sdp")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            crate::modules::p2p_signaling::P2PMessage::Offer { from, sdp }
        }
        "answer" => {
            let sdp = message
                .get("sdp")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            crate::modules::p2p_signaling::P2PMessage::Answer { from, sdp }
        }
        "ice-candidate" => {
            let candidate = message
                .get("candidate")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            crate::modules::p2p_signaling::P2PMessage::IceCandidate { from, candidate }
        }
        _ => {
            return Err("未知的信令消息类型".to_string());
        }
    };

    // 发送消息
    if let Some(target) = to {
        p2p_svc
            .send_to_player(target, p2p_message)
            .await
            .map_err(|e| e.to_string())?;
    } else {
        p2p_svc
            .broadcast_to_all(p2p_message)
            .await
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

    let p2p_signaling = state.p2p_signaling().await;
    let p2p_svc = p2p_signaling.lock().await;

    // 创建状态更新消息
    let message = crate::modules::p2p_signaling::P2PMessage::StatusUpdate {
        player_id,
        mic_enabled,
    };

    // 广播消息
    p2p_svc
        .broadcast_to_all(message)
        .await
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

    let voice_service = state.voice_service().await;
    let voice_svc = voice_service.lock().await;

    voice_svc
        .send_heartbeat(&player_id)
        .await
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
    let lobby_manager = core.get_lobby_manager();
    let network_svc = network_service.lock().await;

    // 调用NetworkService的stop_easytier方法
    // 该方法已经包含了完整的清理逻辑：
    // 1. 优雅关闭进程（SIGTERM）
    // 2. 强制终止（taskkill /F）
    // 3. 清理虚拟网卡
    // 4. 刷新DNS缓存
    match network_svc.stop_easytier().await {
        Ok(_) => {
            drop(network_svc);
            // A force-stop can be invoked after a cancelled/failed lobby
            // attempt.  EasyTier cleanup alone is insufficient: stale
            // LobbyManager state makes the next create/join fail with
            // AlreadyInLobby immediately.
            lobby_manager.lock().await.force_clear_state();
            log::info!("✅ EasyTier进程及残留大厅状态已强制清理完成");
            Ok(())
        }
        Err(e) => {
            log::warn!("⚠️ 强制停止EasyTier进程时出现警告: {}", e);
            // 即使出现错误，也返回成功，因为可能只是没有进程在运行
            drop(network_svc);
            lobby_manager.lock().await.force_clear_state();
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
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        for image in ["easytier-core.exe", "easytier-cli.exe"] {
            let _ = tokio::process::Command::new(windows_system_command("taskkill.exe"))
                .args(["/F", "/IM", image])
                .creation_flags(CREATE_NO_WINDOW)
                .output()
                .await;
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let pkill = unix_system_command("pkill")?;
        let _ = tokio::process::Command::new(pkill)
            .args(["-9", "-f", "easytier-core"])
            .output()
            .await;
    }

    log::info!("✅ 已发送终止信号给 easytier-core 进程");
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
        use std::os::windows::process::CommandExt;
        use std::process::Command;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        // 使用 ipconfig 命令查找 EasyTier 创建的虚拟网卡
        let output = Command::new(windows_system_command("ipconfig.exe"))
            .arg("/all")
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|e| format!("执行 ipconfig 失败: {}", e))?;

        let output_str = String::from_utf8_lossy(&output.stdout);

        // 查找包含 "EasyTier" 或 "WinTun" 的网卡
        let has_adapter = output_str.contains("EasyTier")
            || output_str.contains("WinTun")
            || output_str.contains("wintun");

        log::info!("虚拟网卡检查结果: {}", has_adapter);
        Ok(has_adapter)
    }

    // Linux：扫描 /sys/class/net 找 EasyTier 建的 TUN 网卡。语义与 Windows 解析
    // ipconfig 一致 —— 网卡只在组网期间存在，未组网时返回 false 属正常。
    #[cfg(target_os = "linux")]
    {
        let has_adapter = crate::modules::linux_platform::has_virtual_adapter();
        log::info!("虚拟网卡检查结果: {}", has_adapter);
        Ok(has_adapter)
    }

    #[cfg(not(any(windows, target_os = "linux")))]
    {
        // 其余平台尚未适配虚拟网卡检测，返回 true 避免阻断流程
        Ok(true)
    }
}

/// 查询当前是否以管理员身份运行
#[tauri::command]
pub async fn is_admin() -> bool {
    #[cfg(windows)]
    {
        use windows::Win32::Foundation::{CloseHandle, HANDLE};
        use windows::Win32::Security::{
            GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY,
        };
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
            let elevated = ok.is_ok() && elevation.TokenIsElevated != 0;
            let _ = CloseHandle(token);
            elevated
        }
    }
    #[cfg(not(windows))]
    {
        true
    }
}

/// 以管理员身份重启应用
#[tauri::command]
pub async fn restart_as_admin(app_handle: tauri::AppHandle) -> Result<(), String> {
    #[cfg(windows)]
    {
        let _ = app_handle;
        Err("MCTier 主程序以普通权限运行，特权操作会单独请求 UAC".to_string())
    }
    // Linux 没有"以管理员重启整个应用"这一步 —— 应用本体本来就不需要 root。
    // 前端这条"一键修复"在 Linux 上真正要做的是给 EasyTier 补 TUN 文件能力，
    // 所以这里复用同一入口，成功后不重启进程。
    #[cfg(target_os = "linux")]
    {
        crate::modules::linux_platform::ensure_easytier_tun_capability(&app_handle).await?;
        log::info!("Linux 权限修复完成（EasyTier TUN 能力已就绪，无需重启应用）");
        Ok(())
    }

    #[cfg(not(any(windows, target_os = "linux")))]
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

    let target = ip
        .parse::<std::net::IpAddr>()
        .map_err(|_| "只允许 Ping 有效的 IP 地址".to_string())?;
    if target.is_unspecified() || target.is_multicast() || target.is_loopback() {
        return Err("不允许 Ping 未指定、组播或回环地址".to_string());
    }
    let target = target.to_string();

    use std::process::Command;

    #[cfg(windows)]
    let output = {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        Command::new(windows_system_command("ping.exe"))
            .args(["-n", "2", "-w", "1000", &target])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|e| format!("执行 ping 失败: {}", e))?
    };

    #[cfg(not(windows))]
    let output = Command::new(unix_system_command("ping")?)
        .args(["-c", "2", "-W", "1", &target])
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
        use std::os::windows::process::CommandExt;
        use std::process::Command;
        let app_name = "MCTier";
        let app_path = std::env::current_exe()
            .map_err(|e| format!("获取程序路径失败: {}", e))?
            .to_string_lossy()
            .replace("/", "\\");

        if enable {
            // A quoted executable path is sufficient for a Run key. Avoid
            // storing a PowerShell script in the registry value.
            let reg_value = windows_run_value(&std::path::PathBuf::from(&app_path))?;

            let output = Command::new(windows_system_command("reg.exe"))
                .args([
                    "add",
                    "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
                    "/v",
                    app_name,
                    "/t",
                    "REG_SZ",
                    "/d",
                    &reg_value,
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
            let output = Command::new(windows_system_command("reg.exe"))
                .args([
                    "delete",
                    "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
                    "/v",
                    app_name,
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

    // Linux：写 XDG autostart 的 .desktop 文件（~/.config/autostart/）
    #[cfg(target_os = "linux")]
    {
        crate::modules::linux_platform::set_auto_start(enable)
    }

    #[cfg(not(any(windows, target_os = "linux")))]
    {
        let _ = enable;
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
        use std::os::windows::process::CommandExt;
        use std::process::Command;
        let app_name = "MCTier";
        let output = Command::new(windows_system_command("reg.exe"))
            .args([
                "query",
                "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
                "/v",
                app_name,
            ])
            .creation_flags(0x08000000)
            .output()
            .map_err(|e| format!("查询注册表失败: {}", e))?;

        let is_enabled = output.status.success();
        log::info!("开机自启动状态（注册表）: {}", is_enabled);
        Ok(is_enabled)
    }

    #[cfg(target_os = "linux")]
    {
        Ok(crate::modules::linux_platform::auto_start_enabled())
    }

    #[cfg(not(any(windows, target_os = "linux")))]
    {
        Ok(false)
    }
}

// ==================== Magic DNS 命令 ====================

/// 添加玩家域名映射到hosts文件
///
/// # 参数
/// * `player_id` - 信令身份指纹；域名由本地从该指纹派生
/// * `ip` - 虚拟IP地址
/// * `state` - 应用状态
///
/// # 返回
/// * `Ok(())` - 添加成功
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn add_player_domain(
    player_id: String,
    ip: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let domain = crate::modules::hosts_manager::HostsManager::domain_for_identity(&player_id)
        .map_err(|error| format!("身份域名派生失败: {}", error))?;
    log::info!("收到添加玩家身份域名映射命令: {} -> {}", player_id, ip);

    let lobby_manager = state.lobby_manager().await;
    let mut manager = lobby_manager.lock().await;

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
        let new_hosts_manager = crate::modules::hosts_manager::HostsManager::new(&lobby_name);
        new_hosts_manager
            .add_entry(&domain, &ip)
            .map_err(|e| format!("添加域名映射失败: {}", e))?;

        // Keep the same lobby guard from validation through publication.
        manager.set_hosts_manager(Some(new_hosts_manager));

        log::info!(
            "✅ 域名映射已添加（动态创建HostsManager）: {} -> {}",
            domain,
            ip
        );
        Ok(())
    };

    hosts_manager
}

/// 删除玩家域名映射
///
/// # 参数
/// * `player_id` - 信令身份指纹；域名由本地从该指纹派生
/// * `state` - 应用状态
///
/// # 返回
/// * `Ok(())` - 删除成功
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn remove_player_domain(
    player_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let domain = crate::modules::hosts_manager::HostsManager::domain_for_identity(&player_id)
        .map_err(|error| format!("身份域名派生失败: {}", error))?;
    log::info!("收到删除玩家身份域名映射命令: {}", player_id);

    let lobby_manager = state.lobby_manager().await;
    let manager = lobby_manager.lock().await;

    // 获取HostsManager
    if let Some(hosts_manager) = manager.get_hosts_manager() {
        hosts_manager
            .remove_entry(&domain)
            .map_err(|e| format!("删除域名映射失败: {}", e))?;

        log::info!("✅ 域名映射已删除: {}", domain);
        Ok(())
    } else {
        // HostsManager不存在，说明没有域名映射需要删除，直接返回成功
        log::info!("⚠️ HostsManager不存在，跳过删除域名映射");
        Ok(())
    }
}
