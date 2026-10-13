//! ScreenCaptureKit system-audio capture (macOS 13+): the native counterpart of
//! Windows' WASAPI loopback for recording what the machine *plays*. SCK is
//! configured for 48 kHz mono float32, so the recording pipeline's 20 ms packet
//! contract (3840 bytes) is shared with the microphone paths unchanged.
//!
//! Audio sample buffers arrive on SCK's dispatch queue and are pushed into a
//! bounded ring; the worker thread below drains it with the same packet batching
//! the WASAPI loopback uses, including the two-second backlog stop.
use super::{read_size, Reply, CAPACITY, CHUNK};
use objc2::rc::Retained;
use objc2::runtime::{NSObject, NSObjectProtocol, ProtocolObject};
use objc2::{define_class, extern_methods, AnyThread};
use objc2_core_audio_types::{AudioBuffer, AudioBufferList};
use objc2_core_media::{CMBlockBuffer, CMSampleBuffer};
use objc2_foundation::{NSError, NSProcessInfo};
use objc2_screen_capture_kit::{
    SCContentFilter, SCShareableContent, SCStream, SCStreamConfiguration, SCStreamOutput,
    SCStreamOutputType,
};
use std::{
    collections::VecDeque,
    ffi::c_void,
    ptr,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{Receiver, TryRecvError},
        Arc, Mutex, OnceLock,
    },
    time::{Duration, Instant},
};

/// Capture ring: SCK's queue pushes, the worker drains. Two seconds of slack;
/// past that the callback drops the oldest audio instead of piling up.
const RING_CAPACITY: usize = 48000 * 2;
/// The device id returned to the frontend; display-only, like `coreaudio:<uid>`.
const DEVICE_ID: &str = "screenaudio:system-audio";

fn permission_hint(error: &str) -> String {
    format!(
        "录制系统声音需要「系统设置 › 隐私与安全性 › 屏幕录制」授权 MCTier（授权后重启应用生效）: {error}"
    )
}

fn system_supports_audio_capture() -> bool {
    let version = NSProcessInfo::processInfo().operatingSystemVersion();
    version.majorVersion > 13
        || (version.majorVersion == 13 && (version.minorVersion > 0 || version.patchVersion >= 0))
}

// The delegate is a bare function pointer target: its state hangs off these
// globals instead of ivars. Only one loopback capture runs at a time (the
// single-flight guard below), so "current ring" is unambiguous.
type SharedRing = Arc<Mutex<VecDeque<f32>>>;
fn ring_slot() -> &'static Mutex<Option<SharedRing>> {
    static RING: OnceLock<Mutex<Option<SharedRing>>> = OnceLock::new();
    RING.get_or_init(|| Mutex::new(None))
}

fn failure_slot() -> &'static Mutex<Option<String>> {
    static FAILURE: OnceLock<Mutex<Option<String>>> = OnceLock::new();
    FAILURE.get_or_init(|| Mutex::new(None))
}

define_class!(
    #[unsafe(super(NSObject))]
    struct SystemAudioOutput;

    unsafe impl NSObjectProtocol for SystemAudioOutput {}

    unsafe impl SCStreamOutput for SystemAudioOutput {
        #[allow(non_snake_case)]
        #[unsafe(method(stream:didOutputSampleBuffer:ofType:))]
        unsafe fn stream_didOutputSampleBuffer_ofType(
            &self,
            _stream: &SCStream,
            sample_buffer: &CMSampleBuffer,
            r#type: SCStreamOutputType,
        ) {
            if r#type != SCStreamOutputType::Audio {
                return;
            }
            // 双次调用模式：第一次拿所需大小，第二次真正取 AudioBufferList。
            let mut needed: usize = 0;
            let status = sample_buffer.audio_buffer_list_with_retained_block_buffer(
                &mut needed,
                ptr::null_mut(),
                0,
                None,
                None,
                0,
                ptr::null_mut(),
            );
            if status != 0 || needed < std::mem::size_of::<AudioBufferList>() {
                return;
            }
            let mut list = AudioBufferList {
                mNumberBuffers: 1,
                mBuffers: [AudioBuffer {
                    mNumberChannels: 1,
                    mDataByteSize: 0,
                    mData: ptr::null_mut(),
                }],
            };
            let mut block: *mut CMBlockBuffer = ptr::null_mut();
            let status = sample_buffer.audio_buffer_list_with_retained_block_buffer(
                &mut needed,
                &mut list,
                std::mem::size_of::<AudioBufferList>(),
                None,
                None,
                0,
                &mut block,
            );
            if status != 0 {
                return;
            }
            // 回调挂在 SCK 的派发队列上（非实时音频线程），锁竞争时直接丢帧。
            if let Ok(slot) = ring_slot().try_lock() {
                if let Some(ring) = slot.as_ref() {
                    if let Ok(mut ring) = ring.try_lock() {
                        for index in 0..list.mNumberBuffers as usize {
                            let buffer = &list.mBuffers[index];
                            let samples = buffer.mDataByteSize as usize / 4;
                            if buffer.mData.is_null() || samples == 0 {
                                continue;
                            }
                            let data = buffer.mData.cast::<f32>();
                            let slice = std::slice::from_raw_parts(data, samples);
                            ring.extend(slice.iter().copied());
                        }
                        if ring.len() > RING_CAPACITY {
                            let overflow = ring.len() - RING_CAPACITY;
                            ring.drain(..overflow);
                        }
                    }
                }
            }
            // audio_buffer_list_with_retained_block_buffer 返回 +1 的 block buffer，
            // 数据已拷入 ring，必须释放，否则每个样本缓冲都泄漏一次。
            if !block.is_null() {
                extern "C" {
                    fn CFRelease(value: *const c_void);
                }
                unsafe { CFRelease(block.cast()) };
            }
        }
    }
);

/// 单飞：同一段系统声音只有一条采集流，与 Windows loopback 的语义一致。
static ACTIVE: AtomicBool = AtomicBool::new(false);

pub fn run(
    stop: Arc<AtomicBool>,
    requests: Receiver<Reply>,
    ready: tokio::sync::oneshot::Sender<Result<String, String>>,
) -> Result<(), String> {
    if ACTIVE
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err("已有进行中的系统声音采集，请先停止录制".into());
    }
    let result = run_inner(&stop, &requests, ready);
    ACTIVE.store(false, Ordering::Release);
    result
}

fn run_inner(
    stop: &AtomicBool,
    requests: &Receiver<Reply>,
    ready: tokio::sync::oneshot::Sender<Result<String, String>>,
) -> Result<(), String> {
    // ScreenCaptureKit 音频采集是 macOS 13.0+ 的 API；更旧的系统保持
    // BlackHole 虚拟设备方案。
    if !system_supports_audio_capture() {
        let message = "macOS 13 以下没有系统级系统声音采集接口；请安装虚拟音频设备（如 BlackHole）并把它设为默认输入后在「麦克风」开关中录制".to_string();
        let _ = ready.send(Err(message.clone()));
        return Err(message);
    }

    let init = init_stream();
    let (stream, _output) = match init {
        Ok(value) => value,
        Err(error) => {
            let message = permission_hint(&error);
            let _ = ready.send(Err(message.clone()));
            return Err(message);
        }
    };

    if ready.send(Ok(DEVICE_ID.to_string())).is_err() {
        return Ok(());
    }

    let mut queue = VecDeque::with_capacity(CAPACITY);
    let mut pending: Option<Reply> = None;
    let mut last_request = Instant::now();
    let mut failure = String::new();
    while !stop.load(Ordering::Acquire) && last_request.elapsed() < Duration::from_secs(5) {
        if let Some(message) = failure_slot().lock().unwrap_or_else(|e| e.into_inner()).take() {
            failure = message;
            break;
        }
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
        let captured: Vec<f32> = ring_slot()
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
            .map(|ring| {
                ring.lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .drain(..)
                    .collect()
            })
            .unwrap_or_default();
        if !captured.is_empty() {
            let bytes: Vec<u8> = captured
                .into_iter()
                .flat_map(|sample| sample.clamp(-1.0, 1.0).to_le_bytes())
                .collect();
            queue.extend(bytes);
            if queue.len() > CHUNK * 100 {
                failure = "系统声音处理积压超过两秒，已停止录制".into();
                break;
            }
        }
        if pending.is_some() && queue.len() >= CHUNK {
            // 批量整包交付：慢消费不能把 20 ms 的传输节拍砍半。
            let count = read_size(queue.len(), true);
            let bytes = queue.drain(..count).collect();
            let _ = pending.take().unwrap().send(Ok(bytes));
        }
        std::thread::sleep(Duration::from_millis(3));
    }

    unsafe {
        stream.stopCaptureWithCompletionHandler(None);
    };
    let _ = unsafe {
        stream.removeStreamOutput_type_error(
            ProtocolObject::from_ref(&*_output),
            SCStreamOutputType::Audio,
        )
    };
    *ring_slot().lock().unwrap_or_else(|e| e.into_inner()) = None;

    if failure.is_empty() {
        Ok(())
    } else {
        Err(failure)
    }
}

impl SystemAudioOutput {
    extern_methods!(
        #[unsafe(method(new))]
        fn new() -> Retained<Self>;
    );
}

type StreamHandles = (Retained<SCStream>, Retained<SystemAudioOutput>);

/// 构建 SCStream 并启动采集：显示器过滤 + 仅音频配置。任何一步失败都返回
/// 可读错误（叠加屏幕录制授权提示）。
fn init_stream() -> Result<StreamHandles, String> {
    // 枚举可捕获内容：SCK 的 API 全部走完成回调，用信号量同步等待。
    let content = {
        let (send, receive) = std::sync::mpsc::sync_channel(1);
        let handler = block2::RcBlock::new(move |content: *mut SCShareableContent, error: *mut NSError| {
            let result = if error.is_null() {
                unsafe { Retained::retain(content.cast()) }
                    .map(|content| content as Retained<SCShareableContent>)
                    .ok_or_else(|| "未能获取可捕获内容".to_string())
            } else {
                let error = unsafe { Retained::retain(error.cast()) }
                    .map(|error: Retained<NSError>| error.localizedDescription().to_string())
                    .unwrap_or_else(|| "未知错误".to_string());
                Err(error)
            };
            let _ = send.send(result);
        });
        unsafe {
            SCShareableContent::getShareableContentExcludingDesktopWindows_onScreenWindowsOnly_completionHandler(
                false,
                false,
                &handler,
            );
        }
        receive
            .recv_timeout(Duration::from_secs(10))
            .map_err(|_| "获取可捕获内容超时".to_string())??
    };

    let displays = unsafe { content.displays() };
    if displays.is_empty() {
        return Err("没有可用于采集系统声音的显示器".into());
    }
    let display = displays.objectAtIndex(0);
    let windows = objc2_foundation::NSArray::new();
    let filter = unsafe {
        SCContentFilter::initWithDisplay_excludingWindows(SCContentFilter::alloc(), &display, &windows)
    };
    let config = unsafe {
        let config = SCStreamConfiguration::new();
        // 音频-only：把画面压到 2×2 并把视频帧率压到 600 秒一帧，
        // 回调里也直接丢弃 Screen 类型的缓冲。
        config.setWidth(2);
        config.setHeight(2);
        config.setCapturesAudio(true);
        config.setSampleRate(48000);
        config.setChannelCount(1);
        config.setExcludesCurrentProcessAudio(true);
        config.setQueueDepth(8);
        config
    };

    let output = SystemAudioOutput::new();
    let stream = unsafe {
        SCStream::initWithFilter_configuration_delegate(
            SCStream::alloc(),
            &filter,
            &config,
            None,
        )
    };
    let output_ref: &SystemAudioOutput = &output;
    unsafe {
        stream
            .addStreamOutput_type_sampleHandlerQueue_error(
                ProtocolObject::from_ref(output_ref),
                SCStreamOutputType::Audio,
                None,
            )
            .map_err(|error| error.localizedDescription().to_string())?;
    }

    // 回调随时可能到达，ring 必须在 start 之前就位。
    *ring_slot().lock().unwrap_or_else(|e| e.into_inner()) =
        Some(Arc::new(Mutex::new(VecDeque::with_capacity(RING_CAPACITY))));
    *failure_slot().lock().unwrap_or_else(|e| e.into_inner()) = None;

    let (send, receive) = std::sync::mpsc::sync_channel(1);
    let handler = block2::RcBlock::new(move |error: *mut NSError| {
        let result = if error.is_null() {
            Ok(())
        } else {
            let error = unsafe { Retained::retain(error.cast()) }
                .map(|error: Retained<NSError>| error.localizedDescription().to_string())
                .unwrap_or_else(|| "未知错误".to_string());
            Err(error)
        };
        let _ = send.send(result);
    });
    unsafe { stream.startCaptureWithCompletionHandler(Some(&handler)) };
    if let Err(error) = receive
        .recv_timeout(Duration::from_secs(10))
        .map_err(|_| "系统声音采集启动超时".to_string())
        .and_then(|result| result)
    {
        *ring_slot().lock().unwrap_or_else(|e| e.into_inner()) = None;
        return Err(error);
    }
    Ok((stream, output))
}
