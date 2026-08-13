//! Windows system playback capture used as the far-end reference for Sonora AEC3.
//!
//! The loopback stream is the final shared-mode mix from the default render
//! endpoint, so it includes MCTier, games, browsers, and other applications
//! routed to the same Windows playback device. Audio is sent to the WebView in
//! short base64-encoded float PCM chunks; no audio is written to disk or sent
//! over the network.

use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread::{self, JoinHandle};

#[derive(Debug, Serialize, Clone)]
pub struct SystemAudioReference {
    pub data: String,
    pub sample_rate: u32,
    pub channels: u16,
    /// Timestamp at the end of the PCM chunk, derived from WASAPI's hardware
    /// QPC timestamp rather than the time at which the event reached WebView.
    pub captured_at_unix_ms: i64,
}

struct LoopbackHandle {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

fn active_handle() -> &'static Mutex<Option<LoopbackHandle>> {
    static HANDLE: OnceLock<Mutex<Option<LoopbackHandle>>> = OnceLock::new();
    HANDLE.get_or_init(|| Mutex::new(None))
}

#[cfg(windows)]
mod platform {
    use super::SystemAudioReference;
    use base64::engine::general_purpose::STANDARD;
    use base64::Engine;
    use std::collections::VecDeque;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;
    use tauri::{AppHandle, Emitter};
    use wasapi::{
        initialize_mta, AudioClient, DeviceEnumerator, Direction, SampleType, StreamMode,
        WaveFormat,
    };

    const EVENT: &str = "system-audio-reference";
    const ERROR_EVENT: &str = "system-audio-reference-error";
    const SAMPLE_RATE: usize = 48_000;
    const CHANNELS: usize = 2;
    // 768 samples at 48 kHz equals LocalVQE's 256-sample/16 kHz hop (16 ms).
    const CHUNK_FRAMES: usize = 768;

    fn qpc_100ns_now() -> Result<i64, Box<dyn std::error::Error + Send + Sync>> {
        use windows::Win32::System::Performance::{QueryPerformanceCounter, QueryPerformanceFrequency};
        let mut counter = 0_i64;
        let mut frequency = 0_i64;
        unsafe {
            QueryPerformanceCounter(&mut counter)?;
            QueryPerformanceFrequency(&mut frequency)?;
        }
        if frequency <= 0 {
            return Err("invalid QueryPerformanceFrequency".into());
        }
        Ok(counter.saturating_mul(10_000_000) / frequency)
    }

    pub fn capture_loop(app: AppHandle, stop: Arc<AtomicBool>, requested_device_id: Option<String>, requested_device_name: Option<String>) {
        while !stop.load(Ordering::Acquire) {
            if let Err(error) = capture_loop_inner(&app, &stop, requested_device_id.as_deref(), requested_device_name.as_deref()) {
                log::warn!("WASAPI render loopback restarting: {}", error);
                let _ = app.emit(ERROR_EVENT, error.to_string());
            }
            if !stop.load(Ordering::Acquire) {
                std::thread::sleep(std::time::Duration::from_millis(500));
            }
        }
    }

    fn capture_loop_inner(
        app: &AppHandle,
        stop: &AtomicBool,
        requested_device_id: Option<&str>,
        requested_device_name: Option<&str>,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        initialize_mta()
            .ok()
            .map_err(|error| format!("COM initialization failed: {error:?}"))?;

        let result = (|| {
            let enumerator = DeviceEnumerator::new()?;
            // A render endpoint + Capture stream is WASAPI's shared loopback mode.
            // Chromium audiooutput IDs are WASAPI endpoint IDs on Windows. Use the
            // selected endpoint whenever possible so the AEC reference matches the
            // device receiving MCTier's remote audio.
            let device = requested_device_id
                .filter(|id| !id.is_empty() && *id != "default" && *id != "communications")
                .and_then(|id| match enumerator.get_device(id) {
                    Ok(device) => Some(device),
                    Err(error) => {
                        log::warn!("Unable to open selected WASAPI output {id}: {error:?}; using default output");
                        None
                    }
                })
                .or_else(|| requested_device_name.filter(|name| !name.is_empty()).and_then(|name| match enumerator.get_device_collection(&Direction::Render).and_then(|devices| devices.get_device_with_name(name)) {
                    Ok(device) => Some(device),
                    Err(error) => {
                        log::warn!("Unable to match WASAPI output name {name}: {error:?}; using default output");
                        None
                    }
                }))
                .unwrap_or(enumerator.get_default_device(&Direction::Render)?);
            log::info!(
                "WASAPI loopback reference output: {} ({})",
                device.get_friendlyname().unwrap_or_else(|_| "Unknown output".to_string()),
                device.get_id().unwrap_or_else(|_| "unknown-id".to_string()),
            );
            let mut audio_client: AudioClient = device.get_iaudioclient()?;
            let format = WaveFormat::new(32, 32, &SampleType::Float, SAMPLE_RATE, CHANNELS, None);
            let (_, min_time) = audio_client.get_device_period()?;
            let mode = StreamMode::EventsShared {
                autoconvert: true,
                buffer_duration_hns: min_time,
            };
            audio_client.initialize_client(&format, &Direction::Capture, &mode)?;
            let event = audio_client.set_get_eventhandle()?;
            let buffer_frames = audio_client.get_buffer_size()? as usize;
            let capture = audio_client.get_audiocaptureclient()?;
            let block_align = CHANNELS * std::mem::size_of::<f32>();
            let mut bytes = vec![0_u8; buffer_frames.max(CHUNK_FRAMES) * block_align];
            let mut queue: VecDeque<u8> = VecDeque::with_capacity(bytes.len() * 2);
            let anchor_qpc_100ns = qpc_100ns_now()?;
            let anchor_unix_100ns = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|duration| duration.as_nanos() as i64 / 100)
                .unwrap_or_default();
            let mut queue_start_qpc_100ns: Option<i64> = None;

            audio_client.start_stream()?;
            while !stop.load(Ordering::Acquire) {
                let (frames, info) = capture.read_from_device(&mut bytes)?;
                if frames > 0 {
                    if info.flags.data_discontinuity {
                        queue.clear();
                        queue_start_qpc_100ns = None;
                    }
                    let byte_count = frames as usize * block_align;
                    if info.flags.silent {
                        bytes[..byte_count].fill(0);
                    }
                    if queue.is_empty() && !info.flags.timestamp_error && info.timestamp > 0 {
                        queue_start_qpc_100ns = Some(info.timestamp as i64);
                    }
                    queue.extend(&bytes[..byte_count]);
                }

                while queue.len() >= CHUNK_FRAMES * block_align {
                    let mut chunk = vec![0_u8; CHUNK_FRAMES * block_align];
                    for byte in &mut chunk {
                        *byte = queue.pop_front().unwrap_or_default();
                    }
                    let chunk_duration_100ns = (CHUNK_FRAMES as i64 * 10_000_000) / SAMPLE_RATE as i64;
                    let end_qpc_100ns = queue_start_qpc_100ns
                        .map(|start| start + chunk_duration_100ns)
                        .unwrap_or_else(|| qpc_100ns_now().unwrap_or(anchor_qpc_100ns));
                    let payload = SystemAudioReference {
                        data: STANDARD.encode(chunk),
                        sample_rate: SAMPLE_RATE as u32,
                        channels: CHANNELS as u16,
                        captured_at_unix_ms: (anchor_unix_100ns + end_qpc_100ns - anchor_qpc_100ns) / 10_000,
                    };
                    queue_start_qpc_100ns = Some(end_qpc_100ns);
                    if app.emit(EVENT, payload).is_err() {
                        return Err("WebView event channel closed".into());
                    }
                }

                if event.wait_for_event(1000).is_err() {
                    if !stop.load(Ordering::Acquire) {
                        return Err("WASAPI loopback event timed out".into());
                    }
                }
            }
            let _ = audio_client.stop_stream();
            Ok::<(), Box<dyn std::error::Error + Send + Sync>>(())
        })();

        wasapi::deinitialize();
        result
    }
}

#[cfg(not(windows))]
mod platform {
    use super::*;
    use tauri::AppHandle;

    pub fn capture_loop(_app: AppHandle, _stop: Arc<AtomicBool>, _requested_device_id: Option<String>, _requested_device_name: Option<String>) {
        log::debug!("System loopback is only available on Windows");
    }
}

#[tauri::command]
pub fn start_system_audio_loopback(
    app: tauri::AppHandle,
    device_id: Option<String>,
    device_name: Option<String>,
) -> Result<(), String> {
    let mut active = active_handle()
        .lock()
        .map_err(|_| "system audio loopback lock poisoned".to_string())?;
    if active.is_some() {
        return Ok(());
    }

    let stop = Arc::new(AtomicBool::new(false));
    let thread_stop = Arc::clone(&stop);
    let thread = thread::Builder::new()
        .name("MCTier WASAPI loopback".to_string())
        .spawn(move || platform::capture_loop(app, thread_stop, device_id, device_name))
        .map_err(|error| format!("failed to start WASAPI loopback: {error}"))?;
    *active = Some(LoopbackHandle {
        stop,
        thread: Some(thread),
    });
    Ok(())
}

#[tauri::command]
pub fn stop_system_audio_loopback() -> Result<(), String> {
    let handle = active_handle()
        .lock()
        .map_err(|_| "system audio loopback lock poisoned".to_string())?
        .take();
    if let Some(mut handle) = handle {
        handle.stop.store(true, Ordering::Release);
        if let Some(thread) = handle.thread.take() {
            let _ = thread.join();
        }
    }
    Ok(())
}
