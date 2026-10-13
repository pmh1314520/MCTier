use flate2::read::GzDecoder;
use serde::Serialize;
use std::collections::HashSet;
use std::io::Read;
use std::path::Path;
use std::path::PathBuf;
use tauri::path::BaseDirectory;
use tauri::{Emitter, Manager};

const MAGIC: &[u8] = b"MCTIER_EMOJI_PACK_V3\0";
const MAX_EMOJI_COUNT: usize = 2_000;
const MIN_EMOJI_COUNT: usize = 100;
const MAX_GIF_BYTES: usize = 4 * 1024 * 1024;
const MAX_TOTAL_BYTES: usize = 512 * 1024 * 1024;
const MAX_ID_BYTES: usize = 128;
static SYNC_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuiltinEmojiAsset {
    id: String,
    name: String,
    path: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BuiltinEmojiProgress {
    downloaded: usize,
    total: usize,
}

fn emit_progress(app: &tauri::AppHandle, downloaded: usize, total: usize) {
    let _ = app.emit(
        "builtin-emoji-progress",
        BuiltinEmojiProgress { downloaded, total },
    );
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= MAX_ID_BYTES
        && id.chars().all(|character| {
            character.is_ascii_alphanumeric() || character == '_' || character == '-'
        })
}

fn valid_gif(bytes: &[u8]) -> bool {
    bytes.len() >= 6 && (&bytes[..6] == b"GIF87a" || &bytes[..6] == b"GIF89a")
}

fn valid_cached_gif(path: &Path) -> bool {
    let Ok(metadata) = std::fs::metadata(path) else {
        return false;
    };
    if !metadata.is_file() || metadata.len() < 6 || metadata.len() > MAX_GIF_BYTES as u64 {
        return false;
    }
    let Ok(mut file) = std::fs::File::open(path) else {
        return false;
    };
    let mut header = [0u8; 6];
    file.read_exact(&mut header).is_ok() && valid_gif(&header)
}

fn read_index(path: &Path) -> Option<Vec<String>> {
    let metadata = std::fs::metadata(path).ok()?;
    if !metadata.is_file() || metadata.len() > 128 * 1024 {
        return None;
    }
    let text = std::fs::read_to_string(path).ok()?;
    let ids = text
        .lines()
        .filter(|line| !line.is_empty())
        .map(str::to_owned)
        .collect::<Vec<_>>();
    if ids.len() < MIN_EMOJI_COUNT || ids.len() > MAX_EMOJI_COUNT {
        return None;
    }
    let mut unique = HashSet::with_capacity(ids.len());
    if ids
        .iter()
        .any(|id| !valid_id(id) || !unique.insert(id.clone()))
    {
        return None;
    }
    Some(ids)
}

fn assets(cache_dir: &Path, ids: &[String]) -> Vec<BuiltinEmojiAsset> {
    ids.iter()
        .filter(|id| id.as_str() != "1f60d")
        .map(|id| BuiltinEmojiAsset {
            id: format!("builtin-{id}"),
            name: id.clone(),
            path: cache_dir
                .join(format!("{id}.gif"))
                .to_string_lossy()
                .into_owned(),
        })
        .collect()
}

fn completed_cache(cache_dir: &Path) -> Option<Vec<BuiltinEmojiAsset>> {
    let mut ids = read_index(&cache_dir.join("complete-v3.txt"))?;
    if ids.iter().any(|id| id == "1f60d") {
        ids.retain(|id| id != "1f60d");
        let _ = std::fs::remove_file(cache_dir.join("1f60d.gif"));
        let _ = std::fs::write(cache_dir.join("complete-v3.txt"), ids.join("\n"));
    }
    ids.iter()
        .all(|id| valid_cached_gif(&cache_dir.join(format!("{id}.gif"))))
        .then(|| assets(cache_dir, &ids))
}

fn read_u16(input: &mut impl Read) -> Result<u16, String> {
    let mut bytes = [0; 2];
    input
        .read_exact(&mut bytes)
        .map_err(|_| "内置表情资源包已损坏".to_string())?;
    Ok(u16::from_le_bytes(bytes))
}

fn read_u32(input: &mut impl Read) -> Result<u32, String> {
    let mut bytes = [0; 4];
    input
        .read_exact(&mut bytes)
        .map_err(|_| "内置表情资源包已损坏".to_string())?;
    Ok(u32::from_le_bytes(bytes))
}

fn replace_file(source: &Path, destination: &Path) -> Result<(), String> {
    if std::fs::rename(source, destination).is_ok() {
        return Ok(());
    }
    let _ = std::fs::remove_file(destination);
    std::fs::rename(source, destination).map_err(|error| format!("提交内置表情缓存失败: {error}"))
}

fn unpack_reader(
    pack: impl Read,
    cache_dir: &Path,
    progress: impl Fn(usize, usize),
) -> Result<Vec<String>, String> {
    let mut input = GzDecoder::new(std::io::BufReader::new(pack));
    let mut magic = vec![0; MAGIC.len()];
    input
        .read_exact(&mut magic)
        .map_err(|_| "内置表情资源包已损坏".to_string())?;
    if magic != MAGIC {
        return Err("内置表情资源包版本不兼容".into());
    }
    let count = read_u32(&mut input)? as usize;
    if !(MIN_EMOJI_COUNT..=MAX_EMOJI_COUNT).contains(&count) {
        return Err("内置表情数量异常".into());
    }
    progress(0, count);
    let mut ids = Vec::with_capacity(count);
    let mut total_bytes = 0usize;
    for index in 0..count {
        let id_len = read_u16(&mut input)? as usize;
        let gif_len = read_u32(&mut input)? as usize;
        if id_len == 0 || id_len > MAX_ID_BYTES || gif_len < 6 || gif_len > MAX_GIF_BYTES {
            return Err("内置表情资源包条目超出限制".into());
        }
        total_bytes = total_bytes
            .checked_add(gif_len)
            .filter(|size| *size <= MAX_TOTAL_BYTES)
            .ok_or_else(|| "内置表情解压后体积超过限制".to_string())?;
        let mut id_bytes = vec![0; id_len];
        input
            .read_exact(&mut id_bytes)
            .map_err(|_| "内置表情资源包已损坏".to_string())?;
        let id = String::from_utf8(id_bytes).map_err(|_| "内置表情 ID 无效".to_string())?;
        if !valid_id(&id) || ids.iter().any(|existing| existing == &id) {
            return Err("内置表情 ID 无效或重复".into());
        }
        let mut gif = vec![0; gif_len];
        input
            .read_exact(&mut gif)
            .map_err(|_| "内置表情资源包已损坏".to_string())?;
        if !valid_gif(&gif) {
            return Err("内置表情资源包包含无效 GIF".into());
        }
        let temporary = cache_dir.join(format!("{id}.part"));
        std::fs::write(&temporary, gif).map_err(|error| format!("写入内置表情失败: {error}"))?;
        replace_file(&temporary, &cache_dir.join(format!("{id}.gif")))?;
        ids.push(id);
        progress(index + 1, count);
    }
    let mut trailing = [0u8; 1];
    if input
        .read(&mut trailing)
        .map_err(|error| format!("读取内置表情资源失败: {error}"))?
        != 0
    {
        return Err("内置表情资源包包含多余数据".into());
    }
    let temporary_marker = cache_dir.join("complete-v3.tmp");
    std::fs::write(&temporary_marker, ids.join("\n"))
        .map_err(|error| format!("写入内置表情索引失败: {error}"))?;
    replace_file(&temporary_marker, &cache_dir.join("complete-v3.txt"))?;
    Ok(ids)
}

fn unpack_to_cache(
    pack_path: &Path,
    cache_dir: &Path,
    progress: impl Fn(usize, usize),
) -> Result<Vec<String>, String> {
    let pack = std::fs::File::open(pack_path)
        .map_err(|error| format!("无法打开内置表情资源包: {error}"))?;
    unpack_reader(pack, cache_dir, progress)
}

#[cfg(windows)]
fn unpack_embedded_to_cache(
    cache_dir: &Path,
    progress: impl Fn(usize, usize),
) -> Result<Vec<String>, String> {
    use windows::{
        core::{w, PCWSTR},
        Win32::System::LibraryLoader::{
            FindResourceW, GetModuleHandleW, LoadResource, LockResource, SizeofResource,
        },
    };
    unsafe {
        let module = GetModuleHandleW(None).map_err(|error| error.to_string())?;
        let resource = FindResourceW(
            module,
            w!("MCTIER_BUILTIN_EMOJI_PACK"),
            PCWSTR(11usize as *const u16),
        );
        if resource.0.is_null() {
            return Err("安装包缺少内置表情资源，请重新安装 MCTier".into());
        }
        let size = SizeofResource(module, resource) as usize;
        let loaded = LoadResource(module, resource).map_err(|error| error.to_string())?;
        let pointer = LockResource(loaded) as *const u8;
        if pointer.is_null() || size == 0 {
            return Err("无法读取内置表情资源".into());
        }
        unpack_reader(
            std::io::Cursor::new(std::slice::from_raw_parts(pointer, size)),
            cache_dir,
            progress,
        )
    }
}

fn resource_pack_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    let relative = Path::new("builtin-emoji/builtin-v3.pack.gz");
    let mut candidates = Vec::new();
    if let Ok(path) = app.path().resolve(relative, BaseDirectory::Resource) {
        candidates.push(path);
    }
    if let Ok(path) = app.path().resource_dir() {
        candidates.extend([path.join(relative), path.join("resources").join(relative)]);
    }
    if let Ok(executable) = std::env::current_exe() {
        if let Some(parent) = executable.parent() {
            candidates.extend([
                parent.join(relative),
                parent.join("resources").join(relative),
            ]);
        }
    }
    candidates.into_iter().find(|path| path.is_file())
}

#[tauri::command]
pub async fn sync_builtin_emoji(app: tauri::AppHandle) -> Result<Vec<BuiltinEmojiAsset>, String> {
    let _guard = SYNC_LOCK.lock().await;
    let cache_dir = crate::modules::app_paths::data_root()
        .map_err(|error| format!("无法定位应用缓存目录: {error}"))?
        .join("emoji-builtin-v3");
    std::fs::create_dir_all(&cache_dir)
        .map_err(|error| format!("无法创建表情缓存目录: {error}"))?;
    if let Some(cached) = completed_cache(&cache_dir) {
        emit_progress(&app, cached.len(), cached.len());
        return Ok(cached);
    }
    let _ = std::fs::remove_file(cache_dir.join("complete-v3.txt"));
    if let Ok(entries) = std::fs::read_dir(&cache_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path
                .extension()
                .is_some_and(|ext| ext == "gif" || ext == "part" || ext == "tmp")
            {
                let _ = std::fs::remove_file(path);
            }
        }
    }
    let pack_path = resource_pack_path(&app);
    let app_for_progress = app.clone();
    let cache_for_unpack = cache_dir.clone();
    let ids = tokio::task::spawn_blocking(move || {
        let progress = |done, total| emit_progress(&app_for_progress, done, total);
        if let Some(path) = pack_path {
            unpack_to_cache(&path, &cache_for_unpack, progress)
        } else {
            #[cfg(windows)]
            {
                unpack_embedded_to_cache(&cache_for_unpack, progress)
            }
            #[cfg(not(windows))]
            {
                Err("无法定位内置表情资源包，请重新安装应用".to_string())
            }
        }
    })
    .await
    .map_err(|error| format!("解压内置表情任务失败: {error}"))??;
    Ok(assets(&cache_dir, &ids))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_ids_and_gif_headers() {
        assert!(valid_id("1f600"));
        assert!(valid_id("263a-fe0f"));
        assert!(!valid_id("../secret"));
        assert!(valid_gif(b"GIF89a"));
        assert!(valid_gif(b"GIF87a"));
        assert!(!valid_gif(b"<html>"));
    }

    #[test]
    fn completed_cache_rejects_invalid_files() {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let directory = std::env::temp_dir().join(format!("mctier-emoji-{unique}"));
        std::fs::create_dir_all(&directory).unwrap();
        let ids = (0..MIN_EMOJI_COUNT)
            .map(|index| format!("{index:x}"))
            .collect::<Vec<_>>();
        for id in &ids {
            std::fs::write(directory.join(format!("{id}.gif")), b"GIF89a").unwrap();
        }
        std::fs::write(directory.join("complete-v3.txt"), ids.join("\n")).unwrap();
        assert_eq!(completed_cache(&directory).unwrap().len(), MIN_EMOJI_COUNT);
        let mut old_ids = ids.clone();
        old_ids.extend(["1f60d".to_string(), "1f970".to_string()]);
        for id in ["1f60d", "1f970"] { std::fs::write(directory.join(format!("{id}.gif")), b"GIF89a").unwrap(); }
        std::fs::write(directory.join("complete-v3.txt"), old_ids.join("\n")).unwrap();
        let migrated = completed_cache(&directory).unwrap();
        assert_eq!(migrated.len(), MIN_EMOJI_COUNT + 1);
        assert!(migrated.iter().any(|asset| asset.id == "builtin-1f970"));
        assert!(!migrated.iter().any(|asset| asset.id == "builtin-1f60d"));
        assert!(!directory.join("1f60d.gif").exists());
        std::fs::write(directory.join("0.gif"), b"broken").unwrap();
        assert!(completed_cache(&directory).is_none());
        std::fs::remove_dir_all(directory).unwrap();
    }
}
