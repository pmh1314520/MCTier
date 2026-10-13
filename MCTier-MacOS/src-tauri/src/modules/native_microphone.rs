//! User-initiated microphone capture, with bounded 20 ms voice packets and batched
//! recording PCM. WASAPI on Windows, CoreAudio on macOS; the packet contract below is
//! what the frontend's AudioWorklet pump validates, so both platforms share it.
use serde::Serialize;
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::Duration,
};
#[cfg(any(windows, target_os = "macos"))]
use std::collections::VecDeque;
use tauri::WebviewWindow;

/// 20 ms of 48 kHz mono f32. The frontend rejects anything that is not a multiple of
/// this (`bytes % 3840 == 0`), so it is the unit of transport on every platform.
#[cfg(any(windows, target_os = "macos"))]
pub(crate) const CHUNK: usize = 960 * 4;
/// Bounded queue depth: past this the oldest speech is dropped instead of piling up.
#[cfg(any(windows, target_os = "macos"))]
pub(crate) const CAPACITY: usize = CHUNK * 5;

/// Whole packets only, so a slow IPC round trip drains the backlog instead of halving
/// throughput. Recording gets a deeper batch because its consumer also writes to disk.
#[cfg(any(windows, target_os = "macos"))]
pub(crate) fn read_size(queued: usize, recording: bool) -> usize {
    (queued / CHUNK).min(if recording { 10 } else { 5 }) * CHUNK
}

/// Drop old samples on a stalled consumer rather than accumulating seconds of speech.
#[cfg(any(windows, target_os = "macos"))]
pub(crate) fn push_packet(queue: &mut VecDeque<u8>, bytes: &[u8]) {
    queue.extend(bytes);
    if queue.len() > CAPACITY {
        queue.drain(..queue.len() - CAPACITY);
    }
}

/// Linear resampler for devices that refuse the 48 kHz client format.
#[cfg(any(windows, target_os = "macos"))]
pub(crate) struct MonoResampler {
    samples: Vec<f32>,
    position: f64,
    step: f64,
}
#[cfg(any(windows, target_os = "macos"))]
impl MonoResampler {
    pub(crate) fn new(rate: u32) -> Self {
        Self {
            samples: Vec::new(),
            position: 0.0,
            step: rate as f64 / 48000.0,
        }
    }
    pub(crate) fn convert(&mut self, samples: impl Iterator<Item = f32>) -> Vec<u8> {
        self.samples.extend(samples);
        let mut out = Vec::new();
        while self.position + 1.0 < self.samples.len() as f64 {
            let i = self.position as usize;
            let fraction = (self.position - i as f64) as f32;
            let value = self.samples[i] * (1.0 - fraction) + self.samples[i + 1] * fraction;
            out.extend_from_slice(&value.clamp(-1.0, 1.0).to_le_bytes());
            self.position += self.step;
        }
        let consumed = (self.position as usize).min(self.samples.len());
        self.samples.drain(..consumed);
        self.position -= consumed as f64;
        out
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InputDevice {
    pub device_id: String,
    pub label: String,
    pub kind: &'static str,
    pub is_default: bool,
    pub is_communications: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Capture {
    id: String,
    device_id: String,
    sample_rate: u32,
}
type Reply = tokio::sync::oneshot::Sender<Result<Vec<u8>, String>>;
struct Session {
    stop: Arc<AtomicBool>,
    requests: std::sync::mpsc::SyncSender<Reply>,
}
fn sessions() -> &'static Mutex<HashMap<String, Session>> {
    static SESSIONS: OnceLock<Mutex<HashMap<String, Session>>> = OnceLock::new();
    SESSIONS.get_or_init(Default::default)
}
/// 有活跃会话时申请 macOS 后台活动豁免：窗口隐藏后 App Nap 会节流进程，
/// WebView 的取流泵一旦停摆，语音与录制就会出现断流。会话清零时释放。
#[cfg(target_os = "macos")]
fn update_background_activity() {
    let active = !sessions()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .is_empty();
    crate::modules::macos_platform::set_realtime_activity(active);
}
fn authorize(window: &WebviewWindow) -> Result<(), String> {
    let url = window.url().map_err(|e| e.to_string())?;
    if window.label() != "main" || !crate::modules::media_permission::trusted(url.as_str()) {
        return Err("仅 MCTier 主窗口可操作麦克风".into());
    }
    Ok(())
}
#[tauri::command]
pub fn native_microphone_supported() -> bool {
    cfg!(any(windows, target_os = "macos"))
}
#[tauri::command]
pub fn report_audio_diagnostic(window: WebviewWindow, stage: String, detail: String) -> Result<(), String> {
    authorize(&window)?;
    if !["capture-ready", "capture-error", "playback-error", "playback-ready", "realtime"].contains(&stage.as_str()) {
        return Err("Unknown audio diagnostic".into());
    }
    let detail: String = detail.chars().filter(|c| !c.is_control()).take(512).collect();
    log::info!("[AudioPipeline] {stage}: {detail}");
    Ok(())
}
#[tauri::command]
pub async fn native_microphone_devices(window: WebviewWindow) -> Result<Vec<InputDevice>, String> {
    authorize(&window)?;
    #[cfg(any(windows, target_os = "macos"))]
    return tokio::task::spawn_blocking(platform::devices)
        .await
        .map_err(|e| e.to_string())?;
    #[cfg(not(any(windows, target_os = "macos")))]
    Err("Native microphone requires Windows or macOS".into())
}

/// 不经过 Tauri 命令、不需要窗口句柄的输入设备枚举，供 `voice_service` 复用，
/// 让后端的设备认知与前端选择器看到的是同一份真实列表（而非写死的占位设备）。
/// 平台不支持或枚举失败时返回空列表，由调用方决定如何回退。
pub fn input_devices() -> Vec<InputDevice> {
    #[cfg(any(windows, target_os = "macos"))]
    {
        platform::devices().unwrap_or_else(|error| {
            log::warn!("原生输入设备枚举失败: {error}");
            Vec::new()
        })
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        Vec::new()
    }
}
#[tauri::command]
pub async fn native_microphone_start(
    window: WebviewWindow,
    device_id: String,
    system_processing: bool,
    recording: Option<bool>,
) -> Result<Capture, String> {
    authorize(&window)?;
    start_source(device_id, system_processing, false, recording.unwrap_or(false)).await
}
#[tauri::command]
pub async fn recording_system_audio_start(window: WebviewWindow) -> Result<Capture, String> {
    authorize(&window)?;
    start_source(String::new(), false, true, true).await
}
async fn start_source(device_id: String, system_processing: bool, loopback: bool, recording: bool) -> Result<Capture, String> {
    // macOS：麦克风采集必须先拿到 TCC 授权，否则原生单元只吐静音、还不弹窗。
    // 系统声音(loopback)走屏幕录制授权，不在这里处理。请求弹窗会阻塞，放到
    // 阻塞线程池里，避免占住 async 执行器。
    #[cfg(target_os = "macos")]
    if !loopback {
        let permission = tokio::task::spawn_blocking(mic_permission::ensure_authorized)
            .await
            .map_err(|e| format!("麦克风授权检查失败: {e}"))?;
        permission?;
    }
    #[cfg(any(windows, target_os = "macos"))]
    {
        let id = uuid::Uuid::new_v4().to_string();
        let stop = Arc::new(AtomicBool::new(false));
        let (requests, receive) = std::sync::mpsc::sync_channel(1);
        let (ready, initialized) = tokio::sync::oneshot::channel();
        {
            let mut all = sessions().lock().unwrap_or_else(|e| e.into_inner());
            if all.len() >= 4 {
                return Err("同时使用麦克风的任务过多，请停止试音后重试".into());
            }
            all.insert(
                id.clone(),
                Session {
                    stop: stop.clone(),
                    requests,
                },
            );
        }
        #[cfg(target_os = "macos")]
        update_background_activity();
        let worker_id = id.clone();
        let spawn = std::thread::Builder::new()
            .name("native-microphone".into())
            .spawn(move || {
                let result = if recording { platform::run_recording(device_id, system_processing, loopback, stop, receive, ready) } else { platform::run(device_id, system_processing, stop, receive, ready) };
                if let Err(e) = result {
                    log::warn!("原生麦克风采集结束: {e}");
                }
                sessions()
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .remove(&worker_id);
                #[cfg(target_os = "macos")]
                update_background_activity();
            });
        if let Err(e) = spawn {
            stop_id(&id);
            return Err(e.to_string());
        }
        match tokio::time::timeout(Duration::from_secs(10), initialized).await {
            Ok(Ok(Ok(device_id))) => Ok(Capture {
                id,
                device_id,
                sample_rate: 48000,
            }),
            other => {
                stop_id(&id);
                Err(match other {
                    Ok(Ok(Err(e))) => e,
                    _ => if cfg!(windows) {
                        "麦克风启动超时，请检查设备和 Windows 麦克风隐私设置"
                    } else {
                        "麦克风启动超时，请检查设备和「系统设置 › 隐私与安全性 › 麦克风」授权"
                    }
                    .into(),
                })
            }
        }
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = (device_id, system_processing, loopback, recording);
        Err("Native microphone requires Windows or macOS".into())
    }
}
#[tauri::command]
pub async fn native_microphone_read(
    window: WebviewWindow,
    id: String,
) -> Result<tauri::ipc::Response, String> {
    authorize(&window)?;
    let requests = sessions()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(&id)
        .map(|s| s.requests.clone())
        .ok_or("麦克风采集已停止")?;
    let (tx, rx) = tokio::sync::oneshot::channel();
    requests
        .try_send(tx)
        .map_err(|_| "麦克风读取繁忙或已停止")?;
    let bytes = tokio::time::timeout(Duration::from_secs(3), rx)
        .await
        .map_err(|_| "麦克风无响应，请检查设备")?
        .map_err(|_| "麦克风设备已断开或采集已停止")??;
    Ok(tauri::ipc::Response::new(bytes))
}
#[tauri::command]
pub fn native_microphone_stop(window: WebviewWindow, id: String) -> Result<(), String> {
    authorize(&window)?;
    stop_id(&id);
    Ok(())
}
fn stop_id(id: &str) {
    if let Some(s) = sessions()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(id)
    {
        s.stop.store(true, Ordering::Release);
    }
    #[cfg(target_os = "macos")]
    update_background_activity();
}
pub fn stop_all() {
    for (_, s) in sessions().lock().unwrap_or_else(|e| e.into_inner()).drain() {
        s.stop.store(true, Ordering::Release);
    }
    #[cfg(target_os = "macos")]
    update_background_activity();
}

#[cfg(windows)]
#[path = "native_microphone/windows.rs"]
mod platform;

#[cfg(target_os = "macos")]
#[path = "native_microphone/macos.rs"]
mod platform;

/// 麦克风 TCC 授权（AVCaptureDevice）。原生输入单元不会自己弹授权框，必须先在这里
/// 查询/请求权限，否则采集“成功”却只有静音。
#[cfg(target_os = "macos")]
#[path = "native_microphone/mic_permission.rs"]
pub mod mic_permission;

/// 系统声音采集（ScreenCaptureKit，macOS 13+）：对应 Windows 的 WASAPI loopback，
/// 由 macOS 的 platform::run_recording 在 loopback 时调用。
#[cfg(target_os = "macos")]
#[path = "native_microphone/macos_system_audio.rs"]
mod system_audio;
