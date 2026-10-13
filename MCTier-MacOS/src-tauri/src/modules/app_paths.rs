//! One home for application-owned data. User-selected exports are kept at their chosen paths.
use std::{
    fs, io,
    path::{Path, PathBuf},
};

pub const APP_ID: &str = "com.mctier.app";

pub fn data_root() -> io::Result<PathBuf> {
    dirs::data_local_dir()
        .map(|base| base.join(APP_ID))
        .ok_or_else(|| io::Error::other("无法获取 MCTier 本地数据目录"))
}

pub fn config_path() -> io::Result<PathBuf> {
    Ok(data_root()?.join("mctier_config.json"))
}

pub fn log_path() -> io::Result<PathBuf> {
    Ok(data_root()?.join("mctier.log"))
}

/// Run before opening config, logs or WebView. Never overwrite an existing destination.
pub fn migrate_legacy_data() -> io::Result<()> {
    let root = data_root()?;
    create_plain_directory(&root)?;
    let mut sources = Vec::new();
    if let Some(base) = dirs::config_dir() {
        sources.push((base.join("mctier"), "roaming-mctier"));
        sources.push((base.join(APP_ID), "roaming-app-id"));
    }
    if let Some(base) = dirs::data_local_dir() {
        sources.push((base.join("MCTier"), "local-mctier"));
    }
    if let Some(base) = dirs::cache_dir() {
        sources.push((base.join(APP_ID), "cache-app-id"));
        sources.push((base.join("mctier"), "cache-mctier"));
    }
    for (source, label) in sources {
        if source != root && source.exists() {
            merge_directory(&source, &root, &root.join("legacy-migration").join(label))?;
        }
    }
    Ok(())
}

fn check_plain_path(path: &Path) -> io::Result<()> {
    let meta = fs::symlink_metadata(path)?;
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if meta.file_attributes() & 0x400 != 0 {
            return Err(io::Error::other(format!(
                "迁移时不跟随目录链接: {}",
                path.display()
            )));
        }
    }
    if meta.file_type().is_symlink() {
        return Err(io::Error::other(format!(
            "迁移时不跟随符号链接: {}",
            path.display()
        )));
    }
    Ok(())
}

fn create_plain_directory(path: &Path) -> io::Result<()> {
    // Validate existing parents before creating anything through them.
    for ancestor in path.ancestors() {
        if ancestor.exists() {
            check_plain_path(ancestor)?;
        }
    }
    fs::create_dir_all(path)?;
    check_plain_path(path)
}

fn merge_directory(source: &Path, destination: &Path, conflicts: &Path) -> io::Result<()> {
    check_plain_path(source)?;
    create_plain_directory(destination)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let from = entry.path();
        check_plain_path(&from)?;
        let file_type = entry.file_type()?;
        // FIFO / socket / 设备节点不能迁移：File::open 会一直等在 open() 上直到有另一端，
        // 迁移发生在建窗之前，卡住就等于应用启动不了（macOS 提权助手留下的 stdout.fifo
        // 就会这样）。这类条目原样留在旧目录里，交给用户自行清理。
        if !file_type.is_dir() && !file_type.is_file() {
            log::warn!("迁移时跳过非普通文件: {}", from.display());
            continue;
        }
        let to = destination.join(entry.file_name());
        let backup = conflicts.join(entry.file_name());
        if to.exists() {
            check_plain_path(&to)?;
        }
        if file_type.is_dir() {
            if to.exists() && !to.is_dir() {
                merge_directory(&from, &backup, &backup.with_extension("conflicts"))?;
            } else {
                merge_directory(&from, &to, &backup)?;
            }
        } else if to.exists() {
            // Keep both versions. A prior interrupted copy is safe to retry.
            let mut target = backup.clone();
            let mut suffix = 0;
            while target.exists() {
                check_plain_path(&target)?;
                if target.is_file() && files_equal(&from, &target)? {
                    break;
                }
                suffix += 1;
                target = backup.with_file_name(format!(
                    "{}.{}",
                    entry.file_name().to_string_lossy(),
                    suffix
                ));
            }
            move_file(&from, &target)?;
        } else {
            move_file(&from, &to)?;
        }
    }
    // Only remove an empty legacy directory, never recursively discard old data.
    // 被跳过的非普通文件会让目录保持非空，那不算迁移失败。
    if fs::read_dir(source)?.next().is_none() {
        fs::remove_dir(source)?;
    }
    Ok(())
}

fn move_file(source: &Path, target: &Path) -> io::Result<()> {
    create_plain_directory(
        target
            .parent()
            .ok_or_else(|| io::Error::other("无效迁移路径"))?,
    )?;
    if target.exists() {
        if !files_equal(source, target)? {
            return Err(io::Error::other("迁移目标已存在且内容不同"));
        }
    } else {
        // Publish only a complete, flushed file. A crash must not leave a partial
        // config at the active path; the source remains available until committed.
        let pending =
            target.with_file_name(format!(".migration-{:016x}.tmp", rand::random::<u64>()));
        let result = (|| {
            let mut input = fs::File::open(source)?;
            let mut output = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&pending)?;
            io::copy(&mut input, &mut output)?;
            output.sync_all()?;
            drop(output);
            // Atomic and refuses to replace an existing file, even during two launches.
            match fs::hard_link(&pending, target) {
                Ok(()) => Ok(()),
                Err(error)
                    if error.kind() == io::ErrorKind::AlreadyExists
                        && files_equal(source, target)? =>
                {
                    Ok(())
                }
                Err(error) => Err(error),
            }
        })();
        let _ = fs::remove_file(&pending);
        result?;
    }
    fs::remove_file(source)
}

fn files_equal(left: &Path, right: &Path) -> io::Result<bool> {
    use io::Read;
    if fs::metadata(left)?.len() != fs::metadata(right)?.len() {
        return Ok(false);
    }
    let mut left = io::BufReader::new(fs::File::open(left)?);
    let mut right = io::BufReader::new(fs::File::open(right)?);
    let mut a = [0u8; 65536];
    let mut b = [0u8; 65536];
    loop {
        let count = left.read(&mut a)?;
        if count == 0 {
            return Ok(true);
        }
        right.read_exact(&mut b[..count])?;
        if a[..count] != b[..count] {
            return Ok(false);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 迁移逻辑拒绝跟随符号链接祖先（见 [`check_plain_path`]）。macOS 上
    /// `std::env::temp_dir()` 返回 `/var/folders/...`，而 `/var` 是指向
    /// `/private/var` 的符号链接，直接用会让下面每个用例都以
    /// “迁移时不跟随符号链接: /var” 失败。先把基目录规范化，让祖先链中不含符号链接。
    fn plain_tempdir() -> tempfile::TempDir {
        let base = std::env::temp_dir();
        let base = base.canonicalize().unwrap_or(base);
        tempfile::tempdir_in(base).unwrap()
    }

    #[test]
    fn migration_preserves_config_logs_nested_files_and_conflicts() {
        let temp = plain_tempdir();
        let source = temp.path().join("old");
        let root = temp.path().join(APP_ID);
        fs::create_dir_all(source.join("avatar-cache")).unwrap();
        fs::create_dir_all(&root).unwrap();
        fs::write(source.join("mctier_config.json"), "old config").unwrap();
        fs::write(root.join("mctier_config.json"), "current config").unwrap();
        fs::write(source.join("mctier.log"), "previous log").unwrap();
        fs::write(source.join("quark-support.bin"), b"encrypted legacy session").unwrap();
        fs::write(source.join("avatar-cache/avatar.png"), b"avatar").unwrap();
        let backup = root.join("legacy-migration/old");
        merge_directory(&source, &root, &backup).unwrap();
        assert!(!source.exists());
        assert_eq!(
            fs::read_to_string(root.join("mctier_config.json")).unwrap(),
            "current config"
        );
        assert_eq!(
            fs::read_to_string(backup.join("mctier_config.json")).unwrap(),
            "old config"
        );
        assert_eq!(
            fs::read_to_string(root.join("mctier.log")).unwrap(),
            "previous log"
        );
        assert_eq!(
            fs::read(root.join("avatar-cache/avatar.png")).unwrap(),
            b"avatar"
        );
        assert_eq!(fs::read(root.join("quark-support.bin")).unwrap(), b"encrypted legacy session");
    }

    #[test]
    fn interrupted_migration_and_repeated_conflicts_do_not_overwrite() {
        let temp = plain_tempdir();
        let source = temp.path().join("old");
        let root = temp.path().join("new");
        let backup = root.join("legacy-migration/old");
        fs::create_dir_all(&source).unwrap();
        fs::create_dir_all(&backup).unwrap();
        fs::write(root.join("config"), "current").unwrap();
        fs::write(backup.join("config"), "first").unwrap();
        fs::write(source.join("config"), "second").unwrap();
        merge_directory(&source, &root, &backup).unwrap();
        assert_eq!(
            fs::read_to_string(backup.join("config.1")).unwrap(),
            "second"
        );
        assert_eq!(fs::read_to_string(backup.join("config")).unwrap(), "first");
        fs::create_dir_all(&source).unwrap();
        fs::write(source.join("config"), "second").unwrap();
        merge_directory(&source, &root, &backup).unwrap();
        assert!(!backup.join("config.2").exists());
    }

    /// macOS 提权助手会在旧数据目录里留下 `stdout.fifo`。迁移必须跳过这类非普通文件：
    /// `File::open` 会一直等在 `open()` 上直到出现写端，而迁移发生在建窗之前，卡住就
    /// 等于应用再也启动不了（升级后点图标毫无反应，只能用 Activity Monitor 结束）。
    #[cfg(unix)]
    #[test]
    fn migration_skips_fifo_instead_of_blocking_on_open() {
        let temp = plain_tempdir();
        let source = temp.path().join("old");
        let root = temp.path().join(APP_ID);
        fs::create_dir_all(source.join("privileged")).unwrap();
        fs::create_dir_all(&root).unwrap();
        fs::write(source.join("mctier.log"), "previous log").unwrap();
        let fifo = source.join("privileged/stdout.fifo");
        assert!(std::process::Command::new("mkfifo")
            .arg(&fifo)
            .status()
            .unwrap()
            .success());

        let backup = root.join("legacy-migration/old");
        // 回归前这里会永久阻塞，用超时把「挂死」变成一条明确的失败信息。
        let (thread_source, thread_root, thread_backup) =
            (source.clone(), root.clone(), backup.clone());
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let _ = tx.send(merge_directory(
                &thread_source,
                &thread_root,
                &thread_backup,
            ));
        });
        rx.recv_timeout(std::time::Duration::from_secs(10))
            .expect("迁移在 FIFO 上阻塞：非普通文件应当跳过而不是打开")
            .unwrap();

        assert_eq!(
            fs::read_to_string(root.join("mctier.log")).unwrap(),
            "previous log"
        );
        // FIFO 原样留在旧目录里：不迁移、不删除，目录非空也不算迁移失败。
        assert!(fifo.exists());
        assert!(source.exists());
    }

    #[test]
    fn existing_complete_copy_is_reused_and_conflicting_target_is_not_deleted() {
        let temp = plain_tempdir();
        let source = temp.path().join("source");
        let target = temp.path().join("target");
        fs::write(&source, "complete").unwrap();
        fs::write(&target, "complete").unwrap();
        move_file(&source, &target).unwrap();
        assert!(!source.exists());
        fs::write(&source, "different").unwrap();
        assert!(move_file(&source, &target).is_err());
        assert_eq!(fs::read_to_string(source).unwrap(), "different");
        assert_eq!(fs::read_to_string(target).unwrap(), "complete");
    }
}
