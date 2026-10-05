use super::shared::*;

// ==================== 文件共享操作命令 ====================

use serde::{Deserialize, Serialize};

use std::path::Path;

/// 文件信息结构
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileInfo {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub size: u64,
    pub modified_time: u64,
}

/// 获取文件夹名称
///
/// # 参数
/// * `path` - 文件夹路径
///
/// # 返回
/// * `Ok(String)` - 文件夹名称
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn get_folder_name(path: String) -> Result<String, String> {
    log::info!("获取文件夹名称: {}", path);

    let path_obj = require_existing_directory_grant(&path, PathAccess::ReadDirectory)?;

    if let Some(name) = path_obj.file_name() {
        if let Some(name_str) = name.to_str() {
            Ok(name_str.to_string())
        } else {
            Err("无法转换文件夹名称".to_string())
        }
    } else {
        Err("无效的文件夹路径".to_string())
    }
}

/// 获取文件夹信息（文件数量和总大小）
///
/// # 参数
/// * `path` - 文件夹路径
///
/// # 返回
/// * `Ok((file_count, total_size))` - 文件数量和总大小
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn get_folder_info(path: String) -> Result<serde_json::Value, String> {
    log::info!("获取文件夹信息: {}", path);
    let path_obj = require_existing_directory_grant(&path, PathAccess::ReadDirectory)?;

    let (file_count, total_size) =
        count_files_and_size(&path_obj).map_err(|e| format!("统计文件失败: {}", e))?;

    Ok(serde_json::json!({
        "fileCount": file_count,
        "totalSize": total_size,
    }))
}

/// 递归统计文件数量和总大小
pub(crate) fn count_files_and_size(path: &Path) -> std::io::Result<(usize, u64)> {
    let mut file_count: usize = 0;
    let mut total_size: u64 = 0;

    let metadata = std::fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() {
        return Ok((0, 0));
    }
    if metadata.is_file() {
        file_count = 1;
        total_size = metadata.len();
    } else if metadata.is_dir() {
        for entry in std::fs::read_dir(path)? {
            let entry = entry?;
            let entry_path = entry.path();

            let entry_metadata = std::fs::symlink_metadata(&entry_path)?;
            if is_symlink_or_reparse_point(&entry_metadata) {
                continue;
            }

            let (count, size) = count_files_and_size(&entry_path)?;
            file_count = file_count.saturating_add(count);
            total_size = total_size.saturating_add(size);
        }
    }

    Ok((file_count, total_size))
}

/// 列出目录中的文件和文件夹
///
/// # 参数
/// * `path` - 目录路径
///
/// # 返回
/// * `Ok(Vec<FileInfo>)` - 文件列表
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn list_directory_files(path: String) -> Result<Vec<FileInfo>, String> {
    log::info!("📂 列出目录文件: {}", path);
    let path_obj = require_existing_directory_grant(&path, PathAccess::ReadDirectory)?;

    let mut files = Vec::new();

    let entries = std::fs::read_dir(&path_obj).map_err(|e| format!("读取目录失败: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("读取条目失败: {}", e))?;
        let entry_path = entry.path();

        let metadata =
            std::fs::symlink_metadata(&entry_path).map_err(|e| format!("获取元数据失败: {}", e))?;
        if is_symlink_or_reparse_point(&metadata) {
            log::warn!("跳过目录中的符号链接或重解析点: {}", entry_path.display());
            continue;
        }

        let name = entry.file_name().to_str().unwrap_or("未知").to_string();

        let relative_path = entry_path
            .strip_prefix(&path_obj)
            .unwrap_or(&entry_path)
            .to_str()
            .unwrap_or("")
            .to_string();

        let modified_time = metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);

        let is_dir = metadata.is_dir();

        log::info!(
            "  - {}: {} (is_directory: {})",
            if is_dir { "📁" } else { "📄" },
            name,
            is_dir
        );

        files.push(FileInfo {
            name,
            path: relative_path,
            is_directory: is_dir,
            size: metadata.len(),
            modified_time,
        });
    }

    // 按名称排序（文件夹在前）
    files.sort_by(|a, b| {
        if a.is_directory == b.is_directory {
            a.name.cmp(&b.name)
        } else if a.is_directory {
            std::cmp::Ordering::Less
        } else {
            std::cmp::Ordering::Greater
        }
    });

    log::info!("✅ 返回 {} 个文件/文件夹", files.len());

    Ok(files)
}

/// 读取文件内容（字节数组）
///
/// # 参数
/// * `path` - 文件路径
///
/// # 返回
/// * `Ok(Vec<u8>)` - 文件内容
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn read_file_bytes(path: String) -> Result<Vec<u8>, String> {
    log::info!("读取文件: {}", path);

    const MAX_GENERIC_FILE_BYTES: u64 = 256 * 1024 * 1024;
    let path_obj = require_existing_file_grant(&path, PathAccess::ReadFile)?;
    let metadata =
        std::fs::symlink_metadata(&path_obj).map_err(|e| format!("检查文件失败: {}", e))?;
    if metadata.len() > MAX_GENERIC_FILE_BYTES {
        return Err("文件超过通用读取大小限制".to_string());
    }

    std::fs::read(path_obj).map_err(|e| format!("读取文件失败: {}", e))
}

/// 写入文件内容（字节数组）
///
/// # 参数
/// * `path` - 文件路径
/// * `data` - 文件内容
///
/// # 返回
/// * `Ok(())` - 写入成功
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn write_file_bytes(path: String, data: Vec<u8>) -> Result<(), String> {
    log::info!("写入文件: {} ({} 字节)", path, data.len());

    const MAX_GENERIC_FILE_BYTES: usize = 256 * 1024 * 1024;
    if data.len() > MAX_GENERIC_FILE_BYTES {
        return Err("文件超过通用写入大小限制".to_string());
    }
    let path_obj = require_path_grant(&path, PathAccess::WriteFile, true)?;
    if path_obj.exists() {
        return Err("目标文件已存在，拒绝覆盖".to_string());
    }

    use tokio::io::AsyncWriteExt;
    let mut file = tokio::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path_obj)
        .await
        .map_err(|e| format!("创建文件失败: {}", e))?;
    file.write_all(&data)
        .await
        .map_err(|e| format!("写入文件失败: {}", e))?;
    file.sync_all()
        .await
        .map_err(|e| format!("同步文件失败: {}", e))
}

/// 选择文件夹
///
/// # 返回
/// * `Ok(Option<String>)` - 选择的文件夹路径，None表示取消
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn select_folder() -> Result<Option<String>, String> {
    log::info!("打开文件夹选择对话框");

    use rfd::FileDialog;

    let result = FileDialog::new()
        .set_title("选择要共享的文件夹")
        .pick_folder();

    if let Some(path) = result {
        if let Some(path_str) = path.to_str() {
            register_path_grant(path_str, PathAccess::ReadDirectory, false)?;
            register_path_grant(path_str, PathAccess::Open, false)?;
            log::info!("用户选择了文件夹: {}", path_str);
            Ok(Some(path_str.to_string()))
        } else {
            Err("无法转换文件夹路径".to_string())
        }
    } else {
        log::info!("用户取消了选择");
        Ok(None)
    }
}

/// 选择文件夹共享下载目录
#[tauri::command]
pub async fn select_file_share_download_folder() -> Result<Option<String>, String> {
    log::info!("打开文件共享下载目录选择对话框");
    use rfd::FileDialog;

    let result = FileDialog::new()
        .set_title("选择文件共享下载目录")
        .pick_folder();

    result
        .map(|path| {
            let value = path
                .to_str()
                .ok_or_else(|| "无法转换下载目录路径".to_string())?;
            register_path_grant(value, PathAccess::WriteDirectory, false)?;
            register_path_grant(value, PathAccess::Open, false)?;
            Ok(value.to_string())
        })
        .transpose()
}

pub(crate) fn default_file_share_download_dir() -> std::path::PathBuf {
    dirs::download_dir()
        .or_else(dirs::home_dir)
        .or_else(dirs::data_local_dir)
        .unwrap_or_else(std::env::temp_dir)
        .join("MCTier")
}

pub(crate) fn effective_file_share_download_dir(config: &UserConfig) -> std::path::PathBuf {
    config
        .file_share_download_dir
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .map(std::path::PathBuf::from)
        .unwrap_or_else(default_file_share_download_dir)
}

/// Resolve the download directory through the same authorization path used by
/// all generic filesystem commands. A persisted custom directory is only
/// usable after the native picker has granted it in this process; otherwise a
/// modified config file could turn a filename-only download helper into an
/// arbitrary directory writer.
pub(crate) fn prepare_file_share_download_dir(
    config: &UserConfig,
) -> Result<std::path::PathBuf, String> {
    if config
        .file_share_download_dir
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty())
    {
        let directory = effective_file_share_download_dir(config);
        let directory = require_existing_directory_grant(
            directory
                .to_str()
                .ok_or_else(|| "无法转换下载目录路径".to_string())?,
            PathAccess::WriteDirectory,
        )
        .map_err(|_| "自定义下载目录需要在本次运行中重新选择".to_string())?;
        register_path_grant(
            directory
                .to_str()
                .ok_or_else(|| "无法转换下载目录路径".to_string())?,
            PathAccess::ReadDirectory,
            false,
        )?;
        register_path_grant(
            directory
                .to_str()
                .ok_or_else(|| "无法转换下载目录路径".to_string())?,
            PathAccess::Open,
            false,
        )?;
        return Ok(directory);
    }

    let directory = default_file_share_download_dir();
    std::fs::create_dir_all(&directory).map_err(|e| format!("创建下载目录失败: {}", e))?;
    let directory = register_path_grant(
        directory
            .to_str()
            .ok_or_else(|| "无法转换下载目录路径".to_string())?,
        PathAccess::ReadDirectory,
        false,
    )?;
    register_path_grant(
        directory
            .to_str()
            .ok_or_else(|| "无法转换下载目录路径".to_string())?,
        PathAccess::WriteDirectory,
        false,
    )?;
    register_path_grant(
        directory
            .to_str()
            .ok_or_else(|| "无法转换下载目录路径".to_string())?,
        PathAccess::Open,
        false,
    )?;
    Ok(directory)
}

pub(crate) fn validate_download_file_name(file_name: &str) -> Result<&str, String> {
    if file_name.is_empty()
        || file_name == "."
        || file_name == ".."
        || file_name.contains('\0')
        || file_name.contains('/')
        || file_name.contains('\\')
        || file_name.contains(':')
        || file_name.chars().any(char::is_control)
        || file_name
            .chars()
            .any(|ch| matches!(ch, '<' | '>' | '"' | '|' | '?' | '*'))
    {
        return Err("文件名无效".to_string());
    }

    let trimmed = file_name.trim_end_matches([' ', '.']);
    if trimmed.is_empty() || trimmed != file_name {
        return Err("文件名无效".to_string());
    }

    let stem = file_name
        .split('.')
        .next()
        .unwrap_or("")
        .to_ascii_uppercase();
    if matches!(
        stem.as_str(),
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
    ) {
        return Err("文件名无效".to_string());
    }

    Ok(file_name)
}

/// 获取文件夹共享的有效下载目录。目录不存在时会自动创建。
#[tauri::command]
pub async fn get_file_share_download_dir(state: State<'_, AppState>) -> Result<String, String> {
    let config_manager = state.config_manager().await;
    let cfg_mgr = config_manager.lock().await;
    let directory = prepare_file_share_download_dir(cfg_mgr.get_config())?;
    directory
        .to_str()
        .map(|value| value.to_string())
        .ok_or_else(|| "无法转换下载目录路径".to_string())
}

/// 保存或清除文件夹共享下载目录。传入空字符串或 null 恢复系统默认目录。
#[tauri::command]
pub async fn set_file_share_download_dir(
    path: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let normalized = path
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let normalized = normalized
        .map(|directory| {
            let path = require_existing_directory_grant(&directory, PathAccess::WriteDirectory)?;
            path.to_str()
                .map(|value| value.to_string())
                .ok_or_else(|| "无法转换下载目录路径".to_string())
        })
        .transpose()?;

    let config_manager = state.config_manager().await;
    let mut cfg_mgr = config_manager.lock().await;
    cfg_mgr
        .update_config(|config| {
            config.file_share_download_dir = normalized.clone();
        })
        .await
        .map_err(|e| format!("保存下载目录失败: {}", e))
}

/// 根据文件名生成文件夹共享下载路径，统一处理 Windows 路径分隔符。
#[tauri::command]
pub async fn get_file_share_download_path(
    file_name: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let config_manager = state.config_manager().await;
    let cfg_mgr = config_manager.lock().await;
    let safe_name = validate_download_file_name(&file_name)?;
    let directory = prepare_file_share_download_dir(cfg_mgr.get_config())?;
    let path = directory.join(safe_name);
    if std::fs::symlink_metadata(&path).is_ok() {
        return Err("目标文件已存在".to_string());
    }
    let path = path
        .to_str()
        .ok_or_else(|| "无法转换下载文件路径".to_string())?;
    register_path_grant(path, PathAccess::WriteFile, true)?;
    register_path_grant(path, PathAccess::ReadFile, true)?;
    register_path_grant(path, PathAccess::DeleteFile, true)?;
    register_path_grant(path, PathAccess::Open, true)?;
    Ok(path.to_string())
}

/// 选择保存位置
///
/// # 参数
/// * `default_name` - 默认文件名
///
/// # 返回
/// * `Ok(Option<String>)` - 选择的保存路径，None表示取消
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn select_save_location(default_name: String) -> Result<Option<String>, String> {
    let default_name = validate_download_file_name(&default_name)?;
    log::info!("打开保存位置选择对话框: {}", default_name);

    use rfd::FileDialog;

    let result = FileDialog::new()
        .set_title("选择保存位置")
        .set_file_name(default_name)
        .save_file();

    if let Some(path) = result {
        if let Some(path_str) = path.to_str() {
            register_path_grant(path_str, PathAccess::WriteFile, true)?;
            register_path_grant(path_str, PathAccess::Open, true)?;
            log::info!("用户选择了保存位置: {}", path_str);
            Ok(Some(path_str.to_string()))
        } else {
            Err("无法转换保存路径".to_string())
        }
    } else {
        log::info!("用户取消了选择");
        Ok(None)
    }
}

/// 选择文件
///
/// # 返回
/// * `Ok(Option<String>)` - 选择的文件路径，None表示取消
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn select_file() -> Result<Option<String>, String> {
    log::info!("打开文件选择对话框");

    use rfd::FileDialog;

    let result = FileDialog::new()
        .set_title("选择配置文件")
        .add_filter("JSON 文件", &["json"])
        .pick_file();

    if let Some(path) = result {
        if let Some(path_str) = path.to_str() {
            let path = normalize_local_path(path_str, false)?;
            if path
                .extension()
                .and_then(|extension| extension.to_str())
                .is_none_or(|extension| !extension.eq_ignore_ascii_case("json"))
            {
                return Err("配置文件必须使用 .json 扩展名".to_string());
            }
            register_path_grant(
                path.to_str()
                    .ok_or_else(|| "无法转换文件路径".to_string())?,
                PathAccess::ReadFile,
                false,
            )?;
            register_path_grant(
                path.to_str()
                    .ok_or_else(|| "无法转换文件路径".to_string())?,
                PathAccess::Open,
                false,
            )?;
            log::info!("用户选择了文件: {}", path_str);
            Ok(Some(path_str.to_string()))
        } else {
            Err("无法转换文件路径".to_string())
        }
    } else {
        log::info!("用户取消了选择");
        Ok(None)
    }
}

/// 打开文件所在文件夹并选中文件
///
/// # 参数
/// * `path` - 文件的完整路径
///
/// # 返回
/// * `Ok(())` - 成功打开
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn open_file_location(path: String) -> Result<(), String> {
    log::info!("打开文件位置: {}", path);

    let path = require_existing_file_grant(&path, PathAccess::Open)?;
    use std::process::Command;

    #[cfg(target_os = "windows")]
    {
        // Windows: 使用 explorer.exe /select,<path>
        match Command::new(windows_system_command("explorer.exe"))
            .args(["/select,", path.to_string_lossy().as_ref()])
            .spawn()
        {
            Ok(_) => {
                log::info!("成功打开文件位置");
                Ok(())
            }
            Err(e) => {
                log::error!("打开文件位置失败: {}", e);
                Err(format!("打开文件位置失败: {}", e))
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        // macOS: 使用 open -R <path>
        match Command::new(unix_system_command("open")?)
            .args(["-R", path.to_string_lossy().as_ref()])
            .spawn()
        {
            Ok(_) => {
                log::info!("成功打开文件位置");
                Ok(())
            }
            Err(e) => {
                log::error!("打开文件位置失败: {}", e);
                Err(format!("打开文件位置失败: {}", e))
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        // Linux: 使用 xdg-open 打开父目录
        let path_obj = &path;
        if let Some(parent) = path_obj.parent() {
            if let Some(parent_str) = parent.to_str() {
                match Command::new(unix_system_command("xdg-open")?)
                    .arg(parent_str)
                    .spawn()
                {
                    Ok(_) => {
                        log::info!("成功打开文件位置");
                        Ok(())
                    }
                    Err(e) => {
                        log::error!("打开文件位置失败: {}", e);
                        Err(format!("打开文件位置失败: {}", e))
                    }
                }
            } else {
                Err("无法转换父目录路径".to_string())
            }
        } else {
            Err("无法获取父目录".to_string())
        }
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        Err("不支持的操作系统".to_string())
    }
}

/// 直接打开文件夹
///
/// # 参数
/// * `path` - 文件夹路径
///
/// # 返回
/// * `Ok(())` - 成功打开
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn open_folder(path: String) -> Result<(), String> {
    log::info!("打开文件夹: {}", path);

    let path = require_existing_directory_grant(&path, PathAccess::Open)?;
    use std::process::Command;

    #[cfg(target_os = "windows")]
    {
        // Windows: 直接使用 explorer.exe 打开文件夹
        match Command::new(windows_system_command("explorer.exe"))
            .arg(&path)
            .spawn()
        {
            Ok(_) => {
                log::info!("成功打开文件夹");
                Ok(())
            }
            Err(e) => {
                log::error!("打开文件夹失败: {}", e);
                Err(format!("打开文件夹失败: {}", e))
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        // macOS: 使用 open 打开文件夹
        match Command::new(unix_system_command("open")?)
            .arg(&path)
            .spawn()
        {
            Ok(_) => {
                log::info!("成功打开文件夹");
                Ok(())
            }
            Err(e) => {
                log::error!("打开文件夹失败: {}", e);
                Err(format!("打开文件夹失败: {}", e))
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        // Linux: 使用 xdg-open 打开文件夹
        match Command::new(unix_system_command("xdg-open")?)
            .arg(&path)
            .spawn()
        {
            Ok(_) => {
                log::info!("成功打开文件夹");
                Ok(())
            }
            Err(e) => {
                log::error!("打开文件夹失败: {}", e);
                Err(format!("打开文件夹失败: {}", e))
            }
        }
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        Err("不支持的操作系统".to_string())
    }
}

/// 启动HTTP文件服务器
#[tauri::command]
pub async fn start_file_server(
    virtual_ip: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    log::info!("启动HTTP文件服务器: {}", virtual_ip);

    // Preserve existing serialization with core-gated lifecycle operations.
    let core = state.core.lock().await;
    let file_transfer = core.get_file_transfer();
    let ft_service = file_transfer.lock().await;

    // 先尝试停止旧的服务器（如果存在）
    ft_service.stop_server().await;
    log::info!("已停止旧的HTTP文件服务器（如果存在）");

    // 等待端口完全释放
    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

    // 设置虚拟IP
    ft_service.set_virtual_ip(virtual_ip);

    // 启动服务器
    match ft_service.start_server().await {
        Ok(_) => {
            log::info!("✅ HTTP文件服务器启动成功");
            Ok(())
        }
        Err(e) => {
            log::error!("❌ HTTP文件服务器启动失败: {}", e);
            Err(e.to_string())
        }
    }
}

/// 停止HTTP文件服务器
#[tauri::command]
pub async fn stop_file_server(state: State<'_, AppState>) -> Result<(), String> {
    log::info!("停止HTTP文件服务器");

    // Preserve existing serialization with core-gated lifecycle operations.
    let core = state.core.lock().await;
    let file_transfer = core.get_file_transfer();
    let ft_service = file_transfer.lock().await;

    ft_service.stop_server().await;
    log::info!("✅ HTTP文件服务器已停止");
    Ok(())
}

/// 检查HTTP文件服务器状态
#[tauri::command]
pub async fn check_file_server_status(state: State<'_, AppState>) -> Result<bool, String> {
    let file_transfer = state.file_transfer().await;
    let ft_service = file_transfer.lock().await;

    // 检查服务器句柄是否存在
    let is_running = ft_service.is_running();
    log::info!(
        "📊 HTTP文件服务器状态: {}",
        if is_running { "运行中" } else { "未运行" }
    );
    Ok(is_running)
}

/// 添加共享文件夹
#[tauri::command]
pub async fn add_shared_folder(
    mut share: SharedFolder,
    state: State<'_, AppState>,
) -> Result<(), String> {
    log::info!("📁 添加共享文件夹: {} ({})", share.name, share.id);

    let shared_path = require_existing_directory_grant(&share.path, PathAccess::ReadDirectory)?;
    share.path = shared_path
        .to_str()
        .ok_or_else(|| "无法转换共享目录路径".to_string())?
        .to_string();

    // Preserve existing serialization with core-gated lifecycle operations.
    let core = state.core.lock().await;
    let file_transfer = core.get_file_transfer();
    let ft_service = file_transfer.lock().await;

    // 检查HTTP服务器是否已启动
    let is_running = ft_service.is_running();

    if !is_running {
        log::info!("🚀 首次添加共享，启动HTTP文件服务器...");

        // 启动HTTP服务器
        match ft_service.start_server().await {
            Ok(_) => {
                log::info!("✅ HTTP文件服务器启动成功");
            }
            Err(e) => {
                log::error!("❌ HTTP文件服务器启动失败: {}", e);
                return Err(format!("启动HTTP文件服务器失败: {}", e));
            }
        }
    } else {
        log::info!("📡 HTTP文件服务器已在运行中");
    }

    // 添加共享
    ft_service.add_share(share)
}

/// 删除共享文件夹
#[tauri::command]
pub async fn remove_shared_folder(
    share_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    log::debug!("删除共享文件夹: {}", share_id);

    // Preserve existing serialization with core-gated lifecycle operations.
    let core = state.core.lock().await;
    let file_transfer = core.get_file_transfer();
    let ft_service = file_transfer.lock().await;

    ft_service.remove_share(&share_id)
}

/// 获取本地共享列表
#[tauri::command]
pub async fn get_local_shares(state: State<'_, AppState>) -> Result<Vec<SharedFolder>, String> {
    let file_transfer = state.file_transfer().await;
    let ft_service = file_transfer.lock().await;

    Ok(ft_service.get_shares())
}

/// 清理过期共享
#[tauri::command]
pub async fn cleanup_expired_shares(state: State<'_, AppState>) -> Result<(), String> {
    log::debug!("清理过期共享");

    // Preserve existing serialization with core-gated lifecycle operations.
    let core = state.core.lock().await;
    let file_transfer = core.get_file_transfer();
    let ft_service = file_transfer.lock().await;

    ft_service.cleanup_expired_shares();
    Ok(())
}
