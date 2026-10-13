//! The same lossless optimizer runs on desktop and Android. Never resize,
//! quantize, discard animation, or replace the original with a larger file.
use std::{io::Cursor, sync::atomic::{AtomicUsize, Ordering}, time::{Duration, Instant}};

mod gif;
mod webp_image;

pub const MAX_INPUT_BYTES: usize = 64 * 1024 * 1024;
const MAX_PIXELS: u64 = 16_000_000;
static ENCODERS: AtomicUsize = AtomicUsize::new(0);
struct EncoderSlot;
impl Drop for EncoderSlot { fn drop(&mut self) { ENCODERS.fetch_sub(1, Ordering::Relaxed); } }
pub(crate) const WORK_BUDGET: Duration = Duration::from_millis(150);
const SEND_WAIT_BUDGET: Duration = Duration::from_millis(250);

pub fn mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        Some("image/jpeg")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("image/gif")
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        Some("image/webp")
    } else {
        None
    }
}

pub fn extension(mime: &str) -> &'static str {
    match mime {
        "image/png" => "png",
        "image/gif" => "gif",
        "image/webp" => "webp",
        _ => "jpg",
    }
}

fn dimensions_ok(width: u32, height: u32) -> bool {
    width > 0 && height > 0 && u64::from(width) * u64::from(height) <= MAX_PIXELS
}

/// Returns None when no safe smaller representation exists. Unsupported,
/// malformed, huge or unusually complex images remain byte-for-byte original.
pub fn optimize(bytes: &[u8]) -> Option<Vec<u8>> {
    if bytes.len() < 32 || bytes.len() > 8 * 1024 * 1024 || mime(bytes).is_none() {
        return None;
    }
    // At most two independent encoders; a burst never queues behind a large GIF.
    ENCODERS.fetch_update(Ordering::Relaxed, Ordering::Relaxed, |n| (n < 2).then_some(n + 1)).ok()?;
    let slot = EncoderSlot;
    let input = bytes.to_vec();
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    // Codec calls cannot be interrupted. Bound the sender's wait instead; the
    // detached worker retains its slot until it exits, so a burst cannot grow threads.
    std::thread::Builder::new().name("chat-image-optimize".into()).spawn(move || {
        let result = optimize_candidate(&input);
        drop(slot);
        let _ = sender.send(result);
    }).ok()?;
    receiver.recv_timeout(SEND_WAIT_BUDGET).ok().flatten()
}

fn optimize_candidate(bytes: &[u8]) -> Option<Vec<u8>> {
    let candidate = std::panic::catch_unwind(|| match mime(bytes)? {
        "image/png" => optimize_png(bytes),
        "image/jpeg" => optimize_jpeg(bytes),
        "image/gif" => gif::optimize(bytes),
        "image/webp" => webp_image::optimize(bytes),
        _ => None,
    })
    .ok()
    .flatten()?;
    (candidate.len() < bytes.len()).then_some(candidate)
}

fn optimize_png(bytes: &[u8]) -> Option<Vec<u8>> {
    let width = u32::from_be_bytes(bytes.get(16..20)?.try_into().ok()?);
    let height = u32::from_be_bytes(bytes.get(20..24)?.try_into().ok()?);
    if !dimensions_ok(width, height) || u64::from(width) * u64::from(height) > 4_000_000 {
        return None;
    }
    let started = Instant::now();
    let mut options = oxipng::Options::from_preset(0);
    options.timeout = Some(WORK_BUDGET);
    options.max_decompressed_size = Some(128 * 1024 * 1024);
    options.optimize_alpha = false;
    options.strip = oxipng::StripChunks::None;
    let mut best = oxipng::optimize_from_memory(bytes, &options).ok()?;
    // Only bare 8-bit PNGs may change container. Color profiles, EXIF, HDR,
    // text, APNG and any unknown chunks stay in PNG, preserved by oxipng.
    let mut pos = 8;
    let mut plain = bytes.get(24).is_some_and(|depth| *depth <= 8);
    while pos < bytes.len() {
        let size = u32::from_be_bytes(bytes.get(pos..pos + 4)?.try_into().ok()?) as usize;
        let kind = bytes.get(pos + 4..pos + 8)?;
        plain &= matches!(kind, b"IHDR" | b"PLTE" | b"tRNS" | b"IDAT" | b"IEND");
        pos = pos.checked_add(size)?.checked_add(12)?;
        if pos > bytes.len() {
            return None;
        }
    }
    if plain && started.elapsed() < WORK_BUDGET && u64::from(width) * u64::from(height) <= 1_000_000 {
        let mut reader =
            image::ImageReader::with_format(Cursor::new(bytes), image::ImageFormat::Png);
        let mut limits = image::Limits::default();
        limits.max_alloc = Some(128 * 1024 * 1024);
        reader.limits(limits);
        if let Ok(decoded) = reader.decode() {
            let rgba = decoded.to_rgba8();
            if let Some(webp) = webp_image::encode(rgba.as_raw(), width, height) {
                if webp.len() < best.len() {
                    best = webp;
                }
            }
        }
    }
    Some(best)
}

fn optimize_jpeg(bytes: &[u8]) -> Option<Vec<u8>> {
    let header = turbojpeg::read_header(bytes).ok()?;
    if !dimensions_ok(
        header.width.try_into().ok()?,
        header.height.try_into().ok()?,
    ) {
        return None;
    }
    let mut transformer = turbojpeg::Transformer::new().ok()?;
    let mut best = bytes.to_vec();
    for progressive in [false] {
        let mut transform = turbojpeg::Transform::default();
        transform.optimize = true;
        transform.progressive = progressive;
        transform.copy_none = false; // Preserve orientation, ICC and other markers.
        if let Ok(candidate) = transformer.transform_to_vec(&transform, bytes) {
            if candidate.len() < best.len() {
                best = candidate;
            }
        }
    }
    Some(best)
}

#[cfg(target_os = "android")]
#[no_mangle]
pub extern "system" fn Java_top_pmh13_mctier_network_ImageOptimizer_optimizeNative(
    env: jni::JNIEnv,
    _class: jni::objects::JClass,
    input: jni::objects::JByteArray,
) -> jni::sys::jbyteArray {
    // Null means keep the original; no panics may cross the JNI boundary.
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let len = env.get_array_length(&input).ok()? as usize;
        if len > MAX_INPUT_BYTES {
            return None;
        }
        let bytes = env.convert_byte_array(input).ok()?;
        let optimized = optimize(&bytes)?;
        env.byte_array_from_slice(&optimized)
            .ok()
            .map(|array| array.into_raw())
    }))
    .ok()
    .flatten()
    .unwrap_or(std::ptr::null_mut())
}

#[cfg(test)]
mod tests;
