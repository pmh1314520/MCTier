use crate::modules::error::AppError;
use std::path::PathBuf;
use tauri::Manager;

/// 资源管理器
/// 
/// 负责管理应用程序的资源文件路径
pub struct ResourceManager;

impl ResourceManager {
    /// 获取 EasyTier 可执行文件的路径
    /// 
    /// # 参数
    /// * `app_handle` - Tauri 应用句柄
    /// 
    /// # 返回
    /// * `Ok(PathBuf)` - EasyTier 可执行文件的完整路径
    /// * `Err(AppError)` - 获取路径失败
    pub fn get_easytier_path(_app_handle: &tauri::AppHandle) -> Result<PathBuf, AppError> {
        // 在开发模式下，使用相对路径
        #[cfg(debug_assertions)]
        {
            let resource_path = _app_handle
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
        
        // 在生产模式下，使用 sidecar 路径
        #[cfg(not(debug_assertions))]
        {
            use tauri::utils::platform::current_exe;
            
            // 尝试从 sidecar 获取路径
            let exe_dir = current_exe()
                .map_err(|e| {
                    AppError::ConfigError(format!("无法获取可执行文件目录: {}", e))
                })?
                .parent()
                .ok_or_else(|| {
                    AppError::ConfigError("无法获取父目录".to_string())
                })?
                .to_path_buf();
            
            log::info!("生产模式 - 可执行文件目录: {:?}", exe_dir);
            
            // 尝试多个可能的路径
            let possible_paths = vec![
                exe_dir.join("easytier-core.exe"),
                exe_dir.join("resources").join("binaries").join("easytier-core.exe"),
                exe_dir.join("binaries").join("easytier-core.exe"),
            ];
            
            for path in &possible_paths {
                log::info!("检查 EasyTier 路径: {:?}, 存在: {}", path, path.exists());
                if path.exists() {
                    log::info!("生产模式 - 找到 EasyTier 路径: {:?}", path);
                    return Ok(path.clone());
                }
            }
            
            log::error!("无法找到 EasyTier 可执行文件，已检查的路径: {:?}", possible_paths);
            Err(AppError::ConfigError(
                "无法找到 EasyTier 可执行文件".to_string()
            ))
        }
    }
    
    /// 获取 EasyTier CLI 工具的路径
    /// 
    /// # 参数
    /// * `app_handle` - Tauri 应用句柄
    /// 
    /// # 返回
    /// * `Ok(PathBuf)` - EasyTier CLI 工具的完整路径
    /// * `Err(AppError)` - 获取路径失败
    pub fn get_easytier_cli_path(_app_handle: &tauri::AppHandle) -> Result<PathBuf, AppError> {
        #[cfg(debug_assertions)]
        {
            let resource_path = _app_handle
                .path()
                .resource_dir()
                .map_err(|e| {
                    AppError::ConfigError(format!("无法获取资源目录: {}", e))
                })?;
            
            let cli_path = resource_path
                .join("binaries")
                .join("easytier-cli.exe");
            
            if !cli_path.exists() {
                return Err(AppError::ConfigError(format!(
                    "EasyTier CLI 工具不存在: {:?}",
                    cli_path
                )));
            }
            
            Ok(cli_path)
        }
        
        #[cfg(not(debug_assertions))]
        {
            use tauri::utils::platform::current_exe;
            
            let exe_dir = current_exe()
                .map_err(|e| {
                    AppError::ConfigError(format!("无法获取可执行文件目录: {}", e))
                })?
                .parent()
                .ok_or_else(|| {
                    AppError::ConfigError("无法获取父目录".to_string())
                })?
                .to_path_buf();
            
            let possible_paths = vec![
                exe_dir.join("easytier-cli.exe"),
                exe_dir.join("resources").join("binaries").join("easytier-cli.exe"),
                exe_dir.join("binaries").join("easytier-cli.exe"),
            ];
            
            for path in possible_paths {
                if path.exists() {
                    return Ok(path);
                }
            }
            
            Err(AppError::ConfigError(
                "无法找到 EasyTier CLI 工具".to_string()
            ))
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
