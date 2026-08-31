use crate::modules::error::AppError;
use sha2::{Digest, Sha256};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::Manager;

// 将二进制文件嵌入到可执行文件中。
//
// Windows：easytier-core.exe / easytier-cli.exe，外加 2 个驱动类文件
//   （wintun.dll / WinDivert64.sys）。
// Linux：只需 easytier-core / easytier-cli —— 虚拟网卡由内核 TUN
//   （/dev/net/tun）提供，不存在与 wintun/WinDivert 对应的用户态驱动，
//   因此那 2 个文件在 Linux 上既不内嵌也不提取。
//
// 不再内嵌 Npcap 的 Packet.dll：它此前是 easytier-core.exe 的启动期硬依赖
// （PE 导入表静态导入，缺失即 0xC0000135），而该依赖并非功能需要，只是
// pnet_datalink 无条件 #[link(name = "Packet")] 的连带结果。现随 MCTier 重建的
// EasyTier 一并消除，详见 patches/pnet_datalink-0.35.0-no-npcap.patch 与
// THIRD_PARTY_NOTICES.md §8。
#[cfg(windows)]
#[allow(dead_code)]
static EASYTIER_CORE_BYTES: &[u8] = include_bytes!("../../resources/binaries/easytier-core.exe");
#[cfg(windows)]
#[allow(dead_code)]
static EASYTIER_CLI_BYTES: &[u8] = include_bytes!("../../resources/binaries/easytier-cli.exe");
#[cfg(windows)]
#[allow(dead_code)]
static WINTUN_DLL_BYTES: &[u8] = include_bytes!("../../resources/binaries/wintun.dll");
#[cfg(windows)]
#[allow(dead_code)]
static WINDIVERT_SYS_BYTES: &[u8] = include_bytes!("../../resources/binaries/WinDivert64.sys");

#[cfg(not(windows))]
#[allow(dead_code)]
static EASYTIER_CORE_BYTES: &[u8] = include_bytes!("../../resources/binaries/linux/easytier-core");
#[cfg(not(windows))]
#[allow(dead_code)]
static EASYTIER_CLI_BYTES: &[u8] = include_bytes!("../../resources/binaries/linux/easytier-cli");

/// EasyTier 可执行文件名（Windows 带 .exe 扩展名，类 Unix 不带）。
/// 集中成常量，避免路径拼接处散落平台判断。
#[cfg(windows)]
const EASYTIER_CORE_FILE: &str = "easytier-core.exe";
#[cfg(windows)]
const EASYTIER_CLI_FILE: &str = "easytier-cli.exe";
#[cfg(not(windows))]
const EASYTIER_CORE_FILE: &str = "easytier-core";
#[cfg(not(windows))]
const EASYTIER_CLI_FILE: &str = "easytier-cli";

/// 资源管理器
///
/// 负责管理应用程序的资源文件路径
/// 所有二进制文件都嵌入到exe中，运行时提取到临时目录
pub struct ResourceManager;

impl ResourceManager {
    fn embedded_bytes(filename: &str) -> Option<&'static [u8]> {
        match filename {
            #[cfg(windows)]
            "easytier-core.exe" => Some(EASYTIER_CORE_BYTES),
            #[cfg(windows)]
            "easytier-cli.exe" => Some(EASYTIER_CLI_BYTES),
            #[cfg(windows)]
            "wintun.dll" => Some(WINTUN_DLL_BYTES),
            #[cfg(windows)]
            "WinDivert64.sys" => Some(WINDIVERT_SYS_BYTES),
            #[cfg(not(windows))]
            "easytier-core" => Some(EASYTIER_CORE_BYTES),
            #[cfg(not(windows))]
            "easytier-cli" => Some(EASYTIER_CLI_BYTES),
            _ => None,
        }
    }

    fn sha256_hex(bytes: &[u8]) -> String {
        Sha256::digest(bytes)
            .iter()
            .map(|byte| format!("{:02x}", byte))
            .collect()
    }

    fn is_link_or_reparse_point(metadata: &fs::Metadata) -> bool {
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            metadata.file_type().is_symlink() || metadata.file_attributes() & 0x400 != 0
        }

        #[cfg(not(windows))]
        {
            metadata.file_type().is_symlink()
        }
    }

    fn ensure_no_link_components(path: &Path) -> Result<(), AppError> {
        let mut current = path.to_path_buf();
        loop {
            let metadata = fs::symlink_metadata(&current).map_err(|e| {
                AppError::ConfigError(format!("无法检查资源路径 {}: {}", current.display(), e))
            })?;
            if Self::is_link_or_reparse_point(&metadata) {
                return Err(AppError::ConfigError(format!(
                    "资源路径包含符号链接或重解析点: {}",
                    current.display()
                )));
            }
            let Some(parent) = current.parent() else {
                break;
            };
            if parent == current {
                break;
            }
            current = parent.to_path_buf();
        }
        Ok(())
    }

    fn ensure_regular_file(path: &Path) -> Result<(), AppError> {
        Self::ensure_no_link_components(path)?;
        let metadata = fs::symlink_metadata(path).map_err(|e| {
            AppError::ConfigError(format!("无法检查资源文件 {}: {}", path.display(), e))
        })?;
        if Self::is_link_or_reparse_point(&metadata) || !metadata.is_file() {
            return Err(AppError::ConfigError(format!(
                "资源路径不是普通文件: {}",
                path.display()
            )));
        }
        Ok(())
    }

    /// Return the installation-owned runtime directory without creating it.
    /// Windows release bundles use the per-machine resource directory so the
    /// normal renderer process cannot replace privileged EasyTier files.
    pub fn get_runtime_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, AppError> {
        #[cfg(windows)]
        {
            return app_handle
                .path()
                .resource_dir()
                .map(|path| path.join("runtime"))
                .map_err(|e| AppError::ConfigError(format!("无法获取资源目录: {}", e)));
        }

        #[cfg(not(windows))]
        {
            app_handle
                .path()
                .app_local_data_dir()
                .map(|path| path.join("runtime"))
                .map_err(|e| AppError::ConfigError(format!("无法获取本地数据目录: {}", e)))
        }
    }

    /// Verify a materialized resource against the bytes embedded in this
    /// executable. Length-only checks are intentionally not sufficient.
    pub fn verify_embedded_file(path: &Path, filename: &str) -> Result<(), AppError> {
        let expected = Self::embedded_bytes(filename)
            .ok_or_else(|| AppError::ConfigError(format!("未知的嵌入资源: {}", filename)))?;
        Self::ensure_regular_file(path)?;
        let actual = fs::read(path).map_err(|e| {
            AppError::ConfigError(format!("读取资源文件失败 {}: {}", path.display(), e))
        })?;
        if Self::sha256_hex(&actual) != Self::sha256_hex(expected) {
            return Err(AppError::ConfigError(format!(
                "资源完整性校验失败: {}",
                path.display()
            )));
        }
        Ok(())
    }

    /// Atomically materialize one embedded resource and verify it afterwards.
    /// Existing symlinks, reparse points, and non-regular files are rejected.
    pub fn ensure_embedded_file_at(path: &Path, filename: &str) -> Result<PathBuf, AppError> {
        let expected = Self::embedded_bytes(filename)
            .ok_or_else(|| AppError::ConfigError(format!("未知的嵌入资源: {}", filename)))?;
        let parent = path
            .parent()
            .ok_or_else(|| AppError::ConfigError("资源路径缺少父目录".to_string()))?;
        Self::ensure_no_link_components(parent)?;
        let parent_metadata = fs::symlink_metadata(parent)
            .map_err(|e| AppError::ConfigError(format!("检查资源目录失败: {}", e)))?;
        if !parent_metadata.is_dir() {
            return Err(AppError::ConfigError("资源父路径不是目录".to_string()));
        }

        match fs::symlink_metadata(path) {
            Ok(metadata) => {
                if Self::is_link_or_reparse_point(&metadata) || !metadata.is_file() {
                    return Err(AppError::ConfigError(format!(
                        "拒绝覆盖 symlink/reparse/non-regular 资源: {}",
                        path.display()
                    )));
                }
                if Self::sha256_hex(
                    &fs::read(path)
                        .map_err(|e| AppError::ConfigError(format!("读取资源文件失败: {}", e)))?,
                ) == Self::sha256_hex(expected)
                {
                    return Ok(path.to_path_buf());
                }
                fs::remove_file(path).map_err(|e| {
                    AppError::ConfigError(format!("移除旧资源文件失败 {}: {}", path.display(), e))
                })?;
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(AppError::ConfigError(format!(
                    "检查资源文件失败 {}: {}",
                    path.display(),
                    error
                )))
            }
        }

        let temp_path = parent.join(format!(".{}.{}.tmp", filename, std::process::id()));
        let mut temp = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp_path)
            .map_err(|e| AppError::ConfigError(format!("创建临时资源文件失败: {}", e)))?;
        temp.write_all(expected)
            .and_then(|_| temp.sync_all())
            .map_err(|e| AppError::ConfigError(format!("写入资源文件失败: {}", e)))?;
        drop(temp);

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&temp_path, fs::Permissions::from_mode(0o755))
                .map_err(|e| AppError::ConfigError(format!("设置资源权限失败: {}", e)))?;
        }

        if let Err(error) = fs::rename(&temp_path, path) {
            let _ = fs::remove_file(&temp_path);
            return Err(AppError::ConfigError(format!(
                "替换资源文件失败 {}: {}",
                path.display(),
                error
            )));
        }
        Self::verify_embedded_file(path, filename)?;
        Ok(path.to_path_buf())
    }

    #[cfg(debug_assertions)]
    fn find_debug_binary(app_handle: &tauri::AppHandle, filename: &str) -> Option<PathBuf> {
        let mut candidates: Vec<PathBuf> = Vec::new();

        if let Ok(resource_path) = app_handle.path().resource_dir() {
            candidates.push(resource_path.join("binaries").join(filename));
        }

        if let Ok(exe_path) = std::env::current_exe() {
            if let Some(exe_dir) = exe_path.parent() {
                candidates.push(exe_dir.join("binaries").join(filename));
                // 逐段 join 而不是写 "..\..\..\binaries"：反斜杠只有 Windows 认，
                // 在 Linux 上它是合法文件名字符，会拼出一个永不存在的路径。
                let up3 = exe_dir.join("..").join("..").join("..");
                candidates.push(up3.join("binaries").join(filename));
                candidates.push(up3.join("resources").join("binaries").join(filename));
                // Linux 侧二进制放在 resources/binaries/linux/ 下
                #[cfg(not(windows))]
                {
                    candidates.push(exe_dir.join("binaries").join("linux").join(filename));
                    candidates.push(up3.join("binaries").join("linux").join(filename));
                    candidates.push(
                        up3.join("resources")
                            .join("binaries")
                            .join("linux")
                            .join(filename),
                    );
                }
            }
        }

        for candidate in candidates {
            if fs::symlink_metadata(&candidate)
                .ok()
                .is_some_and(|metadata| {
                    !Self::is_link_or_reparse_point(&metadata) && metadata.is_file()
                })
            {
                return Some(candidate);
            }
        }

        None
    }

    /// 获取运行时目录（用于存放提取的二进制文件）
    ///
    /// # 参数
    /// * `app_handle` - Tauri 应用句柄
    ///
    /// # 返回
    /// * `Ok(PathBuf)` - 运行时目录路径
    /// * `Err(AppError)` - 获取路径失败
    #[allow(dead_code)]
    fn get_runtime_dir(app_handle: &tauri::AppHandle) -> Result<PathBuf, AppError> {
        let runtime_dir = Self::get_runtime_path(app_handle)?;

        // 确保运行时目录存在，并拒绝把运行时目录放在链接/reparse point 后面。
        if !runtime_dir.exists() {
            fs::create_dir_all(&runtime_dir)
                .map_err(|e| AppError::ConfigError(format!("无法创建运行时目录: {}", e)))?;
        }

        Self::ensure_no_link_components(&runtime_dir)?;
        let metadata = fs::symlink_metadata(&runtime_dir)
            .map_err(|e| AppError::ConfigError(format!("无法检查运行时目录: {}", e)))?;
        if Self::is_link_or_reparse_point(&metadata) || !metadata.is_dir() {
            return Err(AppError::ConfigError("运行时路径不是普通目录".to_string()));
        }

        Ok(runtime_dir)
    }

    /// 提取嵌入的二进制文件到运行时目录
    ///
    /// # 参数
    /// * `app_handle` - Tauri 应用句柄
    /// * `filename` - 文件名
    /// * `bytes` - 文件内容
    ///
    /// # 返回
    /// * `Ok(PathBuf)` - 提取后的文件路径
    /// * `Err(AppError)` - 提取失败
    #[allow(dead_code)]
    fn extract_binary(
        app_handle: &tauri::AppHandle,
        filename: &str,
        bytes: &[u8],
    ) -> Result<PathBuf, AppError> {
        let runtime_dir = Self::get_runtime_dir(app_handle)?;
        let target_path = runtime_dir.join(filename);
        if bytes != Self::embedded_bytes(filename).unwrap_or(bytes) {
            return Err(AppError::ConfigError(format!(
                "资源内容与嵌入副本不一致: {}",
                filename
            )));
        }
        log::info!("提取嵌入的二进制文件: {} (SHA-256 校验)", filename);
        Self::ensure_embedded_file_at(&target_path, filename)?;
        log::info!("成功提取文件到: {:?}", target_path);
        Ok(target_path)
    }

    /// 获取 EasyTier 可执行文件的路径
    ///
    /// # 参数
    /// * `app_handle` - Tauri 应用句柄
    ///
    /// # 返回
    /// * `Ok(PathBuf)` - EasyTier 可执行文件的完整路径
    /// * `Err(AppError)` - 获取路径失败
    pub fn get_easytier_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, AppError> {
        #[cfg(windows)]
        {
            return Ok(Self::get_runtime_path(app_handle)?.join(EASYTIER_CORE_FILE));
        }

        // 在开发模式下，优先使用 target 目录中的 binaries；不存在时退回到嵌入提取
        #[cfg(debug_assertions)]
        {
            if let Some(path) = Self::find_debug_binary(app_handle, EASYTIER_CORE_FILE) {
                log::info!("开发模式 - 使用 EasyTier 路径: {:?}", path);
                return Ok(path);
            }

            log::warn!("开发模式 - 未找到外部 EasyTier，回退到内嵌资源提取");
            return Self::extract_binary(app_handle, EASYTIER_CORE_FILE, EASYTIER_CORE_BYTES);
        }

        // 在生产模式下，从嵌入的二进制文件中提取
        #[cfg(not(debug_assertions))]
        {
            Self::extract_binary(app_handle, EASYTIER_CORE_FILE, EASYTIER_CORE_BYTES)
        }
    }

    /// 获取 easytier-cli 可执行文件的路径（用于查询对等连接类型 P2P/中继）
    pub fn get_easytier_cli_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, AppError> {
        #[cfg(windows)]
        {
            return Ok(Self::get_runtime_path(app_handle)?.join(EASYTIER_CLI_FILE));
        }

        #[cfg(debug_assertions)]
        {
            if let Some(path) = Self::find_debug_binary(app_handle, EASYTIER_CLI_FILE) {
                return Ok(path);
            }
            return Self::extract_binary(app_handle, EASYTIER_CLI_FILE, EASYTIER_CLI_BYTES);
        }
        #[cfg(not(debug_assertions))]
        {
            Self::extract_binary(app_handle, EASYTIER_CLI_FILE, EASYTIER_CLI_BYTES)
        }
    }

    /// 获取 wintun.dll 的路径（仅 Windows；Linux 走内核 TUN，无此依赖）
    #[cfg(windows)]
    pub fn get_wintun_dll_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, AppError> {
        Ok(Self::get_runtime_path(app_handle)?.join("wintun.dll"))
    }

    /// 获取 WinDivert64.sys 的路径（仅 Windows；Linux 走内核 TUN，无此依赖）
    #[cfg(windows)]
    pub fn get_windivert_sys_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, AppError> {
        Ok(Self::get_runtime_path(app_handle)?.join("WinDivert64.sys"))
    }

    /// 获取配置目录路径
    ///
    /// # 参数
    /// * `app_handle` - Tauri 应用句柄
    ///
    /// # 返回
    /// * `Ok(PathBuf)` - 配置目录路径
    /// * `Err(AppError)` - 获取路径失败
    pub fn get_config_dir(app_handle: &tauri::AppHandle) -> Result<PathBuf, AppError> {
        let config_dir = app_handle
            .path()
            .app_config_dir()
            .map_err(|e| AppError::ConfigError(format!("无法获取配置目录: {}", e)))?;

        // 确保配置目录存在
        if !config_dir.exists() {
            std::fs::create_dir_all(&config_dir)
                .map_err(|e| AppError::ConfigError(format!("无法创建配置目录: {}", e)))?;
        }

        Ok(config_dir)
    }

    /// 获取日志目录路径
    ///
    /// # 参数
    /// * `app_handle` - Tauri 应用句柄
    ///
    /// # 返回
    /// * `Ok(PathBuf)` - 日志目录路径
    /// * `Err(AppError)` - 获取路径失败
    pub fn get_log_dir(app_handle: &tauri::AppHandle) -> Result<PathBuf, AppError> {
        let log_dir = app_handle
            .path()
            .app_log_dir()
            .map_err(|e| AppError::ConfigError(format!("无法获取日志目录: {}", e)))?;

        // 确保日志目录存在
        if !log_dir.exists() {
            std::fs::create_dir_all(&log_dir)
                .map_err(|e| AppError::ConfigError(format!("无法创建日志目录: {}", e)))?;
        }

        Ok(log_dir)
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn test_resource_manager_exists() {
        // 这个测试只是确保模块可以编译
        // 实际的路径测试需要在集成测试中进行
        assert!(true);
    }
}
