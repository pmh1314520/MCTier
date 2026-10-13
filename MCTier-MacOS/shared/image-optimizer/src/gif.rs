use weezl::{decode::Decoder, encode::Encoder, BitOrder, LzwStatus};

fn sub_blocks(bytes: &[u8], pos: &mut usize) -> Option<Vec<u8>> {
    let mut data = Vec::new();
    loop {
        let size = *bytes.get(*pos)? as usize;
        *pos += 1;
        if size == 0 {
            return Some(data);
        }
        data.extend_from_slice(bytes.get(*pos..*pos + size)?);
        *pos += size;
    }
}

pub fn optimize(bytes: &[u8]) -> Option<Vec<u8>> {
    let started = std::time::Instant::now();
    let width = u16::from_le_bytes(bytes.get(6..8)?.try_into().ok()?) as u32;
    let height = u16::from_le_bytes(bytes.get(8..10)?.try_into().ok()?) as u32;
    if !super::dimensions_ok(width, height) {
        return None;
    }
    let flags = *bytes.get(10)?;
    let mut pos = 13
        + if flags & 0x80 != 0 {
            3 * (1 << ((flags & 7) + 1))
        } else {
            0
        };
    let mut output = bytes.get(..pos)?.to_vec();
    let mut total_pixels = 0usize;
    let mut frames = 0;
    loop {
        if started.elapsed() >= super::WORK_BUDGET { return None; }
        let start = pos;
        match *bytes.get(pos)? {
            0x3b => {
                output.extend_from_slice(&bytes[pos..]);
                return Some(output);
            }
            0x21 => {
                // Copy ALL extensions exactly, including repeat counts, ICC,
                // frame delay/disposal/transparency and unknown application data.
                pos += 2;
                sub_blocks(bytes, &mut pos)?;
                output.extend_from_slice(&bytes[start..pos]);
            }
            0x2c => {
                let descriptor = bytes.get(pos..pos + 10)?;
                let w = u16::from_le_bytes(descriptor[5..7].try_into().ok()?) as usize;
                let h = u16::from_le_bytes(descriptor[7..9].try_into().ok()?) as usize;
                let pixels = w.checked_mul(h)?;
                total_pixels = total_pixels.checked_add(pixels)?;
                frames += 1;
                if pixels == 0 || total_pixels > 4_000_000 || frames > 128 {
                    return None;
                }
                pos += 10;
                if descriptor[9] & 0x80 != 0 {
                    pos += 3 * (1 << ((descriptor[9] & 7) + 1));
                }
                let compressed_start = pos;
                let min_code_size = *bytes.get(pos)?;
                if !(2..=8).contains(&min_code_size) {
                    return None;
                }
                pos += 1;
                let compressed = sub_blocks(bytes, &mut pos)?;
                let mut decoded = vec![0; pixels + 1]; // Extra byte detects decompression bombs.
                let mut decoder = Decoder::new(BitOrder::Lsb, min_code_size);
                let (mut consumed, mut written) = (0, 0);
                loop {
                    let result =
                        decoder.decode_bytes(&compressed[consumed..], &mut decoded[written..]);
                    consumed += result.consumed_in;
                    written += result.consumed_out;
                    if written > pixels {
                        return None;
                    }
                    match result.status.ok()? {
                        LzwStatus::Done => break,
                        _ if result.consumed_in == 0 && result.consumed_out == 0 => return None,
                        _ => (),
                    }
                }
                if written != pixels {
                    return None;
                }
                decoded.truncate(pixels);
                let max_index = *decoded.iter().max()?;
                let new_min = (8 - max_index.leading_zeros() as u8).max(2);
                let encoded = Encoder::new(BitOrder::Lsb, new_min).encode(&decoded).ok()?;
                let mut candidate = vec![new_min];
                for block in encoded.chunks(255) {
                    candidate.push(block.len() as u8);
                    candidate.extend_from_slice(block);
                }
                candidate.push(0);
                output.extend_from_slice(bytes.get(start..compressed_start)?);
                if candidate.len() < pos - compressed_start {
                    output.extend_from_slice(&candidate);
                } else {
                    output.extend_from_slice(&bytes[compressed_start..pos]);
                }
            }
            _ => return None,
        }
    }
}
