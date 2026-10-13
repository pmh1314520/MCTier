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
    log::info!(
        "打开屏幕查看窗口: share_id={}, player_name={}",
        share_id,
        player_name
    );

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
    let url = format!(
        "index.html?screen-viewer=true&shareId={}&playerName={}",
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

    // 查看窗口自己也跑一条 WebRTC 接收链路，同样需要打开媒体开关
    #[cfg(target_os = "linux")]
    crate::modules::linux_platform::enable_webview_media(&_window);

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
    // 注意顺序：必须先 show() 再设鼠标穿透。
    // 这些窗口以 visible(false) 创建，在 Linux/Wayland 下 GTK 尚未 realize 时调用
    // set_ignore_cursor_events 会命中 tao 内部的 window().unwrap() 而 panic，
    // 表现为"进大厅瞬间闪退"。先 show 让主循环完成 realize 再设穿透即可规避；
    // Windows 上两种顺序都成立，因此这里统一用兼容写法而不加 cfg 分支。
    let _ = window.set_always_on_top(true);
    let _ = window.show();
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    let _ = window.set_ignore_cursor_events(true);

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

/// 切换弹幕窗口的鼠标穿透（用于点击弹幕暂停/复制/下载时临时关闭穿透）
#[tauri::command]
pub async fn set_danmaku_ignore_cursor(app: tauri::AppHandle, ignore: bool) -> Result<(), String> {
    use tauri::Manager;
    if let Some(window) = app.get_webview_window("danmaku") {
        let _ = window.set_ignore_cursor_events(ignore);
    }
    Ok(())
}

/// 打开游戏内 HUD 浮层窗口：置顶、透明、无边框、鼠标穿透，置于主屏右上角。
/// 显示队友延迟/丢包与"谁在说话"，玩游戏时一眼掌握全队状态。
#[tauri::command]
pub async fn open_game_hud_window(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    use tauri::WebviewWindowBuilder;
    let label = "gamehud";
    if let Some(existing) = app.get_webview_window(label) {
        let _ = existing.show();
        let _ = existing.set_always_on_top(true);
        let _ = existing.set_ignore_cursor_events(true);
        return Ok(());
    }
    let mut builder = WebviewWindowBuilder::new(
        &app,
        label,
        tauri::WebviewUrl::App("index.html?gamehud=true".into()),
    )
    .title("MCTier HUD")
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .shadow(false)
    .resizable(false)
    .focused(false)
    .visible(false)
    .inner_size(600.0, 600.0);
    // 设为主窗口的子(owner)窗口：主程序进程结束时，HUD 窗口由系统随父窗口一并立即销毁，
    // 避免主程序被杀后 HUD 还残留几秒。
    if let Some(main_win) = app.get_webview_window("main") {
        builder = builder
            .parent(&main_win)
            .map_err(|e| format!("设置HUD父窗口失败: {}", e))?;
    }
    let window = builder
        .build()
        .map_err(|e| format!("创建HUD窗口失败: {}", e))?;
    // 定位到主屏右上角
    if let Ok(Some(monitor)) = window.primary_monitor() {
        let size = monitor.size();
        let pos = monitor.position();
        let scale = monitor.scale_factor();
        let w = (600.0 * scale) as i32;
        let x = pos.x + size.width as i32 - w - (24.0 * scale) as i32;
        let y = pos.y + (60.0 * scale) as i32;
        let _ = window.set_position(tauri::PhysicalPosition::new(x.max(pos.x), y));
    }
    // 同 open_danmaku_window：先 show 完成 realize 再设穿透，规避 tao/Wayland 竞态 panic
    let _ = window.set_always_on_top(true);
    let _ = window.show();
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    let _ = window.set_ignore_cursor_events(true);
    log::info!("✅ 游戏HUD窗口已打开");
    Ok(())
}

/// 关闭游戏内 HUD 浮层窗口
#[tauri::command]
pub async fn close_game_hud_window(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    if let Some(window) = app.get_webview_window("gamehud") {
        let _ = window.close();
    }
    Ok(())
}

/// 切换 HUD 窗口鼠标穿透（悬停在 HUD 卡片上时关闭穿透以便拖动）
#[tauri::command]
pub async fn set_gamehud_ignore_cursor(app: tauri::AppHandle, ignore: bool) -> Result<(), String> {
    use tauri::Manager;
    if let Some(window) = app.get_webview_window("gamehud") {
        let _ = window.set_ignore_cursor_events(ignore);
    }
    Ok(())
}

/// 获取鼠标相对 HUD 窗口的逻辑坐标（穿透模式下命中检测 HUD 卡片用）
#[tauri::command]
pub async fn gamehud_cursor_pos(app: tauri::AppHandle) -> Result<Option<(f64, f64)>, String> {
    use tauri::Manager;
    let window = match app.get_webview_window("gamehud") {
        Some(w) => w,
        None => return Ok(None),
    };
    let cursor = match app.cursor_position() {
        Ok(c) => c,
        Err(_) => return Ok(None),
    };
    let pos = match window.outer_position() {
        Ok(p) => p,
        Err(_) => return Ok(None),
    };
    let scale = window.scale_factor().unwrap_or(1.0).max(0.1);
    let rx = (cursor.x - pos.x as f64) / scale;
    let ry = (cursor.y - pos.y as f64) / scale;
    Ok(Some((rx, ry)))
}

/// 获取鼠标相对弹幕窗口的逻辑坐标（用于在穿透模式下命中检测弹幕）。
/// 返回 None 表示窗口不存在或取不到坐标。
#[tauri::command]
pub async fn danmaku_cursor_pos(app: tauri::AppHandle) -> Result<Option<(f64, f64)>, String> {
    use tauri::Manager;
    let window = match app.get_webview_window("danmaku") {
        Some(w) => w,
        None => return Ok(None),
    };
    let cursor = match app.cursor_position() {
        Ok(c) => c,
        Err(_) => return Ok(None),
    };
    let pos = match window.outer_position() {
        Ok(p) => p,
        Err(_) => return Ok(None),
    };
    let scale = window.scale_factor().unwrap_or(1.0).max(0.1);
    let rx = (cursor.x - pos.x as f64) / scale;
    let ry = (cursor.y - pos.y as f64) / scale;
    Ok(Some((rx, ry)))
}

/// 保存弹幕图片（data URL）到系统下载文件夹，返回保存的完整路径。
#[tauri::command]
pub async fn save_danmaku_image(data_url: String) -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};

    // 解析 data URL：data:image/<ext>;base64,<payload>
    let (meta, payload) = data_url
        .split_once(',')
        .ok_or_else(|| "无效的图片数据".to_string())?;
    let ext = if meta.contains("png") {
        "png"
    } else if meta.contains("gif") {
        "gif"
    } else if meta.contains("webp") {
        "webp"
    } else {
        "jpg"
    };
    let bytes = STANDARD
        .decode(payload.trim())
        .map_err(|e| format!("图片解码失败: {}", e))?;

    let dir = dirs::download_dir()
        .or_else(dirs::picture_dir)
        .or_else(dirs::home_dir)
        .ok_or_else(|| "找不到下载目录".to_string())?;
    let ts = chrono::Local::now().format("%Y%m%d_%H%M%S");
    let filename = format!("MCTier_弹幕图片_{}.{}", ts, ext);
    let path = dir.join(&filename);
    std::fs::write(&path, &bytes).map_err(|e| format!("保存失败: {}", e))?;
    Ok(path.to_string_lossy().to_string())
}
