use super::*;
use std::borrow::Cow;

// Fidelity fixtures need an encoder slot; production deliberately skips busy work.
static TEST_ENCODER: std::sync::Mutex<()> = std::sync::Mutex::new(());
fn optimize(bytes: &[u8]) -> Option<Vec<u8>> {
    let _guard = TEST_ENCODER.lock().unwrap();
    super::optimize(bytes)
}

#[test]
fn busy_encoders_skip_work_instead_of_queueing_and_release_slots() {
    let _guard = TEST_ENCODER.lock().unwrap();
    let source = png_image(png::BitDepth::Eight, false);
    ENCODERS.store(2, Ordering::Relaxed);
    let first = EncoderSlot;
    let second = EncoderSlot;
    assert!(super::optimize(&source).is_none());
    drop(first);
    assert!(super::optimize(&source).is_some());
    drop(second);
    assert_eq!(ENCODERS.load(Ordering::Relaxed), 0);
}

fn rgba(width: usize, height: usize) -> Vec<u8> {
    (0..width * height)
        .flat_map(|i| {
            let x = i % width;
            let y = i / width;
            [
                if x % 16 < 8 { 240 } else { 30 },
                (y / 8) as u8,
                80,
                if x % 17 == 0 { 0 } else { 255 },
            ]
        })
        .collect()
}

fn png_image(depth: png::BitDepth, animation: bool) -> Vec<u8> {
    let mut bytes = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut bytes, 128, 128);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(depth);
        encoder.set_compression(png::Compression::NoCompression);
        if animation {
            encoder.set_animated(2, 3).unwrap();
        }
        let mut writer = encoder.write_header().unwrap();
        let pixels = rgba(128, 128);
        let pixels = if depth == png::BitDepth::Sixteen {
            pixels
                .into_iter()
                .flat_map(|v| [v, v.wrapping_add(1)])
                .collect()
        } else {
            pixels
        };
        writer.write_image_data(&pixels).unwrap();
        if animation {
            writer.write_image_data(&pixels).unwrap();
        }
    }
    bytes
}

fn png_rgba(bytes: &[u8]) -> Vec<u8> {
    image::load_from_memory_with_format(bytes, image::ImageFormat::Png)
        .unwrap()
        .to_rgba8()
        .into_raw()
}

fn webp_rgba(bytes: &[u8]) -> Vec<u8> {
    let decoded = webp::Decoder::new(bytes).decode().unwrap();
    if decoded.is_alpha() {
        decoded.to_vec()
    } else {
        decoded
            .chunks_exact(3)
            .flat_map(|p| [p[0], p[1], p[2], 255])
            .collect()
    }
}

#[test]
fn screenshot_compression_preserves_every_rgba_byte_and_dimensions() {
    let original = png_image(png::BitDepth::Eight, false);
    let result = optimize(&original).unwrap();
    assert!(result.len() < original.len() / 10);
    let decoded = match mime(&result).unwrap() {
        "image/webp" => webp_rgba(&result),
        _ => png_rgba(&result),
    };
    assert_eq!(decoded, rgba(128, 128)); // Includes hidden RGB under alpha=0.
    println!(
        "RGBA screenshot: {} -> {} bytes",
        original.len(),
        result.len()
    );
}

#[test]
fn sixteen_bit_png_is_not_reduced_to_eight_bits() {
    let original = png_image(png::BitDepth::Sixteen, false);
    let result = optimize(&original).unwrap();
    assert_eq!(mime(&result), Some("image/png"));
    let decode = |bytes: &[u8]| {
        image::load_from_memory_with_format(bytes, image::ImageFormat::Png)
            .unwrap()
            .to_rgba16()
    };
    assert_eq!(decode(&original), decode(&result));
}

#[test]
fn apng_keeps_all_animation_frames_and_controls() {
    let original = png_image(png::BitDepth::Eight, true);
    let result = optimize(&original).unwrap_or_else(|| original.clone());
    assert_eq!(mime(&result), Some("image/png"));
    let controls = |data: &[u8]| {
        let mut pos = 8;
        let mut controls = Vec::new();
        while pos < data.len() {
            let size = u32::from_be_bytes(data[pos..pos + 4].try_into().unwrap()) as usize;
            if matches!(&data[pos + 4..pos + 8], b"acTL" | b"fcTL") {
                controls.push(data[pos + 4..pos + 8 + size].to_vec());
            }
            pos += size + 12;
        }
        controls
    };
    assert_eq!(controls(&original), controls(&result));
    use image::AnimationDecoder;
    let frames = |bytes: &[u8]| {
        image::codecs::png::PngDecoder::new(Cursor::new(bytes))
            .unwrap()
            .apng()
            .unwrap()
            .into_frames()
            .map(|frame| {
                let frame = frame.unwrap();
                (frame.delay(), frame.into_buffer())
            })
            .collect::<Vec<_>>()
    };
    assert_eq!(frames(&original), frames(&result));
}

#[test]
fn jpeg_optimization_keeps_pixels_orientation_and_color_markers() {
    let pixels = rgba(128, 128);
    let image = turbojpeg::Image {
        pixels: pixels.as_slice(),
        width: 128,
        height: 128,
        pitch: 128 * 4,
        format: turbojpeg::PixelFormat::RGBA,
    };
    let original = turbojpeg::compress(image, 95, turbojpeg::Subsamp::Sub2x2).unwrap();
    let mut with_metadata = original[..2].to_vec();
    for (marker, data) in [
        (0xe1, b"Exif\0\0II*\0\x08\0\0\0\x01\0\x12\x01\x03\0\x01\0\0\0\x06\0\0\0\0\0\0\0".as_slice()),
        (0xe2, b"ICC_PROFILE\0\x01\x01color-must-stay".as_slice()),
    ] {
        with_metadata.extend_from_slice(&[0xff, marker]);
        with_metadata.extend_from_slice(&((data.len() + 2) as u16).to_be_bytes());
        with_metadata.extend_from_slice(data);
    }
    with_metadata.extend_from_slice(&original[2..]);
    let result = optimize(&with_metadata).unwrap_or_else(|| with_metadata.clone());
    assert!(result.len() <= with_metadata.len());
    assert_eq!(
        turbojpeg::decompress(&with_metadata, turbojpeg::PixelFormat::RGBA)
            .unwrap()
            .pixels,
        turbojpeg::decompress(&result, turbojpeg::PixelFormat::RGBA)
            .unwrap()
            .pixels
    );
    for value in [
        b"Exif\0\0II*\0\x08\0\0\0\x01\0\x12\x01\x03\0\x01\0\0\0\x06\0\0\0\0\0\0\0".as_slice(),
        b"ICC_PROFILE\0\x01\x01color-must-stay".as_slice(),
    ] {
        assert!(result.windows(value.len()).any(|part| part == value));
    }
    println!("JPEG: {} -> {} bytes", with_metadata.len(), result.len());
}

fn animated_gif() -> Vec<u8> {
    let mut bytes = Vec::new();
    {
        let palette: Vec<u8> = (0..256).flat_map(|i| [i as u8, 0, 0]).collect();
        let mut encoder = ::gif::Encoder::new(&mut bytes, 96, 64, &palette).unwrap();
        encoder.set_repeat(::gif::Repeat::Finite(7)).unwrap();
        for (index, disposal) in [
            (0, ::gif::DisposalMethod::Keep),
            (1, ::gif::DisposalMethod::Background),
            (2, ::gif::DisposalMethod::Previous),
        ] {
            let frame = ::gif::Frame {
                width: 96,
                height: 64,
                delay: 11 + index,
                dispose: disposal,
                transparent: Some(0),
                interlaced: index == 1,
                buffer: Cow::Owned(
                    (0..96 * 64)
                        .map(|n| ((n / 96 + index as usize) % 3) as u8)
                        .collect(),
                ),
                ..Default::default()
            };
            encoder.write_frame(&frame).unwrap();
        }
    }
    bytes
}

#[test]
fn gif_preserves_indexed_pixels_delays_disposal_transparency_interlace_and_repeat() {
    let original = animated_gif();
    let result = optimize(&original).unwrap_or_else(|| original.clone());
    let decode = |bytes: &[u8]| {
        let mut reader = ::gif::DecodeOptions::new()
            .read_info(Cursor::new(bytes))
            .unwrap();
        let palette = reader.global_palette().unwrap().to_vec();
        let mut frames = Vec::new();
        while let Some(frame) = reader.read_next_frame().unwrap() {
            frames.push((
                frame.buffer.to_vec(),
                frame.delay,
                frame.dispose,
                frame.transparent,
                frame.left,
                frame.top,
            ));
        }
        (palette, frames, reader.repeat())
    };
    assert_eq!(decode(&original), decode(&result));
    assert!(result.len() <= original.len());
    println!("Animated GIF: {} -> {} bytes", original.len(), result.len());
}

#[test]
fn webp_preserves_decoded_pixels_including_transparency() {
    let pixels = rgba(128, 128);
    let original = webp::Encoder::from_rgba(&pixels, 128, 128)
        .encode(95.0)
        .to_vec();
    let result = optimize(&original).unwrap_or_else(|| original.clone());
    assert_eq!(webp_rgba(&original), webp_rgba(&result));
    assert!(result.len() <= original.len());
}

#[test]
fn animated_webp_preserves_pixels_timestamps_and_loop_count() {
    let first = rgba(96, 64);
    let mut second = first.clone();
    for pixel in second.chunks_exact_mut(4).skip(96) {
        pixel[1] = 190;
    }
    let mut config = webp::WebPConfig::new().unwrap();
    config.lossless = 1;
    config.exact = 1;
    let mut encoder = webp::AnimEncoder::new(96, 64, &config);
    encoder.add_frame(webp::AnimFrame::from_rgba(&first, 96, 64, 0));
    encoder.add_frame(webp::AnimFrame::from_rgba(&second, 96, 64, 130));
    encoder.add_frame(webp::AnimFrame::from_rgba(&first, 96, 64, 470));
    let original = encoder.encode().to_vec();
    let result = webp_image::optimize(&original).expect("animation optimizer must parse frames");
    let decode = |bytes: &[u8]| {
        let animation = webp::AnimDecoder::new(bytes).decode().unwrap();
        (
            animation.loop_count,
            (0..animation.len())
                .map(|i| {
                    let frame = animation.get_frame(i).unwrap();
                    (
                        frame.get_time_ms(),
                        frame.width(),
                        frame.height(),
                        frame.get_image().to_vec(),
                    )
                })
                .collect::<Vec<_>>(),
        )
    };
    assert_eq!(decode(&original), decode(&result));
}

#[test]
fn gif_recompresses_inefficient_lzw_without_touching_animation_controls() {
    let width = 64u16;
    let mut original = b"GIF89a".to_vec();
    original.extend_from_slice(&width.to_le_bytes());
    original.extend_from_slice(&width.to_le_bytes());
    original.extend_from_slice(&[0xf7, 0, 0]);
    for value in 0..256 {
        original.extend_from_slice(&[value as u8, 0, 0]);
    }
    original.extend_from_slice(b"\x21\xff\x0bNETSCAPE2.0\x03\x01\x05\0\0");
    for index in 0..2 {
        original.extend_from_slice(&[0x21, 0xf9, 4, 9, 15, 0, 0, 0]);
        original.extend_from_slice(&[0x2c, 0, 0, 0, 0, 64, 0, 64, 0, 0]);
        original.push(8);
        let pixels = vec![index; 64 * 64];
        let encoded = weezl::encode::Encoder::new(weezl::BitOrder::Lsb, 8)
            .encode(&pixels)
            .unwrap();
        for block in encoded.chunks(255) {
            original.push(block.len() as u8);
            original.extend_from_slice(block);
        }
        original.push(0);
    }
    original.push(0x3b);
    let result = optimize(&original).expect("inefficient GIF should shrink");
    let decode = |bytes: &[u8]| {
        let mut reader = ::gif::DecodeOptions::new()
            .read_info(Cursor::new(bytes))
            .unwrap();
        let mut frames = Vec::new();
        while let Some(frame) = reader.read_next_frame().unwrap() {
            frames.push((
                frame.buffer.to_vec(),
                frame.delay,
                frame.dispose,
                frame.transparent,
            ));
        }
        (frames, reader.repeat())
    };
    assert_eq!(decode(&original), decode(&result));
    println!(
        "Inefficient GIF: {} -> {} bytes",
        original.len(),
        result.len()
    );
}

#[test]
fn malformed_bombs_and_unsupported_files_safely_keep_original() {
    for data in [
        b"not an image".as_slice(),
        b"GIF89a",
        b"\xff\xd8\xff",
        b"RIFF\0\0\0\0WEBP",
    ] {
        assert!(optimize(data).is_none());
    }
    let mut png = png_image(png::BitDepth::Eight, false);
    png[16..20].copy_from_slice(&u32::MAX.to_be_bytes());
    assert!(optimize(&png).is_none());
    let gif = animated_gif();
    for size in [32, 40, gif.len() / 2, gif.len() - 2] {
        assert!(optimize(&gif[..size]).is_none());
    }
}
