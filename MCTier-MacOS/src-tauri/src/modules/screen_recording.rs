//! Local recording sink. A trusted main window selects a persistent native output directory.
use std::{fs::{File, OpenOptions}, io::Write, path::PathBuf, sync::{Mutex, OnceLock}};
use serde::Serialize;
use tauri::{WebviewWindow, State, ipc::{Request, InvokeBody}};
use crate::AppState;

struct Output { id: String, path: PathBuf, partial: PathBuf, file: File, bytes: u64 }
fn output() -> &'static Mutex<Option<Output>> {
    static VALUE: OnceLock<Mutex<Option<Output>>> = OnceLock::new();
    VALUE.get_or_init(|| Mutex::new(None))
}
fn authorize(window: &WebviewWindow) -> Result<(), String> {
    if window.label() != "main" || !super::media_permission::trusted(window.url().map_err(|e| e.to_string())?.as_str()) {
        return Err("仅主窗口可操作录屏文件".into());
    }
    Ok(())
}
#[derive(Serialize)]
pub struct RecordingOutput { id: String, path: String }

fn default_directory() -> Result<PathBuf, String> {
    dirs::video_dir().or_else(|| dirs::home_dir().map(|home| home.join("Videos")))
        .map(|videos| videos.join("MCTier")).ok_or_else(|| "无法定位用户视频目录".into())
}

async fn configured_directory(state: &State<'_, AppState>) -> Result<PathBuf, String> {
    let manager = state.config_manager().await;
    let cfg = manager.lock().await;
    let directory = cfg.get_config().recording_directory.as_deref().map(PathBuf::from).map(Ok).unwrap_or_else(default_directory)?;
    std::fs::create_dir_all(&directory).map_err(|e| format!("无法创建录制目录: {e}"))?;
    Ok(directory)
}

#[tauri::command]
pub async fn recording_get_directory(window: WebviewWindow, state: State<'_, AppState>) -> Result<String, String> {
    authorize(&window)?;
    configured_directory(&state).await?.to_str().map(str::to_owned).ok_or_else(|| "无法读取录制目录".into())
}

#[tauri::command]
pub async fn recording_choose_directory(window: WebviewWindow, state: State<'_, AppState>) -> Result<Option<String>, String> {
    authorize(&window)?;
    let Some(chosen) = rfd::AsyncFileDialog::new().set_title("选择录制保存文件夹").pick_folder().await else { return Ok(None) };
    let path = chosen.path().to_path_buf();
    let text = path.to_str().ok_or("无法转换录制目录路径")?.to_owned();
    let manager = state.config_manager().await;
    let mut cfg = manager.lock().await;
    cfg.update_config(|config| config.recording_directory = Some(text.clone())).await.map_err(|e| format!("保存录制目录失败: {e}"))?;
    Ok(Some(text))
}

#[tauri::command]
pub async fn recording_reset_directory(window: WebviewWindow, state: State<'_, AppState>) -> Result<String, String> {
    authorize(&window)?;
    let directory = default_directory()?;
    std::fs::create_dir_all(&directory).map_err(|e| format!("无法创建默认录制目录: {e}"))?;
    let manager = state.config_manager().await;
    let mut cfg = manager.lock().await;
    cfg.update_config(|config| config.recording_directory = None).await.map_err(|e| format!("恢复录制目录失败: {e}"))?;

    directory.to_str().map(str::to_owned).ok_or_else(|| "无法读取默认录制目录".into())
}
#[tauri::command]
pub async fn recording_create(window: WebviewWindow, state: State<'_, AppState>, extension: String) -> Result<Option<RecordingOutput>, String> {
    authorize(&window)?;
    if !["webm", "mp4"].contains(&extension.as_str()) { return Err("无效录屏格式".into()); }
    let directory = configured_directory(&state).await?;
    let filename = format!("MCTier-{}.{}", chrono::Local::now().format("%Y%m%d-%H%M%S"), extension);
    let mut path = directory.join(filename);
    if path.exists() { path = directory.join(format!("MCTier-{}-{}.{}", chrono::Local::now().format("%Y%m%d-%H%M%S"), uuid::Uuid::new_v4().simple(), extension)); }
    create_at(path).map(Some)
}
fn create_at(path: PathBuf) -> Result<RecordingOutput, String> {
    if path.exists() { return Err("文件已存在，请使用新的文件名，避免覆盖录像".into()); }
    let mut guard = output().lock().map_err(|e| e.to_string())?;
    if guard.is_some() { return Err("已有录屏文件正在写入".into()); }
    let id = uuid::Uuid::new_v4().to_string();
    let partial = path.with_extension(format!("{id}.partial"));
    let file = OpenOptions::new().create_new(true).write(true).open(&partial).map_err(|e| e.to_string())?;
    let result = RecordingOutput { id: id.clone(), path: path.to_string_lossy().into_owned() };
    *guard = Some(Output { id, path, partial, file, bytes: 0 });
    Ok(result)
}
#[tauri::command]
pub fn recording_write(window: WebviewWindow, request: Request<'_>) -> Result<(), String> {
    authorize(&window)?;
    let id = request.headers().get("x-recording-id").and_then(|h| h.to_str().ok()).ok_or("缺少录制 ID")?;
    let InvokeBody::Raw(bytes) = request.body() else { return Err("无效录屏数据".into()) };
    if bytes.len() > 16 * 1024 * 1024 { return Err("录制写入积压，请降低画质".into()); }
    let mut guard = output().lock().map_err(|e| e.to_string())?;
    let out = guard.as_mut().filter(|o| o.id == id).ok_or("录屏文件已关闭")?;
    out.file.write_all(bytes).map_err(|e| format!("录屏保存失败，请检查磁盘空间: {e}"))?;
    out.bytes += bytes.len() as u64;
    Ok(())
}
#[tauri::command]
pub fn recording_finish(window: WebviewWindow, id: String, discard: bool) -> Result<String, String> {
    authorize(&window)?;
    let mut guard = output().lock().map_err(|e| e.to_string())?;
    if guard.as_ref().map(|o| o.id.as_str()) != Some(&id) { return Err("录屏会话不匹配".into()); }
    let out = guard.take().unwrap();
    if discard || out.bytes == 0 {
        drop(out.file);
        std::fs::remove_file(out.partial).map_err(|e| e.to_string())?;
        return Ok(String::new());
    }
    out.file.sync_all().map_err(|e| format!("录像未能落盘，临时文件位于 {}: {e}", out.partial.display()))?;
    drop(out.file);
    publish_file(&out.partial, &out.path).map_err(|e| format!("保存失败，录像保留在 {}: {e}", out.partial.display()))?;
    super::tauri_commands::register_path_grant(&out.path.to_string_lossy(), super::tauri_commands::PathAccess::Open, false)
        .map_err(|e| format!("录像已保存到 {}，但无法授权打开位置: {e}", out.path.display()))?;
    Ok(out.path.to_string_lossy().into_owned())
}
pub fn close_output() {
    if let Some(out) = output().lock().unwrap_or_else(|e| e.into_inner()).take() {
        let _ = out.file.sync_all();
        // On abrupt window reload, preserve partial bytes for recovery, never claim completion.
    }
}
fn publish_file(partial: &std::path::Path, path: &std::path::Path) -> std::io::Result<()> {
    #[cfg(windows)] {
        use std::os::windows::ffi::OsStrExt;
        #[link(name = "kernel32")]
        extern "system" { fn MoveFileW(existing: *const u16, destination: *const u16) -> i32; }
        let source: Vec<u16> = partial.as_os_str().encode_wide().chain(Some(0)).collect();
        let destination: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        // Same-directory move supports FAT/exFAT and refuses to overwrite an existing file.
        if unsafe { MoveFileW(source.as_ptr(), destination.as_ptr()) } == 0 { return Err(std::io::Error::last_os_error()); }
        Ok(())
    }
    #[cfg(not(windows))] {
        std::fs::hard_link(partial, path)?;
        std::fs::remove_file(partial)
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn publish_preserves_existing_files_and_moves_new_recordings() {
        let dir = tempfile::tempdir().unwrap();
        let partial = dir.path().join("video.partial");
        let final_path = dir.path().join("video.webm");
        std::fs::write(&partial, b"recording").unwrap();
        std::fs::write(&final_path, b"previous").unwrap();
        assert!(super::publish_file(&partial, &final_path).is_err());
        assert_eq!(std::fs::read(&final_path).unwrap(), b"previous");
        assert!(partial.exists());
        let destination = dir.path().join("new.webm");
        super::publish_file(&partial, &destination).unwrap();
        assert_eq!(std::fs::read(destination).unwrap(), b"recording");
        assert!(!partial.exists());
    }
}
pub fn finish_before_exit(app: &tauri::AppHandle) -> bool {
    use tauri::{Emitter, Manager};
    if output().lock().unwrap_or_else(|e| e.into_inner()).is_none() { return false; }
    if let Some(window) = app.get_webview_window("main") { let _ = window.show(); }
    let _ = app.emit("screen-recording-exit", ());
    true
}

#[cfg(all(test, windows))]
#[path = "screen_recording_test.rs"]
mod integration;
