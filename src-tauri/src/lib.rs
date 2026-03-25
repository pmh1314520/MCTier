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

use modules::tauri_commands::{
    create_lobby, join_lobby, leave_lobby,
    toggle_mic, mute_player, mute_all,
    get_config, update_config, save_opacity,
    get_audio_devices, get_app_state, get_current_lobby, get_players,
    get_mic_status, get_global_mute_status, is_player_muted,
    get_network_status, get_virtual_ip,
    set_always_on_top, toggle_mini_mode, set_window_opacity,
    send_signaling_message, broadcast_status_update, send_heartbeat,
    force_stop_easytier,
    check_virtual_adapter, check_firewall_rules, ping_virtual_ip, check_udp_port,
    exit_app,
    add_player_domain, remove_player_domain,
    get_folder_name, get_folder_info, list_directory_files,
    read_file_bytes, write_file_bytes, select_folder, select_save_location,
    save_file, save_chat_image, read_file, delete_file, extract_zip,
    open_file_location, open_folder,
    start_file_server, stop_file_server, check_file_server_status,
    add_shared_folder, remove_shared_folder, get_local_shares,
    cleanup_expired_shares, get_remote_shares, get_remote_files,
    verify_share_password, get_download_url, diagnose_file_share_connection,
    send_p2p_chat_message, get_p2p_chat_messages, clear_p2p_chat_messages,
    open_screen_viewer_window,
    open_log_folder, open_log_file, get_log_file_path,
    save_settings, get_settings, set_auto_start, check_auto_start,
};

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
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
            get_network_status, get_virtual_ip,
            set_always_on_top, toggle_mini_mode, set_window_opacity,
            send_signaling_message, broadcast_status_update, send_heartbeat,
            force_stop_easytier,
            check_virtual_adapter, check_firewall_rules, ping_virtual_ip, check_udp_port,
            exit_app,
            add_player_domain, remove_player_domain,
            get_folder_name, get_folder_info, list_directory_files,
            read_file_bytes, write_file_bytes, select_folder, select_save_location,
            save_file, save_chat_image, read_file, delete_file, extract_zip,
            open_file_location, open_folder,
            start_file_server, stop_file_server, check_file_server_status,
            add_shared_folder, remove_shared_folder, get_local_shares,
            cleanup_expired_shares, get_remote_shares, get_remote_files,
            verify_share_password, get_download_url, diagnose_file_share_connection,
            send_p2p_chat_message, get_p2p_chat_messages, clear_p2p_chat_messages,
            open_screen_viewer_window,
            open_log_folder, open_log_file, get_log_file_path,
            save_settings, get_settings, set_auto_start, check_auto_start,
        ])
        .setup(|app| {
            info!("Tauri 应用设置完成");
            let app_handle = app.handle().clone();
            if let Some(state) = app.try_state::<AppState>() {
                let core_hk = Arc::clone(&state.core);
                let ltm = Arc::new(Mutex::new(std::time::Instant::now() - std::time::Duration::from_millis(500)));
                let ltt = Arc::new(Mutex::new(std::time::Instant::now() - std::time::Duration::from_millis(500)));
                let cm = Arc::clone(&core_hk); let hm = app_handle.clone(); let lm = Arc::clone(&ltm);
                if let Err(e) = app.global_shortcut().on_shortcut("CommandOrControl+M", move |_,_,ev| {
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
                }) { error!("Ctrl+M注册失败: {}", e); } else { info!("Ctrl+M 注册成功"); }
                let ct = Arc::clone(&core_hk); let ht = app_handle.clone(); let lt2 = Arc::clone(&ltt);
                if let Err(e) = app.global_shortcut().on_shortcut("CommandOrControl+T", move |_,_,ev| {
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
                }) { error!("Ctrl+T注册失败: {}", e); } else { info!("Ctrl+T 注册成功"); }
            }
            if let Some(window) = app.get_webview_window("main") {
                #[cfg(target_os = "windows")]
                {
                    use windows::Win32::Foundation::HWND;
                    use windows::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_USE_IMMERSIVE_DARK_MODE};
                    use windows::Win32::UI::WindowsAndMessaging::{SetLayeredWindowAttributes, LWA_ALPHA, GWL_EXSTYLE, WS_EX_LAYERED, GetWindowLongW, SetWindowLongW};
                    if let Ok(hwnd) = window.hwnd() {
                        let hwnd = HWND(hwnd.0 as *mut _);
                        unsafe {
                            let dm: i32 = 1;
                            let _ = DwmSetWindowAttribute(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE, &dm as *const _ as *const _, std::mem::size_of::<i32>() as u32);
                            let ex = GetWindowLongW(hwnd, GWL_EXSTYLE);
                            SetWindowLongW(hwnd, GWL_EXSTYLE, ex | WS_EX_LAYERED.0 as i32);
                            let _ = SetLayeredWindowAttributes(hwnd, windows::Win32::Foundation::COLORREF(0), 255, LWA_ALPHA);
                        }
                    }
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
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let ah = window.app_handle().clone();
                let label = window.label().to_string();
                if let Some(state) = ah.try_state::<AppState>() {
                    let core = Arc::clone(&state.core);
                    tauri::async_runtime::spawn(async move {
                        if let Err(e) = core.lock().await.shutdown().await { error!("关闭错误: {}", e); }
                        if let Some(w) = ah.get_webview_window(&label) { let _ = w.close(); }
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
