// Minecraft 启动器模块
// 负责启动 Minecraft 并自动注入 Agent

use std::path::{Path, PathBuf};
use log::info;
use serde::{Deserialize, Serialize};


/// Minecraft 配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MinecraftConfig {
    /// Minecraft 启动器类型
    pub launcher_type: String,
    /// Minecraft 版本目录
    pub version_dir: String,
    /// 启动器配置文件路径
    pub launcher_config_path: Option<String>,
}

/// Minecraft 启动器
pub struct MinecraftLauncher {
    agent_jar_path: PathBuf,
}

impl MinecraftLauncher {
    /// 创建新的启动器
    pub fn new() -> Self {
        Self {
            agent_jar_path: PathBuf::from("resources/binaries/minecraft-offline-agent.jar"),
        }
    }

    /// 获取 Agent 参数
    pub fn get_agent_argument(&self) -> Result<String, String> {
        if !self.agent_jar_path.exists() {
            return Err("Agent JAR 文件不存在，请先编译 Agent".to_string());
        }

        let agent_path = self.agent_jar_path
            .canonicalize()
            .map_err(|e| format!("获取 Agent 路径失败: {}", e))?;

        Ok(format!("-javaagent:\"{}\"", agent_path.display()))
    }

    /// 自动配置 Minecraft 启动器
    pub async fn auto_configure(&self, config: MinecraftConfig) -> Result<String, String> {
        info!("🔧 开始配置 Minecraft 启动器");
        info!("   启动器类型: {}", config.launcher_type);
        info!("   版本目录: {}", config.version_dir);

        let agent_arg = self.get_agent_argument()?;
        
        match config.launcher_type.as_str() {
            "PCL" | "PCL2" => {
                info!("📝 检测到 PCL 启动器");
                self.configure_pcl(&config, &agent_arg).await
            }
            "HMCL" => {
                info!("📝 检测到 HMCL 启动器");
                self.configure_hmcl(&config, &agent_arg).await
            }
            "官方启动器" | "Official" => {
                info!("📝 检测到官方启动器");
                self.configure_official(&config, &agent_arg).await
            }
            _ => {
                // 返回手动配置说明
                Ok(format!(
                    "请手动在启动器的 JVM 参数中添加以下内容：\n\n{}\n\n添加后重启 Minecraft 即可自动关闭正版验证。",
                    agent_arg
                ))
            }
        }
    }

    /// 配置 PCL 启动器
    async fn configure_pcl(&self, _config: &MinecraftConfig, agent_arg: &str) -> Result<String, String> {
        // PCL 启动器的配置文件在 PCL 主目录下，不在版本目录
        // 需要用户提供 PCL 主目录路径，或者我们提供手动配置说明
        
        info!("PCL 启动器需要手动配置");
        
        Ok(format!(
            "PCL 启动器配置说明：\n\n\
            1. 打开 PCL 启动器\n\
            2. 选择版本：1.21.11\n\
            3. 点击「版本设置」\n\
            4. 找到「游戏 Java 虚拟机参数」或「JVM 参数」\n\
            5. 在参数框中添加以下内容：\n\n\
            {}\n\n\
            6. 点击保存\n\
            7. 重启 Minecraft\n\n\
            配置完成后，开放局域网时会自动关闭正版验证。",
            agent_arg
        ))
    }

    /// 配置 HMCL 启动器
    async fn configure_hmcl(&self, _config: &MinecraftConfig, agent_arg: &str) -> Result<String, String> {
        // HMCL 的配置文件格式不同，这里提供手动配置说明
        Ok(format!(
            "请手动在 HMCL 启动器中：\n\n1. 选择版本\n2. 点击「编辑版本」\n3. 在「Java 虚拟机参数」中添加：\n\n{}\n\n4. 保存并重启游戏",
            agent_arg
        ))
    }

    /// 配置官方启动器
    async fn configure_official(&self, _config: &MinecraftConfig, agent_arg: &str) -> Result<String, String> {
        Ok(format!(
            "请手动在官方启动器中：\n\n1. 点击「启动选项」\n2. 选择配置文件\n3. 启用「JVM 参数」\n4. 在 JVM 参数中添加：\n\n{}\n\n5. 保存并重启游戏",
            agent_arg
        ))
    }

    /// 检测 Minecraft 启动器类型
    pub fn detect_launcher_type(minecraft_dir: &str) -> Option<String> {
        let path = Path::new(minecraft_dir);
        
        // 检查是否是 PCL 启动器
        if path.join("PCL.exe").exists() || path.to_str().unwrap_or("").contains("PCL") {
            return Some("PCL".to_string());
        }

        // 检查是否是 HMCL 启动器
        if path.join("HMCL.jar").exists() || path.to_str().unwrap_or("").contains("HMCL") {
            return Some("HMCL".to_string());
        }

        // 默认返回 None，需要用户手动选择
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_launcher_creation() {
        let launcher = MinecraftLauncher::new();
        assert!(launcher.agent_jar_path.to_str().unwrap().contains("minecraft-offline-agent.jar"));
    }

    #[test]
    fn test_get_agent_argument() {
        let launcher = MinecraftLauncher::new();
        // 如果 JAR 存在，应该返回正确的参数
        if launcher.agent_jar_path.exists() {
            let arg = launcher.get_agent_argument();
            assert!(arg.is_ok());
            let arg_str = arg.unwrap();
            assert!(arg_str.starts_with("-javaagent:"));
            assert!(arg_str.contains("minecraft-offline-agent.jar"));
        }
    }
}
