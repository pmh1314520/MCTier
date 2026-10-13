//! CoreGraphics screen capture. Displays snapshot through `CGDisplayCreateImage`,
//! windows through `CGWindowListCreateImage`, and every frame is scaled in a reused
//! RGBA bitmap context. The packet contract ([u32 LE width][u32 LE height][RGBA8]) is
//! what the Windows WGC backend produces and what the frontend's `decodeCaptureFrame`
//! validates, so the viewer and WebRTC path stay platform-agnostic.
use super::{output_size, FrameReply, Source};
use core_foundation::base::TCFType;
use core_foundation::string::CFString;
use core_graphics::color_space::CGColorSpace;
use core_graphics::context::CGContext;
use core_graphics::display::CGDisplay;
use core_graphics::geometry::{CGPoint, CGRect, CGSize};
use core_graphics::image::CGImage;
use core_graphics::window::{
    kCGWindowImageBestResolution, kCGWindowImageBoundsIgnoreFraming, kCGWindowImageShouldBeOpaque,
    kCGWindowListExcludeDesktopElements, kCGWindowListOptionIncludingWindow,
    kCGWindowListOptionOnScreenOnly, CGWindowID,
};
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::Receiver,
    },
    time::{Duration, Instant},
};

/// RGBA 字节序（内存里 R,G,B,A 依次排列）+ 预乘 alpha。前端把包内容直接当
/// ImageData 消费，字节序错一个通道整屏颜色就错了。
const BITMAP_INFO: u32 =
    1 /* kCGImageAlphaPremultipliedLast */ | (4 << 12) /* kCGBitmapByteOrder32Big */;

extern "C" {
    // CoreGraphics 10.15+：预检不弹窗，请求才弹。分开用，避免测试与枚举误触系统对话框。
    fn CGPreflightScreenCaptureAccess() -> bool;
    fn CGRequestScreenCaptureAccess() -> bool;
    // kCGWindowBounds 是 CFNumber 字典，CoreGraphics 自带它到 CGRect 的换算。
    fn CGRectMakeWithDictionaryRepresentation(dict: *const std::ffi::c_void, rect: *mut CGRect) -> bool;
    fn CFDictionaryGetValue(dict: *const std::ffi::c_void, key: *const std::ffi::c_void) -> *const std::ffi::c_void;
    fn CFNumberGetValue(number: *const std::ffi::c_void, the_type: isize, value: *mut std::ffi::c_void) -> u8;
}

/// kCFNumberFloat64Type
const CF_NUMBER_FLOAT64: isize = 6;
/// kCFNumberSInt32Type
const CF_NUMBER_SINT32: isize = 3;

/// 屏幕录制是 10.15+ 的 TCC 门控：未授权时采集 API 静默只返回桌面壁纸，
/// 所以枚举前先检查并引导，而不是让用户拿到一张"没有内容"的共享画面。
fn screen_capture_permission_denied() -> Option<String> {
    if unsafe { CGPreflightScreenCaptureAccess() } {
        return None;
    }
    unsafe { CGRequestScreenCaptureAccess() };
    Some("请在「系统设置 › 隐私与安全性 › 屏幕录制」中授权 MCTier；若已勾选仍提示，请退出并重新打开 MCTier".into())
}

pub fn sources() -> Result<Vec<Source>, String> {
    if let Some(message) = screen_capture_permission_denied() {
        return Err(message);
    }
    let mut items = Vec::new();
    let ids = CGDisplay::active_displays().map_err(|e| format!("枚举显示器失败: {e}"))?;
    for id in ids {
        let display = CGDisplay::new(id);
        let bounds = display.bounds();
        if bounds.size.width <= 0.0 || bounds.size.height <= 0.0 {
            continue;
        }
        items.push(Source {
            id: format!("monitor:{id}"),
            // 选择器里显示器按序号展示，不直接渲染该名称；windows 端同样如此。
            name: format!("Display {id}"),
            kind: "monitor".into(),
            // 像素尺寸（Retina 下为物理像素），与帧包里的实际内容一致。
            width: display.pixels_wide().max(1) as u32,
            height: display.pixels_high().max(1) as u32,
            primary: display.is_main(),
        });
    }
    items.extend(window_sources());
    items.sort_by_key(|s| (s.kind != "monitor", !s.primary, s.name.clone()));
    Ok(items)
}

/// 与 Windows 一致只列普通应用窗口：常驻 layer 0、可见、非本进程、非透明、
/// 尺寸非空且有归属应用。未授权屏幕录制时 kCGWindowName 拿不到标题，退回
/// 所属应用名，保证列表仍然可用。
fn window_sources() -> Vec<Source> {
    let Some(list) = CGDisplay::window_list_info(
        kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements,
        None,
    ) else {
        return Vec::new();
    };
    let own_pid = std::process::id() as i32;
    let mut items = Vec::new();
    for index in 0..list.len() {
        let Some(item) = list.get(index) else { continue };
        let dict = *item;
        if dict_i32(dict, "kCGWindowLayer") != Some(0) {
            continue;
        }
        if dict_i32(dict, "kCGWindowPID").is_none_or(|pid| pid == own_pid) {
            continue;
        }
        if dict_f64(dict, "kCGWindowAlpha") == Some(0.0) {
            continue;
        }
        let Some(number) = dict_i32(dict, "kCGWindowNumber") else { continue };
        let Some(rect) = dict_rect(dict) else { continue };
        if rect.size.width < 1.0 || rect.size.height < 1.0 {
            continue;
        }
        let owner = dict_string(dict, "kCGWindowOwnerName").unwrap_or_default();
        if owner.is_empty() {
            continue;
        }
        let name = dict_string(dict, "kCGWindowName")
            .filter(|title| !title.is_empty())
            .unwrap_or(owner);
        items.push(Source {
            id: format!("window:{number}"),
            name,
            kind: "window".into(),
            // CGWindowList 的 bounds 是点（非 Retina 像素）；帧包尺寸以实际采集结果为准。
            width: rect.size.width as u32,
            height: rect.size.height as u32,
            primary: false,
        });
    }
    items
}

fn dict_i32(dict: *const std::ffi::c_void, key: &str) -> Option<i32> {
    let value = unsafe { CFDictionaryGetValue(dict, key_cfstring(key)?) };
    if value.is_null() {
        return None;
    }
    let mut out: i32 = 0;
    let ok = unsafe { CFNumberGetValue(value, CF_NUMBER_SINT32, (&mut out as *mut i32).cast()) };
    (ok != 0).then_some(out)
}

fn dict_f64(dict: *const std::ffi::c_void, key: &str) -> Option<f64> {
    let value = unsafe { CFDictionaryGetValue(dict, key_cfstring(key)?) };
    if value.is_null() {
        return None;
    }
    let mut out: f64 = 0.0;
    let ok = unsafe { CFNumberGetValue(value, CF_NUMBER_FLOAT64, (&mut out as *mut f64).cast()) };
    (ok != 0).then_some(out)
}

fn dict_string(dict: *const std::ffi::c_void, key: &str) -> Option<String> {
    let value = unsafe { CFDictionaryGetValue(dict, key_cfstring(key)?) };
    if value.is_null() {
        return None;
    }
    Some(unsafe { CFString::wrap_under_get_rule(value.cast()) }.to_string())
}

fn dict_rect(dict: *const std::ffi::c_void) -> Option<CGRect> {
    let bounds = unsafe { CFDictionaryGetValue(dict, key_cfstring("kCGWindowBounds")?) };
    if bounds.is_null() {
        return None;
    }
    let mut rect = CGRect {
        origin: CGPoint { x: 0.0, y: 0.0 },
        size: CGSize {
            width: 0.0,
            height: 0.0,
        },
    };
    let ok = unsafe { CGRectMakeWithDictionaryRepresentation(bounds, &mut rect) };
    (ok).then_some(rect)
}

/// 窗口字典的键就是以常量名命名的 CFString（如 "kCGWindowName"），
/// CFDictionaryGetValue 按内容相等比较，所以自建同内容字符串即可命中。
/// 键在进程内不变：CFString 故意泄漏（等同静态存储），表里只存指针数值
/// 以满足静态项的 Sync 要求。
fn key_cfstring(name: &str) -> Option<*const std::ffi::c_void> {
    static KEYS: std::sync::OnceLock<std::collections::HashMap<&'static str, usize>> =
        std::sync::OnceLock::new();
    let keys = KEYS.get_or_init(|| {
        [
            "kCGWindowLayer",
            "kCGWindowPID",
            "kCGWindowAlpha",
            "kCGWindowNumber",
            "kCGWindowBounds",
            "kCGWindowOwnerName",
            "kCGWindowName",
        ]
        .into_iter()
        .map(|key| {
            // mem::forget 保留 +1 引用，字符串对象与进程同寿命，指针永远有效。
            let owned = CFString::new(key);
            let raw = owned.as_concrete_TypeRef() as usize;
            std::mem::forget(owned);
            (key, raw)
        })
        .collect()
    });
    keys.get(name)
        .map(|raw| *raw as *const std::ffi::c_void)
}

/// 窗口采集不裁剪，直接取整个窗口内容（CGRectNull 的系统约定值）。
fn entire_window() -> CGRect {
    CGRect {
        origin: CGPoint {
            x: f64::INFINITY,
            y: f64::INFINITY,
        },
        size: CGSize {
            width: 0.0,
            height: 0.0,
        },
    }
}

/// 把采集到的 CGImage 缩放为请求分辨率并打包。上下文按尺寸缓存复用，
/// 同尺寸连续取帧时除最终 Vec 外没有每帧分配。
struct Scaler {
    space: CGColorSpace,
    context: Option<CGContext>,
    size: (usize, usize),
}

impl Scaler {
    fn packet(&mut self, image: &CGImage, resolution: u32) -> Result<Vec<u8>, String> {
        let (width, height) = {
            let (w, h) = output_size(image.width().max(1) as u32, image.height().max(1) as u32, resolution);
            (w as usize, h as usize)
        };
        if self.size != (width, height) {
            self.size = (width, height);
            // bytes_per_row 固定 width*4（紧致行序），data() 的长度才是 height*width*4。
            self.context = Some(CGContext::create_bitmap_context(
                None,
                width,
                height,
                8,
                width * 4,
                &self.space,
                BITMAP_INFO,
            ));
        }
        let Some(context) = self.context.as_ref() else {
            return Err("无法创建屏幕采集位图上下文".into());
        };
        context.draw_image(
            CGRect::new(
                &CGPoint::new(0.0, 0.0),
                &CGSize::new(width as f64, height as f64),
            ),
            image,
        );
        let data = self.context.as_mut().expect("上下文已创建").data();
        let expected = width * height * 4;
        if data.len() != expected {
            return Err(format!("屏幕采集行距异常: {} != {expected}", data.len()));
        }
        let mut bytes = Vec::with_capacity(8 + expected);
        bytes.extend_from_slice(&(width as u32).to_le_bytes());
        bytes.extend_from_slice(&(height as u32).to_le_bytes());
        bytes.extend_from_slice(data);
        Ok(bytes)
    }
}

fn capture_frame(source: &Source, resolution: u32, scaler: &mut Scaler) -> Result<Vec<u8>, String> {
    let id: CGWindowID = source
        .id
        .split_once(':')
        .and_then(|(_, raw)| raw.parse().ok())
        .ok_or("共享目标标识无效")?;
    let image = match source.kind.as_str() {
        "monitor" => CGDisplay::new(id).image(),
        "window" => CGDisplay::screenshot(
            entire_window(),
            kCGWindowListOptionIncludingWindow,
            id,
            kCGWindowImageBestResolution
                | kCGWindowImageBoundsIgnoreFraming
                | kCGWindowImageShouldBeOpaque,
        ),
        _ => return Err("未知的共享目标类型".into()),
    };
    let Some(image) = image else {
        return Err("共享目标已关闭或已不可见".into());
    };
    scaler.packet(&image, resolution)
}

pub fn run(
    source: &Source,
    resolution: u32,
    frame_rate: u32,
    stop: &AtomicBool,
    requests: Receiver<FrameReply>,
    ready: tokio::sync::oneshot::Sender<Result<(), String>>,
) -> Result<(), String> {
    let init = (|| {
        if let Some(message) = screen_capture_permission_denied() {
            return Err(message);
        }
        let mut scaler = Scaler {
            space: CGColorSpace::create_device_rgb(),
            context: None,
            size: (0, 0),
        };
        let first = capture_frame(source, resolution, &mut scaler)?;
        Ok::<_, String>(first)
    })();
    let first = match init {
        Ok(value) => value,
        Err(e) => {
            let _ = ready.send(Err(e.clone()));
            return Err(e);
        }
    };
    if ready.send(Ok(())).is_err() {
        return Ok(());
    }
    let mut scaler = Scaler {
        space: CGColorSpace::create_device_rgb(),
        context: None,
        size: (0, 0),
    };
    let mut first = Some(first);
    let interval = Duration::from_secs_f64(1.0 / frame_rate as f64);
    let mut last = Instant::now() - interval;
    let mut last_request = Instant::now();
    while !stop.load(Ordering::Acquire) {
        match requests.recv_timeout(Duration::from_millis(100)) {
            Ok(reply) => {
                last_request = Instant::now();
                if reply.is_closed() {
                    continue;
                }
                if let Some(wait) = interval.checked_sub(last.elapsed()) {
                    std::thread::sleep(wait);
                }
                last = Instant::now();
                // CoreGraphics 没有事件式帧池：每次请求实时快照即为天然背压。
                let result = match first.take() {
                    Some(bytes) => Ok(bytes),
                    None => capture_frame(source, resolution, &mut scaler),
                };
                let failed = result.is_err();
                let _ = reply.send(result);
                if failed {
                    break;
                }
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
            Err(_) => {
                // 渲染进程崩溃或重载后必须自动释放采集，避免留下孤儿会话。
                if last_request.elapsed() > Duration::from_secs(12) {
                    break;
                }
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use core_graphics::data_provider::CGDataProvider;
    use std::sync::Arc;

    /// 上红下蓝的已知图样：画进位图上下文后缓冲区首行必须仍是红色。
    /// 采集包按「自顶向下」的行序编码，这个映射若颠倒，远端看到的就是倒屏。
    #[test]
    fn bitmap_packets_are_top_down() {
        let pattern: Arc<Vec<u8>> = Arc::new(vec![
            255, 0, 0, 255, 255, 0, 0, 255, // 首行红
            0, 0, 255, 255, 0, 0, 255, 255, // 次行蓝
        ]);
        let space = CGColorSpace::create_device_rgb();
        let provider = CGDataProvider::from_buffer(Arc::clone(&pattern));
        let image = CGImage::new(2, 2, 8, 32, 2 * 4, &space, BITMAP_INFO, &provider, true, 0);
        let mut scaler = Scaler {
            space,
            context: None,
            size: (0, 0),
        };
        let packet = scaler.packet(&image, 2160).expect("打包 2×2 图样");
        let width = u32::from_le_bytes(packet[0..4].try_into().unwrap());
        let height = u32::from_le_bytes(packet[4..8].try_into().unwrap());
        assert_eq!((width, height), (2, 2), "小图样不允许被放大");
        assert_eq!(packet.len(), 8 + 2 * 2 * 4);
        assert_eq!(&packet[8..12], &pattern[0..4], "缓冲区首行应是图样首行（红）");
        assert_eq!(&packet[16..20], &pattern[8..12], "缓冲区次行应是图样次行（蓝）");
        assert!(packet[8..].chunks_exact(4).all(|pixel| pixel[3] == 255));
    }

    /// 不透明源画进预乘位图上下文后 alpha 必须保持 255，前端画布才能正常显示。
    #[test]
    fn opaque_source_keeps_full_alpha() {
        // 2×2 同色图样：output_size 的下限是 2，避免尺寸取整干扰断言。
        let pattern: Arc<Vec<u8>> = Arc::new(vec![128, 64, 32, 255, 128, 64, 32, 255, 128, 64, 32, 255, 128, 64, 32, 255]);
        let space = CGColorSpace::create_device_rgb();
        let provider = CGDataProvider::from_buffer(Arc::clone(&pattern));
        let image = CGImage::new(2, 2, 8, 32, 2 * 4, &space, BITMAP_INFO, &provider, true, 0);
        let mut scaler = Scaler {
            space,
            context: None,
            size: (0, 0),
        };
        let packet = scaler.packet(&image, 2160).expect("打包 2×2 图样");
        assert!(packet[8..].chunks_exact(4).all(|pixel| pixel == [128, 64, 32, 255]));
    }

    mod live {
        //! 需要真实显示器与屏幕录制授权；未授权时直接跳过，避免测试进程误弹系统对话框。
        use super::*;

        fn skip_without_permission() -> bool {
            unsafe { CGPreflightScreenCaptureAccess() }
        }

        #[test]
        #[ignore = "需要屏幕录制授权与真实显示器（先给宿主终端授权，再 --include-ignored）"]
        fn real_monitor_capture_produces_a_valid_packet() {
            assert!(skip_without_permission(), "终端没有屏幕录制授权，已跳过");
            let primary = sources()
                .expect("枚举共享目标")
                .into_iter()
                .find(|s| s.kind == "monitor" && s.primary)
                .expect("主显示器");
            let mut scaler = Scaler {
                space: CGColorSpace::create_device_rgb(),
                context: None,
                size: (0, 0),
            };
            let packet = capture_frame(&primary, 720, &mut scaler).expect("采集主显示器");
            let width = u32::from_le_bytes(packet[0..4].try_into().unwrap());
            let height = u32::from_le_bytes(packet[4..8].try_into().unwrap());
            assert_eq!(packet.len(), 8 + width as usize * height as usize * 4);
            assert!(
                packet[8..].chunks_exact(4).all(|pixel| pixel[3] == 255),
                "不透明屏幕包 alpha 应为 255"
            );
            eprintln!("主显示器 {}×{} -> {width}×{height}", primary.width, primary.height);
        }

        #[test]
        #[ignore = "需要屏幕录制授权与真实显示器"]
        fn window_sources_are_well_formed() {
            assert!(skip_without_permission(), "终端没有屏幕录制授权，已跳过");
            for source in sources().expect("枚举共享目标") {
                assert!(
                    source.id.starts_with("monitor:") || source.id.starts_with("window:"),
                    "{}",
                    source.id
                );
                assert!(!source.name.is_empty(), "{} 缺少名称", source.id);
                assert!(source.width >= 2 && source.height >= 2, "{}", source.id);
            }
        }
    }
}
