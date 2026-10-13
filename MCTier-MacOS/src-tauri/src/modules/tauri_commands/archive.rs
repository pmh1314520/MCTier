#[cfg(test)]
use super::file_share::validate_download_file_name;
use super::shared::*;

// ==================== 文件下载命令 ====================

// ZIP extraction helpers keep every output path inside the selected directory.
pub(crate) const MAX_ZIP_ENTRIES: usize = 4096;

pub(crate) const MAX_ZIP_ENTRY_UNCOMPRESSED_BYTES: u64 = 512 * 1024 * 1024;

pub(crate) const MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES: u64 = 2 * 1024 * 1024 * 1024;

/// Normalize a ZIP entry using Windows path rules on every platform. Archives
/// are often produced on Linux and extracted on Windows, so backslashes,
/// device names and alternate data stream syntax must be rejected uniformly.
pub(crate) fn safe_zip_entry_path(name: &str) -> Result<(std::path::PathBuf, String), String> {
    if name.is_empty() || name.contains('\0') {
        return Err(format!("拒绝空或包含NUL的ZIP条目: {}", name));
    }

    let normalized = name.replace('\\', "/");
    if normalized.starts_with('/') || normalized.starts_with("//") {
        return Err(format!("拒绝绝对ZIP条目路径: {}", name));
    }

    // ZIP directory entries conventionally end in one slash. Strip only that
    // marker while rejecting repeated separators and empty path components.
    let components_text = normalized.strip_suffix('/').unwrap_or(&normalized);
    if components_text.is_empty() || components_text.ends_with('/') {
        return Err(format!("拒绝不安全的ZIP条目路径: {}", name));
    }

    let mut path = std::path::PathBuf::new();
    let mut components = Vec::new();
    for component in components_text.split('/') {
        if component == "." || component == ".." {
            return Err(format!("拒绝不安全的ZIP条目路径: {}", name));
        }
        if component.chars().any(|ch| ch.is_control())
            || component.contains(':')
            || component
                .chars()
                .any(|ch| matches!(ch, '<' | '>' | '"' | '|' | '?' | '*'))
            || component != component.trim_end_matches([' ', '.'])
            || is_windows_reserved_name(component)
        {
            return Err(format!("拒绝不安全的ZIP条目名称: {}", name));
        }
        path.push(component);
        components.push(component.to_string());
    }

    if components.is_empty() {
        return Err(format!("拒绝空的ZIP条目路径: {}", name));
    }

    let key = components
        .iter()
        .map(|component| component.to_ascii_lowercase())
        .collect::<Vec<_>>()
        .join("/");

    Ok((path, key))
}

pub(crate) fn ensure_no_link_components(path: &std::path::Path) -> Result<(), String> {
    let mut current = std::path::PathBuf::new();
    for component in path.components() {
        current.push(component.as_os_str());
        match std::fs::symlink_metadata(&current) {
            Ok(metadata)
                if is_symlink_or_reparse_point(&metadata)
                    && !is_macos_system_path_alias(&current) =>
            {
                return Err(format!("拒绝经过符号链接或重解析点: {}", current.display()));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => break,
            Err(error) => {
                return Err(format!("检查路径失败 {}: {}", current.display(), error));
            }
        }
    }
    Ok(())
}

pub(crate) fn ensure_safe_zip_directory(
    extraction_root: &std::path::Path,
    relative_path: &std::path::Path,
    created_dirs: &mut Vec<std::path::PathBuf>,
) -> Result<std::path::PathBuf, String> {
    use std::io::ErrorKind;
    use std::path::Component;

    let mut current = extraction_root.to_path_buf();

    for component in relative_path.components() {
        let Component::Normal(component) = component else {
            return Err(format!(
                "ZIP条目包含不安全的目录组件: {}",
                relative_path.display()
            ));
        };

        current.push(component);
        match std::fs::symlink_metadata(&current) {
            Ok(metadata) => {
                if is_symlink_or_reparse_point(&metadata) || !metadata.is_dir() {
                    return Err(format!(
                        "ZIP解压路径包含符号链接、重解析点或非目录项: {}",
                        current.display()
                    ));
                }
            }
            Err(error) if error.kind() == ErrorKind::NotFound => {
                std::fs::create_dir(&current)
                    .map_err(|e| format!("创建目录失败 {}: {}", current.display(), e))?;
                created_dirs.push(current.clone());
            }
            Err(error) => {
                return Err(format!("检查解压目录失败 {}: {}", current.display(), error));
            }
        }

        let canonical = std::fs::canonicalize(&current)
            .map_err(|e| format!("规范化解压目录失败 {}: {}", current.display(), e))?;
        if !canonical.starts_with(extraction_root) {
            return Err(format!("ZIP条目试图写出目标目录: {}", current.display()));
        }
        current = canonical;
    }

    Ok(current)
}

pub(crate) fn extract_zip_archive(
    zip_path: &std::path::Path,
    extract_dir: &std::path::Path,
    requested_total_budget: Option<u64>,
) -> Result<Vec<String>, String> {
    use std::collections::HashSet;
    use std::fs::{File, OpenOptions};
    use std::io::{ErrorKind, Read};
    use zip::ZipArchive;

    let zip_metadata =
        std::fs::symlink_metadata(zip_path).map_err(|e| format!("检查ZIP文件失败: {}", e))?;
    if is_symlink_or_reparse_point(&zip_metadata) || !zip_metadata.is_file() {
        return Err(format!("ZIP路径不是普通本地文件: {}", zip_path.display()));
    }

    ensure_no_link_components(
        extract_dir
            .parent()
            .unwrap_or_else(|| std::path::Path::new(".")),
    )?;
    match std::fs::symlink_metadata(extract_dir) {
        Ok(metadata) => {
            if is_symlink_or_reparse_point(&metadata) || !metadata.is_dir() {
                return Err(format!(
                    "解压目标目录不能是符号链接或非目录: {}",
                    extract_dir.display()
                ));
            }
        }
        Err(error) if error.kind() == ErrorKind::NotFound => {
            std::fs::create_dir_all(extract_dir)
                .map_err(|e| format!("创建解压目标目录失败: {}", e))?;
            ensure_no_link_components(extract_dir)?;
        }
        Err(error) => {
            return Err(format!("检查解压目标目录失败: {}", error));
        }
    }
    let extraction_root =
        std::fs::canonicalize(extract_dir).map_err(|e| format!("规范化解压目标目录失败: {}", e))?;
    let root_metadata = std::fs::symlink_metadata(extract_dir)
        .map_err(|e| format!("检查解压目标目录失败: {}", e))?;
    if is_symlink_or_reparse_point(&root_metadata) || !root_metadata.is_dir() {
        return Err(format!(
            "解压目标目录不能是符号链接或非目录: {}",
            extract_dir.display()
        ));
    }

    let file = File::open(zip_path).map_err(|e| format!("打开ZIP文件失败: {}", e))?;
    let mut archive = ZipArchive::new(file).map_err(|e| format!("读取ZIP文件失败: {}", e))?;

    if archive.len() > MAX_ZIP_ENTRIES {
        return Err(format!("ZIP条目数量超过限制: {}", MAX_ZIP_ENTRIES));
    }

    let total_budget = requested_total_budget
        .unwrap_or(MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES)
        .min(MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES);
    let mut total_uncompressed = 0u64;
    let mut seen = HashSet::new();
    let mut files = HashSet::new();
    let mut plans = Vec::with_capacity(archive.len());

    // Validate every entry before writing anything so a malicious archive
    // cannot leave a partially extracted payload behind.
    for i in 0..archive.len() {
        let entry = archive
            .by_index(i)
            .map_err(|e| format!("读取ZIP条目失败: {}", e))?;
        if entry.is_symlink() {
            return Err(format!("拒绝ZIP中的符号链接条目: {}", entry.name()));
        }

        let (relative_path, key) = safe_zip_entry_path(entry.name())?;
        if !seen.insert(key.clone()) {
            return Err(format!("拒绝ZIP中的重复条目: {}", entry.name()));
        }

        let entry_size = entry.size();
        if entry_size > MAX_ZIP_ENTRY_UNCOMPRESSED_BYTES {
            return Err(format!("ZIP单条目解压大小超过限制: {}", entry.name()));
        }
        total_uncompressed = total_uncompressed
            .checked_add(entry_size)
            .ok_or_else(|| "ZIP总解压大小溢出".to_string())?;
        if total_uncompressed > total_budget {
            return Err(format!("ZIP总解压大小超过预算: {}", total_budget));
        }

        if !entry.is_dir() {
            files.insert(key.clone());
        }
        plans.push((i, relative_path, key, entry.is_dir(), entry_size));
    }

    // Reject a file used as a parent directory before touching the output.
    for key in &files {
        let mut prefix = String::new();
        let parts: Vec<&str> = key.split('/').collect();
        for component in parts.iter().take(parts.len().saturating_sub(1)) {
            if !prefix.is_empty() {
                prefix.push('/');
            }
            prefix.push_str(component);
            if files.contains(&prefix) {
                return Err(format!("ZIP条目文件与目录冲突: {}", key));
            }
        }
    }

    let mut extracted_files = Vec::new();
    let mut created_files = Vec::new();
    let mut created_dirs = Vec::new();
    let extraction_result: Result<(), String> = (|| {
        for (index, relative_path, _key, is_dir, entry_size) in plans {
            let mut entry = archive
                .by_index(index)
                .map_err(|e| format!("读取ZIP条目失败: {}", e))?;

            if is_dir {
                let directory =
                    ensure_safe_zip_directory(&extraction_root, &relative_path, &mut created_dirs)?;
                log::info!("📁 创建目录: {:?}", directory);
                continue;
            }

            let file_name = relative_path
                .file_name()
                .ok_or_else(|| format!("ZIP条目缺少文件名: {}", entry.name()))?;
            let parent_path = relative_path
                .parent()
                .unwrap_or_else(|| std::path::Path::new(""));
            let safe_parent =
                ensure_safe_zip_directory(&extraction_root, parent_path, &mut created_dirs)?;
            let outpath = safe_parent.join(file_name);

            // create_new prevents following a pre-existing symlink/hard link
            // and avoids silently overwriting files in the selected directory.
            let mut outfile = match OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&outpath)
            {
                Ok(file) => file,
                Err(error) if error.kind() == ErrorKind::AlreadyExists => {
                    return Err(format!("目标文件已存在，拒绝覆盖: {}", outpath.display()));
                }
                Err(error) => {
                    return Err(format!("创建文件失败 {}: {}", outpath.display(), error));
                }
            };
            created_files.push(outpath.clone());

            log::info!("📄 解压文件: {:?}", outpath);
            let mut limited_entry = (&mut entry).take(entry_size.saturating_add(1));
            let copied = std::io::copy(&mut limited_entry, &mut outfile)
                .map_err(|e| format!("写入文件失败: {}", e))?;
            if copied != entry_size {
                return Err(format!(
                    "ZIP条目实际解压大小与声明不匹配: {} ({} != {})",
                    entry.name(),
                    copied,
                    entry_size
                ));
            }
            extracted_files.push(outpath.to_string_lossy().to_string());
        }
        Ok(())
    })();

    if let Err(error) = extraction_result {
        for path in created_files.iter().rev() {
            let _ = std::fs::remove_file(path);
        }
        for path in created_dirs.iter().rev() {
            let _ = std::fs::remove_dir(path);
        }
        return Err(error);
    }

    Ok(extracted_files)
}

/// 解压ZIP文件到指定目录
///
/// # 参数
/// * `zip_path` - ZIP文件路径
/// * `extract_dir` - 解压目标目录
/// * `max_total_bytes` - 本次解压允许的最大总字节数；为空时使用硬上限
///
/// # 返回
/// * `Ok(Vec<String>)` - 解压的文件列表
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn extract_zip(
    zip_path: String,
    extract_dir: String,
    max_total_bytes: Option<u64>,
) -> Result<Vec<String>, String> {
    log::info!("📦 解压ZIP文件: {} -> {}", zip_path, extract_dir);

    let zip_path = require_existing_file_grant(&zip_path, PathAccess::ReadFile)?;
    let extract_dir = require_existing_directory_grant(&extract_dir, PathAccess::WriteDirectory)?;

    let extracted_files = tokio::task::spawn_blocking(move || {
        extract_zip_archive(&zip_path, &extract_dir, max_total_bytes)
    })
    .await
    .map_err(|e| format!("解压任务失败: {}", e))??;

    log::info!("✅ ZIP文件解压完成，共 {} 个文件", extracted_files.len());
    Ok(extracted_files)
}

#[cfg(test)]
mod path_security_tests {
    use super::{
        normalize_local_path, overlay_http_host, register_path_grant, require_existing_file_grant,
        validate_download_file_name, PathAccess,
    };

    #[test]
    fn remote_http_targets_stay_inside_the_fixed_overlay() {
        assert_eq!(overlay_http_host("10.126.126.1").unwrap(), "10.126.126.1");
        assert_eq!(
            overlay_http_host("10.126.126.254").unwrap(),
            "10.126.126.254"
        );
        for target in [
            "10.126.126.0",
            "10.126.126.255",
            "10.126.125.1",
            "192.168.1.10",
            "8.8.8.8",
        ] {
            assert!(overlay_http_host(target).is_err(), "accepted {target}");
        }
    }

    #[test]
    fn file_grants_are_required_for_existing_files() {
        let temp = tempfile::tempdir().expect("create temp dir");
        let path = temp.path().join("safe.txt");
        std::fs::write(&path, b"safe").expect("create file");
        let path = path.to_str().expect("UTF-8 path");

        assert!(require_existing_file_grant(path, PathAccess::ReadFile).is_err());
        register_path_grant(path, PathAccess::ReadFile, false).expect("register read grant");
        assert!(require_existing_file_grant(path, PathAccess::ReadFile).is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn new_file_grants_reject_dangling_symlinks() {
        use std::os::unix::fs::symlink;

        let temp = tempfile::tempdir().expect("create temp dir");
        let target = temp.path().join("missing-target");
        let link = temp.path().join("dangling-link");
        symlink(&target, &link).expect("create dangling symlink");

        assert!(normalize_local_path(link.to_str().expect("UTF-8 path"), true).is_err());
    }

    #[test]
    fn download_and_picker_names_reject_path_syntax() {
        for name in [
            "nested/file.txt",
            "nested\\file.txt",
            "payload:stream",
            "bad<name>.txt",
            "trailing.",
            "CON.txt",
        ] {
            assert!(
                validate_download_file_name(name).is_err(),
                "accepted {name:?}"
            );
        }
        assert!(validate_download_file_name("normal-file.txt").is_ok());
    }

    #[cfg(windows)]
    #[test]
    fn local_paths_reject_ads_and_device_names() {
        for path in [r"C:\safe\payload::$DATA", r"C:\safe\CON.txt"] {
            assert!(
                normalize_local_path(path, true).is_err(),
                "accepted {path:?}"
            );
        }
    }
}

#[cfg(test)]
mod zip_extraction_tests {
    use super::extract_zip_archive;
    use std::io::Write;

    fn create_zip(zip_path: &std::path::Path, entries: &[(&str, &[u8])]) {
        let file = std::fs::File::create(zip_path).expect("create test zip");
        let mut writer = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default();

        for (name, contents) in entries {
            writer.start_file(*name, options).expect("start zip entry");
            writer.write_all(contents).expect("write zip entry");
        }

        writer.finish().expect("finish test zip");
    }

    #[test]
    fn extracts_valid_nested_files() {
        let temp = tempfile::tempdir().expect("create temp dir");
        let zip_path = temp.path().join("valid.zip");
        let extract_dir = temp.path().join("output");
        create_zip(&zip_path, &[("nested/file.txt", b"safe")]);

        let extracted =
            extract_zip_archive(&zip_path, &extract_dir, None).expect("extract valid zip");

        assert_eq!(extracted.len(), 1);
        assert_eq!(
            std::fs::read(extract_dir.join("nested/file.txt")).unwrap(),
            b"safe"
        );
    }

    #[test]
    fn rejects_parent_directory_traversal_before_writing() {
        let temp = tempfile::tempdir().expect("create temp dir");
        let zip_path = temp.path().join("traversal.zip");
        let extract_dir = temp.path().join("output");
        create_zip(
            &zip_path,
            &[
                ("safe.txt", b"must not be written"),
                ("../escape.txt", b"pwned"),
            ],
        );

        let error =
            extract_zip_archive(&zip_path, &extract_dir, None).expect_err("reject traversal");

        assert!(error.contains("不安全的ZIP条目路径"));
        assert!(!extract_dir.join("safe.txt").exists());
        assert!(!temp.path().join("escape.txt").exists());
    }

    #[test]
    fn refuses_to_overwrite_existing_files() {
        let temp = tempfile::tempdir().expect("create temp dir");
        let zip_path = temp.path().join("overwrite.zip");
        let extract_dir = temp.path().join("output");
        std::fs::create_dir_all(&extract_dir).unwrap();
        std::fs::write(extract_dir.join("existing.txt"), b"original").unwrap();
        create_zip(&zip_path, &[("existing.txt", b"replacement")]);

        let error =
            extract_zip_archive(&zip_path, &extract_dir, None).expect_err("reject overwrite");

        assert!(error.contains("拒绝覆盖"));
        assert_eq!(
            std::fs::read(extract_dir.join("existing.txt")).unwrap(),
            b"original"
        );
    }

    #[test]
    fn normalizes_backslashes_but_rejects_device_names_and_ads() {
        let temp = tempfile::tempdir().expect("create temp dir");

        let zip_path = temp.path().join("backslash.zip");
        let extract_dir = temp.path().join("backslash-output");
        create_zip(&zip_path, &[(r"nested\file.txt", b"safe")]);
        extract_zip_archive(&zip_path, &extract_dir, None).expect("extract backslash path");
        assert_eq!(
            std::fs::read(extract_dir.join("nested/file.txt")).unwrap(),
            b"safe"
        );

        for (archive_name, label) in [("CON.txt", "device"), ("payload:stream", "ads")] {
            let zip_path = temp.path().join(format!("{}.zip", label));
            let output = temp.path().join(format!("{}-output", label));
            create_zip(&zip_path, &[(archive_name, b"blocked")]);
            let error = extract_zip_archive(&zip_path, &output, None)
                .expect_err("reject Windows-special ZIP name");
            assert!(error.contains("ZIP条目名称"));
            assert!(!output.join(archive_name).exists());
        }
    }

    #[test]
    fn rejects_duplicate_normalized_entries() {
        let temp = tempfile::tempdir().expect("create temp dir");
        let zip_path = temp.path().join("duplicate.zip");
        let extract_dir = temp.path().join("output");
        create_zip(&zip_path, &[("same/txt", b"one"), (r"same\txt", b"two")]);

        let error = extract_zip_archive(&zip_path, &extract_dir, None)
            .expect_err("reject duplicate normalized entries");
        assert!(error.contains("重复条目"));
        assert!(!extract_dir.exists() || std::fs::read_dir(&extract_dir).unwrap().next().is_none());
    }

    #[test]
    fn enforces_requested_uncompressed_budget() {
        let temp = tempfile::tempdir().expect("create temp dir");
        let zip_path = temp.path().join("budget.zip");
        let extract_dir = temp.path().join("output");
        create_zip(&zip_path, &[("payload.bin", b"1234")]);

        let error = extract_zip_archive(&zip_path, &extract_dir, Some(3))
            .expect_err("reject over-budget archive");
        assert!(error.contains("总解压大小超过预算"));
        assert!(!extract_dir.join("payload.bin").exists());
    }

    #[test]
    fn rolls_back_files_created_before_later_failure() {
        let temp = tempfile::tempdir().expect("create temp dir");
        let zip_path = temp.path().join("rollback.zip");
        let extract_dir = temp.path().join("output");
        std::fs::create_dir_all(&extract_dir).unwrap();
        std::fs::write(extract_dir.join("second.txt"), b"original").unwrap();
        create_zip(
            &zip_path,
            &[("first.txt", b"temporary"), ("second.txt", b"blocked")],
        );

        let error = extract_zip_archive(&zip_path, &extract_dir, None)
            .expect_err("reject collision and roll back");
        assert!(error.contains("拒绝覆盖"));
        assert!(!extract_dir.join("first.txt").exists());
        assert_eq!(
            std::fs::read(extract_dir.join("second.txt")).unwrap(),
            b"original"
        );
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlink_extraction_root() {
        use std::os::unix::fs::symlink;

        let temp = tempfile::tempdir().expect("create temp dir");
        let outside = temp.path().join("outside");
        let root = temp.path().join("root");
        std::fs::create_dir_all(&outside).unwrap();
        symlink(&outside, &root).unwrap();
        let zip_path = temp.path().join("root-symlink.zip");
        create_zip(&zip_path, &[("file.txt", b"blocked")]);

        let error = extract_zip_archive(&zip_path, &root, None)
            .expect_err("reject symlink extraction root");
        assert!(error.contains("不能是符号链接"));
        assert!(!outside.join("file.txt").exists());
    }
}

/// 删除文件
///
/// # 参数
/// * `path` - 文件路径
///
/// # 返回
/// * `Ok(())` - 成功
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn delete_file(path: String) -> Result<(), String> {
    log::info!("🗑️ 删除文件: {}", path);

    let path = require_existing_file_grant(&path, PathAccess::DeleteFile)?;
    tokio::fs::remove_file(&path)
        .await
        .map_err(|e| format!("删除文件失败: {}", e))?;

    log::info!("✅ 文件已删除: {}", path.display());
    Ok(())
}

/// 保存文件
///
/// # 参数
/// * `path` - 文件路径
/// * `data` - 文件数据（字节数组）
///
/// # 返回
/// * `Ok(())` - 保存成功
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn save_file(path: String, data: Vec<u8>) -> Result<(), String> {
    log::info!("保存文件: {}, 大小: {} bytes", path, data.len());

    const MAX_GENERIC_FILE_BYTES: usize = 256 * 1024 * 1024;
    if data.len() > MAX_GENERIC_FILE_BYTES {
        return Err("文件超过通用写入大小限制".to_string());
    }
    let path = require_path_grant(&path, PathAccess::WriteFile, true)?;
    if path.exists() {
        return Err("目标文件已存在，拒绝覆盖".to_string());
    }

    use tokio::io::AsyncWriteExt;
    let mut file = tokio::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .await
        .map_err(|e| format!("创建文件失败: {}", e))?;
    file.write_all(&data)
        .await
        .map_err(|e| format!("写入文件失败: {}", e))?;
    file.sync_all()
        .await
        .map_err(|e| format!("同步文件失败: {}", e))?;

    log::info!("✅ 文件保存成功: {}", path.display());
    Ok(())
}

/// 保存聊天图片
///
/// # 参数
/// * `image_data` - Base64编码的图片数据
///
/// # 返回
/// * `Ok(String)` - 保存的文件路径
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn save_chat_image(image_data: String) -> Result<String, String> {
    use base64::{engine::general_purpose, Engine as _};
    use tokio::fs;

    log::info!("保存聊天图片，数据长度: {} bytes", image_data.len());

    if image_data.len() > 14 * 1024 * 1024 {
        return Err("图片大小超出限制".to_string());
    }
    let bytes = general_purpose::STANDARD
        .decode(&image_data)
        .map_err(|e| format!("Base64解码失败: {}", e))?;
    if bytes.is_empty() || bytes.len() > 10 * 1024 * 1024 {
        return Err("图片大小超出限制".to_string());
    }
    let extension = if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        "gif"
    } else if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]) {
        "png"
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        "jpg"
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        "webp"
    } else {
        return Err("不支持的图片格式".to_string());
    };

    log::info!("解码后图片大小: {} bytes", bytes.len());

    // 获取下载目录
    let download_dir = dirs::download_dir().ok_or_else(|| "无法获取下载目录".to_string())?;

    // 生成文件名
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let filename = format!("MCTier_聊天图片_{}.{}", timestamp, extension);

    // 构建完整路径
    let file_path = download_dir.join(filename);
    let path_str = file_path.to_string_lossy().to_string();

    log::info!("保存图片到: {}", path_str);

    // 写入文件
    fs::write(&file_path, bytes)
        .await
        .map_err(|e| format!("写入文件失败: {}", e))?;

    log::info!("✅ 聊天图片保存成功: {}", path_str);
    Ok(path_str)
}

/// 读取文件
///
/// # 参数
/// * `path` - 文件路径
///
/// # 返回
/// * `Ok(Vec<u8>)` - 文件内容
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn read_file(path: String) -> Result<Vec<u8>, String> {
    log::info!("读取文件: {}", path);

    const MAX_GENERIC_FILE_BYTES: u64 = 256 * 1024 * 1024;
    let path = require_existing_file_grant(&path, PathAccess::ReadFile)?;
    let metadata = std::fs::symlink_metadata(&path).map_err(|e| format!("检查文件失败: {}", e))?;
    if metadata.len() > MAX_GENERIC_FILE_BYTES {
        return Err("文件超过通用读取大小限制".to_string());
    }
    let data = tokio::fs::read(&path)
        .await
        .map_err(|e| format!("读取文件失败: {}", e))?;

    log::info!(
        "✅ 文件读取成功: {}, 大小: {} bytes",
        path.display(),
        data.len()
    );
    Ok(data)
}
