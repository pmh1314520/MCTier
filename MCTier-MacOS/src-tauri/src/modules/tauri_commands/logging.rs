// Only the Windows branches use `windows_system_command` from shared; other
// platforms open logs via the default handler and reference nothing here.
#[cfg(target_os = "windows")]
use super::shared::*;
use crate::modules::error::{AppError, AppResult};
use std::path::{Path, PathBuf};

fn legacy_result<T>(result: AppResult<T>) -> Result<T, String> {
    // Keep the legacy IPC error text stable while the implementation adopts
    // typed errors internally. New commands can return AppError directly.
    result.map_err(|error| error.inner_message())
}

fn log_data_root() -> AppResult<PathBuf> {
    crate::modules::app_paths::data_root().map_err(|error| AppError::ConfigError(error.to_string()))
}

fn log_file_path() -> AppResult<PathBuf> {
    crate::modules::app_paths::log_path().map_err(|error| AppError::ConfigError(error.to_string()))
}

fn require_existing_path(path: &Path, missing_message: &str) -> AppResult<()> {
    if path.exists() {
        Ok(())
    } else {
        Err(AppError::FileError(missing_message.to_string()))
    }
}

fn open_log_folder_impl() -> AppResult<()> {
    let log_path = log_data_root()?;
    log::info!("日志文件夹路径: {:?}", log_path);
    require_existing_path(&log_path, "日志文件夹不存在")?;

    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        Command::new(windows_system_command("explorer.exe"))
            .arg(&log_path)
            .spawn()
            .map(|_| ())
            .map_err(|error| AppError::ProcessError(format!("打开日志文件夹失败: {error}")))
    }

    #[cfg(not(target_os = "windows"))]
    {
        // macOS 用 open（Finder），Linux 用 xdg-open；路径由 app_paths 决定，不受输入控制。
        use std::process::Command;
        let opener = if cfg!(target_os = "macos") { "open" } else { "xdg-open" };
        let opener = unix_system_command(opener).map_err(AppError::ProcessError)?;
        Command::new(opener)
            .arg(&log_path)
            .spawn()
            .map(|_| ())
            .map_err(|error| AppError::ProcessError(format!("打开日志文件夹失败: {error}")))
    }
}

fn open_log_file_impl() -> AppResult<()> {
    let log_path = log_file_path()?;
    log::info!("日志文件路径: {:?}", log_path);
    require_existing_path(&log_path, "日志文件不存在")?;

    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        Command::new(windows_system_command("notepad.exe"))
            .arg(&log_path)
            .spawn()
            .map(|_| ())
            .map_err(|error| AppError::ProcessError(format!("打开日志文件失败: {error}")))
    }

    #[cfg(not(target_os = "windows"))]
    {
        // 交给系统默认文本处理器：macOS 是 open，Linux 是 xdg-open。
        use std::process::Command;
        let opener = if cfg!(target_os = "macos") { "open" } else { "xdg-open" };
        let opener = unix_system_command(opener).map_err(AppError::ProcessError)?;
        Command::new(opener)
            .arg(&log_path)
            .spawn()
            .map(|_| ())
            .map_err(|error| AppError::ProcessError(format!("打开日志文件失败: {error}")))
    }
}

#[cfg(not(target_os = "windows"))]
use super::shared::unix_system_command;

/// 打开日志文件所在的文件夹
///
/// # 返回
/// * `Ok(())` - 成功
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn open_log_folder() -> Result<(), String> {
    log::info!("打开日志文件夹");
    let result = open_log_folder_impl();
    if let Err(error) = &result {
        log::error!("❌ 打开日志文件夹失败: {}", error);
    } else {
        log::info!("✅ 成功打开日志文件夹");
    }
    legacy_result(result)
}

/// 打开日志文件（使用默认文本编辑器）
///
/// # 返回
/// * `Ok(())` - 成功
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn open_log_file() -> Result<(), String> {
    log::info!("打开日志文件");
    let result = open_log_file_impl();
    if let Err(error) = &result {
        log::error!("❌ 打开日志文件失败: {}", error);
    } else {
        log::info!("✅ 成功打开日志文件");
    }
    legacy_result(result)
}

/// 获取日志文件路径
///
/// # 返回
/// * `Ok(String)` - 日志文件路径
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn get_log_file_path() -> Result<String, String> {
    legacy_result(log_file_path().map(|path| path.to_string_lossy().into_owned()))
}

/// 读取最近的运行日志，供设置页内查看。仅返回末尾内容，避免日志过大阻塞界面。
#[tauri::command]
pub async fn read_log_file() -> Result<String, String> {
    let result = async {
        let log_path = log_file_path()?;
        tokio::task::spawn_blocking(move || crate::modules::logs::read_recent_log(&log_path))
            .await
            .map_err(|error| AppError::ProcessError(format!("读取日志失败: {error}")))?
            .map_err(|error| AppError::FileError(format!("读取日志失败: {error}")))
    }
    .await;
    legacy_result(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_adapter_preserves_human_readable_errors() {
        let result: Result<(), String> =
            legacy_result(Err(AppError::FileError("日志文件不存在".to_string())));

        assert_eq!(result.unwrap_err(), "日志文件不存在");
    }

    #[test]
    fn missing_log_path_has_a_structured_file_error() {
        let directory = tempfile::tempdir().unwrap();
        assert!(require_existing_path(directory.path(), "日志文件夹不存在").is_ok());

        let error = require_existing_path(&directory.path().join("missing.log"), "日志文件不存在")
            .unwrap_err();

        assert_eq!(
            serde_json::to_value(error).unwrap(),
            serde_json::json!({
                "code": "file",
                "message": "日志文件不存在",
                "retryable": false
            })
        );
    }
}
