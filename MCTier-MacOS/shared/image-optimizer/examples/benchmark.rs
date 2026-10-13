use std::time::Instant;

fn measure(label: &str, bytes: &[u8]) {
    let mut times = Vec::new();
    let mut size = bytes.len();
    for _ in 0..5 {
        let start = Instant::now();
        let result = mctier_image_optimizer::optimize(bytes);
        times.push(start.elapsed().as_secs_f64() * 1000.0);
        size = result.as_ref().map_or(bytes.len(), Vec::len);
    }
    times.sort_by(f64::total_cmp);
    println!("{label}: {} -> {size} bytes; median {:.2} ms, max {:.2} ms", bytes.len(), times[2], times[4]);
}

fn main() {
    let paths: Vec<_> = std::env::args().skip(1).collect();
    if !paths.is_empty() {
        for path in paths { measure(&path, &std::fs::read(&path).unwrap()); }
        return;
    }
    for (width, height) in [(1280, 720), (1920, 1080), (3840, 2160)] {
        let pixels: Vec<u8> = (0..width * height).flat_map(|i| {
            let (x, y) = (i % width, i / width);
            [(x / 16) as u8, (y / 16) as u8, ((x + y) / 32) as u8, 255]
        }).collect();
        let mut png = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut png, width, height);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_compression(png::Compression::Fast);
            encoder.write_header().unwrap().write_image_data(&pixels).unwrap();
        }
        measure(&format!("Synthetic screenshot {width}x{height} PNG"), &png);
        let jpg = turbojpeg::compress(turbojpeg::Image {
            pixels: pixels.as_slice(), width: width as usize, height: height as usize,
            pitch: width as usize * 4, format: turbojpeg::PixelFormat::RGBA,
        }, 90, turbojpeg::Subsamp::Sub2x2).unwrap();
        measure(&format!("Synthetic {width}x{height} JPEG"), &jpg);
    }
}
