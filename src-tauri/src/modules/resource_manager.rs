use crate::modules::error::AppError;
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use tauri::Manager;

// 将二进制文件嵌入到可执行文件中。
//
// Windows：easytier-core.exe / easytier-cli.exe，外加 3 个驱动类文件
//   （Packet.dll / wintun.dll / WinDivert64.sys）。
// Linux：只需 easytier-core / easytier-cli —— 虚拟网卡由内核 TUN
//   （/dev/net/tun）提供，不存在与 wintun/WinDivert 对应的用户态驱动，
//   因此那 3 个文件在 Linux 上既不内嵌也不提取。
#[cfg(windows)]
#[allow(dead_code)]
static EASYTIER_CORE_BYTES: &[u8] = include_bytes!("../../resources/binaries/easytier-core.exe");
#[cfg(windows)]
#[allow(dead_code)]
static EASYTIER_CLI_BYTES: &[u8] = include_bytes!("../../resources/binaries/easytier-cli.exe");
#[cfg(windows)]
#[allow(dead_code)]
static PACKET_DLL_BYTES: &[u8] = include_bytes!("../../resources/binaries/Packet.dll");
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
            if candidate.exists() {
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
        let runtime_dir = app_handle
            .path()
            .app_local_data_dir()
            .map_err(|e| AppError::ConfigError(format!("无法获取本地数据目录: {}", e)))?
            .join("runtime");

        // 确保运行时目录存在
        if !runtime_dir.exists() {
            fs::create_dir_all(&runtime_dir)
                .map_err(|e| AppError::ConfigError(format!("无法创建运行时目录: {}", e)))?;
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

        // 如果文件已存在且大小一致，跳过提取
        if target_path.exists() {
            if let Ok(metadata) = fs::metadata(&target_path) {
                if metadata.len() == bytes.len() as u64 {
                    log::debug!("文件已存在且大小一致，跳过提取: {:?}", target_path);
                    return Ok(target_path);
                }
            }
        }

        // 提取文件
        log::info!("提取嵌入的二进制文件: {} ({} 字节)", filename, bytes.len());
        let mut file = fs::File::create(&target_path)
            .map_err(|e| AppError::ConfigError(format!("无法创建文件 {}: {}", filename, e)))?;

        file.write_all(bytes)
            .map_err(|e| AppError::ConfigError(format!("无法写入文件 {}: {}", filename, e)))?;

        // 类 Unix：提取出来的文件默认没有可执行位，必须显式补上，否则 spawn 会 EACCES。
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            drop(file);
            fs::set_permissions(&target_path, fs::Permissions::from_mode(0o755)).map_err(|e| {
                AppError::ConfigError(format!("无法设置可执行权限 {}: {}", filename, e))
            })?;
        }

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

    /// 获取 Packet.dll 的路径（仅 Windows；Linux 走内核 TUN，无此依赖）
    #[cfg(windows)]
    pub fn get_packet_dll_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, AppError> {
        #[cfg(debug_assertions)]
        {
            if let Some(path) = Self::find_debug_binary(app_handle, "Packet.dll") {
                return Ok(path);
            }
            return Self::extract_binary(app_handle, "Packet.dll", PACKET_DLL_BYTES);
        }

        #[cfg(not(debug_assertions))]
        {
            Self::extract_binary(app_handle, "Packet.dll", PACKET_DLL_BYTES)
        }
    }

    /// 获取 wintun.dll 的路径（仅 Windows；Linux 走内核 TUN，无此依赖）
    #[cfg(windows)]
    pub fn get_wintun_dll_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, AppError> {
        #[cfg(debug_assertions)]
        {
            if let Some(path) = Self::find_debug_binary(app_handle, "wintun.dll") {
                return Ok(path);
            }
            return Self::extract_binary(app_handle, "wintun.dll", WINTUN_DLL_BYTES);
        }

        #[cfg(not(debug_assertions))]
        {
            Self::extract_binary(app_handle, "wintun.dll", WINTUN_DLL_BYTES)
        }
    }

    /// 获取 WinDivert64.sys 的路径（仅 Windows；Linux 走内核 TUN，无此依赖）
    #[cfg(windows)]
    pub fn get_windivert_sys_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, AppError> {
        #[cfg(debug_assertions)]
        {
            if let Some(path) = Self::find_debug_binary(app_handle, "WinDivert64.sys") {
                return Ok(path);
            }
            return Self::extract_binary(app_handle, "WinDivert64.sys", WINDIVERT_SYS_BYTES);
        }

        #[cfg(not(debug_assertions))]
        {
            Self::extract_binary(app_handle, "WinDivert64.sys", WINDIVERT_SYS_BYTES)
        }
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
