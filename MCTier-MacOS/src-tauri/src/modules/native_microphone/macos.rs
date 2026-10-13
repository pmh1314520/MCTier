//! CoreAudio input. A HAL output unit runs in input-only mode and hands 48 kHz mono
//! float samples to the worker thread, which packetises them exactly like WASAPI does
//! on Windows, so the frontend pump and its 3840-byte packet check stay unchanged.
//!
//! The AudioUnit and AudioObject APIs are plain C, so the handful of symbols used here
//! are declared directly instead of pulling in another crate.
use super::{push_packet, read_size, InputDevice, MonoResampler, Reply, CAPACITY, CHUNK};
use std::{
    collections::VecDeque,
    ffi::c_void,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{Receiver, TryRecvError},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};

type OSStatus = i32;
type AudioUnit = *mut c_void;
type AudioComponent = *mut c_void;
type AudioObjectId = u32;
type CFStringRef = *const c_void;

/// CoreAudio names its constants as four-character codes; spelling them out keeps the
/// numbers honest and readable.
const fn fourcc(value: &[u8; 4]) -> u32 {
    u32::from_be_bytes(*value)
}

// Values taken from the macOS SDK headers (AUComponent.h, AudioUnitProperties.h,
// AudioHardwareBase.h, AudioHardware.h) rather than from memory.
const UNIT_TYPE_OUTPUT: u32 = fourcc(b"auou");
const UNIT_SUBTYPE_HAL_OUTPUT: u32 = fourcc(b"ahal");
const UNIT_SUBTYPE_VOICE_PROCESSING: u32 = fourcc(b"vpio");
const UNIT_MANUFACTURER_APPLE: u32 = fourcc(b"appl");

const PROP_CURRENT_DEVICE: u32 = 2000;
const PROP_ENABLE_IO: u32 = 2003;
const PROP_SET_INPUT_CALLBACK: u32 = 2005;
const PROP_STREAM_FORMAT: u32 = 8;
const PROP_MAXIMUM_FRAMES_PER_SLICE: u32 = 14;

const SCOPE_GLOBAL: u32 = 0;
const SCOPE_INPUT: u32 = 1;
const SCOPE_OUTPUT: u32 = 2;
/// Scope and element as they appear inside an `AudioObjectPropertyAddress`.
const ADDRESS_SCOPE_GLOBAL: u32 = fourcc(b"glob");
const ADDRESS_SCOPE_INPUT: u32 = fourcc(b"inpt");
const ADDRESS_ELEMENT_MAIN: u32 = 0;

const FORMAT_LINEAR_PCM: u32 = fourcc(b"lpcm");
const FORMAT_FLAG_IS_FLOAT: u32 = 1;
const FORMAT_FLAG_IS_PACKED: u32 = 8;
const FORMAT_FLAG_IS_NON_INTERLEAVED: u32 = 32;

const OBJECT_SYSTEM: AudioObjectId = 1;
const HARDWARE_DEVICES: u32 = fourcc(b"dev#");
const HARDWARE_DEFAULT_INPUT: u32 = fourcc(b"dIn ");
const DEVICE_UID: u32 = fourcc(b"uid ");
const DEVICE_STREAMS: u32 = fourcc(b"stm#");
const OBJECT_NAME: u32 = fourcc(b"lnam");

const CF_STRING_ENCODING_UTF8: u32 = 0x0800_0100;
/// Upper bound on one callback slice; also the scratch buffer length.
const MAX_FRAMES: usize = 4096;
/// Two seconds of slack. Past this the callback drops the oldest audio.
const RING_CAPACITY: usize = 48000 * 2;
/// The device id prefix, mirroring the `wasapi:` prefix Windows uses.
const ID_PREFIX: &str = "coreaudio:";

#[repr(C)]
#[derive(Clone, Copy)]
struct AudioComponentDescription {
    component_type: u32,
    component_sub_type: u32,
    component_manufacturer: u32,
    component_flags: u32,
    component_flags_mask: u32,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct AudioStreamBasicDescription {
    sample_rate: f64,
    format_id: u32,
    format_flags: u32,
    bytes_per_packet: u32,
    frames_per_packet: u32,
    bytes_per_frame: u32,
    channels_per_frame: u32,
    bits_per_channel: u32,
    reserved: u32,
}

#[repr(C)]
struct AudioBuffer {
    number_channels: u32,
    data_byte_size: u32,
    data: *mut c_void,
}

#[repr(C)]
struct AudioBufferList {
    number_buffers: u32,
    buffers: [AudioBuffer; 1],
}

/// Only ever forwarded back to `AudioUnitRender`; never inspected here, so the layout
/// does not matter and an opaque type avoids copying Apple's nested SMPTE struct.
#[repr(C)]
struct AudioTimeStamp {
    _opaque: [u8; 0],
}

#[repr(C)]
#[derive(Clone, Copy)]
struct AudioObjectPropertyAddress {
    selector: u32,
    scope: u32,
    element: u32,
}

type InputCallback = unsafe extern "C" fn(
    ref_con: *mut c_void,
    flags: *mut u32,
    timestamp: *const AudioTimeStamp,
    bus: u32,
    frames: u32,
    data: *mut AudioBufferList,
) -> OSStatus;

#[repr(C)]
struct InputCallbackStruct {
    callback: Option<InputCallback>,
    ref_con: *mut c_void,
}

#[link(name = "AudioToolbox", kind = "framework")]
extern "C" {
    fn AudioComponentFindNext(
        component: AudioComponent,
        description: *const AudioComponentDescription,
    ) -> AudioComponent;
    fn AudioComponentInstanceNew(component: AudioComponent, instance: *mut AudioUnit) -> OSStatus;
    fn AudioComponentInstanceDispose(instance: AudioUnit) -> OSStatus;
    fn AudioUnitSetProperty(
        unit: AudioUnit,
        id: u32,
        scope: u32,
        element: u32,
        data: *const c_void,
        size: u32,
    ) -> OSStatus;
    fn AudioUnitGetProperty(
        unit: AudioUnit,
        id: u32,
        scope: u32,
        element: u32,
        data: *mut c_void,
        size: *mut u32,
    ) -> OSStatus;
    fn AudioUnitInitialize(unit: AudioUnit) -> OSStatus;
    fn AudioUnitUninitialize(unit: AudioUnit) -> OSStatus;
    fn AudioOutputUnitStart(unit: AudioUnit) -> OSStatus;
    fn AudioOutputUnitStop(unit: AudioUnit) -> OSStatus;
    fn AudioUnitRender(
        unit: AudioUnit,
        flags: *mut u32,
        timestamp: *const AudioTimeStamp,
        bus: u32,
        frames: u32,
        data: *mut AudioBufferList,
    ) -> OSStatus;
}

#[link(name = "CoreAudio", kind = "framework")]
extern "C" {
    fn AudioObjectGetPropertyData(
        object: AudioObjectId,
        address: *const AudioObjectPropertyAddress,
        qualifier_size: u32,
        qualifier: *const c_void,
        size: *mut u32,
        data: *mut c_void,
    ) -> OSStatus;
    fn AudioObjectGetPropertyDataSize(
        object: AudioObjectId,
        address: *const AudioObjectPropertyAddress,
        qualifier_size: u32,
        qualifier: *const c_void,
        size: *mut u32,
    ) -> OSStatus;
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFStringGetLength(string: CFStringRef) -> isize;
    // CoreFoundation's Boolean is an unsigned char, not Rust's bool.
    fn CFStringGetCString(string: CFStringRef, buffer: *mut u8, size: isize, encoding: u32) -> u8;
    fn CFRelease(value: *const c_void);
}

fn check(status: OSStatus, action: &str) -> Result<(), String> {
    if status == 0 {
        return Ok(());
    }
    // -10868 kAudioUnitErr_FormatNotSupported, -10879 kAudioUnitErr_InvalidProperty.
    let hint = match status {
        -10868 => "：设备不支持 48 kHz 单声道格式",
        -10879 => "：音频单元不支持该属性",
        _ => "",
    };
    Err(format!("{action}失败 (OSStatus {status}){hint}"))
}

fn address(selector: u32, scope: u32) -> AudioObjectPropertyAddress {
    AudioObjectPropertyAddress {
        selector,
        scope,
        element: ADDRESS_ELEMENT_MAIN,
    }
}

fn property_size(object: AudioObjectId, selector: u32, scope: u32) -> Result<u32, String> {
    let mut size = 0u32;
    let status = unsafe {
        AudioObjectGetPropertyDataSize(object, &address(selector, scope), 0, std::ptr::null(), &mut size)
    };
    check(status, "查询音频属性大小")?;
    Ok(size)
}

fn property_list(object: AudioObjectId, selector: u32, scope: u32) -> Result<Vec<u32>, String> {
    let size = property_size(object, selector, scope)?;
    let count = size as usize / std::mem::size_of::<u32>();
    let mut values = vec![0u32; count];
    if count == 0 {
        return Ok(values);
    }
    let mut written = size;
    let status = unsafe {
        AudioObjectGetPropertyData(
            object,
            &address(selector, scope),
            0,
            std::ptr::null(),
            &mut written,
            values.as_mut_ptr().cast(),
        )
    };
    check(status, "读取音频属性列表")?;
    values.truncate((written as usize / std::mem::size_of::<u32>()).min(count));
    Ok(values)
}

fn property_u32(object: AudioObjectId, selector: u32, scope: u32) -> Result<u32, String> {
    let mut value = 0u32;
    let mut size = std::mem::size_of::<u32>() as u32;
    let status = unsafe {
        AudioObjectGetPropertyData(object, &address(selector, scope), 0, std::ptr::null(), &mut size, (&mut value as *mut u32).cast())
    };
    check(status, "读取音频属性")?;
    Ok(value)
}

/// Reads a CoreAudio string property. The framework hands back a +1 CFString that the
/// caller owns, so it must be released on every path.
fn property_string(object: AudioObjectId, selector: u32) -> Option<String> {
    let mut value: CFStringRef = std::ptr::null();
    let mut size = std::mem::size_of::<CFStringRef>() as u32;
    let status = unsafe {
        AudioObjectGetPropertyData(
            object,
            &address(selector, ADDRESS_SCOPE_GLOBAL),
            0,
            std::ptr::null(),
            &mut size,
            (&mut value as *mut CFStringRef).cast(),
        )
    };
    if status != 0 || value.is_null() {
        return None;
    }
    unsafe {
        // A UTF-16 unit never expands past four UTF-8 bytes, so this always fits.
        let capacity = CFStringGetLength(value) * 4 + 1;
        let mut buffer = vec![0u8; capacity.max(1) as usize];
        let ok = CFStringGetCString(value, buffer.as_mut_ptr(), capacity, CF_STRING_ENCODING_UTF8);
        CFRelease(value.cast());
        if ok == 0 {
            return None;
        }
        let end = buffer.iter().position(|byte| *byte == 0).unwrap_or(buffer.len());
        buffer.truncate(end);
        String::from_utf8(buffer).ok()
    }
}

fn default_input_device() -> Option<AudioObjectId> {
    property_u32(OBJECT_SYSTEM, HARDWARE_DEFAULT_INPUT, ADDRESS_SCOPE_GLOBAL)
        .ok()
        .filter(|id| *id != 0)
}

fn device_uid(object: AudioObjectId) -> Option<String> {
    property_string(object, DEVICE_UID)
}

/// A device with no input streams is an output-only endpoint; listing it would only
/// give the user a microphone that cannot be opened.
fn has_input(object: AudioObjectId) -> bool {
    property_size(object, DEVICE_STREAMS, ADDRESS_SCOPE_INPUT)
        .map(|size| size > 0)
        .unwrap_or(false)
}

/// Devices for the settings list, in the same shape WASAPI produces.
pub fn devices() -> Result<Vec<InputDevice>, String> {
    let default = default_input_device();
    let mut devices = Vec::new();
    for object in property_list(OBJECT_SYSTEM, HARDWARE_DEVICES, ADDRESS_SCOPE_GLOBAL)? {
        if !has_input(object) {
            continue;
        }
        // The UID is stable across replugs; the AudioDeviceID is not.
        let Some(uid) = device_uid(object) else {
            continue;
        };
        let label = property_string(object, OBJECT_NAME).unwrap_or_else(|| uid.clone());
        devices.push(InputDevice {
            device_id: format!("{ID_PREFIX}{uid}"),
            label,
            kind: "audioinput",
            // macOS has a single input default; voice apps are routed to it too.
            is_default: default == Some(object),
            is_communications: default == Some(object),
        });
    }
    Ok(devices)
}

/// Everything the render callback touches. The callback is a bare function pointer, so
/// all of its state hangs off this struct behind `ref_con`.
struct CallbackState {
    unit: AudioUnit,
    ring: Arc<Mutex<VecDeque<f32>>>,
    scratch: Vec<f32>,
}

impl CallbackState {
    fn new(unit: AudioUnit, ring: Arc<Mutex<VecDeque<f32>>>) -> Self {
        Self {
            unit,
            ring,
            scratch: vec![0.0; MAX_FRAMES],
        }
    }
}

/// Pulls one slice out of the unit and appends it to the ring.
///
/// This runs on CoreAudio's real-time thread: it must not allocate, block, or panic.
/// A contended ring (the worker is draining) drops the slice instead of waiting.
unsafe extern "C" fn input_callback(
    ref_con: *mut c_void,
    flags: *mut u32,
    timestamp: *const AudioTimeStamp,
    bus: u32,
    frames: u32,
    _data: *mut AudioBufferList,
) -> OSStatus {
    if ref_con.is_null() {
        return 0;
    }
    let state = &mut *(ref_con as *mut CallbackState);
    let frame_count = frames as usize;
    if frame_count == 0 || frame_count > state.scratch.len() {
        return 0;
    }
    let mut list = AudioBufferList {
        number_buffers: 1,
        buffers: [AudioBuffer {
            number_channels: 1,
            data_byte_size: (frame_count * 4) as u32,
            data: state.scratch.as_mut_ptr().cast(),
        }],
    };
    if AudioUnitRender(state.unit, flags, timestamp, bus, frames, &mut list) != 0 {
        return 0;
    }
    let filled = (list.buffers[0].data_byte_size as usize / 4).min(frame_count);
    if let Ok(mut ring) = state.ring.try_lock() {
        ring.extend(state.scratch[..filled].iter().copied());
        if ring.len() > RING_CAPACITY {
            let overflow = ring.len() - RING_CAPACITY;
            ring.drain(..overflow);
        }
    }
    0
}

/// Owns the unit and everything the callback points at. Disposal order matters: the
/// unit is stopped and destroyed first, so the callback cannot fire while the boxed
/// state is torn down.
struct Running {
    unit: AudioUnit,
    _callback: Box<CallbackState>,
}

impl Drop for Running {
    fn drop(&mut self) {
        unsafe {
            let _ = AudioOutputUnitStop(self.unit);
            let _ = AudioUnitUninitialize(self.unit);
            let _ = AudioComponentInstanceDispose(self.unit);
        }
    }
}

impl Running {
    /// The ring the render callback fills, for the worker thread to drain.
    fn ring(&self) -> Arc<Mutex<VecDeque<f32>>> {
        Arc::clone(&self._callback.ring)
    }
}

/// Builds and starts an input-only unit. `voice_processing` selects Apple's voice
/// IO unit, which is what applies echo cancellation and noise suppression on macOS.
fn open(device: AudioObjectId, voice_processing: bool) -> Result<Running, String> {
    let sub_type = if voice_processing { UNIT_SUBTYPE_VOICE_PROCESSING } else { UNIT_SUBTYPE_HAL_OUTPUT };
    let description = AudioComponentDescription {
        component_type: UNIT_TYPE_OUTPUT,
        component_sub_type: sub_type,
        component_manufacturer: UNIT_MANUFACTURER_APPLE,
        component_flags: 0,
        component_flags_mask: 0,
    };
    let mut unit: AudioUnit = std::ptr::null_mut();
    unsafe {
        let component = AudioComponentFindNext(std::ptr::null_mut(), &description);
        if component.is_null() {
            return Err("未找到系统音频输入组件".into());
        }
        check(AudioComponentInstanceNew(component, &mut unit), "创建音频输入单元")?;
        let enable = 1u32;
        let disable = 0u32;
        // Input lives on bus 1 of the input scope; bus 0 is the (unused) output.
        check(
            AudioUnitSetProperty(unit, PROP_ENABLE_IO, SCOPE_INPUT, 1, (&enable as *const u32).cast(), 4),
            "启用音频输入",
        )?;
        check(
            AudioUnitSetProperty(unit, PROP_ENABLE_IO, SCOPE_OUTPUT, 0, (&disable as *const u32).cast(), 4),
            "禁用音频输出",
        )?;
        // AUHAL 输出单元跑在输入模式时，必须显式绑定「当前设备」，哪怕用的是系统默认麦克风：
        // 不绑定的话单元会默认挂到系统默认**输出**设备（扬声器）上，而扬声器没有输入流，
        // 于是输入回调渲染不出任何采样，表现就是采集“成功”、ring 永远为空、读取 3 秒超时
        // 报“麦克风无响应”——正是对方听不到声音的根因。device==0 时解析出真正的默认输入设备。
        //
        // 语音处理单元(vpio)例外：它自动跟随系统默认输入，设了反而可能被拒；仅 HAL 单元需要绑定。
        if !voice_processing {
            let bind_device = if device != 0 {
                device
            } else {
                default_input_device().ok_or("找不到可用的默认输入设备")?
            };
            check(
                AudioUnitSetProperty(unit, PROP_CURRENT_DEVICE, SCOPE_GLOBAL, 0, (&bind_device as *const u32).cast(), 4),
                "选择输入设备",
            )?;
        }
        // Ask for the exact format the frontend insists on; the HAL unit resamples.
        let format = AudioStreamBasicDescription {
            sample_rate: 48000.0,
            format_id: FORMAT_LINEAR_PCM,
            format_flags: FORMAT_FLAG_IS_FLOAT | FORMAT_FLAG_IS_PACKED | FORMAT_FLAG_IS_NON_INTERLEAVED,
            bytes_per_packet: 4,
            frames_per_packet: 1,
            bytes_per_frame: 4,
            channels_per_frame: 1,
            bits_per_channel: 32,
            reserved: 0,
        };
        // The client format is set on the input bus's *output* scope: that is the side
        // which faces us, while the input scope describes the device's own format.
        check(
            AudioUnitSetProperty(
                unit,
                PROP_STREAM_FORMAT,
                SCOPE_OUTPUT,
                1,
                (&format as *const AudioStreamBasicDescription).cast(),
                std::mem::size_of::<AudioStreamBasicDescription>() as u32,
            ),
            "设置采集格式",
        )?;
        let maximum = MAX_FRAMES as u32;
        if let Err(error) = check(
            AudioUnitSetProperty(unit, PROP_MAXIMUM_FRAMES_PER_SLICE, SCOPE_GLOBAL, 0, (&maximum as *const u32).cast(), 4),
            "设置每片最大帧数",
        ) {
            // Not fatal on every unit; the callback guards against oversized slices.
            log::warn!("{error}");
        }
        let ring = Arc::new(Mutex::new(VecDeque::with_capacity(RING_CAPACITY)));
        let mut callback = Box::new(CallbackState::new(unit, Arc::clone(&ring)));
        let callback_struct = InputCallbackStruct {
            callback: Some(input_callback),
            ref_con: (&mut *callback as *mut CallbackState).cast(),
        };
        check(
            AudioUnitSetProperty(
                unit,
                PROP_SET_INPUT_CALLBACK,
                SCOPE_GLOBAL,
                0,
                (&callback_struct as *const InputCallbackStruct).cast(),
                std::mem::size_of::<InputCallbackStruct>() as u32,
            ),
            "注册音频回调",
        )?;
        if let Err(error) = check(AudioUnitInitialize(unit), "初始化音频单元") {
            let _ = AudioComponentInstanceDispose(unit);
            return Err(format!(
                "{error}；若系统未授权麦克风，请在「系统设置 › 隐私与安全性 › 麦克风」中允许 MCTier"
            ));
        }
        check(AudioOutputUnitStart(unit), "启动音频采集")?;
        Ok(Running { unit, _callback: callback })
    }
}

/// 系统语音处理单元(vpio)是否在本机可用。
///
/// 很多 Mac（尤其没有合规麦克风或特定 SDK 组合时）打开 vpio 会以
/// `kAudioUnitErr_FailedInitialization (-10875)` 失败，而 `AudioUnitInitialize`
/// 要卡约 3~4 秒才返回这个失败——于是每次开麦都白等几秒再回退到 HAL 单元，
/// 表现就是“麦克风激活很慢”。首次失败后把结果缓存下来，后续直接走 HAL 单元，
/// 开麦几乎瞬时。None=未探测过，Some(false)=已知不可用，Some(true)=可用。
static VOICE_PROCESSING_AVAILABLE: std::sync::atomic::AtomicU8 =
    std::sync::atomic::AtomicU8::new(0); // 0=未知, 1=可用, 2=不可用

fn open_with_fallback(device: AudioObjectId, system_processing: bool) -> Result<Running, String> {
    use std::sync::atomic::Ordering;
    // Voice processing follows the system default device, so an explicit device
    // selection always uses the plain HAL unit.
    if system_processing && device == 0 {
        // 已知不可用就直接跳过，不再花几秒去撞同一个失败。
        if VOICE_PROCESSING_AVAILABLE.load(Ordering::Acquire) != 2 {
            match open(0, true) {
                Ok(running) => {
                    VOICE_PROCESSING_AVAILABLE.store(1, Ordering::Release);
                    return Ok(running);
                }
                Err(error) => {
                    VOICE_PROCESSING_AVAILABLE.store(2, Ordering::Release);
                    log::warn!(
                        "系统语音处理不可用，改用原始采集（后续开麦将直接跳过以加快速度）: {error}"
                    );
                }
            }
        } else {
            log::debug!("已知系统语音处理不可用，直接使用原始采集");
        }
    }
    open(device, false)
}

/// Resolves the frontend's device id to a CoreAudio object.
///
/// Legacy browser ids (a raw Chromium hash) are not CoreAudio UIDs; those, the explicit
/// "default"/"communications" aliases, and an empty id all mean the system default.
fn resolve(device_id: &str) -> Result<AudioObjectId, String> {
    if let Some(uid) = device_id.strip_prefix(ID_PREFIX) {
        let devices = property_list(OBJECT_SYSTEM, HARDWARE_DEVICES, ADDRESS_SCOPE_GLOBAL)
            .map_err(|e| format!("MIC_NOT_FOUND:无法枚举音频设备: {e}"))?;
        for object in devices {
            if device_uid(object).as_deref() == Some(uid) && has_input(object) {
                return Ok(object);
            }
        }
        return Err("MIC_NOT_FOUND:无法打开麦克风，请检查设备是否已连接".into());
    }
    match device_id {
        "" | "default" | "communications" => Ok(0),
        _ => Ok(0),
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

/// `loopback` records what the machine *plays*. macOS 13+ captures it natively
/// through ScreenCaptureKit (see `super::system_audio`); older systems keep the
/// BlackHole virtual-device guidance instead of quietly recording the microphone.
pub fn run_recording(
    device_id: String,
    system_processing: bool,
    loopback: bool,
    stop: Arc<AtomicBool>,
    requests: Receiver<Reply>,
    ready: tokio::sync::oneshot::Sender<Result<String, String>>,
) -> Result<(), String> {
    if loopback {
        return super::system_audio::run(stop, requests, ready);
    }
    run_source(device_id, system_processing, false, true, stop, requests, ready)
}

fn run_source(
    device_id: String,
    system_processing: bool,
    loopback: bool,
    recording: bool,
    stop: Arc<AtomicBool>,
    requests: Receiver<Reply>,
    ready: tokio::sync::oneshot::Sender<Result<String, String>>,
) -> Result<(), String> {
    let _ = loopback;
    let mut ready = Some(ready);
    let result = (|| -> Result<(), String> {
        let device = resolve(&device_id)?;
        let running = open_with_fallback(device, system_processing)?;
        let actual_id = match device_uid(device).or_else(|| default_input_device().and_then(device_uid)) {
            Some(uid) => format!("{ID_PREFIX}{uid}"),
            None => format!("{ID_PREFIX}{device}"),
        };
        // Read back the format the unit settled on. The HAL unit usually honours the
        // 48 kHz request, but a device that refuses it must be resampled rather than
        // played at the wrong speed.
        let mut achieved = AudioStreamBasicDescription {
            sample_rate: 0.0,
            format_id: 0,
            format_flags: 0,
            bytes_per_packet: 0,
            frames_per_packet: 0,
            bytes_per_frame: 0,
            channels_per_frame: 0,
            bits_per_channel: 0,
            reserved: 0,
        };
        let mut size = std::mem::size_of::<AudioStreamBasicDescription>() as u32;
        let mut resampler = None;
        let read_back = unsafe {
            AudioUnitGetProperty(
                running.unit,
                PROP_STREAM_FORMAT,
                SCOPE_OUTPUT,
                1,
                (&mut achieved as *mut AudioStreamBasicDescription).cast(),
                &mut size,
            )
        };
        if read_back == 0 {
            let rate = achieved.sample_rate.round();
            if !(8000.0..=192000.0).contains(&rate) {
                return Err("麦克风报告了不受支持的采样率".into());
            }
            if rate != 48000.0 {
                log::info!("输入设备工作在 {rate} Hz，将重采样到 48 kHz");
                resampler = Some(MonoResampler::new(rate as u32));
            }
        }
        let ring = running.ring();
        if ready.take().unwrap().send(Ok(actual_id)).is_err() {
            return Ok(());
        }
        let mut resampler = resampler;
        let mut queue = VecDeque::with_capacity(CAPACITY);
        let mut pending: Option<Reply> = None;
        let mut last_request = Instant::now();
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
            let captured: Vec<f32> = match ring.lock() {
                Ok(mut ring) => ring.drain(..).collect(),
                Err(poisoned) => poisoned.into_inner().drain(..).collect(),
            };
            if !captured.is_empty() {
                let bytes: Vec<u8> = match resampler.as_mut() {
                    Some(resampler) => resampler.convert(captured.into_iter()),
                    None => captured
                        .into_iter()
                        .flat_map(|sample| sample.clamp(-1.0, 1.0).to_le_bytes())
                        .collect(),
                };
                if recording {
                    queue.extend(bytes);
                    if queue.len() > CHUNK * 100 {
                        return Err("录屏音频处理积压超过两秒，请降低录屏画质".into());
                    }
                } else {
                    push_packet(&mut queue, &bytes);
                }
            }
            if pending.is_some() && queue.len() >= CHUNK {
                // Batch every completed packet: a slow renderer round trip must not
                // halve the transport rate.
                let count = read_size(queue.len(), recording);
                let bytes = queue.drain(..count).collect();
                let _ = pending.take().unwrap().send(Ok(bytes));
            }
            std::thread::sleep(Duration::from_millis(3));
        }
        Ok(())
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

    /// 这些值是照着 SDK 头文件抄的，抄错一个字符就会静默落到错误的属性上。
    #[test]
    fn fourcc_constants_match_the_sdk_headers() {
        assert_eq!(UNIT_TYPE_OUTPUT, 0x6175_6F75);
        assert_eq!(UNIT_SUBTYPE_HAL_OUTPUT, 0x6168_616C);
        assert_eq!(UNIT_SUBTYPE_VOICE_PROCESSING, 0x7670_696F);
        assert_eq!(UNIT_MANUFACTURER_APPLE, 0x6170_706C);
        assert_eq!(FORMAT_LINEAR_PCM, 0x6C70_636D);
        assert_eq!(ADDRESS_SCOPE_GLOBAL, 0x676C_6F62);
        assert_eq!(ADDRESS_SCOPE_INPUT, 0x696E_7074);
        assert_eq!(HARDWARE_DEVICES, 0x6465_7623);
        assert_eq!(HARDWARE_DEFAULT_INPUT, 0x6449_6E20);
        assert_eq!(DEVICE_UID, 0x7569_6420);
        assert_eq!(DEVICE_STREAMS, 0x7374_6D23);
        assert_eq!(OBJECT_NAME, 0x6C6E_616D);
    }

    /// 0 是 CoreAudio 的「无指定设备」：让 AudioUnit 跟随系统默认输入。
    #[test]
    fn browser_ids_and_aliases_fall_back_to_the_system_default() {
        for id in ["", "default", "communications", "a1b2c3d4e5f6"] {
            assert_eq!(resolve(id).expect("默认设备"), 0, "{id} 应落到系统默认输入");
        }
    }

    #[test]
    fn an_unknown_coreaudio_uid_reports_mic_not_found() {
        let error = resolve("coreaudio:definitely-not-a-real-uid").unwrap_err();
        assert!(error.starts_with("MIC_NOT_FOUND:"), "{error}");
    }

    // 系统声音（loopback）在 macOS 13+ 走 ScreenCaptureKit，见
    // super::system_audio：启动需要屏幕录制授权，只能实机验证，不适合单测。

    /// 枚举输入设备不需要麦克风授权，所以在没给权限的机器上也能跑。
    #[test]
    fn device_list_is_well_formed() {
        let devices = devices().expect("枚举输入设备");
        for device in &devices {
            assert!(device.device_id.starts_with(ID_PREFIX), "{}", device.device_id);
            assert!(!device.label.is_empty(), "{}", device.device_id);
            assert_eq!(device.kind, "audioinput");
        }
        assert!(
            devices.iter().filter(|device| device.is_default).count() <= 1,
            "最多只有一个系统默认输入"
        );
    }

    /// 前端的 pump 会丢弃任何不是 3840 字节整倍数、或超过上限的包。
    #[test]
    fn packet_contract_matches_the_frontend_check() {
        assert_eq!(CHUNK, 3840);
        assert_eq!(CAPACITY, 3840 * 5);
        assert_eq!(read_size(CHUNK - 1, false), 0);
        assert_eq!(read_size(CHUNK, false), CHUNK);
        assert_eq!(read_size(CHUNK * 3, false), CHUNK * 3);
        assert_eq!(read_size(CHUNK * 9, false), CHUNK * 5);
        assert_eq!(read_size(CHUNK * 9, true), CHUNK * 9);
        assert_eq!(read_size(CHUNK * 20, true), CHUNK * 10);
    }
}

