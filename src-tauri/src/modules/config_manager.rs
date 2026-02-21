use crate::modules::error::AppError;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tokio::fs;
use tokio::io::AsyncWriteExt;

/// 窗口位置信息
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WindowPosition {
    /// X 坐标
    pub x: i32,
    /// Y 坐标
    pub y: i32,
    /// 窗口宽度
    pub width: u32,
    /// 窗口高度
    pub height: u32,
}

impl Default for WindowPosition {
    fn default() -> Self {
        Self {
            x: 100,
            y: 100,
            width: 300,
            height: 400,
        }
    }
}

/// 用户配置结构
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct UserConfig {
    /// 玩家名称
    pub player_name: Option<String>,
    /// 首选服务器节点
    pub preferred_server: Option<String>,
    /// 麦克风快捷键
    pub mic_hotkey: Option<String>,
    /// 状态窗口位置
    pub window_position: Option<WindowPosition>,
    /// 音频设备 ID
    pub audio_device_id: Option<String>,
    /// 窗口透明度 (0.0-1.0)，默认 0.95
    pub opacity: Option<f64>,
}

impl Default for UserConfig {
    fn default() -> Self {
        Self {
            player_name: None,
            preferred_server: None,
            mic_hotkey: Some("Ctrl+M".to_string()),
            window_position: Some(WindowPosition::default()),
            audio_device_id: None,
            opacity: Some(0.95),
        }
    }
}

/// 配置管理器
pub struct ConfigManager {
    /// 配置文件路径
    config_path: PathBuf,
    /// 当前配置
    config: UserConfig,
}

impl Default for ConfigManager {
    fn default() -> Self {
        // 获取默认配置路径
        let config_path = Self::get_config_path()
            .unwrap_or_else(|_| PathBuf::from("mctier_config.json"));
        
        Self {
            config_path,
            config: UserConfig::default(),
        }
    }
}

impl ConfigManager {
    /// 配置文件名
    const CONFIG_FILE_NAME: &'static str = "mctier_config.json";

    /// 加载配置管理器（静态方法）
    /// 
    /// # 返回
    /// * `Ok(ConfigManager)` - 成功加载配置管理器
    /// * `Err(AppError)` - 加载失败
    pub async fn load() -> Result<Self, AppError> {
        Self::new().await
    }

    /// 创建新的配置管理器实例
    /// 
    /// # 返回
    /// * `Ok(ConfigManager)` - 成功创建配置管理器
    /// * `Err(AppError)` - 创建失败
    /// 
    /// # 说明
    /// 此方法会尝试从配置文件加载配置，如果文件不存在或损坏，则使用默认配置
    pub async fn new() -> Result<Self, AppError> {
        let config_path = Self::get_config_path()?;
        
        log::info!("配置文件路径: {:?}", config_path);
        
        // 尝试加载配置，如果失败则使用默认配置
        let config = match Self::load_from_file(&config_path).await {
            Ok(cfg) => {
                log::info!("成功加载配置文件");
                cfg
            }
            Err(e) => {
                log::warn!("加载配置文件失败，使用默认配置: {}", e);
                UserConfig::default()
            }
        };

        Ok(Self {
            config_path,
            config,
        })
    }

    /// 获取配置文件路径
    /// 
    /// # 返回
    /// * `Ok(PathBuf)` - 配置文件路径
    /// * `Err(AppError)` - 获取失败
    fn get_config_path() -> Result<PathBuf, AppError> {
        // 获取用户配置目录
        let config_dir = dirs::config_dir()
            .ok_or_else(|| AppError::ConfigError("无法获取配置目录".to_string()))?;

        // 创建应用配置目录
        let app_config_dir = config_dir.join("mctier");
        
        Ok(app_config_dir.join(Self::CONFIG_FILE_NAME))
    }

    /// 从文件加载配置
    /// 
    /// # 参数
    /// * `path` - 配置文件路径
    /// 
    /// # 返回
    /// * `Ok(UserConfig)` - 成功加载的配置
    /// * `Err(AppError)` - 加载失败
    async fn load_from_file(path: &PathBuf) -> Result<UserConfig, AppError> {
        // 检查文件是否存在
        if !path.exists() {
            return Err(AppError::ConfigError("配置文件不存在".to_string()));
        }

        // 读取文件内容
        let content = fs::read_to_string(path).await.map_err(|e| {
            AppError::ConfigError(format!("读取配置文件失败: {}", e))
        })?;

        // 解析 JSON
        let config: UserConfig = serde_json::from_str(&content).map_err(|e| {
            AppError::ConfigError(format!("解析配置文件失败: {}", e))
        })?;

        Ok(config)
    }

    /// 保存配置到文件
    /// 
    /// # 返回
    /// * `Ok(())` - 保存成功
    /// * `Err(AppError)` - 保存失败
    pub async fn save(&self) -> Result<(), AppError> {
        // 确保配置目录存在
        if let Some(parent) = self.config_path.parent() {
            fs::create_dir_all(parent).await.map_err(|e| {
                AppError::ConfigError(format!("创建配置目录失败: {}", e))
            })?;
        }

        // 序列化配置为 JSON（格式化输出，便于阅读）
        let json_content = serde_json::to_string_pretty(&self.config).map_err(|e| {
            AppError::ConfigError(format!("序列化配置失败: {}", e))
        })?;

        // 写入文件（使用临时文件 + 原子重命名，防止写入过程中断导致文件损坏）
        let temp_path = self.config_path.with_extension("json.tmp");
        
        let mut file = fs::File::create(&temp_path).await.map_err(|e| {
            AppError::ConfigError(format!("创建临时配置文件失败: {}", e))
        })?;

        file.write_all(json_content.as_bytes()).await.map_err(|e| {
            AppError::ConfigError(format!("写入配置文件失败: {}", e))
        })?;

        file.sync_all().await.map_err(|e| {
            AppError::ConfigError(format!("同步配置文件失败: {}", e))
        })?;

        drop(file);

        // 原子重命名
        fs::rename(&temp_path, &self.config_path).await.map_err(|e| {
            AppError::ConfigError(format!("重命名配置文件失败: {}", e))
        })?;

        log::info!("配置已保存到: {:?}", self.config_path);

        Ok(())
    }

    /// 获取当前配置的引用
    /// 
    /// # 返回
    /// 当前配置的不可变引用
    pub fn get_config(&self) -> &UserConfig {
        &self.config
    }

    /// 获取当前配置的克隆
    /// 
    /// # 返回
    /// 当前配置的克隆副本
    pub fn get_config_clone(&self) -> UserConfig {
        self.config.clone()
    }

    /// 更新配置
    /// 
    /// # 参数
    /// * `updater` - 配置更新函数，接收可变配置引用
    /// 
    /// # 返回
    /// * `Ok(())` - 更新成功
    /// * `Err(AppError)` - 更新失败
    /// 
    /// # 示例
    /// ```rust
    /// manager.update_config(|config| {
    ///     config.player_name = Some("新玩家".to_string());
    /// }).await?;
    /// ```
    pub async fn update_config<F>(&mut self, updater: F) -> Result<(), AppError>
    where
        F: FnOnce(&mut UserConfig),
    {
        // 应用更新
        updater(&mut self.config);
        
        // 立即保存到文件
        self.save().await?;
        
        log::info!("配置已更新并保存");
        
        Ok(())
    }

    /// 设置玩家名称
    /// 
    /// # 参数
    /// * `name` - 玩家名称
    /// 
    /// # 返回
    /// * `Ok(())` - 设置成功
    /// * `Err(AppError)` - 设置失败
    pub async fn set_player_name(&mut self, name: String) -> Result<(), AppError> {
        self.update_config(|config| {
            config.player_name = Some(name);
        }).await
    }

    /// 设置首选服务器
    /// 
    /// # 参数
    /// * `server` - 服务器地址
    /// 
    /// # 返回
    /// * `Ok(())` - 设置成功
    /// * `Err(AppError)` - 设置失败
    pub async fn set_preferred_server(&mut self, server: String) -> Result<(), AppError> {
        self.update_config(|config| {
            config.preferred_server = Some(server);
        }).await
    }

    /// 设置麦克风快捷键
    /// 
    /// # 参数
    /// * `hotkey` - 快捷键字符串
    /// 
    /// # 返回
    /// * `Ok(())` - 设置成功
    /// * `Err(AppError)` - 设置失败
    pub async fn set_mic_hotkey(&mut self, hotkey: String) -> Result<(), AppError> {
        self.update_config(|config| {
            config.mic_hotkey = Some(hotkey);
        }).await
    }

    /// 设置窗口位置
    /// 
    /// # 参数
    /// * `position` - 窗口位置信息
    /// 
    /// # 返回
    /// * `Ok(())` - 设置成功
    /// * `Err(AppError)` - 设置失败
    pub async fn set_window_position(&mut self, position: WindowPosition) -> Result<(), AppError> {
        self.update_config(|config| {
            config.window_position = Some(position);
        }).await
    }

    /// 设置音频设备 ID
    /// 
    /// # 参数
    /// * `device_id` - 音频设备 ID
    /// 
    /// # 返回
    /// * `Ok(())` - 设置成功
    /// * `Err(AppError)` - 设置失败
    pub async fn set_audio_device_id(&mut self, device_id: String) -> Result<(), AppError> {
        self.update_config(|config| {
            config.audio_device_id = Some(device_id);
        }).await
    }

    /// 设置窗口透明度
    /// 
    /// # 参数
    /// * `opacity` - 透明度值 (0.0-1.0)
    /// 
    /// # 返回
    /// * `Ok(())` - 设置成功
    /// * `Err(AppError)` - 设置失败
    pub async fn set_opacity(&mut self, opacity: f64) -> Result<(), AppError> {
        // 验证透明度范围
        let clamped_opacity = opacity.clamp(0.0, 1.0);
        
        self.update_config(|config| {
            config.opacity = Some(clamped_opacity);
        }).await
    }

    /// 重置为默认配置
    /// 
    /// # 返回
    /// * `Ok(())` - 重置成功
    /// * `Err(AppError)` - 重置失败
    pub async fn reset_to_default(&mut self) -> Result<(), AppError> {
        self.config = UserConfig::default();
        self.save().await?;
        
        log::info!("配置已重置为默认值");
        
        Ok(())
    }

    /// 备份当前配置文件
    /// 
    /// # 返回
    /// * `Ok(PathBuf)` - 备份文件路径
    /// * `Err(AppError)` - 备份失败
    pub async fn backup_config(&self) -> Result<PathBuf, AppError> {
        if !self.config_path.exists() {
            return Err(AppError::ConfigError("配置文件不存在，无法备份".to_string()));
        }

        // 生成备份文件名（带时间戳）
        let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S");
        let backup_path = self.config_path.with_file_name(
            format!("mctier_config_backup_{}.json", timestamp)
        );

        // 复制文件
        fs::copy(&self.config_path, &backup_path).await.map_err(|e| {
            AppError::ConfigError(format!("备份配置文件失败: {}", e))
        })?;

        log::info!("配置已备份到: {:?}", backup_path);

        Ok(backup_path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    /// 创建临时配置管理器用于测试
    async fn create_test_config_manager(temp_dir: &TempDir) -> ConfigManager {
        let config_path = temp_dir.path().join("test_config.json");
        ConfigManager {
            config_path,
            config: UserConfig::default(),
        }
    }

    #[tokio::test]
    async fn test_default_config() {
        let config = UserConfig::default();
        
        assert!(config.player_name.is_none());
        assert!(config.preferred_server.is_none());
        assert_eq!(config.mic_hotkey, Some("Ctrl+M".to_string()));
        assert!(config.window_position.is_some());
        assert!(config.audio_device_id.is_none());
        assert_eq!(config.opacity, Some(0.95));
    }

    #[tokio::test]
    async fn test_default_window_position() {
        let pos = WindowPosition::default();
        
        assert_eq!(pos.x, 100);
        assert_eq!(pos.y, 100);
        assert_eq!(pos.width, 300);
        assert_eq!(pos.height, 400);
    }

    #[tokio::test]
    async fn test_save_and_load_config() {
        let temp_dir = TempDir::new().unwrap();
        let mut manager = create_test_config_manager(&temp_dir).await;

        // 设置一些配置
        manager.config.player_name = Some("测试玩家".to_string());
        manager.config.preferred_server = Some("tcp://test:11010".to_string());

        // 保存配置
        manager.save().await.unwrap();

        // 验证文件存在
        assert!(manager.config_path.exists());

        // 重新加载配置
        let loaded_config = ConfigManager::load_from_file(&manager.config_path)
            .await
            .unwrap();

        // 验证配置内容
        assert_eq!(loaded_config.player_name, Some("测试玩家".to_string()));
        assert_eq!(loaded_config.preferred_server, Some("tcp://test:11010".to_string()));
    }

    #[tokio::test]
    async fn test_update_config() {
        let temp_dir = TempDir::new().unwrap();
        let mut manager = create_test_config_manager(&temp_dir).await;

        // 更新配置
        manager.update_config(|config| {
            config.player_name = Some("新玩家".to_string());
            config.mic_hotkey = Some("Ctrl+Shift+M".to_string());
        }).await.unwrap();

        // 验证配置已更新
        assert_eq!(manager.config.player_name, Some("新玩家".to_string()));
        assert_eq!(manager.config.mic_hotkey, Some("Ctrl+Shift+M".to_string()));

        // 验证配置已保存到文件
        let loaded_config = ConfigManager::load_from_file(&manager.config_path)
            .await
            .unwrap();
        assert_eq!(loaded_config.player_name, Some("新玩家".to_string()));
    }

    #[tokio::test]
    async fn test_set_player_name() {
        let temp_dir = TempDir::new().unwrap();
        let mut manager = create_test_config_manager(&temp_dir).await;

        manager.set_player_name("玩家123".to_string()).await.unwrap();

        assert_eq!(manager.config.player_name, Some("玩家123".to_string()));
    }

    #[tokio::test]
    async fn test_set_preferred_server() {
        let temp_dir = TempDir::new().unwrap();
        let mut manager = create_test_config_manager(&temp_dir).await;

        manager.set_preferred_server("tcp://server:11010".to_string()).await.unwrap();

        assert_eq!(manager.config.preferred_server, Some("tcp://server:11010".to_string()));
    }

    #[tokio::test]
    async fn test_set_window_position() {
        let temp_dir = TempDir::new().unwrap();
        let mut manager = create_test_config_manager(&temp_dir).await;

        let new_pos = WindowPosition {
            x: 200,
            y: 300,
            width: 400,
            height: 500,
        };

        manager.set_window_position(new_pos.clone()).await.unwrap();

        assert_eq!(manager.config.window_position, Some(new_pos));
    }

    #[tokio::test]
    async fn test_reset_to_default() {
        let temp_dir = TempDir::new().unwrap();
        let mut manager = create_test_config_manager(&temp_dir).await;

        // 设置一些自定义配置
        manager.config.player_name = Some("测试".to_string());
        manager.config.preferred_server = Some("test".to_string());

        // 重置为默认配置
        manager.reset_to_default().await.unwrap();

        // 验证配置已重置
        assert!(manager.config.player_name.is_none());
        assert!(manager.config.preferred_server.is_none());
        assert_eq!(manager.config.mic_hotkey, Some("Ctrl+M".to_string()));
    }

    #[tokio::test]
    async fn test_load_corrupted_config() {
        let temp_dir = TempDir::new().unwrap();
        let config_path = temp_dir.path().join("corrupted.json");

        // 写入损坏的 JSON
        fs::write(&config_path, "{invalid json content}").await.unwrap();

        // 尝试加载应该失败
        let result = ConfigManager::load_from_file(&config_path).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_load_nonexistent_config() {
        let temp_dir = TempDir::new().unwrap();
        let config_path = temp_dir.path().join("nonexistent.json");

        // 尝试加载不存在的文件应该失败
        let result = ConfigManager::load_from_file(&config_path).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_config_serialization() {
        let config = UserConfig {
            player_name: Some("测试玩家".to_string()),
            preferred_server: Some("tcp://test:11010".to_string()),
            mic_hotkey: Some("Ctrl+M".to_string()),
            window_position: Some(WindowPosition {
                x: 100,
                y: 200,
                width: 300,
                height: 400,
            }),
            audio_device_id: Some("device123".to_string()),
            opacity: Some(0.85),
        };

        // 序列化
        let json = serde_json::to_string(&config).unwrap();

        // 反序列化
        let deserialized: UserConfig = serde_json::from_str(&json).unwrap();

        // 验证往返一致性
        assert_eq!(config, deserialized);
    }

    #[tokio::test]
    async fn test_backup_config() {
        let temp_dir = TempDir::new().unwrap();
        let mut manager = create_test_config_manager(&temp_dir).await;

        // 保存配置
        manager.config.player_name = Some("测试".to_string());
        manager.save().await.unwrap();

        // 备份配置
        let backup_path = manager.backup_config().await.unwrap();

        // 验证备份文件存在
        assert!(backup_path.exists());

        // 验证备份内容正确
        let backup_content = fs::read_to_string(&backup_path).await.unwrap();
        let backup_config: UserConfig = serde_json::from_str(&backup_content).unwrap();
        assert_eq!(backup_config.player_name, Some("测试".to_string()));
    }
}
