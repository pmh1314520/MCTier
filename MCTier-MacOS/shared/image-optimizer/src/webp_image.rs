type Chunk<'a> = (&'a [u8], &'a [u8]);

fn chunks(bytes: &[u8]) -> Option<Vec<Chunk<'_>>> {
    let mut chunks = Vec::new();
    let mut pos = 0;
    while pos < bytes.len() {
        let kind = bytes.get(pos..pos + 4)?;
        let size = u32::from_le_bytes(bytes.get(pos + 4..pos + 8)?.try_into().ok()?) as usize;
        let data = bytes.get(pos + 8..pos + 8 + size)?;
        chunks.push((kind, data));
        pos = pos.checked_add(8 + size + (size & 1))?;
    }
    (pos == bytes.len()).then_some(chunks)
}

fn append(output: &mut Vec<u8>, kind: &[u8], data: &[u8]) {
    output.extend_from_slice(kind);
    output.extend_from_slice(&(data.len() as u32).to_le_bytes());
    output.extend_from_slice(data);
    if data.len() & 1 == 1 {
        output.push(0);
    }
}

fn riff(chunks: &[u8]) -> Vec<u8> {
    let mut result = b"RIFF".to_vec();
    result.extend_from_slice(&((chunks.len() + 4) as u32).to_le_bytes());
    result.extend_from_slice(b"WEBP");
    result.extend_from_slice(chunks);
    result
}

pub fn encode(rgba: &[u8], width: u32, height: u32) -> Option<Vec<u8>> {
    let mut config = webp::WebPConfig::new().ok()?;
    config.lossless = 1;
    config.near_lossless = 100;
    config.exact = 1; // Also preserve RGB under completely transparent pixels.
    config.quality = 0.0; // Lossless effort only: pixels remain exact at every quality.
    config.method = 0;
    config.thread_level = 1;
    let data = webp::Encoder::from_rgba(rgba, width, height)
        .encode_advanced(&config)
        .ok()?;
    Some(data.to_vec())
}

fn optimize_still(bytes: &[u8]) -> Option<Vec<u8>> {
    let features = webp::BitstreamFeatures::new(bytes)?;
    if features.has_animation()
        || !super::dimensions_ok(features.width(), features.height())
        || u64::from(features.width()) * u64::from(features.height()) > 1_000_000
    {
        return None;
    }
    let decoded = webp::Decoder::new(bytes).decode()?;
    let rgba = if decoded.is_alpha() {
        decoded.to_vec()
    } else {
        decoded
            .chunks_exact(3)
            .flat_map(|pixel| [pixel[0], pixel[1], pixel[2], 255])
            .collect()
    };
    let encoded = encode(&rgba, decoded.width(), decoded.height())?;
    let mut output = Vec::new();
    // Replace only pixel chunks. Keep ICC, EXIF, XMP, orientation and unknown
    // chunks in their original relative order and preserve the extended header.
    let original = chunks(bytes.get(12..)?)?;
    let mut replaced = false;
    for (kind, data) in original {
        if matches!(kind, b"ALPH" | b"VP8 " | b"VP8L") {
            if !replaced {
                for (new_kind, new_data) in chunks(&encoded[12..])? {
                    if matches!(new_kind, b"ALPH" | b"VP8 " | b"VP8L") {
                        append(&mut output, new_kind, new_data);
                    }
                }
                replaced = true;
            }
        } else {
            append(&mut output, kind, data);
        }
    }
    replaced.then(|| riff(&output))
}

pub fn optimize(bytes: &[u8]) -> Option<Vec<u8>> {
    let started = std::time::Instant::now();
    if u32::from_le_bytes(bytes.get(4..8)?.try_into().ok()?) as usize + 8 != bytes.len() {
        return None;
    }
    let features = webp::BitstreamFeatures::new(bytes)?;
    if !super::dimensions_ok(features.width(), features.height()) {
        return None;
    }
    if !features.has_animation() {
        return optimize_still(bytes);
    }
    let mut output = Vec::new();
    let mut total_pixels = 0u64;
    let mut count = 0;
    for (kind, data) in chunks(&bytes[12..])? {
        if started.elapsed() >= super::WORK_BUDGET { return None; }
        if kind != b"ANMF" {
            append(&mut output, kind, data);
            continue;
        }
        let header = data.get(..16)?;
        let u24 = |b: &[u8]| u32::from_le_bytes([b[0], b[1], b[2], 0]);
        let width = u24(&header[6..9]) + 1;
        let height = u24(&header[9..12]) + 1;
        total_pixels += u64::from(width) * u64::from(height);
        count += 1;
        if total_pixels > 4_000_000 || count > 128 {
            return None;
        }
        // Supply the per-frame extended header when decoding ALPH + VP8.
        let has_alpha = chunks(&data[16..])?
            .iter()
            .any(|(kind, _)| matches!(*kind, b"ALPH" | b"VP8L"));
        let mut frame_chunks = Vec::new();
        let mut extended = vec![if has_alpha { 0x10 } else { 0 }, 0, 0, 0];
        extended.extend_from_slice(&header[6..12]);
        append(&mut frame_chunks, b"VP8X", &extended);
        frame_chunks.extend_from_slice(&data[16..]);
        let candidate = optimize_still(&riff(&frame_chunks))?;
        let mut frame = header.to_vec(); // Frame rectangle, duration, blend and disposal unchanged.
        for (pixel_kind, pixels) in chunks(&candidate[12..])? {
            if pixel_kind != b"VP8X" {
                append(&mut frame, pixel_kind, pixels);
            }
        }
        append(
            &mut output,
            kind,
            if frame.len() < data.len() {
                &frame
            } else {
                data
            },
        );
    }
    Some(riff(&output))
}
