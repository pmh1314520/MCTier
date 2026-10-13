use super::{push_packet, read_size, InputDevice, MonoResampler, Reply, CAPACITY, CHUNK};
use std::{
    collections::VecDeque,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{Receiver, TryRecvError},
        Arc,
    },
    time::{Duration, Instant},
};
use windows::{
    core::{Interface, PCWSTR},
    Win32::{Media::Audio::*, System::Com::*},
};

struct Apartment;
impl Apartment {
    fn new() -> Result<Self, String> {
        unsafe {
            CoInitializeEx(None, COINIT_MULTITHREADED)
                .ok()
                .map_err(|e| e.to_string())?;
        }
        Ok(Self)
    }
}
impl Drop for Apartment {
    fn drop(&mut self) {
        unsafe {
            CoUninitialize();
        }
    }
}
pub fn devices() -> Result<Vec<InputDevice>, String> {
    let _apartment = Apartment::new()?;
    let enumerator = wasapi::DeviceEnumerator::new().map_err(|e| e.to_string())?;
    let default_id = enumerator.get_default_device_for_role(&wasapi::Direction::Capture, &wasapi::Role::Console).and_then(|device| device.get_id()).ok();
    let communications_id = enumerator.get_default_device_for_role(&wasapi::Direction::Capture, &wasapi::Role::Communications).and_then(|device| device.get_id()).ok();
    let collection = enumerator
        .get_device_collection(&wasapi::Direction::Capture)
        .map_err(|e| e.to_string())?;
    let mut devices = Vec::new();
    for index in 0..collection.get_nbr_devices().map_err(|e| e.to_string())? {
        let Ok(device) = collection.get_device_at_index(index) else {
            continue;
        };
        if let (Ok(id), Ok(label)) = (device.get_id(), device.get_friendlyname()) {
            devices.push(InputDevice {
                device_id: format!("wasapi:{id}"),
                label,
                kind: "audioinput",
                is_default: default_id.as_ref() == Some(&id),
                is_communications: communications_id.as_ref() == Some(&id),
            });
        }
    }
    Ok(devices)
}
struct Running(IAudioClient);
impl Drop for Running {
    fn drop(&mut self) {
        unsafe {
            let _ = self.0.Stop();
        }
    }
}

pub fn run(
    device_id: String,
    system_processing: bool,
    stop: Arc<AtomicBool>,
    requests: Receiver<Reply>,
    ready: tokio::sync::oneshot::Sender<Result<String, String>>,
) -> Result<(), String> {
    run_source(device_id, system_processing, false, false, stop, requests, ready)
}
pub fn run_recording(
    device_id: String, system_processing: bool, loopback: bool,
    stop: Arc<AtomicBool>, requests: Receiver<Reply>,
    ready: tokio::sync::oneshot::Sender<Result<String, String>>,
) -> Result<(), String> {
    run_source(device_id, system_processing, loopback, true, stop, requests, ready)
}
fn run_source(
    device_id: String, system_processing: bool, loopback: bool, recording: bool,
    stop: Arc<AtomicBool>, requests: Receiver<Reply>,
    ready: tokio::sync::oneshot::Sender<Result<String, String>>,
) -> Result<(), String> {
    let mut ready = Some(ready);
    let result = (|| -> Result<(), String> {
        let _apartment = Apartment::new()?;
        unsafe {
            let enumerator: IMMDeviceEnumerator =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                    .map_err(|e| e.to_string())?;
            // Legacy browser IDs are not WASAPI endpoint IDs: migrate them to system default.
            let device = if loopback {
                enumerator.GetDefaultAudioEndpoint(eRender, eConsole)
            } else if let Some(id) = device_id.strip_prefix("wasapi:") {
                let wide: Vec<u16> = id.encode_utf16().chain(Some(0)).collect();
                enumerator.GetDevice(PCWSTR(wide.as_ptr()))
            } else {
                // Match Chromium's "default" input and the UI's system-default label.
                // The communications endpoint can be a disconnected virtual mixer bus.
                enumerator.GetDefaultAudioEndpoint(eCapture, if device_id == "communications" { eCommunications } else { eConsole })
            }
            .map_err(|e| format!("MIC_NOT_FOUND:无法打开麦克风，请检查设备是否已连接: {e}"))?;
            // Prevent an untrusted endpoint ID from selecting loopback/output audio.
            let endpoint: IMMEndpoint = device.cast().map_err(|e| e.to_string())?;
            if endpoint.GetDataFlow().map_err(|e| e.to_string())? != if loopback { eRender } else { eCapture } {
                return Err("所选设备不是麦克风".into());
            }
            let native_id = device.GetId().map_err(|e| e.to_string())?;
            let actual_id = native_id.to_string().map_err(|e| e.to_string());
            CoTaskMemFree(Some(native_id.0.cast()));
            let actual_id = format!("wasapi:{}", actual_id?);
            let client: IAudioClient = device
                .Activate(CLSCTX_ALL, None)
                .map_err(|e| e.to_string())?;
            // Audio categories are for capture/render streams, not loopback. Some drivers
            // accept SetClientProperties then fail Initialize(E_INVALIDARG) for loopback.
            if !loopback { if let Ok(client2) = client.cast::<IAudioClient2>() {
                let properties = AudioClientProperties {
                    cbSize: std::mem::size_of::<AudioClientProperties>() as u32,
                    eCategory: if system_processing {
                        AudioCategory_Communications
                    } else {
                        AudioCategory_Media
                    },
                    ..Default::default()
                };
                if let Err(e) = client2.SetClientProperties(&properties) {
                    log::warn!("设备不支持通信音效: {e}");
                }
            } }
            let format = WAVEFORMATEX {
                wFormatTag: 3,
                nChannels: 1,
                nSamplesPerSec: 48000,
                nAvgBytesPerSec: 192000,
                nBlockAlign: 4,
                wBitsPerSample: 32,
                cbSize: 0,
            };
            // Render loopback must use the device mix format. Some drivers reject
            // AUTOCONVERTPCM or a mono format for loopback with E_INVALIDARG.
            let mix = if loopback { Some(client.GetMixFormat().map_err(|e| e.to_string())?) } else { None };
            let chosen = mix.unwrap_or(&format as *const WAVEFORMATEX as *mut WAVEFORMATEX);
            let channels = (*chosen).nChannels as usize;
            let block = (*chosen).nBlockAlign as usize;
            let bits = (*chosen).wBitsPerSample as usize;
            let sample_rate = (*chosen).nSamplesPerSec;
            let tag = if (*chosen).wFormatTag == 0xfffe && (*chosen).cbSize >= 22 {
                std::ptr::read_unaligned((chosen as *const u8).add(24).cast::<u32>()) as u16
            } else { (*chosen).wFormatTag };
            let supported = (8000..=192000).contains(&sample_rate) && channels > 0 && channels <= 16 && block == channels * (bits / 8)
                && (tag == 3 && bits == 32 || tag == 1 && [16, 24, 32].contains(&bits));
            if !supported { if let Some(ptr) = mix { CoTaskMemFree(Some(ptr.cast())); } return Err("系统声音格式不受支持".into()); }
            let initialized = client
                .Initialize(
                    AUDCLNT_SHAREMODE_SHARED,
                    if loopback { AUDCLNT_STREAMFLAGS_LOOPBACK } else { AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY },
                    200_000,
                    0,
                    chosen,
                    None,
                );
            if let Some(ptr) = mix { CoTaskMemFree(Some(ptr.cast())); }
            initialized.map_err(|e| if loopback { format!("系统声音录制启动失败，请检查默认播放设备: {e}") } else { format!("麦克风启动失败，请检查 Windows 麦克风隐私设置及设备占用: {e}") })?;
            let mut resampler = MonoResampler::new(sample_rate);
            let capture: IAudioCaptureClient = client.GetService().map_err(|e| e.to_string())?;
            client.Start().map_err(|e| e.to_string())?;
            let _running = Running(client);
            if ready.take().unwrap().send(Ok(actual_id)).is_err() {
                return Ok(());
            }
            let mut queue = VecDeque::with_capacity(CAPACITY);
            let mut pending: Option<Reply> = None;
            let mut last_request = Instant::now();
            let mut last_packet = Instant::now();
            let mut last_capture = Instant::now();
            while !stop.load(Ordering::Acquire) && last_request.elapsed() < Duration::from_secs(5) {
                if pending.is_none() {
                    match requests.try_recv() {
                        Ok(reply) => {
                            pending = Some(reply);
                            last_request = Instant::now();
                        }
                        Err(TryRecvError::Disconnected) => break,
                        Err(TryRecvError::Empty) => {}
                    }
                }
                // Drain only a bounded number per pass so Stop cannot starve.
                for _ in 0..16 {
                    if capture.GetNextPacketSize().map_err(|e| e.to_string())? == 0 {
                        break;
                    }
                    let (mut ptr, mut frames, mut flags) = (std::ptr::null_mut(), 0u32, 0u32);
                    capture
                        .GetBuffer(&mut ptr, &mut frames, &mut flags, None, None)
                        .map_err(|e| e.to_string())?;
                    let size = frames as usize * block;
                    // WASAPI may return a null pointer for silent packets. Never dereference it.
                    if flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32 != 0 {
                        let converted = resampler.convert(std::iter::repeat_n(0.0, (frames as usize).min(192000)));
                        if recording { queue.extend(converted); } else { push_packet(&mut queue, &converted); }
                    } else if !ptr.is_null() && size <= 4 * 1024 * 1024 {
                        let bytes = std::slice::from_raw_parts(ptr, size);
                        let converted = resampler.convert(bytes.chunks_exact(block).map(|frame| {
                            frame.chunks_exact(bits / 8).map(|s| match (tag, bits) {
                                (3, 32) => f32::from_le_bytes(s.try_into().unwrap()),
                                (1, 16) => i16::from_le_bytes(s.try_into().unwrap()) as f32 / 32768.0,
                                (1, 24) => (i32::from_le_bytes([0, s[0], s[1], s[2]]) >> 8) as f32 / 8388608.0,
                                (1, 32) => i32::from_le_bytes(s.try_into().unwrap()) as f32 / 2147483648.0,
                                _ => 0.0,
                            }).sum::<f32>() / channels as f32
                        }));
                        if recording { queue.extend(converted); } else { push_packet(&mut queue, &converted); }
                    } else {
                        let _ = capture.ReleaseBuffer(frames);
                        return Err("麦克风返回了无效音频数据".into());
                    }
                    capture.ReleaseBuffer(frames).map_err(|e| e.to_string())?;
                    last_capture = Instant::now();
                    if queue.len() > CHUNK * 100 { return Err("录屏音频处理积压超过两秒，请降低录屏画质".into()); }
                }
                if pending.is_some() && queue.len() >= CHUNK {
                    // A renderer IPC round trip can exceed 20 ms during screen capture.
                    // Batch all completed packets so transport throughput still keeps up
                    // with the device clock instead of losing half of every second.
                    let count = read_size(queue.len(), recording);
                    let bytes = queue.drain(..count).collect();
                    let _ = pending.take().unwrap().send(Ok(bytes));
                    last_packet = Instant::now();
                }
                // A silent output endpoint may emit no WASAPI packets at all.
                if loopback && pending.is_some() && last_capture.elapsed() >= Duration::from_millis(60) && last_packet.elapsed() >= Duration::from_millis(20) {
                    let mut bytes: Vec<u8> = queue.drain(..).collect();
                    bytes.resize(CHUNK, 0);
                    let _ = pending.take().unwrap().send(Ok(bytes));
                    last_packet = Instant::now();
                }
                std::thread::sleep(Duration::from_millis(3));
            }
            Ok(())
        }
    })();
    if let Some(ready) = ready {
        let _ = ready.send(Err(result
            .as_ref()
            .err()
            .cloned()
            .unwrap_or_else(|| "麦克风启动失败".into())));
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn voice_reads_catch_up_after_screen_ipc_delay_without_unbounded_latency() {
        let mut queue = VecDeque::new();
        // A 40 ms IPC round trip must drain 40 ms, not only 20 ms on each read.
        let samples: Vec<u8> = (0..CHUNK * 2).map(|i| (i % 251) as u8).collect();
        for _ in 0..100 {
            push_packet(&mut queue, &samples);
            let count = read_size(queue.len(), false);
            assert_eq!(queue.drain(..count).collect::<Vec<_>>(), samples);
            assert!(queue.is_empty());
        }
        push_packet(&mut queue, &vec![0; CHUNK * 20]);
        assert_eq!(queue.len(), CAPACITY);
        assert_eq!(read_size(queue.len(), false), CHUNK * 5);
        assert_eq!(read_size(CHUNK - 4, false), 0);
        assert_eq!(read_size(CHUNK * 12, true), CHUNK * 10);
    }
    #[test]
    fn loopback_resampling_is_continuous_and_bounded() {
        for rate in [44100, 48000, 96000] {
            let mut resampler = MonoResampler::new(rate);
            let mut result = Vec::new();
            for _ in 0..100 { result.extend(resampler.convert(std::iter::repeat_n(0.5, rate as usize / 100))); }
            assert!((result.len() as i64 / 4 - 48000).abs() <= 2);
            assert!(result.chunks_exact(4).all(|b| (f32::from_le_bytes(b.try_into().unwrap()) - 0.5).abs() < 0.0001));
            assert!(resampler.samples.len() <= 2);
        }
    }
    #[test]
    fn slow_consumer_keeps_only_latest_aligned_audio() {
        let mut queue = VecDeque::new();
        push_packet(&mut queue, &vec![1; CHUNK * 4]);
        push_packet(&mut queue, &vec![2; CHUNK * 3]);
        assert_eq!(queue.len(), CAPACITY);
        assert!(queue.iter().take(CHUNK * 2).all(|b| *b == 1));
        assert!(queue.iter().skip(CHUNK * 2).all(|b| *b == 2));
    }
    #[test]
    #[ignore = "Opens the default microphone briefly; requires interactive Windows audio hardware"]
    fn default_device_captures_pcm_and_releases_on_repeated_stop() {
        let inputs = devices().expect("enumerate capture endpoints");
        assert!(!inputs.is_empty(), "No active microphones");
        let expected = inputs.iter().find(|device| device.is_default).expect("system default microphone").device_id.clone();
        println!("Available native inputs: {}", serde_json::to_string(&inputs).unwrap());
        { let _com = Apartment::new().unwrap();
          let devices = wasapi::DeviceEnumerator::new().unwrap();
          for direction in [wasapi::Direction::Capture, wasapi::Direction::Render] {
            for role in [wasapi::Role::Console, wasapi::Role::Multimedia, wasapi::Role::Communications] {
              if let Ok(device) = devices.get_default_device_for_role(&direction, &role) { println!("Default {direction:?}/{role:?}: {}", device.get_friendlyname().unwrap_or_default()); }
            }
          }
        }
        for _ in 0..2 {
            let stop = Arc::new(AtomicBool::new(false));
            let worker_stop = stop.clone();
            let (tx, rx) = std::sync::mpsc::sync_channel(1);
            let (ready_tx, ready_rx) = tokio::sync::oneshot::channel();
            let worker =
                std::thread::spawn(move || run(String::new(), true, worker_stop, rx, ready_tx));
            let started = ready_rx.blocking_recv().expect("worker start response");
            if let Err(ref error) = started {
                stop.store(true, Ordering::Release);
                let _ = worker.join();
                panic!("{error}");
            }
            let actual = started.unwrap();
            println!("Default native input: {actual}");
            let mut peak = 0f32;
            for _ in 0..50 {
                let (reply, response) = tokio::sync::oneshot::channel();
                tx.send(reply).unwrap();
                let packet = response.blocking_recv().unwrap().unwrap();
                assert!(packet.len() >= CHUNK && packet.len() <= CAPACITY && packet.len() % CHUNK == 0);
                assert!(packet
                    .chunks_exact(4)
                    .all(|b| f32::from_le_bytes(b.try_into().unwrap()).is_finite()));
                for sample in packet.chunks_exact(4) { peak = peak.max(f32::from_le_bytes(sample.try_into().unwrap()).abs()); }
            }
            println!("Native sample peak over 1 second: {peak}");
            stop.store(true, Ordering::Release);
            drop(tx);
            worker.join().expect("worker join").expect("capture stop");
            assert_eq!(actual, expected, "Default capture must use the console endpoint, not the communications endpoint");
        }
    }
}
