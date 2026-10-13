use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::Path,
};
use tauri::ipc::Channel;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelManifest {
    id: String,
    #[cfg(test)]
    base_url: String,
    files: Vec<ModelFile>,
}
#[derive(Deserialize)]
struct ModelFile {
    name: String,
    size: u64,
    sha256: String,
    compression: Option<String>,
}
#[derive(Clone, Serialize)]
pub struct SpeechProgress {
    completed: u64,
    total: u64,
}
static RECOGNITION: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[cfg(windows)]
fn bundled_model_bytes() -> Result<&'static [u8], String> {
    use windows::{
        core::{w, PCWSTR},
        Win32::System::LibraryLoader::{
            FindResourceW, GetModuleHandleW, LoadResource, LockResource, SizeofResource,
        },
    };
    // The main executable owns this immutable RCDATA for its entire lifetime.
    // Validate handles and length before constructing the read-only slice.
    unsafe {
        let module = GetModuleHandleW(None).map_err(|e| e.to_string())?;
        let resource = FindResourceW(
            module,
            w!("MCTIER_SPEECH_MODEL"),
            PCWSTR(10usize as *const u16),
        );
        if resource.0.is_null() {
            return Err("安装包缺少内置语音模型，请重新安装 MCTier".into());
        }
        let size = SizeofResource(module, resource) as usize;
        let loaded = LoadResource(module, resource).map_err(|e| e.to_string())?;
        let pointer = LockResource(loaded) as *const u8;
        if pointer.is_null() || size == 0 {
            return Err("无法读取内置语音模型".into());
        }
        Ok(std::slice::from_raw_parts(pointer, size))
    }
}

#[cfg(not(windows))]
fn bundled_model_bytes() -> Result<&'static [u8], String> {
    Ok(include_bytes!(
        "../../../shared/generated/speech-model/model.int8.onnx.gzip"
    ))
}

fn verified(path: &Path, expected: &ModelFile) -> bool {
    let Ok(mut file) = fs::File::open(path) else {
        return false;
    };
    if file.metadata().map(|m| m.len()).ok() != Some(expected.size) {
        return false;
    }
    let mut hash = Sha256::new();
    let mut buffer = [0u8; 65536];
    loop {
        match file.read(&mut buffer) {
            Ok(0) => break,
            Ok(count) => hash.update(&buffer[..count]),
            Err(_) => return false,
        }
    }
    format!("{:x}", hash.finalize()) == expected.sha256
}

fn prepare_model(
    root: &Path,
    progress: &Channel<SpeechProgress>,
) -> Result<std::path::PathBuf, String> {
    let manifest: ModelManifest =
        serde_json::from_str(include_str!("../../../shared/speech-model.json"))
            .map_err(|e| e.to_string())?;
    let directory = root.join(manifest.id);
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let total = manifest.files.iter().map(|file| file.size).sum();
    let mut completed = 0;
    for item in &manifest.files {
        let path = directory.join(&item.name);
        if !verified(&path, item) {
            let bytes: &[u8] = match item.name.as_str() {
                "model.int8.onnx" => bundled_model_bytes()?,
                "tokens.txt" => include_bytes!("../../../shared/generated/speech-model/tokens.txt"),
                _ => return Err("安装包缺少内置语音模型，请重新安装 MCTier".into()),
            };
            let pending = directory.join(format!("{}.partial", item.name));
            let result = (|| -> Result<(), String> {
                let mut file = fs::File::create(&pending).map_err(|e| e.to_string())?;
                extract_bundled(bytes, item, &mut file, |extracted| {
                    let _ = progress.send(SpeechProgress {
                        completed: completed + extracted,
                        total,
                    });
                })?;
                file.sync_all().map_err(|e| e.to_string())?;
                drop(file);
                if !verified(&pending, item) {
                    return Err("内置语音模型校验失败，请重新安装 MCTier".into());
                }
                if path.exists() {
                    fs::remove_file(&path).map_err(|e| e.to_string())?;
                }
                fs::rename(&pending, &path).map_err(|e| e.to_string())?;
                Ok(())
            })();
            if result.is_err() {
                let _ = fs::remove_file(pending);
            }
            result?;
        }
        completed += item.size;
        let _ = progress.send(SpeechProgress { completed, total });
    }
    Ok(directory)
}

fn extract_bundled(
    bytes: &[u8],
    item: &ModelFile,
    output: &mut impl Write,
    mut progress: impl FnMut(u64),
) -> Result<(), String> {
    let mut input: Box<dyn Read + '_> = match item.compression.as_deref() {
        Some("gzip") => Box::new(flate2::read::GzDecoder::new(bytes)),
        None => Box::new(bytes),
        _ => return Err("不支持的语音模型压缩格式".into()),
    };
    let mut buffer = [0u8; 65536];
    let mut extracted = 0u64;
    loop {
        let count = input
            .read(&mut buffer)
            .map_err(|e| format!("语音模型解压失败: {e}"))?;
        if count == 0 {
            break;
        }
        extracted += count as u64;
        if extracted > item.size {
            return Err("语音模型解压大小超限".into());
        }
        output
            .write_all(&buffer[..count])
            .map_err(|e| e.to_string())?;
        progress(extracted);
    }
    if extracted != item.size {
        return Err("语音模型解压大小不匹配".into());
    }
    Ok(())
}

pub fn decode_pcm(wav: &[u8]) -> Result<Vec<f32>, String> {
    if wav.len() > 4 * 1024 * 1024 {
        return Err("语音数据过大".into());
    }
    let mut reader =
        hound::WavReader::new(std::io::Cursor::new(wav)).map_err(|_| "无效的 WAV 语音")?;
    let spec = reader.spec();
    if spec.channels != 1
        || spec.sample_rate != 16000
        || spec.bits_per_sample != 16
        || spec.sample_format != hound::SampleFormat::Int
    {
        return Err("语音必须为 16kHz 单声道 PCM16".into());
    }
    let samples = reader
        .samples::<i16>()
        .map(|value| value.map(|value| value as f32 / 32768.0))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| "语音数据损坏")?;
    if samples.is_empty() || samples.len() > 16000 * 120 {
        return Err("语音时长无效".into());
    }
    Ok(samples)
}

pub async fn transcribe(
    wav: Vec<u8>,
    _app: tauri::AppHandle,
    progress: Channel<SpeechProgress>,
) -> Result<String, String> {
    let guard = RECOGNITION
        .try_lock()
        .map_err(|_| "另一条语音正在识别，请稍后重试")?;
    let directory = crate::modules::app_paths::data_root()
        .map_err(|e| e.to_string())?
        .join("speech-models");
    let result = tokio::task::spawn_blocking(move || {
        let samples = decode_pcm(&wav)?;
        let directory = prepare_model(&directory, &progress)?;
        recognize_samples(&directory, &samples)
    })
    .await
    .map_err(|e| e.to_string())?;
    drop(guard);
    result
}

fn recognize_samples(directory: &Path, samples: &[f32]) -> Result<String, String> {
    let mut config = sherpa_onnx::OnlineRecognizerConfig::default();
    config.enable_endpoint = false;
    config.model_config.zipformer2_ctc = sherpa_onnx::OnlineZipformer2CtcModelConfig {
        model: Some(directory.join("model.int8.onnx").to_string_lossy().into()),
    };
    config.model_config.tokens = Some(directory.join("tokens.txt").to_string_lossy().into());
    config.model_config.num_threads = 2;
    config.model_config.provider = Some("cpu".into());
    let recognizer =
        sherpa_onnx::OnlineRecognizer::create(&config).ok_or("无法加载离线中文语音模型")?;
    let stream = recognizer.create_stream();
    for chunk in samples.chunks(16000) {
        stream.accept_waveform(16000, chunk);
        while recognizer.is_ready(&stream) {
            recognizer.decode(&stream);
        }
    }
    // Flush the final streaming window; endpoint resets would lose earlier text.
    stream.accept_waveform(16000, &vec![0.0; 10560]);
    stream.input_finished();
    while recognizer.is_ready(&stream) {
        recognizer.decode(&stream);
    }
    recognizer
        .get_result(&stream)
        .map(|result| result.text.trim().to_string())
        .ok_or_else(|| "语音识别未返回结果".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_non_pcm_and_truncated_audio() {
        assert!(decode_pcm(b"RIFF bad input").is_err());
    }
    #[test]
    fn manifest_is_pinned() {
        let manifest: ModelManifest =
            serde_json::from_str(include_str!("../../../shared/speech-model.json")).unwrap();
        assert!(!manifest.base_url.contains("/main/"));
        assert!(manifest
            .files
            .iter()
            .all(|f| f.sha256.len() == 64 && f.size > 0));
    }
    #[test]
    #[ignore = "fetches test WAVs only; model is embedded; set MCTIER_SPEECH_TEST_CACHE"]
    fn recognizes_real_chinese_offline() {
        let cache =
            std::env::var("MCTIER_SPEECH_TEST_CACHE").expect("explicit test cache required");
        let directory = prepare_model(Path::new(&cache), &Channel::new(|_| Ok(()))).unwrap();
        let manifest: ModelManifest =
            serde_json::from_str(include_str!("../../../shared/speech-model.json")).unwrap();
        for sample in ["0", "1"] {
            let wav =
                reqwest::blocking::get(format!("{}test_wavs/{sample}.wav", manifest.base_url))
                    .unwrap()
                    .error_for_status()
                    .unwrap()
                    .bytes()
                    .unwrap();
            let text = recognize_samples(&directory, &decode_pcm(&wav).unwrap()).unwrap();
            println!("{sample}: {text}");
            assert!(
                text.chars().count() > 10,
                "actual speech should produce words"
            );
            assert!(text.contains(if sample == "0" { "研究" } else { "金融" }));
        }
    }
    #[test]
    fn rejects_modified_model_cache() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("model");
        fs::write(&path, b"changed").unwrap();
        let expected = ModelFile {
            name: "model".into(),
            size: 7,
            sha256: "0".repeat(64),
            compression: None,
        };
        assert!(!verified(&path, &expected));
    }

    #[test]
    fn embedded_model_extracts_and_repairs_cache_without_network() {
        let temp = tempfile::tempdir().unwrap();
        let channel = Channel::new(|_| Ok(()));
        let directory = prepare_model(temp.path(), &channel).unwrap();
        let manifest: ModelManifest =
            serde_json::from_str(include_str!("../../../shared/speech-model.json")).unwrap();
        for file in &manifest.files {
            assert!(verified(&directory.join(&file.name), file));
        }
        fs::write(directory.join("tokens.txt"), b"corrupted").unwrap();
        assert_eq!(prepare_model(temp.path(), &channel).unwrap(), directory);
        for file in &manifest.files {
            assert!(verified(&directory.join(&file.name), file));
        }
        assert!(!directory.join("tokens.txt.partial").exists());
        fs::write(directory.join("model.int8.onnx"), b"corrupted").unwrap();
        prepare_model(temp.path(), &channel).unwrap();
        assert!(verified(
            &directory.join(&manifest.files[0].name),
            &manifest.files[0]
        ));
    }

    #[test]
    fn compressed_model_is_bounded_and_rejects_truncation() {
        let manifest: ModelManifest =
            serde_json::from_str(include_str!("../../../shared/speech-model.json")).unwrap();
        let bytes = bundled_model_bytes().unwrap();
        assert!(bytes.len() + 13366 <= 20_100_000);
        let mut entry = manifest.files.into_iter().next().unwrap();
        assert!(extract_bundled(
            &bytes[..bytes.len() / 2],
            &entry,
            &mut std::io::sink(),
            |_| {}
        )
        .is_err());
        entry.size = 1;
        assert!(extract_bundled(bytes, &entry, &mut std::io::sink(), |_| {}).is_err());
    }
}
