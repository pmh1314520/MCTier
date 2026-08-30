//! Native desktop voice processing powered by the pure-Rust Sonora WebRTC APM.
//!
//! The browser supplies one 10 ms microphone frame and the matching render
//! reference. Sonora's AEC3 keeps its adaptive filter state across frames, so
//! render and capture must be processed in order on one serialized state.

use std::sync::{Mutex, OnceLock};

use sonora::config::{EchoCanceller, HighPassFilter, NoiseSuppression, NoiseSuppressionLevel};
use sonora::{AudioProcessing, Config, StreamConfig};

const SAMPLE_RATE: u32 = 48_000;
const CHANNELS: u16 = 1;
const FRAME_SAMPLES: usize = 480; // 10 ms at 48 kHz
const DEFAULT_STREAM_DELAY_MS: i32 = 50;

fn processor() -> &'static Mutex<Option<AudioProcessing>> {
    static PROCESSOR: OnceLock<Mutex<Option<AudioProcessing>>> = OnceLock::new();
    PROCESSOR.get_or_init(|| Mutex::new(None))
}

fn create_processor() -> AudioProcessing {
    let stream = StreamConfig::new(SAMPLE_RATE, CHANNELS);
    let config = Config {
        echo_canceller: Some(EchoCanceller::default()),
        // Moderate suppression reduces residual room noise before LocalVQE.
        noise_suppression: Some(NoiseSuppression {
            level: NoiseSuppressionLevel::Moderate,
            analyze_linear_aec_output_when_available: true,
        }),
        high_pass_filter: Some(HighPassFilter::default()),
        // Gain is deliberately applied after LocalVQE in the WebView. Running
        // AGC here would amplify residual noise before the neural enhancer.
        gain_controller2: None,
        ..Config::default()
    };
    let mut apm = AudioProcessing::builder()
        .config(config)
        .capture_config(stream)
        .render_config(stream)
        .build();
    // AEC3 requires an estimate of the render/capture device-buffer delay.
    // Its internal delay estimator refines this while the call is active.
    let _ = apm.set_stream_delay_ms(DEFAULT_STREAM_DELAY_MS);
    apm
}

/// Process one ordered 10 ms mono frame through Sonora AEC3 + light NS.
#[tauri::command]
pub fn process_voice_frame(mic: Vec<f32>, render: Vec<f32>) -> Result<Vec<f32>, String> {
    if mic.len() != FRAME_SAMPLES || render.len() != FRAME_SAMPLES {
        return Err(format!(
            "invalid voice frame length: mic={}, render={}, expected={FRAME_SAMPLES}",
            mic.len(),
            render.len()
        ));
    }

    let mut guard = processor()
        .lock()
        .map_err(|_| "voice processor lock poisoned".to_string())?;
    if guard.is_none() {
        *guard = Some(create_processor());
    }
    let apm = guard.as_mut().expect("processor initialized");

    let render_src: &[&[f32]] = &[&render];
    let mut render_output = vec![0.0f32; FRAME_SAMPLES];
    let render_dest: &mut [&mut [f32]] = &mut [&mut render_output];
    apm.process_render_f32(render_src, render_dest)
        .map_err(|error| format!("Sonora render processing failed: {error}"))?;

    let capture_src: &[&[f32]] = &[&mic];
    let mut capture_output = vec![0.0f32; FRAME_SAMPLES];
    let capture_dest: &mut [&mut [f32]] = &mut [&mut capture_output];
    apm.process_capture_f32(capture_src, capture_dest)
        .map_err(|error| format!("Sonora capture processing failed: {error}"))?;

    Ok(capture_output)
}

/// Process several consecutive 10 ms frames in one IPC call. Batching keeps
/// the native processor comfortably ahead of the real-time WebAudio deadline.
#[tauri::command]
pub fn process_voice_frames(mic: Vec<f32>, render: Vec<f32>) -> Result<Vec<f32>, String> {
    if mic.len() != render.len() || mic.is_empty() || mic.len() % FRAME_SAMPLES != 0 {
        return Err(format!(
            "invalid voice batch length: mic={}, render={}, frame={FRAME_SAMPLES}",
            mic.len(),
            render.len(),
        ));
    }

    let mut output = Vec::with_capacity(mic.len());
    for (mic_frame, render_frame) in mic
        .chunks_exact(FRAME_SAMPLES)
        .zip(render.chunks_exact(FRAME_SAMPLES))
    {
        output.extend(process_voice_frame(
            mic_frame.to_vec(),
            render_frame.to_vec(),
        )?);
    }
    Ok(output)
}

/// Reset adaptive AEC state when the microphone is closed or a new lobby starts.
#[tauri::command]
pub fn reset_voice_processor() -> Result<(), String> {
    let mut guard = processor()
        .lock()
        .map_err(|_| "voice processor lock poisoned".to_string())?;
    *guard = None;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{process_voice_frame, process_voice_frames, reset_voice_processor, FRAME_SAMPLES};

    #[test]
    fn processes_ordered_frames_without_invalid_samples() {
        reset_voice_processor().unwrap();
        for frame_index in 0..24 {
            let mut render = vec![0.0f32; FRAME_SAMPLES];
            let mut mic = vec![0.0f32; FRAME_SAMPLES];
            for sample_index in 0..FRAME_SAMPLES {
                let phase = (frame_index * FRAME_SAMPLES + sample_index) as f32;
                render[sample_index] = (phase * 0.021).sin() * 0.3;
                // Near-end voice plus a quieter acoustic copy of the render.
                mic[sample_index] = (phase * 0.037).sin() * 0.2 + render[sample_index] * 0.25;
            }
            let output = process_voice_frame(mic, render).unwrap();
            assert_eq!(output.len(), FRAME_SAMPLES);
            assert!(output.iter().all(|sample| sample.is_finite()));
        }
        reset_voice_processor().unwrap();
    }

    #[test]
    fn processes_consecutive_frames_as_one_batch() {
        reset_voice_processor().unwrap();
        let frame_count = 4;
        let mic = vec![0.02f32; FRAME_SAMPLES * frame_count];
        let render = vec![0.0f32; FRAME_SAMPLES * frame_count];
        let output = process_voice_frames(mic, render).unwrap();
        assert_eq!(output.len(), FRAME_SAMPLES * frame_count);
        assert!(output.iter().all(|sample| sample.is_finite()));
        reset_voice_processor().unwrap();
    }
}
