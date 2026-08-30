// MCTier 后端模块
pub mod modules;

use log::{error, info};
use modules::app_core::AppCore;
use modules::tauri_commands::AppState;
use std::sync::Arc;
use tauri::Emitter;
use tauri::Manager;
use tauri_plugin_global_shortcut::GlobalShortcutExt;
use tokio::sync::Mutex;
static TRAY_NOTIFICATION_TEXT: std::sync::OnceLock<std::sync::RwLock<(String, String)>> =
    std::sync::OnceLock::new();
static TRAY_SUMMON_HOTKEY: std::sync::OnceLock<std::sync::RwLock<String>> =
    std::sync::OnceLock::new();
static TRAY_NOTIFICATION_GENERATION: std::sync::atomic::AtomicU64 =
    std::sync::atomic::AtomicU64::new(0);
static TRAY_NOTIFICATION_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
static RESTORE_ALWAYS_ON_TOP_AFTER_TRAY: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

/// 在应用启动时应用 GPU 设置
fn apply_gpu_settings_on_startup() {
    // 尝试加载配置文件
    let config_path = if let Some(config_dir) = dirs::config_dir() {
        config_dir.join("mctier").join("mctier_config.json")
    } else {
        return;
    };

    if !config_path.exists() {
        println!("配置文件不存在，使用默认GPU设置（启用）");
        return;
    }

    // 读取配置文件
    if let Ok(content) = std::fs::read_to_string(&config_path) {
        if let Ok(config) = serde_json::from_str::<serde_json::Value>(&content) {
            // 检查 GPU 渲染设置（配置文件使用 snake_case）
            let enable_gpu = config
                .get("enable_gpu_rendering")
                .and_then(|v| v.as_bool())
                .unwrap_or(true);

            if !enable_gpu {
                // 设置环境变量完全禁用 GPU（包括GPU进程）
                std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", 
                    "--disable-gpu --disable-software-rasterizer --disable-gpu-compositing --disable-gpu-process-crash-limit --in-process-gpu");
                println!("✅ GPU 渲染已完全禁用（包括GPU进程）");
            } else {
                // 启用 GPU 时，明确设置启用硬件加速的参数
                std::env::set_var(
                    "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
                    "--enable-gpu-rasterization --enable-zero-copy --ignore-gpu-blocklist",
                );
                println!("✅ GPU 渲染已启用（通过环境变量）");
            }
        }
    } else {
        println!("无法读取配置文件，使用默认GPU设置（启用）");
    }
}

fn reset_microphone_permission_cache_on_startup() {
    if !std::env::args().any(|arg| arg == "--reset-microphone-permission") {
        return;
    }

    let Some(local_app_data) = dirs::data_local_dir() else {
        return;
    };
    let webview_dir = local_app_data.join("com.mctier.app").join("EBWebView");

    // The previous process may hold WebView2 files briefly after spawning us.
    for attempt in 0..40 {
        if !webview_dir.exists() {
            break;
        }
        match std::fs::remove_dir_all(&webview_dir) {
            Ok(()) => break,
            Err(_) if attempt < 39 => std::thread::sleep(std::time::Duration::from_millis(250)),
            Err(error) => eprintln!("failed to clear WebView2 permission cache: {}", error),
        }
    }
}

use modules::tauri_commands::{
    add_firewall_rules, add_player_domain, add_shared_folder, broadcast_status_update,
    cancel_lobby_connecting, cancel_remote_download, check_auto_start, check_file_server_status,
    check_firewall_rules, check_udp_port, check_virtual_adapter, cleanup_expired_shares,
    clear_avatar_cache, clear_p2p_chat_messages, close_danmaku_window, close_game_hud_window,
    configure_p2p_chat, create_lobby, danmaku_cursor_pos, delete_file, detect_security_software,
    diagnose_file_share_connection, download_remote_batch, download_remote_file, exit_app,
    export_config, export_logs, extract_zip, force_stop_easytier, gamehud_cursor_pos,
    get_app_state, get_audio_devices, get_config, get_current_lobby, get_download_url,
    get_exit_node_advanced_config, get_file_share_download_dir, get_file_share_download_path,
    get_folder_info, get_folder_name, get_global_mute_status, get_local_shares, get_log_file_path,
    get_mic_status, get_network_status, get_p2p_chat_messages, get_peer_connection_types,
    get_players, get_remote_files, get_remote_shares, get_settings, get_virtual_ip, import_config,
    is_admin, is_player_muted, join_lobby, leave_lobby, list_directory_files, mute_all,
    mute_player, open_danmaku_window, open_file_location, open_folder, open_game_hud_window,
    open_log_file, open_log_folder, open_microphone_privacy_settings, open_screen_viewer_window,
    ping_virtual_ip, read_file, read_file_bytes, read_log_file, remove_player_domain,
    remove_shared_folder, reset_config_to_default, reset_microphone_permission,
    restart_app_with_gpu_settings, restart_as_admin, save_chat_image, save_danmaku_image,
    save_exit_node_advanced_config, save_file, save_opacity, save_settings, save_voice_volume,
    save_window_position, select_file, select_file_share_download_folder, select_folder,
    select_save_location, send_heartbeat, send_p2p_chat_message, send_signaling_message,
    set_always_on_top, set_auto_start, set_avatar_data, set_danmaku_ignore_cursor,
    set_file_share_download_dir, set_gamehud_ignore_cursor, set_mic_enabled, set_window_opacity,
    start_file_server, stop_file_server, stop_p2p_chat, test_node_latency, toggle_mic,
    toggle_mini_mode, update_config, update_p2p_chat_peers, verify_share_password,
    write_file_bytes,
};

use modules::easytier_advanced_commands::{
    clear_lobby_easytier_advanced_config, get_global_easytier_advanced_config,
    get_lobby_easytier_advanced_config, save_global_easytier_advanced_config,
    save_lobby_easytier_advanced_config,
};

use modules::minecraft_discovery::{
    measure_peers_latency, query_minecraft_server, scan_minecraft_servers,
};

use modules::mc_lan_bridge::{start_mc_lan_broadcast, stop_mc_lan_broadcast};

use modules::remote_control::remote_inject_input;

#[tauri::command]
fn greet(name: &str) -> String {
    info!("Greeting user: {}", name);
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn open_devtools(_app: tauri::AppHandle) {
    #[cfg(debug_assertions)]
    {
        info!("打开开发者工具");
        if let Some(webview) = _app.get_webview_window("main") {
            webview.open_devtools();
        } else {
            error!("无法找到主窗口");
        }
    }
    #[cfg(not(debug_assertions))]
    {
        log::warn!("开发者工具仅在 debug 模式下可用");
    }
}

/// 【#1】确保窗口在可视范围内：若窗口已完全移出所有显示器，则自动居中。
/// 仅在窗口与所有显示器都没有任何重叠（完全丢失）时触发，避免拖拽贴边时误触发。
fn ensure_window_visible(window: &tauri::Window) {
    if window.is_minimized().unwrap_or(false) || !window.is_visible().unwrap_or(true) {
        return;
    }
    let pos = match window.outer_position() {
        Ok(p) => p,
        Err(_) => return,
    };
    let size = match window.outer_size() {
        Ok(s) => s,
        Err(_) => return,
    };

    let win_left = pos.x;
    let win_top = pos.y;
    let win_right = pos.x + size.width as i32;
    let win_bottom = pos.y + size.height as i32;

    let monitors = match window.available_monitors() {
        Ok(m) => m,
        Err(_) => return,
    };
    if monitors.is_empty() {
        return;
    }

    // 计算窗口与任一显示器的最大可见重叠面积
    let mut max_overlap: i64 = 0;
    for monitor in &monitors {
        let mp = monitor.position();
        let ms = monitor.size();
        let mon_left = mp.x;
        let mon_top = mp.y;
        let mon_right = mp.x + ms.width as i32;
        let mon_bottom = mp.y + ms.height as i32;

        let ox = (win_right.min(mon_right) - win_left.max(mon_left)).max(0) as i64;
        let oy = (win_bottom.min(mon_bottom) - win_top.max(mon_top)).max(0) as i64;
        let overlap = ox * oy;
        if overlap > max_overlap {
            max_overlap = overlap;
        }
    }

    // 完全没有任何重叠 => 窗口已丢失到屏幕外，居中找回
    if max_overlap == 0 {
        log::warn!("检测到窗口移出可视范围，自动居中找回");
        let _ = window.center();
    }
}

/// 健壮地将主窗口唤回到前台。
///
/// 解决无边框 + 透明窗口（WS_POPUP 风格）在 Win+D「显示桌面」或任务栏最小化后
/// 无法再唤出的问题：
/// 1. 同时处理「被隐藏」与「被最小化」两种状态（先 show 再 unminimize/SW_RESTORE）；
/// 2. 用 AttachThreadInput + SetForegroundWindow + BringWindowToTop 绕过 Windows
///    前台锁定，确保真正置于最前并获得焦点；
/// 3. 恢复后校正位置，避免窗口被还原到屏幕外不可见区域。
fn restore_main_window(app: &tauri::AppHandle) {
    use tauri::Manager;
    TRAY_NOTIFICATION_GENERATION.fetch_add(1, std::sync::atomic::Ordering::AcqRel);
    if let Some(window) = app.get_webview_window("main") {
        // 先确保不再是隐藏 / 最小化状态
        let _ = window.unminimize();
        let _ = window.show();

        #[cfg(target_os = "windows")]
        if let Ok(hwnd) = window.hwnd() {
            use windows::Win32::Foundation::HWND;
            use windows::Win32::UI::WindowsAndMessaging::{
                BringWindowToTop, IsIconic, SetForegroundWindow, ShowWindow, SW_RESTORE, SW_SHOW,
            };
            let h = HWND(hwnd.0 as *mut _);
            unsafe {
                let _ = ShowWindow(h, SW_SHOW);
                if IsIconic(h).as_bool() {
                    let _ = ShowWindow(h, SW_RESTORE);
                }
                // 抢占前台并置顶，确保从隐藏/最小化恢复后真正显示在最前
                let _ = BringWindowToTop(h);
                let _ = SetForegroundWindow(h);
            }
        }

        let _ = window.set_focus();
        if RESTORE_ALWAYS_ON_TOP_AFTER_TRAY.swap(false, std::sync::atomic::Ordering::AcqRel) {
            let _ = window.set_always_on_top(true);
        }
        let host_window = window.as_ref().window();
        ensure_window_visible(&host_window);
    }
}

#[cfg(target_os = "windows")]
fn release_windows_foreground_after_hide(window: &tauri::WebviewWindow) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetShellWindow, GetWindowThreadProcessId, SetForegroundWindow,
        SetWindowPos, HWND_NOTOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
    };

    if let Ok(hwnd) = window.hwnd() {
        let hwnd = HWND(hwnd.0 as *mut _);
        unsafe {
            let _ = SetWindowPos(
                hwnd,
                HWND_NOTOPMOST,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
            );

            let foreground = GetForegroundWindow();
            let mut foreground_process_id = 0;
            GetWindowThreadProcessId(foreground, Some(&mut foreground_process_id));
            if foreground_process_id == std::process::id() {
                let shell = GetShellWindow();
                if !shell.0.is_null() {
                    let _ = SetForegroundWindow(shell);
                }
            }
        }
    }
}

fn show_tray_background_notification(app: &tauri::AppHandle, generation: u64) {
    if TRAY_NOTIFICATION_GENERATION.load(std::sync::atomic::Ordering::Acquire) != generation {
        info!("跳过过期的托盘后台运行通知任务：generation={}", generation);
        return;
    }
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    if window.is_visible().unwrap_or(true) {
        info!(
            "窗口已恢复，跳过托盘后台运行通知任务：generation={}",
            generation
        );
        return;
    }
    let _notification_lock = match TRAY_NOTIFICATION_LOCK.lock() {
        Ok(lock) => lock,
        Err(error) => error.into_inner(),
    };
    if TRAY_NOTIFICATION_GENERATION.load(std::sync::atomic::Ordering::Acquire) != generation {
        info!(
            "跳过已被新托盘状态取代的通知任务：generation={}",
            generation
        );
        return;
    }

    let (title, body_template) = TRAY_NOTIFICATION_TEXT
        .get_or_init(|| {
            std::sync::RwLock::new((
                "MCTier 正在后台运行".to_string(),
                "MCTier 已最小化到系统托盘。点击右下角托盘图标或按 {shortcut} 可恢复窗口。"
                    .to_string(),
            ))
        })
        .read()
        .map(|text| text.clone())
        .unwrap_or_else(|_| {
            (
                "MCTier 正在后台运行".to_string(),
                "MCTier 已最小化到系统托盘。点击右下角托盘图标或按 {shortcut} 可恢复窗口。"
                    .to_string(),
            )
        });
    let summon_hotkey = TRAY_SUMMON_HOTKEY
        .get_or_init(|| std::sync::RwLock::new("Ctrl+Alt+M".to_string()))
        .read()
        .map(|hotkey| hotkey.clone())
        .unwrap_or_else(|_| "Ctrl+Alt+M".to_string());
    let body = if summon_hotkey.is_empty() {
        body_template
            .replace("或按 {shortcut} ", "")
            .replace("or press {shortcut} ", "")
    } else {
        body_template.replace("{shortcut}", &summon_hotkey)
    };
    let notification_body = body;

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows::core::{w, PCWSTR};
        use windows::Win32::Foundation::{GetLastError, HWND};
        use windows::Win32::UI::Shell::{
            Shell_NotifyIconGetRect, Shell_NotifyIconW, NIF_ICON, NIF_INFO, NIIF_INFO,
            NIIF_LARGE_ICON, NIIF_USER, NIM_ADD, NIM_DELETE, NIM_MODIFY, NOTIFYICONDATAW,
            NOTIFYICONIDENTIFIER,
        };
        use windows::Win32::UI::WindowsAndMessaging::{
            DestroyIcon, FindWindowExW, GetWindowThreadProcessId, LoadImageW, HICON, IMAGE_ICON,
            LR_LOADFROMFILE,
        };

        fn write_wide<const N: usize>(target: &mut [u16; N], value: &str) {
            for (slot, character) in target
                .iter_mut()
                .zip(value.encode_utf16().chain(std::iter::once(0)))
            {
                *slot = character;
            }
        }

        fn load_notification_icon() -> Option<HICON> {
            let icon_dir = dirs::cache_dir()
                .unwrap_or_else(std::env::temp_dir)
                .join("mctier");
            let icon_path = icon_dir.join("notification-logo.ico");
            let icon_bytes = include_bytes!("../icons/icon.ico");
            let icon_ready = std::fs::create_dir_all(&icon_dir)
                .and_then(|_| {
                    if std::fs::read(&icon_path).ok().as_deref() != Some(icon_bytes.as_slice()) {
                        std::fs::write(&icon_path, icon_bytes)?;
                    }
                    Ok(())
                })
                .is_ok();
            if !icon_ready {
                return None;
            }

            let icon_wide: Vec<u16> = icon_path
                .as_os_str()
                .encode_wide()
                .chain(std::iter::once(0))
                .collect();
            unsafe {
                LoadImageW(
                    None,
                    PCWSTR(icon_wide.as_ptr()),
                    IMAGE_ICON,
                    32,
                    32,
                    LR_LOADFROMFILE,
                )
                .ok()
                .map(|icon| HICON(icon.0))
            }
        }

        let current_process_id = std::process::id();
        let mut previous = HWND::default();
        let mut tray_window = None;
        loop {
            let Ok(candidate) =
                (unsafe { FindWindowExW(HWND::default(), previous, w!("tray_icon_app"), None) })
            else {
                break;
            };
            if candidate.0.is_null() {
                break;
            }
            let mut process_id = 0;
            unsafe { GetWindowThreadProcessId(candidate, Some(&mut process_id)) };
            if process_id == current_process_id {
                tray_window = Some(candidate);
                break;
            }
            previous = candidate;
        }

        if let Some(tray_window) = tray_window {
            let tray_id = (1..=64).find(|candidate_id| {
                let identifier = NOTIFYICONIDENTIFIER {
                    cbSize: std::mem::size_of::<NOTIFYICONIDENTIFIER>() as u32,
                    hWnd: tray_window,
                    uID: *candidate_id,
                    ..Default::default()
                };
                unsafe { Shell_NotifyIconGetRect(&identifier).is_ok() }
            });

            let Some(tray_id) = tray_id else {
                log::warn!("MCTier tray icon ID was not found for balloon notification");
                return;
            };

            // Clear the previous balloon first. Windows otherwise coalesces
            // identical tray notifications and reports success without showing
            // the next one, which is especially visible after entering a lobby.
            let mut clear_data = NOTIFYICONDATAW::default();
            clear_data.cbSize = std::mem::size_of::<NOTIFYICONDATAW>() as u32;
            clear_data.hWnd = tray_window;
            clear_data.uID = tray_id;
            clear_data.uFlags = NIF_INFO;
            let cleared = unsafe { Shell_NotifyIconW(NIM_MODIFY, &clear_data).as_bool() };
            let clear_error = if cleared {
                0
            } else {
                unsafe { GetLastError().0 }
            };
            if cleared {
                std::thread::sleep(std::time::Duration::from_millis(80));
            }

            let mut data = NOTIFYICONDATAW::default();
            data.cbSize = std::mem::size_of::<NOTIFYICONDATAW>() as u32;
            data.hWnd = tray_window;
            data.uID = tray_id;
            data.uFlags = NIF_INFO;
            let notification_icon = load_notification_icon();
            if let Some(icon) = notification_icon {
                data.dwInfoFlags = NIIF_USER | NIIF_LARGE_ICON;
                data.hBalloonIcon = icon;
            } else {
                data.dwInfoFlags = NIIF_INFO;
            }
            data.Anonymous.uTimeout = 7000;
            write_wide(&mut data.szInfoTitle, &title);
            write_wide(&mut data.szInfo, &notification_body);
            let shown = unsafe { Shell_NotifyIconW(NIM_MODIFY, &data).as_bool() };
            let show_error = if shown {
                0
            } else {
                unsafe { GetLastError().0 }
            };
            log::info!(
                "Windows tray balloon on MCTier tray icon: hwnd={:?}, pid={}, id={}, cb_size={}, cleared={} error={}, shown={} error={}",
                tray_window.0,
                current_process_id,
                tray_id,
                data.cbSize,
                cleared,
                clear_error,
                shown,
                show_error
            );
            if shown {
                if let Some(icon) = notification_icon {
                    let icon_value = icon.0 as usize;
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_secs(10));
                        unsafe {
                            let _ = DestroyIcon(HICON(icon_value as *mut _));
                        }
                    });
                }
                return;
            }
            if let Some(icon) = notification_icon {
                unsafe {
                    let _ = DestroyIcon(icon);
                }
            }

            let fallback_icon = load_notification_icon();
            let fallback_id = 0x4D43_0001;
            if let Some(fallback_icon) = fallback_icon {
                let mut add_data = NOTIFYICONDATAW::default();
                add_data.cbSize = std::mem::size_of::<NOTIFYICONDATAW>() as u32;
                add_data.hWnd = tray_window;
                add_data.uID = fallback_id;
                add_data.uFlags = NIF_ICON;
                add_data.hIcon = fallback_icon;
                let _ = unsafe { Shell_NotifyIconW(NIM_DELETE, &add_data) };
                let added = unsafe { Shell_NotifyIconW(NIM_ADD, &add_data).as_bool() };
                let add_error = if added {
                    0
                } else {
                    unsafe { GetLastError().0 }
                };
                if added {
                    std::thread::sleep(std::time::Duration::from_millis(80));
                    let mut fallback_data = NOTIFYICONDATAW::default();
                    fallback_data.cbSize = std::mem::size_of::<NOTIFYICONDATAW>() as u32;
                    fallback_data.hWnd = tray_window;
                    fallback_data.uID = fallback_id;
                    fallback_data.uFlags = NIF_INFO;
                    fallback_data.dwInfoFlags = NIIF_INFO;
                    fallback_data.Anonymous.uTimeout = 7000;
                    write_wide(&mut fallback_data.szInfoTitle, &title);
                    write_wide(&mut fallback_data.szInfo, &notification_body);
                    let fallback_shown =
                        unsafe { Shell_NotifyIconW(NIM_MODIFY, &fallback_data).as_bool() };
                    let fallback_error = if fallback_shown {
                        0
                    } else {
                        unsafe { GetLastError().0 }
                    };
                    log::info!(
                        "Windows tray balloon fallback: id={}, added={} error={}, shown={} error={}",
                        fallback_id,
                        added,
                        add_error,
                        fallback_shown,
                        fallback_error
                    );
                    let cleanup_app = app.clone();
                    let tray_window_value = tray_window.0 as usize;
                    let fallback_icon_value = fallback_icon.0 as usize;
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_secs(10));
                        let _ = cleanup_app.run_on_main_thread(move || {
                            let mut delete_data = NOTIFYICONDATAW::default();
                            delete_data.cbSize = std::mem::size_of::<NOTIFYICONDATAW>() as u32;
                            delete_data.hWnd = HWND(tray_window_value as *mut _);
                            delete_data.uID = fallback_id;
                            delete_data.uFlags = NIF_ICON;
                            unsafe {
                                let _ = Shell_NotifyIconW(NIM_DELETE, &delete_data);
                                let _ = DestroyIcon(HICON(fallback_icon_value as *mut _));
                            }
                        });
                    });
                    if fallback_shown {
                        return;
                    }
                } else {
                    unsafe {
                        let _ = DestroyIcon(fallback_icon);
                    }
                }
            }
        } else {
            log::warn!("MCTier tray window was not found for balloon notification");
        }
    }
}

/// Hide the main window without closing its WebView and tell the user where it went.
/// Keeping every tray transition on this path prevents Win+D, the close button and
/// start-minimized behavior from drifting apart again.
fn hide_main_window_to_tray(app: &tauri::AppHandle, source: &str) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    let was_visible = window.is_visible().unwrap_or(false);
    if !was_visible && source != "关闭按钮" {
        info!(
            "{}：MCTier 已经处于系统托盘，不重复发送后台运行通知",
            source
        );
        return;
    }

    // Clear the minimized state before hiding so restore does not inherit a
    // stale taskbar/Win+D state from the previous transition.
    let _ = window.unminimize();
    let was_always_on_top = window.is_always_on_top().unwrap_or(false);
    RESTORE_ALWAYS_ON_TOP_AFTER_TRAY.store(was_always_on_top, std::sync::atomic::Ordering::Release);
    if was_always_on_top {
        let _ = window.set_always_on_top(false);
    }
    if let Err(e) = window.hide() {
        error!("{} 隐藏主窗口到托盘失败: {}", source, e);
        return;
    }
    #[cfg(target_os = "windows")]
    release_windows_foreground_after_hide(&window);

    info!(
        "{}：MCTier 已最小化到系统托盘，准备发送后台运行通知",
        source
    );
    let generation =
        TRAY_NOTIFICATION_GENERATION.fetch_add(1, std::sync::atomic::Ordering::AcqRel) + 1;
    let notification_app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(300));
        let main_thread_app = notification_app.clone();
        let _ = notification_app.run_on_main_thread(move || {
            show_tray_background_notification(&main_thread_app, generation);
        });
    });
}

/// Toggle the main window from the native process so this keeps working while
/// the WebView is hidden in the system tray.
fn toggle_main_window(app: &tauri::AppHandle) {
    use tauri::Manager;
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    let visible = window.is_visible().unwrap_or(false);
    let minimized = window.is_minimized().unwrap_or(false);
    if visible && !minimized {
        hide_main_window_to_tray(app, "Ctrl+Alt+M");
    } else {
        restore_main_window(app);
    }
}

#[tauri::command]
fn minimize_main_window_to_tray(app: tauri::AppHandle) {
    hide_main_window_to_tray(&app, "窗口按钮");
}

#[cfg(target_os = "windows")]
static SUMMON_FALLBACK_TX: std::sync::OnceLock<std::sync::mpsc::SyncSender<()>> =
    std::sync::OnceLock::new();
#[cfg(target_os = "windows")]
static SUMMON_FALLBACK_ENABLED: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

#[cfg(target_os = "windows")]
fn start_summon_fallback_listener(app: &tauri::AppHandle) {
    SUMMON_FALLBACK_ENABLED.store(true, std::sync::atomic::Ordering::Relaxed);
    if SUMMON_FALLBACK_TX.get().is_some() {
        return;
    }

    let (tx, rx) = std::sync::mpsc::sync_channel(2);
    if SUMMON_FALLBACK_TX.set(tx).is_err() {
        return;
    }
    let action_app = app.clone();
    std::thread::spawn(move || {
        while rx.recv().is_ok() {
            toggle_main_window(&action_app);
        }
    });
    std::thread::spawn(move || {
        use windows::Win32::UI::Input::KeyboardAndMouse::{
            GetAsyncKeyState, VK_CONTROL, VK_M, VK_MENU,
        };

        let mut triggered = false;
        loop {
            let pressed = if SUMMON_FALLBACK_ENABLED.load(std::sync::atomic::Ordering::Relaxed) {
                unsafe {
                    GetAsyncKeyState(VK_CONTROL.0 as i32) < 0
                        && GetAsyncKeyState(VK_MENU.0 as i32) < 0
                        && GetAsyncKeyState(VK_M.0 as i32) < 0
                }
            } else {
                false
            };

            if pressed && !triggered {
                info!("检测到 Ctrl+Alt+M，切换主窗口可见状态");
                if let Some(tx) = SUMMON_FALLBACK_TX.get() {
                    let _ = tx.try_send(());
                }
            }
            triggered = pressed;
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
    });
    info!("Ctrl+Alt+M 已启用 Windows 原生按键状态监听");
}

/// 由前端按当前界面语言更新系统托盘菜单文本（显示/退出）。
/// 保持菜单项 id 不变（show_main / exit_app），故已注册的 on_menu_event 仍生效。
#[cfg(target_os = "windows")]
unsafe extern "system" fn window_subclass_proc(
    hwnd: windows::Win32::Foundation::HWND,
    msg: u32,
    wparam: windows::Win32::Foundation::WPARAM,
    lparam: windows::Win32::Foundation::LPARAM,
    _id: usize,
    _data: usize,
) -> windows::Win32::Foundation::LRESULT {
    use windows::Win32::Foundation::LRESULT;
    use windows::Win32::UI::Shell::DefSubclassProc;
    use windows::Win32::UI::WindowsAndMessaging::{
        ShowWindow, SC_MINIMIZE, SW_HIDE, WM_SYSCOMMAND,
    };

    if msg == WM_SYSCOMMAND && (wparam.0 & 0xFFF0) == SC_MINIMIZE as usize {
        let _ = ShowWindow(hwnd, SW_HIDE);
        return LRESULT(0);
    }
    DefSubclassProc(hwnd, msg, wparam, lparam)
}

#[cfg(target_os = "windows")]
fn install_minimize_to_hide(window: &tauri::WebviewWindow) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::Shell::SetWindowSubclass;
    if let Ok(hwnd) = window.hwnd() {
        let hwnd = HWND(hwnd.0 as *mut _);
        unsafe {
            let _ = SetWindowSubclass(hwnd, Some(window_subclass_proc), 1, 0);
        }
    }
}

#[tauri::command]
fn set_tray_menu_texts(
    app: tauri::AppHandle,
    show_text: String,
    exit_text: String,
    notification_title: String,
    notification_body: String,
) -> Result<(), String> {
    use tauri::menu::{MenuBuilder, MenuItem};
    if let Some(tray) = app.tray_by_id("main-tray") {
        let show_item = MenuItem::with_id(&app, "show_main", show_text, true, None::<&str>)
            .map_err(|e| e.to_string())?;
        let exit_item = MenuItem::with_id(&app, "exit_app", exit_text, true, None::<&str>)
            .map_err(|e| e.to_string())?;
        let menu = MenuBuilder::new(&app)
            .item(&show_item)
            .separator()
            .item(&exit_item)
            .build()
            .map_err(|e| e.to_string())?;
        tray.set_menu(Some(menu)).map_err(|e| e.to_string())?;
    }
    if let Ok(mut text) = TRAY_NOTIFICATION_TEXT
        .get_or_init(|| std::sync::RwLock::new((String::new(), String::new())))
        .write()
    {
        *text = (notification_title, notification_body);
    }
    Ok(())
}

/// 用户可自定义的全局快捷键绑定
#[derive(Clone, Debug)]
pub struct HotkeyBindings {
    /// 麦克风开关
    pub mic: String,
    /// 全局听筒（静音所有人）
    pub global_mute: String,
    /// 临时开麦（按住说话）
    pub push_to_talk: String,
    /// 唤出主窗口
    pub summon: String,
}

impl Default for HotkeyBindings {
    fn default() -> Self {
        Self {
            mic: "Ctrl+M".to_string(),
            global_mute: "Ctrl+T".to_string(),
            push_to_talk: "F2".to_string(),
            summon: "Ctrl+Alt+M".to_string(),
        }
    }
}

/// 将界面录制的键位归一化为 Tauri 全局快捷键可识别的格式。
///
/// 前端 HotkeyInput 录制出的是 `Ctrl+Alt+M` / `F2` / `Shift+F1` 这类字符串，
/// 而 Tauri 的 global_shortcut 需要 `CommandOrControl+Alt+M` 这种写法（跨平台修饰键）。
/// 这里做统一转换，避免两套格式不一致导致注册失败。
fn normalize_hotkey(raw: &str) -> String {
    raw.split('+')
        .map(|p| p.trim())
        .filter(|p| !p.is_empty())
        .map(|part| {
            let lower = part.to_lowercase();
            match lower.as_str() {
                "ctrl" | "control" | "commandorcontrol" | "cmdorctrl" => {
                    "CommandOrControl".to_string()
                }
                "alt" | "option" => "Alt".to_string(),
                "shift" => "Shift".to_string(),
                "meta" | "cmd" | "command" | "super" | "win" => "Super".to_string(),
                // 其余为主键：单字符统一大写，功能键（F1/F2…）与命名键保持原样
                _ => {
                    if part.chars().count() == 1 {
                        part.to_uppercase()
                    } else {
                        part.to_string()
                    }
                }
            }
        })
        .collect::<Vec<_>>()
        .join("+")
}

/// 注册（或重新注册）全部全局快捷键。
///
/// 可重复调用：内部会先注销此前注册的全部快捷键，因此用户在设置中改完键位后
/// 无需重启应用即可立即生效。任一快捷键注册失败只记录日志，不影响其它快捷键。
fn register_global_hotkeys(
    app: &tauri::AppHandle,
    core: Arc<Mutex<modules::app_core::AppCore>>,
    bindings: &HotkeyBindings,
) {
    // 先清空旧注册，实现"改完即生效"
    if let Err(e) = app.global_shortcut().unregister_all() {
        log::warn!("注销旧全局快捷键失败（忽略）: {}", e);
    }

    let mic_hotkey = normalize_hotkey(&bindings.mic);
    let global_mute_hotkey = normalize_hotkey(&bindings.global_mute);
    let push_to_talk_hotkey = normalize_hotkey(&bindings.push_to_talk);
    let summon_hotkey = normalize_hotkey(&bindings.summon);
    if let Ok(mut current) = TRAY_SUMMON_HOTKEY
        .get_or_init(|| std::sync::RwLock::new(String::new()))
        .write()
    {
        *current = bindings.summon.trim().to_string();
    }

    info!(
        "注册全局快捷键: 麦克风={}, 全局听筒={}, 临时开麦={}, 唤出窗口={}",
        mic_hotkey, global_mute_hotkey, push_to_talk_hotkey, summon_hotkey
    );

    // ===== 唤出主窗口 =====
    let use_default_summon_fallback =
        cfg!(target_os = "windows") && summon_hotkey.eq_ignore_ascii_case("CommandOrControl+Alt+M");
    #[cfg(target_os = "windows")]
    if use_default_summon_fallback {
        start_summon_fallback_listener(app);
    } else {
        SUMMON_FALLBACK_ENABLED.store(false, std::sync::atomic::Ordering::Relaxed);
    }
    if !summon_hotkey.is_empty() && !use_default_summon_fallback {
        let hs = app.clone();
        if let Err(e) =
            app.global_shortcut()
                .on_shortcut(summon_hotkey.as_str(), move |_, _, ev| {
                    if ev.state == tauri_plugin_global_shortcut::ShortcutState::Released {
                        return;
                    }
                    toggle_main_window(&hs);
                })
        {
            error!("唤出窗口快捷键 {} 注册失败: {}", summon_hotkey, e);
        }
    }

    let ltm = Arc::new(Mutex::new(
        std::time::Instant::now() - std::time::Duration::from_millis(500),
    ));
    let ltt = Arc::new(Mutex::new(
        std::time::Instant::now() - std::time::Duration::from_millis(500),
    ));
    let ltf = Arc::new(Mutex::new((false, false))); // (is_pressed, original_mic_state)

    // ===== 麦克风开关 =====
    if !mic_hotkey.is_empty() {
        let cm = Arc::clone(&core);
        let hm = app.clone();
        let lm = Arc::clone(&ltm);
        if let Err(e) = app
            .global_shortcut()
            .on_shortcut(mic_hotkey.as_str(), move |_, _, ev| {
                if ev.state == tauri_plugin_global_shortcut::ShortcutState::Released {
                    return;
                }
                let mut lt = match lm.try_lock() {
                    Ok(g) => g,
                    Err(_) => return,
                };
                let now = std::time::Instant::now();
                if now.duration_since(*lt) < std::time::Duration::from_millis(200) {
                    return;
                }
                *lt = now;
                drop(lt);
                let c = Arc::clone(&cm);
                let h = hm.clone();
                tauri::async_runtime::spawn(async move {
                    match c.lock().await.toggle_mic().await {
                        Ok(s) => {
                            let _ = h.emit("mic-toggled", s);
                        }
                        Err(e) => {
                            error!("切换麦克风失败: {}", e);
                        }
                    }
                });
            })
        {
            error!("麦克风快捷键 {} 注册失败: {}", mic_hotkey, e);
        }
    }

    // ===== 全局听筒 =====
    if !global_mute_hotkey.is_empty() {
        let ct = Arc::clone(&core);
        let ht = app.clone();
        let lt2 = Arc::clone(&ltt);
        if let Err(e) =
            app.global_shortcut()
                .on_shortcut(global_mute_hotkey.as_str(), move |_, _, ev| {
                    if ev.state == tauri_plugin_global_shortcut::ShortcutState::Released {
                        return;
                    }
                    let mut lt = match lt2.try_lock() {
                        Ok(g) => g,
                        Err(_) => return,
                    };
                    let now = std::time::Instant::now();
                    if now.duration_since(*lt) < std::time::Duration::from_millis(200) {
                        return;
                    }
                    *lt = now;
                    drop(lt);
                    let c = Arc::clone(&ct);
                    let h = ht.clone();
                    tauri::async_runtime::spawn(async move {
                        let vs = c.lock().await.get_voice_service();
                        let v = vs.lock().await;
                        let ns = !v.is_global_muted();
                        match v.mute_all(ns).await {
                            Ok(_) => {
                                let _ = h.emit("global-mute-toggled", ns);
                            }
                            Err(e) => {
                                error!("切换静音失败: {}", e);
                            }
                        }
                    });
                })
        {
            error!("全局听筒快捷键 {} 注册失败: {}", global_mute_hotkey, e);
        }
    }

    // ===== 临时开麦（按住说话）=====
    if !push_to_talk_hotkey.is_empty() {
        let cf = Arc::clone(&core);
        let hf = app.clone();
        let ltf2 = Arc::clone(&ltf);
        if let Err(e) =
            app.global_shortcut()
                .on_shortcut(push_to_talk_hotkey.as_str(), move |_, _, ev| {
                    let c = Arc::clone(&cf);
                    let h = hf.clone();
                    let lf = Arc::clone(&ltf2);
                    tauri::async_runtime::spawn(async move {
                        let mut state = match lf.try_lock() {
                            Ok(g) => g,
                            Err(_) => return,
                        };

                        if ev.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                            if state.0 {
                                return;
                            } // 已按下，防重复触发
                            state.0 = true;
                            let current_mic_state = c
                                .lock()
                                .await
                                .get_voice_service()
                                .lock()
                                .await
                                .is_mic_enabled();
                            state.1 = current_mic_state;
                            drop(state);
                            if !current_mic_state {
                                info!("临时开麦：开启麦克风");
                                match c.lock().await.toggle_mic().await {
                                    Ok(s) => {
                                        let _ = h.emit("mic-toggled", s);
                                    }
                                    Err(e) => {
                                        error!("临时开麦开启失败: {}", e);
                                    }
                                }
                            }
                        } else if ev.state == tauri_plugin_global_shortcut::ShortcutState::Released
                        {
                            if !state.0 {
                                return;
                            }
                            let original_state = state.1;
                            state.0 = false;
                            drop(state);
                            if !original_state {
                                info!("临时开麦：恢复麦克风状态");
                                match c.lock().await.toggle_mic().await {
                                    Ok(s) => {
                                        let _ = h.emit("mic-toggled", s);
                                    }
                                    Err(e) => {
                                        error!("临时开麦恢复失败: {}", e);
                                    }
                                }
                            }
                        }
                    });
                })
        {
            error!("临时开麦快捷键 {} 注册失败: {}", push_to_talk_hotkey, e);
        }
    }
}

/// 应用最新的快捷键设置（供前端在设置中改完键位后调用，立即生效、无需重启）
#[tauri::command]
async fn apply_hotkeys(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let core = Arc::clone(&state.core);
    let bindings = {
        let cl = core.lock().await;
        let cfg_mgr = cl.get_config_manager();
        let mgr = cfg_mgr.lock().await;
        let cfg = mgr.get_config();
        let d = HotkeyBindings::default();
        HotkeyBindings {
            mic: cfg.mic_hotkey.clone().unwrap_or(d.mic),
            global_mute: cfg.global_mute_hotkey.clone().unwrap_or(d.global_mute),
            push_to_talk: cfg.push_to_talk_hotkey.clone().unwrap_or(d.push_to_talk),
            summon: cfg.summon_hotkey.clone().unwrap_or(d.summon),
        }
    };
    register_global_hotkeys(&app, core, &bindings);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    reset_microphone_permission_cache_on_startup();
    // 在应用启动时检查并应用 GPU 设置
    apply_gpu_settings_on_startup();

    use std::fs::OpenOptions;
    let log_path = if let Some(data_dir) = dirs::data_local_dir() {
        let mctier_dir = data_dir.join("MCTier");
        let _ = std::fs::create_dir_all(&mctier_dir);
        mctier_dir.join("mctier.log")
    } else {
        std::path::PathBuf::from("mctier.log")
    };
    let log_file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .expect("无法创建日志文件");
    env_logger::Builder::from_default_env()
        .filter_level(log::LevelFilter::Info)
        .format_timestamp_millis()
        .target(env_logger::Target::Pipe(Box::new(log_file)))
        .init();
    info!("MCTier 应用程序启动中...");
    info!("日志文件位置: {:?}", log_path);

    let runtime = tokio::runtime::Runtime::new().expect("无法创建 Tokio 运行时");
    let app_core = runtime.block_on(async {
        match AppCore::new().await {
            Ok(core) => {
                info!("应用核心初始化成功");
                if let Err(e) = core.start().await {
                    error!("应用启动失败: {}", e);
                }
                core
            }
            Err(e) => {
                error!("应用核心初始化失败: {}", e);
                panic!("无法初始化应用核心: {}", e);
            }
        }
    });

    let app_state = AppState {
        core: Arc::new(Mutex::new(app_core)),
    };

    let result = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // 应用已在运行：第二个实例通常由点击 deep link 触发，argv 含 mctier:// URL
            use tauri::Emitter;
            if let Some(url) = argv.iter().find(|a| a.starts_with("mctier://")) {
                let _ = app.emit("deep-link-join", url.clone());
            }
            restore_main_window(app);
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            greet, open_devtools,
            create_lobby, join_lobby, leave_lobby,
            toggle_mic, set_mic_enabled, open_microphone_privacy_settings, reset_microphone_permission, mute_player, mute_all,
            get_config, update_config, save_opacity,
            get_audio_devices, get_app_state, get_current_lobby, get_players,
            get_mic_status, get_global_mute_status, is_player_muted,
            get_network_status, get_virtual_ip, get_peer_connection_types,
            set_always_on_top, toggle_mini_mode, set_window_opacity,
            send_signaling_message, broadcast_status_update, send_heartbeat,
            force_stop_easytier,
            cancel_lobby_connecting,
            check_virtual_adapter, check_firewall_rules, ping_virtual_ip, check_udp_port,
            is_admin, add_firewall_rules, restart_as_admin,
            save_window_position, exit_app,
            add_player_domain, remove_player_domain,
            get_folder_name, get_folder_info, list_directory_files,
            read_file_bytes, write_file_bytes, select_folder, select_file, select_save_location,
            select_file_share_download_folder, get_file_share_download_dir, set_file_share_download_dir,
            get_file_share_download_path,
            save_file, save_chat_image, read_file, delete_file, extract_zip,
            open_file_location, open_folder,
            start_file_server, stop_file_server, check_file_server_status,
            add_shared_folder, remove_shared_folder, get_local_shares,
            cleanup_expired_shares, get_remote_shares, get_remote_files,
            verify_share_password, get_download_url, diagnose_file_share_connection,
            download_remote_file, cancel_remote_download, export_logs, test_node_latency,
            download_remote_batch, detect_security_software,
            configure_p2p_chat, update_p2p_chat_peers, stop_p2p_chat,
            send_p2p_chat_message, get_p2p_chat_messages, clear_p2p_chat_messages,
            open_screen_viewer_window,
            open_danmaku_window, close_danmaku_window,
            set_danmaku_ignore_cursor, danmaku_cursor_pos, save_danmaku_image,
            open_game_hud_window, close_game_hud_window,
            set_gamehud_ignore_cursor, gamehud_cursor_pos,
            open_log_folder, open_log_file, get_log_file_path, read_log_file, set_avatar_data, clear_avatar_cache,
            save_settings, get_settings, set_auto_start, check_auto_start,
            reset_config_to_default, save_voice_volume,
            export_config, import_config,
            restart_app_with_gpu_settings,
            save_exit_node_advanced_config, get_exit_node_advanced_config,
            save_global_easytier_advanced_config, get_global_easytier_advanced_config,
            save_lobby_easytier_advanced_config, get_lobby_easytier_advanced_config,
            clear_lobby_easytier_advanced_config,
            scan_minecraft_servers, query_minecraft_server, measure_peers_latency,
            start_mc_lan_broadcast, stop_mc_lan_broadcast,
            set_tray_menu_texts,
            minimize_main_window_to_tray,
            remote_inject_input,
            apply_hotkeys,
        ])
        .setup(|app| {
            info!("Tauri 应用设置完成");
            println!("🚀 [Setup] Tauri 应用设置开始");
            let app_handle = app.handle().clone();

            #[cfg(target_os = "windows")]
            if let Some(main_window) = app.get_webview_window("main") {
                install_minimize_to_hide(&main_window);
            }

            {
                use tauri::menu::{MenuBuilder, MenuItem};
                use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
                let show_item = MenuItem::with_id(app, "show_main", "显示 MCTier", true, None::<&str>)?;
                let exit_item = MenuItem::with_id(app, "exit_app", "退出 MCTier", true, None::<&str>)?;
                let tray_menu = MenuBuilder::new(app)
                    .item(&show_item)
                    .separator()
                    .item(&exit_item)
                    .build()?;
                TrayIconBuilder::with_id("main-tray")
                    .tooltip("MCTier")
                    .icon(app.default_window_icon().cloned().unwrap())
                    .menu(&tray_menu)
                    .show_menu_on_left_click(false)
                    .on_menu_event(|app, event| match event.id().as_ref() {
                        "show_main" => restore_main_window(app),
                        "exit_app" => app.exit(0),
                        _ => {}
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. }
                            | TrayIconEvent::DoubleClick { button: MouseButton::Left, .. } = event
                        {
                            restore_main_window(tray.app_handle());
                        }
                    })
                    .build(app)?;
            }


            // 邀请 deep link：注册运行时 scheme 并监听冷启动/运行时打开的链接
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                #[cfg(any(target_os = "windows", target_os = "linux"))]
                {
                    let _ = app.deep_link().register_all();
                }
                let dh = app_handle.clone();
                app.deep_link().on_open_url(move |event| {
                    use tauri::Emitter;
                    if let Some(url) = event.urls().first() {
                        let _ = dh.emit("deep-link-join", url.to_string());
                    }
                });
            }

            println!("🔍 [Setup] 尝试获取 AppState...");
            if let Some(state) = app.try_state::<AppState>() {
                println!("✅ [Setup] 成功获取 AppState");
                let core_hk = Arc::clone(&state.core);

                // 从用户配置读取自定义快捷键（缺省回落到默认键位），并完成注册。
                // 用户在设置中修改后，前端会调用 apply_hotkeys 命令重新注册，无需重启。
                let bindings = tauri::async_runtime::block_on(async {
                    let cl = core_hk.lock().await;
                    let cfg_mgr = cl.get_config_manager();
                    let mgr = cfg_mgr.lock().await;
                    let cfg = mgr.get_config();
                    let d = HotkeyBindings::default();
                    HotkeyBindings {
                        mic: cfg.mic_hotkey.clone().unwrap_or(d.mic),
                        global_mute: cfg.global_mute_hotkey.clone().unwrap_or(d.global_mute),
                        push_to_talk: cfg.push_to_talk_hotkey.clone().unwrap_or(d.push_to_talk),
                        summon: cfg.summon_hotkey.clone().unwrap_or(d.summon),
                    }
                });
                register_global_hotkeys(&app_handle, Arc::clone(&core_hk), &bindings);
            } else {
                println!("❌ [Setup] 无法获取 AppState，快捷键注册失败");
                error!("无法获取 AppState，快捷键注册失败");
            }
            if let Some(window) = app.get_webview_window("main") {
                #[cfg(target_os = "windows")]
                {
                    use windows::Win32::Foundation::HWND;
                    use windows::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_USE_IMMERSIVE_DARK_MODE};
                    use windows::Win32::UI::WindowsAndMessaging::{GWL_EXSTYLE, WS_EX_APPWINDOW, WS_EX_TOOLWINDOW, GetWindowLongW, SetWindowLongW};
                    if let Ok(hwnd) = window.hwnd() {
                        let hwnd = HWND(hwnd.0 as *mut _);
                        unsafe {
                            let dm: i32 = 1;
                            let _ = DwmSetWindowAttribute(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE, &dm as *const _ as *const _, std::mem::size_of::<i32>() as u32);
                            let ex = GetWindowLongW(hwnd, GWL_EXSTYLE);
                            let fixed_ex = (ex | WS_EX_APPWINDOW.0 as i32) & !(WS_EX_TOOLWINDOW.0 as i32);
                            SetWindowLongW(hwnd, GWL_EXSTYLE, fixed_ex);
                        }
                    }
                }

                // 应用窗口配置
                if let Some(state) = app.try_state::<AppState>() {
                    let core = Arc::clone(&state.core);
                    let win = window.clone();
                    tauri::async_runtime::spawn(async move {
                        let config_manager = core.lock().await.get_config_manager();
                        let cfg_mgr = config_manager.lock().await;
                        let config = cfg_mgr.get_config();

                        // 应用窗口置顶设置
                        let always_on_top = config.always_on_top.unwrap_or(true);
                        if let Err(e) = win.set_always_on_top(always_on_top) {
                            error!("设置窗口置顶失败: {}", e);
                        } else {
                            info!("窗口置顶设置成功: {}", always_on_top);
                        }

                        // 应用窗口位置设置
                        let remember_position = config.remember_window_position.unwrap_or(false);
                        if remember_position {
                            if let Some(pos) = &config.window_position {
                                use tauri::PhysicalPosition;
                                if let Err(e) = win.set_position(PhysicalPosition::new(pos.x, pos.y)) {
                                    error!("设置窗口位置失败: {}", e);
                                } else {
                                    info!("窗口位置已恢复: x={}, y={}", pos.x, pos.y);
                                }
                            }
                        }

                        // 启动后自动隐藏到系统托盘（后台运行）
                        let start_minimized = config.start_minimized.unwrap_or(false);
                        if start_minimized {
                            hide_main_window_to_tray(win.app_handle(), "启动配置");
                        }
                    });
                }
            }
            let ah2 = app.handle().clone();
            if let Some(state) = app.try_state::<AppState>() {
                let core = Arc::clone(&state.core);
                tauri::async_runtime::block_on(async move {
                    core.lock().await.set_app_handle(ah2).await;
                    info!("应用句柄已设置到 AppCore");
                });
            }
            if let Some(state) = app.try_state::<AppState>() {
                let core = Arc::clone(&state.core);
                let ah3 = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
                    let cfg = { let cl = core.lock().await; cl.get_config_manager().lock().await.get_config_clone() };
                    if let Some(al) = &cfg.auto_lobby {
                        if al.enabled {
                            let ln = match &al.lobby_name { Some(n) if !n.is_empty() => n.clone(), _ => { return; } };
                            let lp = match &al.lobby_password { Some(p) if !p.is_empty() => p.clone(), _ => { return; } };
                            let pn = match &al.player_name { Some(n) if !n.is_empty() => n.clone(), _ => { return; } };
                            info!("自动大厅：发送配置到前端");
                            let _ = ah3.emit("auto-lobby-config", serde_json::json!({"lobbyName":ln,"lobbyPassword":lp,"playerName":pn,"useDomain":al.use_domain}));
                        }
                    }
                });
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // 【#1】窗口越界自动回中：当窗口被拖到所有显示器可视范围之外时，自动居中找回
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let label = window.label().to_string();
                // 仅主窗口关闭时才退出应用；辅助窗口(弹幕覆盖层/屏幕查看等)正常关闭，
                // 不得连带退出整个程序（修复：预览弹幕后弹幕窗关闭把主程序也带退了）
                if label != "main" {
                    return;
                }
                // 始终先阻止默认关闭，之后根据配置决定：隐藏到托盘 或 退出程序
                api.prevent_close();
                // 先立即隐藏窗口，再在后台判断是保留托盘运行还是清理退出，避免
                // 网络与虚拟网卡清理耗时让用户感觉关闭按钮没有响应。
                let _ = window.hide();
                let ah = window.app_handle().clone();
                if let Some(state) = ah.try_state::<AppState>() {
                    let core = Arc::clone(&state.core);
                    tauri::async_runtime::spawn(async move {
                        // 读取「关闭时最小化到托盘」配置
                        let close_to_tray = {
                            let cl = core.lock().await;
                            let cfg_mgr = cl.get_config_manager();
                            let mgr = cfg_mgr.lock().await;
                            mgr.get_config().close_to_tray.unwrap_or(false)
                        };

                        if close_to_tray {
                            hide_main_window_to_tray(&ah, "关闭按钮");
                            return;
                        }

                        // 正常退出流程
                        if let Err(e) = core.lock().await.shutdown().await { error!("关闭错误: {}", e); }
                        if let Some(w) = ah.get_webview_window("main") { let _ = w.close(); }
                        ah.exit(0);
                    });
                } else {
                    let _ = window.close();
                    window.app_handle().exit(0);
                }
            }
        })
        .run(tauri::generate_context!());
    if let Err(e) = result {
        error!("运行错误: {}", e);
        panic!("error: {}", e);
    }
    info!("MCTier 应用程序已关闭");
}
