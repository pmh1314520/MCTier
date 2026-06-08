// Minecraft Java Agent 注入模块
// 动态注入 Agent 到 Minecraft 进程,关闭局域网服务器的正版验证

use std::path::PathBuf;
use std::process::Command;
use log::{info, warn, error};

/// Minecraft Agent 注入器
pub struct MinecraftAgentInjector {
    agent_jar_path: PathBuf,
}

impl MinecraftAgentInjector {
    /// 创建新的注入器
    pub fn new() -> Self {
        Self {
            agent_jar_path: PathBuf::from("resources/binaries/minecraft-offline-agent.jar"),
        }
    }

    /// 注入 Agent 到 Minecraft 进程
    pub async fn inject(&self, pid: u32) -> Result<(), String> {
        info!("🔧 准备注入 Agent 到进程 {}", pid);

        // 检查 Agent JAR 是否存在
        if !self.agent_jar_path.exists() {
            error!("❌ Agent JAR 不存在: {:?}", self.agent_jar_path);
            error!("💡 请先编译 Java Agent:");
            error!("   cd minecraft-offline-agent");
            error!("   .\\build.bat");
            return Err("Agent JAR 文件不存在".to_string());
        }

        // 执行注入
        self.inject_using_java(pid).await
    }

    /// 使用 Java 的 Attach API 注入 Agent
    async fn inject_using_java(&self, pid: u32) -> Result<(), String> {
        let agent_path = self.agent_jar_path
            .canonicalize()
            .map_err(|e| format!("获取 Agent 路径失败: {}", e))?;

        let agent_path_str = agent_path.to_str().unwrap();

        info!("📌 执行注入命令:");
        info!("   java -cp {} com.mctier.agent.AgentLoader {} {}", 
              agent_path_str, pid, agent_path_str);

        // 使用 Java 的 AgentLoader 来注入
        #[cfg(windows)]
        let output = {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            Command::new("java")
                .args(&[
                    "-cp",
                    agent_path_str,
                    "com.mctier.agent.AgentLoader",
                    &pid.to_string(),
                    agent_path_str,
                ])
                .creation_flags(CREATE_NO_WINDOW)
                .output()
                .map_err(|e| format!("执行 Java AgentLoader 失败: {}", e))?
        };

        #[cfg(not(windows))]
        let output = Command::new("java")
            .args(&[
                "-cp",
                agent_path_str,
                "com.mctier.agent.AgentLoader",
                &pid.to_string(),
                agent_path_str,
            ])
            .output()
            .map_err(|e| format!("执行 Java AgentLoader 失败: {}", e))?;

        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);

        info!("📋 AgentLoader 输出:");
        info!("{}", stdout);
        if !stderr.is_empty() {
            warn!("⚠️ AgentLoader 错误输出:");
            warn!("{}", stderr);
        }

        if output.status.success() {
            info!("✅ Agent 注入成功!");
            info!("🎉 Minecraft LAN 服务器的正版验证已关闭");
            Ok(())
        } else {
            error!("❌ Agent 注入失败");
            Err(format!("Agent 注入失败: {}", stderr))
        }
    }

    /// 检查 Agent 是否已注入
    pub async fn is_injected(&self, _pid: u32) -> bool {
        // 通过检查进程的加载模块来判断
        // 简化实现:假设注入后就一直有效
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_injector_creation() {
        let injector = MinecraftAgentInjector::new();
        assert!(injector.agent_jar_path.to_str().unwrap().contains("minecraft-offline-agent.jar"));
    }
}
