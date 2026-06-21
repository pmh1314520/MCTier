// MCTier 后端模块
pub mod modules;

use log::{error, info};
use modules::app_core::AppCore;
use modules::tauri_commands::AppState;
use std::sync::Arc;
use tokio::sync::Mutex;
use tauri::Manager;
use tauri::Emitter;
use tauri_plugin_global_shortcut::GlobalShortcutExt;

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
            let enable_gpu = config.get("enable_gpu_rendering")
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
            
            if !enable_gpu {
                // 设置环境变量完全禁用 GPU（包括GPU进程）
                std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", 
                    "--disable-gpu --disable-software-rasterizer --disable-gpu-compositing --disable-gpu-process-crash-limit --in-process-gpu");
                println!("✅ GPU 渲染已完全禁用（包括GPU进程）");
            } else {
                // 启用 GPU 时，明确设置启用硬件加速的参数
                std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", 
                    "--enable-gpu-rasterization --enable-zero-copy --ignore-gpu-blocklist");
                println!("✅ GPU 渲染已启用（通过环境变量）");
            }
        }
    } else {
        println!("无法读取配置文件，使用默认GPU设置（启用）");
    }
}


use modules::tauri_commands::{
    create_lobby, join_lobby, leave_lobby,
    toggle_mic, mute_player, mute_all,
    get_config, update_config, save_opacity,
    get_audio_devices, get_app_state, get_current_lobby, get_players,
    get_mic_status, get_global_mute_status, is_player_muted,
    get_network_status, get_virtual_ip, get_peer_connection_types,
    set_always_on_top, toggle_mini_mode, set_window_opacity,
    send_signaling_message, broadcast_status_update, send_heartbeat,
    force_stop_easytier,
    cancel_lobby_connecting,
    download_and_run_installer,
    check_virtual_adapter, check_firewall_rules, ping_virtual_ip, check_udp_port,
    is_admin, add_firewall_rules, restart_as_admin,
    save_window_position, exit_app,
    add_player_domain, remove_player_domain,
    get_folder_name, get_folder_info, list_directory_files,
    read_file_bytes, write_file_bytes, select_folder, select_file, select_save_location,
    save_file, save_chat_image, read_file, delete_file, extract_zip,
    open_file_location, open_folder,
    start_file_server, stop_file_server, check_file_server_status,
    add_shared_folder, remove_shared_folder, get_local_shares,
    cleanup_expired_shares, get_remote_shares, get_remote_files,
    verify_share_password, get_download_url, diagnose_file_share_connection,
    download_remote_file, cancel_remote_download, export_logs, test_node_latency,
    download_remote_batch, detect_security_software,
    send_p2p_chat_message, get_p2p_chat_messages, clear_p2p_chat_messages,
    open_screen_viewer_window,
    open_danmaku_window, close_danmaku_window,
    set_danmaku_ignore_cursor, danmaku_cursor_pos, save_danmaku_image,
    open_log_folder, open_log_file, get_log_file_path,
    save_settings, get_settings, set_auto_start, check_auto_start,
    reset_config_to_default, save_voice_volume,
    export_config, import_config,
    restart_app_with_gpu_settings,
    save_exit_node_advanced_config, get_exit_node_advanced_config,
};

use modules::easytier_advanced_commands::{
    save_global_easytier_advanced_config, get_global_easytier_advanced_config,
    save_lobby_easytier_advanced_config, get_lobby_easytier_advanced_config,
    clear_lobby_easytier_advanced_config,
};

use modules::minecraft_discovery::{
    scan_minecraft_servers, query_minecraft_server, measure_peers_latency,
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
    { log::warn!("开发者工具仅在 debug 模式下可用"); }
}

/// 【#1】确保窗口在可视范围内：若窗口已完全移出所有显示器，则自动居中。
/// 仅在窗口与所有显示器都没有任何重叠（完全丢失）时触发，避免拖拽贴边时误触发。
fn ensure_window_visible(window: &tauri::Window) {
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
        // 屏幕外校正：恢复后窗口若获得焦点会触发 Focused 事件，由 on_window_event 统一处理
    }
}

/// 拦截窗口的「最小化」动作（任务栏点击 / Win+D），改为隐藏窗口。
///
/// 原因：无边框 + 透明（WS_POPUP）窗口在 Windows 上真正进入“最小化”状态后，
/// WebView2/DWM 的合成会出问题，导致窗口卡死、无法再唤出（程序未响应）。
/// 改为 SW_HIDE 隐藏，可完全规避该死锁；之后通过系统托盘或 Ctrl+Alt+M 可靠唤回。
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
    use windows::Win32::UI::WindowsAndMessaging::{ShowWindow, SC_MINIMIZE, SW_HIDE, WM_SYSCOMMAND};

    if msg == WM_SYSCOMMAND && (wparam.0 & 0xFFF0) == SC_MINIMIZE as usize {
        // 用隐藏代替最小化，规避透明无边框窗口最小化卡死
        let _ = ShowWindow(hwnd, SW_HIDE);
        return LRESULT(0);
    }
    DefSubclassProc(hwnd, msg, wparam, lparam)
}

/// 为主窗口安装最小化拦截子类。
#[cfg(target_os = "windows")]
fn install_minimize_to_hide(window: &tauri::WebviewWindow) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::Shell::SetWindowSubclass;
    if let Ok(hwnd) = window.hwnd() {
        let h = HWND(hwnd.0 as *mut _);
        unsafe {
            let _ = SetWindowSubclass(h, Some(window_subclass_proc), 1, 0);
        }
    }
}

/// 由前端按当前界面语言更新系统托盘菜单文本（显示/退出）。
/// 保持菜单项 id 不变（show_main / exit_app），故已注册的 on_menu_event 仍生效。
#[tauri::command]
fn set_tray_menu_texts(
    app: tauri::AppHandle,
    show_text: String,
    exit_text: String,
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
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
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
    let log_file = OpenOptions::new().create(true).append(true).open(&log_path).expect("无法创建日志文件");
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
                if let Err(e) = core.start().await { error!("应用启动失败: {}", e); }
                core
            }
            Err(e) => { error!("应用核心初始化失败: {}", e); panic!("无法初始化应用核心: {}", e); }
        }
    });

    let app_state = AppState { core: Arc::new(Mutex::new(app_core)) };

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
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            greet, open_devtools,
            create_lobby, join_lobby, leave_lobby,
            toggle_mic, mute_player, mute_all,
            get_config, update_config, save_opacity,
            get_audio_devices, get_app_state, get_current_lobby, get_players,
            get_mic_status, get_global_mute_status, is_player_muted,
            get_network_status, get_virtual_ip, get_peer_connection_types,
            set_always_on_top, toggle_mini_mode, set_window_opacity,
            send_signaling_message, broadcast_status_update, send_heartbeat,
            force_stop_easytier,
            cancel_lobby_connecting,
            download_and_run_installer,
            check_virtual_adapter, check_firewall_rules, ping_virtual_ip, check_udp_port,
            is_admin, add_firewall_rules, restart_as_admin,
            save_window_position, exit_app,
            add_player_domain, remove_player_domain,
            get_folder_name, get_folder_info, list_directory_files,
            read_file_bytes, write_file_bytes, select_folder, select_file, select_save_location,
            save_file, save_chat_image, read_file, delete_file, extract_zip,
            open_file_location, open_folder,
            start_file_server, stop_file_server, check_file_server_status,
            add_shared_folder, remove_shared_folder, get_local_shares,
            cleanup_expired_shares, get_remote_shares, get_remote_files,
            verify_share_password, get_download_url, diagnose_file_share_connection,
            download_remote_file, cancel_remote_download, export_logs, test_node_latency,
            download_remote_batch, detect_security_software,
            send_p2p_chat_message, get_p2p_chat_messages, clear_p2p_chat_messages,
            open_screen_viewer_window,
            open_danmaku_window, close_danmaku_window,
            set_danmaku_ignore_cursor, danmaku_cursor_pos, save_danmaku_image,
            open_log_folder, open_log_file, get_log_file_path,
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
            remote_inject_input,
        ])
        .setup(|app| {
            info!("Tauri 应用设置完成");
            println!("🚀 [Setup] Tauri 应用设置开始");
            let app_handle = app.handle().clone();

            // 安装「最小化改为隐藏」子类，规避透明无边框窗口最小化卡死
            #[cfg(target_os = "windows")]
            if let Some(main_win) = app.get_webview_window("main") {
                install_minimize_to_hide(&main_win);
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
                
                // 使用固定的快捷键（不再从配置文件读取）
                let mic_hotkey = "CommandOrControl+M";
                let global_mute_hotkey = "CommandOrControl+T";
                let push_to_talk_hotkey = "F2";
                let summon_hotkey = "CommandOrControl+Alt+M";
                
                info!("注册固定快捷键: 麦克风=Ctrl+M, 全局静音=Ctrl+T, 临时开麦=F2, 唤出窗口=Ctrl+Alt+M");
                println!("🔑 [快捷键] 注册固定快捷键: 麦克风=Ctrl+M, 全局静音=Ctrl+T, 临时开麦=F2, 唤出窗口=Ctrl+Alt+M");

                // 注册「唤出窗口」快捷键：作为 Win+D/任务栏最小化后无法唤出的可靠兜底
                let hs = app_handle.clone();
                if let Err(e) = app.global_shortcut().on_shortcut(summon_hotkey, move |_, _, ev| {
                    if ev.state == tauri_plugin_global_shortcut::ShortcutState::Released { return; }
                    restore_main_window(&hs);
                }) {
                    println!("⚠️ [快捷键] 注册唤出窗口快捷键失败: {}", e);
                }
                
                let ltm = Arc::new(Mutex::new(std::time::Instant::now() - std::time::Duration::from_millis(500)));
                let ltt = Arc::new(Mutex::new(std::time::Instant::now() - std::time::Duration::from_millis(500)));
                let ltf = Arc::new(Mutex::new((false, false))); // (is_pressed, original_mic_state)
                
                // 注册麦克风快捷键
                let cm = Arc::clone(&core_hk); let hm = app_handle.clone(); let lm = Arc::clone(&ltm);
                if let Err(e) = app.global_shortcut().on_shortcut(mic_hotkey, move |_,_,ev| {
                    if ev.state == tauri_plugin_global_shortcut::ShortcutState::Released { return; }
                    let mut lt = match lm.try_lock() { Ok(g) => g, Err(_) => return };
                    let now = std::time::Instant::now();
                    if now.duration_since(*lt) < std::time::Duration::from_millis(200) { return; }
                    *lt = now; drop(lt);
                    let c = Arc::clone(&cm); let h = hm.clone();
                    tauri::async_runtime::spawn(async move {
                        match c.lock().await.toggle_mic().await {
                            Ok(s) => { let _ = h.emit("mic-toggled", s); }
                            Err(e) => { error!("切换麦克风失败: {}", e); }
                        }
                    });
                }) { 
                    error!("麦克风快捷键 Ctrl+M 注册失败: {}", e);
                    println!("❌ [快捷键] 麦克风快捷键 Ctrl+M 注册失败: {}", e);
                } else { 
                    info!("麦克风快捷键 Ctrl+M 注册成功");
                    println!("✅ [快捷键] 麦克风快捷键 Ctrl+M 注册成功");
                }
                
                // 注册全局静音快捷键
                let ct = Arc::clone(&core_hk); let ht = app_handle.clone(); let lt2 = Arc::clone(&ltt);
                if let Err(e) = app.global_shortcut().on_shortcut(global_mute_hotkey, move |_,_,ev| {
                    if ev.state == tauri_plugin_global_shortcut::ShortcutState::Released { return; }
                    let mut lt = match lt2.try_lock() { Ok(g) => g, Err(_) => return };
                    let now = std::time::Instant::now();
                    if now.duration_since(*lt) < std::time::Duration::from_millis(200) { return; }
                    *lt = now; drop(lt);
                    let c = Arc::clone(&ct); let h = ht.clone();
                    tauri::async_runtime::spawn(async move {
                        let vs = c.lock().await.get_voice_service();
                        let v = vs.lock().await;
                        let ns = !v.is_global_muted();
                        match v.mute_all(ns).await {
                            Ok(_) => { let _ = h.emit("global-mute-toggled", ns); }
                            Err(e) => { error!("切换静音失败: {}", e); }
                        }
                    });
                }) { 
                    error!("全局静音快捷键 Ctrl+T 注册失败: {}", e);
                    println!("❌ [快捷键] 全局静音快捷键 Ctrl+T 注册失败: {}", e);
                } else { 
                    info!("全局静音快捷键 Ctrl+T 注册成功");
                    println!("✅ [快捷键] 全局静音快捷键 Ctrl+T 注册成功");
                }
                
                // 注册 F2 临时开麦快捷键（按下开麦，松开闭麦）
                let cf = Arc::clone(&core_hk); let hf = app_handle.clone(); let ltf2 = Arc::clone(&ltf);
                if let Err(e) = app.global_shortcut().on_shortcut(push_to_talk_hotkey, move |_,_,ev| {
                    let c = Arc::clone(&cf); let h = hf.clone(); let lf = Arc::clone(&ltf2);
                    tauri::async_runtime::spawn(async move {
                        let mut state = match lf.try_lock() {
                            Ok(g) => g,
                            Err(_) => return,
                        };
                        
                        if ev.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                            // 按下 F2
                            if state.0 { return; } // 已经按下，防止重复触发
                            state.0 = true;
                            
                            // 获取当前麦克风状态
                            let current_mic_state = c.lock().await.get_voice_service().lock().await.is_mic_enabled();
                            state.1 = current_mic_state;
                            drop(state);
                            
                            // 如果麦克风是关闭的，则开启
                            if !current_mic_state {
                                info!("F2 临时开麦：开启麦克风");
                                match c.lock().await.toggle_mic().await {
                                    Ok(s) => { let _ = h.emit("mic-toggled", s); }
                                    Err(e) => { error!("F2 开启麦克风失败: {}", e); }
                                }
                            }
                        } else if ev.state == tauri_plugin_global_shortcut::ShortcutState::Released {
                            // 松开 F2
                            if !state.0 { return; } // 没有按下过，忽略
                            let original_state = state.1;
                            state.0 = false;
                            drop(state);
                            
                            // 如果原来麦克风是关闭的，则恢复关闭状态
                            if !original_state {
                                info!("F2 临时开麦：恢复麦克风状态");
                                match c.lock().await.toggle_mic().await {
                                    Ok(s) => { let _ = h.emit("mic-toggled", s); }
                                    Err(e) => { error!("F2 恢复麦克风状态失败: {}", e); }
                                }
                            }
                        }
                    });
                }) { 
                    error!("F2 临时开麦快捷键注册失败: {}", e);
                    println!("❌ [快捷键] F2 临时开麦快捷键注册失败: {}", e);
                } else { 
                    info!("F2 临时开麦快捷键注册成功");
                    println!("✅ [快捷键] F2 临时开麦快捷键注册成功");
                }
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
            if let tauri::WindowEvent::Moved(_pos) = event {
                ensure_window_visible(window);
            }
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let label = window.label().to_string();
                // 仅主窗口关闭时才退出应用；辅助窗口(弹幕覆盖层/屏幕查看等)正常关闭，
                // 不得连带退出整个程序（修复：预览弹幕后弹幕窗关闭把主程序也带退了）
                if label != "main" {
                    return;
                }
                api.prevent_close();
                let ah = window.app_handle().clone();
                if let Some(state) = ah.try_state::<AppState>() {
                    let core = Arc::clone(&state.core);
                    tauri::async_runtime::spawn(async move {
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
    if let Err(e) = result { error!("运行错误: {}", e); panic!("error: {}", e); }
    info!("MCTier 应用程序已关闭");
}
