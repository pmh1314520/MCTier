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

// 导入所有 Tauri 命令
use modules::tauri_commands::{
    // 大厅操作命令
    create_lobby,
    join_lobby,
    leave_lobby,
    // 语音控制命令
    toggle_mic,
    mute_player,
    mute_all,
    // 配置管理命令
    get_config,
    update_config,
    save_opacity,
    // 系统信息命令
    get_audio_devices,
    get_app_state,
    get_current_lobby,
    get_players,
    get_mic_status,
    get_global_mute_status,
    is_player_muted,
    get_network_status,
    get_virtual_ip,
    // 窗口控制命令
    set_always_on_top,
    toggle_mini_mode,
    set_window_opacity,
    // WebRTC 语音通信命令
    send_signaling_message,
    broadcast_status_update,
    send_heartbeat,
    // 网络诊断命令
    check_virtual_adapter,
    check_firewall_rules,
    ping_virtual_ip,
    check_udp_port,
    // 应用控制命令
    exit_app,
    // Magic DNS 命令
    add_player_domain,
    remove_player_domain,
    // 文件共享命令（旧）
    get_folder_name,
    get_folder_info,
    list_directory_files,
    read_file_bytes,
    write_file_bytes,
    select_folder,
    select_save_location,
    save_file,
    read_file,
    delete_file,
    open_file_location,
    // HTTP 文件共享命令（新）
    start_file_server,
    stop_file_server,
    check_file_server_status,
    add_shared_folder,
    remove_shared_folder,
    get_local_shares,
    cleanup_expired_shares,
    get_remote_shares,
    get_remote_files,
    verify_share_password,
    get_download_url,
    diagnose_file_share_connection,
    // P2P 聊天命令
    send_p2p_chat_message,
    get_p2p_chat_messages,
    clear_p2p_chat_messages,
};

// 测试命令
#[tauri::command]
fn greet(name: &str) -> String {
    info!("Greeting user: {}", name);
    format!("Hello, {}! You've been greeted from Rust!", name)
}

/// 打开开发者工具（仅在 debug 模式下可用）
#[tauri::command]
fn open_devtools(_app: tauri::AppHandle) {
    #[cfg(debug_assertions)]
    {
        info!("打开开发者工具");
        if let Some(webview) = _app.get_webview_window("main") {
            webview.open_devtools();
            info!("开发者工具已打开");
        } else {
            error!("无法找到主窗口");
        }
    }
    #[cfg(not(debug_assertions))]
    {
        log::warn!("开发者工具仅在 debug 模式下可用");
    }
}
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 初始化日志系统
    env_logger::Builder::from_default_env()
        .filter_level(log::LevelFilter::Info)
        .format_timestamp_millis()
        .init();

    info!("MCTier 应用程序启动中...");

    // 创建 Tokio 运行时用于初始化
    let runtime = tokio::runtime::Runtime::new().expect("无法创建 Tokio 运行时");
    
    // 初始化应用核心
    let app_core = runtime.block_on(async {
        match AppCore::new().await {
            Ok(core) => {
                info!("应用核心初始化成功");
                // 启动应用
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
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            greet,
            open_devtools,
            // 大厅操作命令
            create_lobby,
            join_lobby,
            leave_lobby,
            // 语音控制命令
            toggle_mic,
            mute_player,
            mute_all,
            // 配置管理命令
            get_config,
            update_config,
            save_opacity,
            // 系统信息命令
            get_audio_devices,
            get_app_state,
            get_current_lobby,
            get_players,
            get_mic_status,
            get_global_mute_status,
            is_player_muted,
            get_network_status,
            get_virtual_ip,
            // 窗口控制命令
            set_always_on_top,
            toggle_mini_mode,
            set_window_opacity,
            // WebRTC 语音通信命令
            send_signaling_message,
            broadcast_status_update,
            send_heartbeat,
            // 网络诊断命令
            check_virtual_adapter,
            check_firewall_rules,
            ping_virtual_ip,
            check_udp_port,
            // 应用控制命令
            exit_app,
            // Magic DNS 命令
            add_player_domain,
            remove_player_domain,
            // 文件共享命令（旧）
            get_folder_name,
            get_folder_info,
            list_directory_files,
            read_file_bytes,
            write_file_bytes,
            select_folder,
            select_save_location,
            save_file,
            read_file,
            delete_file,
            open_file_location,
            // HTTP 文件共享命令（新）
            start_file_server,
            stop_file_server,
            check_file_server_status,
            add_shared_folder,
            remove_shared_folder,
            get_local_shares,
            cleanup_expired_shares,
            get_remote_shares,
            get_remote_files,
            verify_share_password,
            get_download_url,
            diagnose_file_share_connection,
            // P2P 聊天命令
            send_p2p_chat_message,
            get_p2p_chat_messages,
            clear_p2p_chat_messages,
        ])
        .setup(|app| {
            info!("Tauri 应用设置完成");
            
            // 注册全局快捷键
            let app_handle = app.handle().clone();
            if let Some(state) = app.try_state::<AppState>() {
                let core_for_hotkey = Arc::clone(&state.core);
                
                // 使用Arc<Mutex>来存储上次触发时间，实现防抖
                let last_trigger_time_mic = Arc::new(Mutex::new(std::time::Instant::now() - std::time::Duration::from_millis(500)));
                let last_trigger_time_mute = Arc::new(Mutex::new(std::time::Instant::now() - std::time::Duration::from_millis(500)));
                
                // 注册 Ctrl+M 全局快捷键用于切换麦克风
                let core_for_mic = Arc::clone(&core_for_hotkey);
                let app_handle_mic = app_handle.clone();
                let last_time_mic = Arc::clone(&last_trigger_time_mic);
                if let Err(e) = app.global_shortcut().on_shortcut("CommandOrControl+M", move |_app, _shortcut, event| {
                    // 只处理按键按下事件，忽略释放事件
                    if event.state == tauri_plugin_global_shortcut::ShortcutState::Released {
                        return;
                    }
                    
                    info!("全局快捷键触发: Ctrl+M (state: {:?})", event.state);
                    
                    // 防抖：如果距离上次触发不到200ms，则忽略
                    let mut last_time = match last_time_mic.try_lock() {
                        Ok(guard) => guard,
                        Err(_) => {
                            info!("快捷键处理中，忽略重复触发");
                            return;
                        }
                    };
                    
                    let now = std::time::Instant::now();
                    if now.duration_since(*last_time) < std::time::Duration::from_millis(200) {
                        info!("快捷键触发过快，忽略 (间隔: {:?})", now.duration_since(*last_time));
                        return;
                    }
                    *last_time = now;
                    drop(last_time);
                    
                    let core = Arc::clone(&core_for_mic);
                    let handle = app_handle_mic.clone();
                    
                    tauri::async_runtime::spawn(async move {
                        // 切换麦克风状态
                        match core.lock().await.toggle_mic().await {
                            Ok(new_state) => {
                                info!("麦克风状态已切换为: {}", new_state);
                                // 发送事件到前端更新UI
                                if let Err(e) = handle.emit("mic-toggled", new_state) {
                                    error!("发送麦克风状态事件失败: {}", e);
                                }
                            }
                            Err(e) => {
                                error!("切换麦克风状态失败: {}", e);
                            }
                        }
                    });
                }) {
                    error!("注册全局快捷键失败: {}", e);
                } else {
                    info!("全局快捷键 Ctrl+M 注册成功");
                }
                
                // 注册 Ctrl+T 全局快捷键用于切换全局听筒
                let core_for_mute = Arc::clone(&core_for_hotkey);
                let app_handle_mute = app_handle.clone();
                let last_time_mute = Arc::clone(&last_trigger_time_mute);
                if let Err(e) = app.global_shortcut().on_shortcut("CommandOrControl+T", move |_app, _shortcut, event| {
                    // 只处理按键按下事件，忽略释放事件
                    if event.state == tauri_plugin_global_shortcut::ShortcutState::Released {
                        return;
                    }
                    
                    info!("全局快捷键触发: Ctrl+T (state: {:?})", event.state);
                    
                    // 防抖：如果距离上次触发不到200ms，则忽略
                    let mut last_time = match last_time_mute.try_lock() {
                        Ok(guard) => guard,
                        Err(_) => {
                            info!("快捷键处理中，忽略重复触发");
                            return;
                        }
                    };
                    
                    let now = std::time::Instant::now();
                    if now.duration_since(*last_time) < std::time::Duration::from_millis(200) {
                        info!("快捷键触发过快，忽略 (间隔: {:?})", now.duration_since(*last_time));
                        return;
                    }
                    *last_time = now;
                    drop(last_time);
                    
                    let core = Arc::clone(&core_for_mute);
                    let handle = app_handle_mute.clone();
                    
                    tauri::async_runtime::spawn(async move {
                        // 切换全局静音状态
                        let voice_service = core.lock().await.get_voice_service();
                        let voice_svc = voice_service.lock().await;
                        
                        // 获取当前全局静音状态并切换
                        let current_muted = voice_svc.is_global_muted();
                        let new_state = !current_muted;
                        
                        match voice_svc.mute_all(new_state).await {
                            Ok(_) => {
                                info!("全局听筒状态已切换为: {}", if new_state { "静音" } else { "开启" });
                                // 发送事件到前端更新UI
                                if let Err(e) = handle.emit("global-mute-toggled", new_state) {
                                    error!("发送全局静音状态事件失败: {}", e);
                                }
                            }
                            Err(e) => {
                                error!("切换全局静音状态失败: {}", e);
                            }
                        }
                    });
                }) {
                    error!("注册全局快捷键 Ctrl+T 失败: {}", e);
                } else {
                    info!("全局快捷键 Ctrl+T 注册成功");
                }
            }
            
            // 获取主窗口
            if let Some(window) = app.get_webview_window("main") {
                #[cfg(target_os = "windows")]
                {
                    use windows::Win32::Foundation::HWND;
                    use windows::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_USE_IMMERSIVE_DARK_MODE};
                    use windows::Win32::UI::WindowsAndMessaging::{SetLayeredWindowAttributes, LWA_ALPHA, GWL_EXSTYLE, WS_EX_LAYERED, GetWindowLongW, SetWindowLongW};
                    
                    // 获取窗口句柄
                    if let Ok(hwnd) = window.hwnd() {
                        let hwnd = HWND(hwnd.0 as *mut _);
                        
                        unsafe {
                            // 启用暗色模式
                            let dark_mode: i32 = 1;
                            let _ = DwmSetWindowAttribute(
                                hwnd,
                                DWMWA_USE_IMMERSIVE_DARK_MODE,
                                &dark_mode as *const _ as *const _,
                                std::mem::size_of::<i32>() as u32,
                            );
                            
                            // 设置窗口为分层窗口以支持透明度（但不设置初始透明度）
                            // 透明度只在进入大厅后才会被设置
                            let ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE);
                            SetWindowLongW(hwnd, GWL_EXSTYLE, ex_style | WS_EX_LAYERED.0 as i32);
                            
                            // 设置初始透明度为100%（完全不透明）
                            let _ = SetLayeredWindowAttributes(hwnd, windows::Win32::Foundation::COLORREF(0), 255, LWA_ALPHA);
                            
                            info!("Windows 窗口已配置为支持透明度，初始状态为完全不透明");
                        }
                    }
                }
            }
            
            // 获取应用句柄并设置到 AppCore
            // 注意：这里必须同步等待设置完成，否则创建/加入大厅时 app_handle 可能还没设置好
            let app_handle = app.handle().clone();
            if let Some(state) = app.try_state::<AppState>() {
                let core = Arc::clone(&state.core);
                // 使用 block_on 同步等待设置完成
                tauri::async_runtime::block_on(async move {
                    core.lock().await.set_app_handle(app_handle).await;
                    info!("应用句柄已设置到 AppCore");
                });
            }
            
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                info!("窗口关闭请求");
                // 在窗口关闭时执行清理
                let app_handle = window.app_handle();
                if let Some(state) = app_handle.try_state::<AppState>() {
                    let core = Arc::clone(&state.core);
                    // 使用 tauri::async_runtime 而不是 tokio::spawn
                    tauri::async_runtime::spawn(async move {
                        if let Err(e) = core.lock().await.shutdown().await {
                            error!("应用关闭时发生错误: {}", e);
                        }
                    });
                }
            }
        })
        .run(tauri::generate_context!());

    if let Err(e) = result {
        error!("应用程序运行错误: {}", e);
        panic!("error while running tauri application: {}", e);
    }

    info!("MCTier 应用程序已关闭");
}
