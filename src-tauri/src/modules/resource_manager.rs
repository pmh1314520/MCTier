use crate::modules::error::AppError;
use std::path::PathBuf;
use std::fs;
use std::io::Write;
use tauri::Manager;

// 将二进制文件嵌入到可执行文件中
#[allow(dead_code)]
static EASYTIER_CORE_BYTES: &[u8] = include_bytes!("../../resources/binaries/easytier-core.exe");
#[allow(dead_code)]
static PACKET_DLL_BYTES: &[u8] = include_bytes!("../../resources/binaries/Packet.dll");
#[allow(dead_code)]
static WINTUN_DLL_BYTES: &[u8] = include_bytes!("../../resources/binaries/wintun.dll");
#[allow(dead_code)]
static WINDIVERT_SYS_BYTES: &[u8] = include_bytes!("../../resources/binaries/WinDivert64.sys");
#[allow(dead_code)]
static PACKET_LIB_BYTES: &[u8] = include_bytes!("../../resources/binaries/Packet.lib");

/// 资源管理器
/// 
/// 负责管理应用程序的资源文件路径
/// 所有二进制文件都嵌入到exe中，运行时提取到临时目录
pub struct ResourceManager;

impl ResourceManager {
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
            .map_err(|e| {
                AppError::ConfigError(format!("无法获取本地数据目录: {}", e))
            })?
            .join("runtime");
        
        // 确保运行时目录存在
        if !runtime_dir.exists() {
            fs::create_dir_all(&runtime_dir).map_err(|e| {
                AppError::ConfigError(format!("无法创建运行时目录: {}", e))
            })?;
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
        let mut file = fs::File::create(&target_path).map_err(|e| {
            AppError::ConfigError(format!("无法创建文件 {}: {}", filename, e))
        })?;
        
        file.write_all(bytes).map_err(|e| {
            AppError::ConfigError(format!("无法写入文件 {}: {}", filename, e))
        })?;
        
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
        // 在开发模式下，使用相对路径
        #[cfg(debug_assertions)]
        {
            let resource_path = app_handle
                .path()
                .resource_dir()
                .map_err(|e| {
                    AppError::ConfigError(format!("无法获取资源目录: {}", e))
                })?;
            
            let easytier_path = resource_path
                .join("binaries")
                .join("easytier-core.exe");
            
            log::info!("开发模式 - EasyTier 路径: {:?}", easytier_path);
            
            if !easytier_path.exists() {
                return Err(AppError::ConfigError(format!(
                    "EasyTier 可执行文件不存在: {:?}",
                    easytier_path
                )));
            }
            
            Ok(easytier_path)
        }
        
        // 在生产模式下，从嵌入的二进制文件中提取
        #[cfg(not(debug_assertions))]
        {
            Self::extract_binary(app_handle, "easytier-core.exe", EASYTIER_CORE_BYTES)
        }
    }
    
    /// 获取 Packet.dll 的路径
    pub fn get_packet_dll_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, AppError> {
        #[cfg(debug_assertions)]
        {
            let resource_path = app_handle
                .path()
                .resource_dir()
                .map_err(|e| {
                    AppError::ConfigError(format!("无法获取资源目录: {}", e))
                })?;
            Ok(resource_path.join("binaries").join("Packet.dll"))
        }
        
        #[cfg(not(debug_assertions))]
        {
            Self::extract_binary(app_handle, "Packet.dll", PACKET_DLL_BYTES)
        }
    }
    
    /// 获取 wintun.dll 的路径
    pub fn get_wintun_dll_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, AppError> {
        #[cfg(debug_assertions)]
        {
            let resource_path = app_handle
                .path()
                .resource_dir()
                .map_err(|e| {
                    AppError::ConfigError(format!("无法获取资源目录: {}", e))
                })?;
            Ok(resource_path.join("binaries").join("wintun.dll"))
        }
        
        #[cfg(not(debug_assertions))]
        {
            Self::extract_binary(app_handle, "wintun.dll", WINTUN_DLL_BYTES)
        }
    }
    
    /// 获取 WinDivert64.sys 的路径
    pub fn get_windivert_sys_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, AppError> {
        #[cfg(debug_assertions)]
        {
            let resource_path = app_handle
                .path()
                .resource_dir()
                .map_err(|e| {
                    AppError::ConfigError(format!("无法获取资源目录: {}", e))
                })?;
            Ok(resource_path.join("binaries").join("WinDivert64.sys"))
        }
        
        #[cfg(not(debug_assertions))]
        {
            Self::extract_binary(app_handle, "WinDivert64.sys", WINDIVERT_SYS_BYTES)
        }
    }
    
    /// 获取 Packet.lib 的路径
    pub fn get_packet_lib_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, AppError> {
        #[cfg(debug_assertions)]
        {
            let resource_path = app_handle
                .path()
                .resource_dir()
                .map_err(|e| {
                    AppError::ConfigError(format!("无法获取资源目录: {}", e))
                })?;
            Ok(resource_path.join("binaries").join("Packet.lib"))
        }
        
        #[cfg(not(debug_assertions))]
        {
            Self::extract_binary(app_handle, "Packet.lib", PACKET_LIB_BYTES)
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
            .map_err(|e| {
                AppError::ConfigError(format!("无法获取配置目录: {}", e))
            })?;
        
        // 确保配置目录存在
        if !config_dir.exists() {
            std::fs::create_dir_all(&config_dir).map_err(|e| {
                AppError::ConfigError(format!("无法创建配置目录: {}", e))
            })?;
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
            .map_err(|e| {
                AppError::ConfigError(format!("无法获取日志目录: {}", e))
            })?;
        
        // 确保日志目录存在
        if !log_dir.exists() {
            std::fs::create_dir_all(&log_dir).map_err(|e| {
                AppError::ConfigError(format!("无法创建日志目录: {}", e))
            })?;
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
