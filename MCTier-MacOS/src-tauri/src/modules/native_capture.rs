//! Native Windows Graphics Capture. No browser picker, getDisplayMedia or loopback server.
//! GPU scaling precedes binary IPC; one requested frame at a time provides backpressure.
use serde::Serialize;
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::Duration,
};
use tauri::WebviewWindow;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub width: u32,
    pub height: u32,
    pub primary: bool,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureInfo {
    pub id: String,
    pub source: Source,
    pub remote: bool,
}
type FrameReply = tokio::sync::oneshot::Sender<Result<Vec<u8>, String>>;
struct Session {
    recording: bool,
    info: CaptureInfo,
    stop: Arc<AtomicBool>,
    frames: std::sync::mpsc::SyncSender<FrameReply>,
}
fn sessions() -> &'static Mutex<HashMap<String, Session>> {
    static VALUE: OnceLock<Mutex<HashMap<String, Session>>> = OnceLock::new();
    VALUE.get_or_init(|| Mutex::new(HashMap::new()))
}
/// 有活跃会话时申请 macOS 后台活动豁免：窗口隐藏后 App Nap 会节流进程，
/// WebView 的取帧泵一旦停摆，观看端就会卡在最后一帧。会话清零时释放。
#[cfg(target_os = "macos")]
fn update_background_activity() {
    let active = !sessions()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .is_empty();
    crate::modules::macos_platform::set_realtime_activity(active);
}
fn authorize(window: &WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("此窗口不能操作屏幕采集".into());
    }
    let url = window.url().map_err(|e| e.to_string())?;
    let trusted = url.username().is_empty()
        && url.password().is_none()
        && ((url.scheme() == "http"
            && url.host_str() == Some("tauri.localhost")
            && url.port().is_none())
            || (cfg!(debug_assertions)
                && url.scheme() == "http"
                && url.host_str() == Some("localhost")
                && url.port() == Some(1420))
            || (cfg!(not(windows))
                && url.scheme() == "tauri"
                && url.host_str() == Some("localhost")));
    if !trusted {
        return Err("仅应用页面可操作屏幕采集".into());
    }
    Ok(())
}
fn validate_quality(resolution: u32, frame_rate: u32) -> Result<(), String> {
    if ![720, 1080, 1440, 2160].contains(&resolution) || ![30, 60, 120].contains(&frame_rate) {
        return Err("无效的屏幕采集画质".into());
    }
    Ok(())
}
fn output_size(width: u32, height: u32, resolution: u32) -> (u32, u32) {
    // Rational arithmetic avoids 719.999999 rounding a requested 720 down to 718.
    let short = width.min(height).max(1) as u64;
    let long = width.max(height).max(1) as u64;
    let (mut numerator, mut denominator) = if short > resolution as u64 {
        (resolution as u64, short)
    } else {
        (1, 1)
    };
    if long * numerator * 9 > resolution as u64 * 16 * denominator {
        numerator = resolution as u64 * 16;
        denominator = long * 9;
    }
    let even = |n: u32| ((n as u64 * numerator / denominator / 2 * 2) as u32).max(2);
    (even(width), even(height))
}

#[tauri::command]
pub async fn native_capture_sources(window: WebviewWindow) -> Result<Vec<Source>, String> {
    authorize(&window)?;
    #[cfg(any(windows, target_os = "macos"))]
    return tokio::task::spawn_blocking(platform::sources)
        .await
        .map_err(|e| e.to_string())?;
    #[cfg(not(any(windows, target_os = "macos")))]
    Err("原生屏幕共享需要 Windows 10 1903 或更高版本".into())
}

#[tauri::command]
pub async fn native_capture_start(
    window: WebviewWindow,
    source_id: String,
    resolution: u32,
    frame_rate: u32,
    remote: bool,
    recording: Option<bool>,
) -> Result<CaptureInfo, String> {
    authorize(&window)?;
    validate_quality(resolution, frame_rate)?;
    #[cfg(any(windows, target_os = "macos"))]
    {
        let source = platform::sources()?
            .into_iter()
            .find(|s| s.id == source_id)
            .ok_or("共享目标已关闭，请刷新列表")?;
        // Existing input injection maps normalized coordinates to the primary display.
        if remote && !(source.kind == "monitor" && source.primary) {
            return Err("远程控制请选择主显示器".into());
        }
        let info = CaptureInfo {
            id: uuid::Uuid::new_v4().to_string(),
            source,
            remote,
        };
        let stop = Arc::new(AtomicBool::new(false));
        let (send, receive) = std::sync::mpsc::sync_channel(1);
        let (ready_tx, ready_rx) = tokio::sync::oneshot::channel();
        {
            let mut all = sessions().lock().unwrap_or_else(|e| e.into_inner());
            if all.values().any(|s| s.info.remote == remote && s.recording == recording.unwrap_or(false)) {
                return Err("已有进行中的屏幕采集，请先停止".into());
            }
            all.insert(
                info.id.clone(),
                Session {
                    recording: recording.unwrap_or(false),
                    info: info.clone(),
                    stop: stop.clone(),
                    frames: send,
                },
            );
        }
        #[cfg(target_os = "macos")]
        update_background_activity();
        let worker_info = info.clone();
        let spawn = std::thread::Builder::new()
            .name("native-screen-capture".into())
            .spawn(move || {
                let result = platform::run(
                    &worker_info.source,
                    resolution,
                    frame_rate,
                    &stop,
                    receive,
                    ready_tx,
                );
                if let Err(error) = result {
                    log::warn!("原生屏幕采集结束: {error}");
                }
                sessions()
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .remove(&worker_info.id);
                #[cfg(target_os = "macos")]
                update_background_activity();
            });
        if let Err(error) = spawn {
            sessions()
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .remove(&info.id);
            #[cfg(target_os = "macos")]
            update_background_activity();
            return Err(error.to_string());
        }
        match tokio::time::timeout(Duration::from_secs(12), ready_rx).await {
            Ok(Ok(Ok(()))) => Ok(info),
            result => {
                stop_id(&info.id);
                Err(match result {
                    Ok(Ok(Err(e))) => e,
                    _ => "原生屏幕采集初始化失败或超时".into(),
                })
            }
        }
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = (source_id, remote, recording);
        Err("当前平台不支持此原生采集后端".into())
    }
}

#[tauri::command]
pub async fn native_capture_frame(
    window: WebviewWindow,
    id: String,
) -> Result<tauri::ipc::Response, String> {
    authorize(&window)?;
    let sender = sessions()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(&id)
        .map(|s| s.frames.clone())
        .ok_or("屏幕采集已停止")?;
    let (tx, rx) = tokio::sync::oneshot::channel();
    sender.try_send(tx).map_err(|_| "采集帧请求繁忙或已停止")?;
    let bytes = tokio::time::timeout(Duration::from_secs(4), rx)
        .await
        .map_err(|_| "屏幕采集帧超时")?
        .map_err(|_| "屏幕采集已停止")??;
    Ok(tauri::ipc::Response::new(bytes))
}
#[tauri::command]
pub fn native_capture_stop(window: WebviewWindow, id: String) -> Result<(), String> {
    authorize(&window)?;
    stop_id(&id);
    Ok(())
}
fn stop_id(id: &str) {
    if let Some(session) = sessions()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(id)
    {
        session.stop.store(true, Ordering::Release);
    }
    #[cfg(target_os = "macos")]
    update_background_activity();
}
pub fn stop_all() {
    for (_, session) in sessions().lock().unwrap_or_else(|e| e.into_inner()).drain() {
        session.stop.store(true, Ordering::Release);
    }
    #[cfg(target_os = "macos")]
    update_background_activity();
}
pub fn remote_capture_active() -> bool {
    sessions()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .values()
        .any(|session| session.info.remote && !session.stop.load(Ordering::Acquire))
}
#[cfg(windows)]
#[path = "native_capture/windows.rs"]
mod platform;

#[cfg(target_os = "macos")]
#[path = "native_capture/macos.rs"]
mod platform;

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn scaling_preserves_aspect_without_upscaling_or_odd_dimensions() {
        assert_eq!(output_size(3840, 2160, 1080), (1920, 1080));
        assert_eq!(output_size(2160, 3840, 1080), (1080, 1920));
        assert_eq!(output_size(1280, 720, 2160), (1280, 720));
        assert_eq!(output_size(5120, 1440, 1080), (1920, 540));
        assert_eq!(output_size(2560, 1600, 720), (1152, 720));
    }
    #[test]
    fn untrusted_quality_cannot_allocate_unbounded_frames() {
        assert!(validate_quality(u32::MAX, 120).is_err());
        assert!(validate_quality(1080, 0).is_err());
        for resolution in [720, 1080, 1440, 2160] {
            for fps in [30, 60, 120] {
                assert!(validate_quality(resolution, fps).is_ok());
            }
        }
    }
}
