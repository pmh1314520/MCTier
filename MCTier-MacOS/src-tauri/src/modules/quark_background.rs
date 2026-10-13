//! Per-user Windows scheduling. Workers run once without initializing Tauri or a WebView.
use std::{
    fs::{File, OpenOptions, TryLockError},
    path::Path,
    time::Duration,
};

/// The handle owns the OS lock, so it may safely move between async executor threads.
/// Never remove this file: replacing its inode would allow two simultaneous owners.
pub(super) fn try_lock(path: &Path) -> Result<Option<File>, String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|_| "无法创建夸克后台数据目录")?;
    }
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(path)
        .map_err(|_| "无法打开夸克后台互斥文件")?;
    match file.try_lock() {
        Ok(()) => Ok(Some(file)),
        Err(TryLockError::WouldBlock) => Ok(None),
        Err(TryLockError::Error(_)) => Err("无法锁定夸克后台数据".into()),
    }
}

pub(super) async fn wait_for_lock(path: &Path) -> Result<File, String> {
    tokio::time::timeout(Duration::from_secs(180), async {
        loop {
            if let Some(lock) = try_lock(path)? {
                return Ok(lock);
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    })
    .await
    .map_err(|_| "后台转存正在结束，请稍后重试")?
}

#[cfg(windows)]
async fn schedule(enabled: bool, uninstall: bool) -> Result<(), String> {
    // COM apartment lifetime stays on this blocking thread. Registration has no
    // shell subprocess and cannot flash a console or load a user shell profile.
    tokio::task::spawn_blocking(move || super::quark_scheduler::configure(enabled, uninstall))
        .await
        .map_err(|_| "Windows 后台任务配置中断".to_owned())?
}

pub(super) async fn configure(enabled: bool) -> Result<(), String> {
    #[cfg(windows)]
    {
        schedule(enabled, false).await
    }
    #[cfg(not(windows))]
    {
        let _ = enabled;
        Ok(())
    }
}

#[cfg(windows)]
pub fn run_if_requested() -> bool {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    if args.len() != 1 {
        return false;
    }
    let worker = args[0] == "--quark-background";
    let uninstall = args[0] == "--quark-background-uninstall";
    if !worker && !uninstall {
        return false;
    }
    if worker {
        use windows::Win32::System::Threading::{
            GetCurrentProcess, SetPriorityClass, PROCESS_MODE_BACKGROUND_BEGIN,
        };
        // Also lower disk I/O and memory priority. No windows, tray, toast, audio,
        // networking core, WebView, model loading or GUI single-instance activation.
        unsafe {
            let _ = SetPriorityClass(GetCurrentProcess(), PROCESS_MODE_BACKGROUND_BEGIN);
        }
    }
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build();
    let result = match runtime {
        Ok(runtime) => runtime.block_on(async {
            if uninstall {
                schedule(false, true).await
            } else {
                super::app_paths::migrate_legacy_data().map_err(|_| "无法迁移旧版应用数据")?;
                // Bound a broken network run; reservations survive even forced termination.
                tokio::time::timeout(
                    Duration::from_secs(150),
                    super::quark_support::background_check(),
                )
                .await
                .map_err(|_| "夸克后台检查超时".to_owned())?
            }
        }),
        Err(_) => Err("无法启动夸克后台检查".into()),
    };
    // Report failure to Task Scheduler without console output or exposing credentials.
    std::process::exit(if result.is_ok() { 0 } else { 1 });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn independent_handles_exclude_each_other_and_release_on_drop() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("state.lock");
        let first = try_lock(&path).unwrap().unwrap();
        assert!(try_lock(&path).unwrap().is_none());
        drop(first);
        assert!(try_lock(&path).unwrap().is_some());
    }

    #[test]
    fn lock_child_process() {
        let Some(path) = std::env::var_os("MCTIER_TEST_QUARK_LOCK") else {
            return;
        };
        let lock = try_lock(Path::new(&path)).unwrap();
        assert_eq!(
            lock.is_some(),
            std::env::var_os("MCTIER_TEST_QUARK_ACQUIRE").is_some()
        );
    }

    #[test]
    fn different_processes_share_one_lock_and_can_restart() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("跨进程.lock");
        let child = |acquire: bool| {
            let mut command = std::process::Command::new(std::env::current_exe().unwrap());
            command
                .args([
                    "--exact",
                    "modules::quark_background::tests::lock_child_process",
                ])
                .env("MCTIER_TEST_QUARK_LOCK", &path)
                .env_remove("MCTIER_TEST_QUARK_ACQUIRE");
            if acquire {
                command.env("MCTIER_TEST_QUARK_ACQUIRE", "1");
            }
            assert!(command.status().unwrap().success());
        };
        let first = try_lock(&path).unwrap().unwrap();
        child(false);
        drop(first);
        child(true);
    }
}
