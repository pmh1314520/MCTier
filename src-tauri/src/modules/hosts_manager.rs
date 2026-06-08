// Hosts文件管理模块
// 用于实现MCTier专属的Magic DNS功能

use std::fs::{File, OpenOptions};
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use crate::modules::error::AppError;

/// 进程级 hosts 文件操作锁：串行化所有「读-改-写」，防止并发交错导致 hosts 文件损坏
fn hosts_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

/// Hosts文件管理器
pub struct HostsManager {
    hosts_path: PathBuf,
    marker_start: String,
    marker_end: String,
}

impl HostsManager {
    /// 创建新的Hosts管理器实例
    pub fn new(lobby_name: &str) -> Self {
        #[cfg(windows)]
        let hosts_path = PathBuf::from(r"C:\Windows\System32\drivers\etc\hosts");
        
        #[cfg(not(windows))]
        let hosts_path = PathBuf::from("/etc/hosts");
        
        Self {
            hosts_path,
            marker_start: format!("# MCTier Magic DNS - {}", lobby_name),
            marker_end: "# MCTier Magic DNS End".to_string(),
        }
    }
    
    /// 清理所有MCTier相关的hosts记录（静态方法）
    /// 
    /// 此方法会清理所有以"# MCTier Magic DNS"开头的记录块，
    /// 无论大厅名称是什么，确保彻底清理
    /// 
    /// # 返回
    /// * `Ok(())` - 清理成功
    /// * `Err(AppError)` - 清理失败
    pub fn cleanup_all_mctier_entries() -> Result<(), AppError> {
        log::info!("🧹 开始清理所有MCTier hosts记录...");
        // 串行化 hosts 读-改-写
        let _guard = hosts_lock().lock().unwrap_or_else(|e| e.into_inner());
        
        #[cfg(windows)]
        let hosts_path = PathBuf::from(r"C:\Windows\System32\drivers\etc\hosts");
        
        #[cfg(not(windows))]
        let hosts_path = PathBuf::from("/etc/hosts");
        
        // 读取hosts文件
        let mut file = File::open(&hosts_path)
            .map_err(|e| AppError::FileError(format!("无法打开hosts文件: {}", e)))?;
        
        let mut content = String::new();
        file.read_to_string(&mut content)
            .map_err(|e| AppError::FileError(format!("无法读取hosts文件: {}", e)))?;
        
        // 分析并移除所有MCTier相关的记录块
        let lines: Vec<&str> = content.lines().collect();
        let mut new_lines = Vec::new();
        let mut in_mctier_section = false;
        let mut removed_count = 0;
        
        for line in lines {
            if line.starts_with("# MCTier Magic DNS") {
                in_mctier_section = true;
                removed_count += 1;
                continue;
            } else if line == "# MCTier Magic DNS End" {
                in_mctier_section = false;
                continue;
            } else if in_mctier_section {
                // 跳过MCTier区域内的所有行
                continue;
            } else {
                new_lines.push(line);
            }
        }
        
        // 重新组合内容
        let new_content = new_lines.join("\n");
        if !new_content.is_empty() && !new_content.ends_with('\n') {
            // 确保文件以换行符结尾
            let new_content = format!("{}\n", new_content);
            
            // 写回hosts文件
            let mut file = OpenOptions::new()
                .write(true)
                .truncate(true)
                .open(&hosts_path)
                .map_err(|e| AppError::FileError(format!("无法打开hosts文件进行写入: {}. 请确保以管理员权限运行", e)))?;
            
            file.write_all(new_content.as_bytes())
                .map_err(|e| AppError::FileError(format!("无法写入hosts文件: {}", e)))?;
        } else {
            // 写回hosts文件
            let mut file = OpenOptions::new()
                .write(true)
                .truncate(true)
                .open(&hosts_path)
                .map_err(|e| AppError::FileError(format!("无法打开hosts文件进行写入: {}. 请确保以管理员权限运行", e)))?;
            
            file.write_all(new_content.as_bytes())
                .map_err(|e| AppError::FileError(format!("无法写入hosts文件: {}", e)))?;
        }
        
        // 刷新DNS缓存
        Self::flush_dns_cache_static()?;
        
        if removed_count > 0 {
            log::info!("✅ 已清理 {} 个MCTier hosts记录块", removed_count);
        } else {
            log::info!("✅ 没有发现MCTier hosts记录，无需清理");
        }
        
        Ok(())
    }
    
    /// 刷新DNS缓存（静态方法）
    fn flush_dns_cache_static() -> Result<(), AppError> {
        #[cfg(windows)]
        {
            use std::process::Command;
            use std::os::windows::process::CommandExt;
            
            // Windows 常量：CREATE_NO_WINDOW = 0x08000000
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            
            log::info!("🔄 [HostsManager] 正在刷新DNS缓存...");
            
            // 使用 ipconfig /flushdns
            match Command::new("ipconfig")
                .arg("/flushdns")
                .creation_flags(CREATE_NO_WINDOW)
                .output()
            {
                Ok(output) => {
                    if output.status.success() {
                        log::info!("✅ [HostsManager] DNS缓存已刷新");
                    } else {
                        log::warn!("⚠️ [HostsManager] ipconfig刷新DNS缓存失败");
                    }
                }
                Err(e) => {
                    log::warn!("⚠️ [HostsManager] 执行ipconfig失败: {}", e);
                }
            }
        }
        
        #[cfg(not(windows))]
        {
            log::info!("✅ [HostsManager] 非Windows平台，跳过DNS缓存刷新");
        }
        
        Ok(())
    }
    
    /// 添加域名映射
    /// 
    /// # 参数
    /// * `domain` - 域名（如：qyzz.mct.net）
    /// * `ip` - 虚拟IP地址
    /// 
    /// # 返回
    /// * `Ok(())` - 添加成功
    /// * `Err(AppError)` - 添加失败
    pub fn add_entry(&self, domain: &str, ip: &str) -> Result<(), AppError> {
        // 串行化 hosts 读-改-写，防止与其它 hosts 操作交错
        let _guard = hosts_lock().lock().unwrap_or_else(|e| e.into_inner());
        log::info!("📝 [HostsManager] 开始添加hosts记录");
        log::info!("📝 [HostsManager] 域名: {}", domain);
        log::info!("📝 [HostsManager] IP: {}", ip);
        log::info!("📝 [HostsManager] Hosts文件路径: {:?}", self.hosts_path);
        
        // 读取现有hosts文件内容
        log::info!("📝 [HostsManager] 正在读取hosts文件...");
        let mut content = self.read_hosts()?;
        log::info!("📝 [HostsManager] Hosts文件读取成功，大小: {} 字节", content.len());
        
        // 查找MCTier标记区域
        log::info!("📝 [HostsManager] 正在查找MCTier标记区域...");
        let (before_marker, mut mctier_section, after_marker) = self.split_content(&content);
        log::info!("📝 [HostsManager] 标记前内容: {} 字节", before_marker.len());
        log::info!("📝 [HostsManager] MCTier区域: {} 字节", mctier_section.len());
        log::info!("📝 [HostsManager] 标记后内容: {} 字节", after_marker.len());
        
        // 检查是否已存在该域名
        let entry = format!("{} {}", ip, domain);
        log::info!("📝 [HostsManager] 要添加的记录: {}", entry);
        
        if !mctier_section.contains(&entry) {
            log::info!("📝 [HostsManager] 记录不存在，准备添加");
            // 如果MCTier区域不存在，创建它
            if mctier_section.is_empty() {
                log::info!("📝 [HostsManager] MCTier区域不存在，创建新区域");
                mctier_section = format!("{}\n{}\n{}\n", 
                    self.marker_start, 
                    entry, 
                    self.marker_end
                );
            } else {
                log::info!("📝 [HostsManager] MCTier区域已存在，在结束标记前添加记录");
                // 在结束标记前添加新记录
                mctier_section = mctier_section.replace(
                    &self.marker_end,
                    &format!("{}\n{}", entry, self.marker_end)
                );
            }
        } else {
            log::info!("📝 [HostsManager] 记录已存在，跳过添加");
        }
        
        // 重新组合内容
        log::info!("📝 [HostsManager] 正在重新组合内容...");
        content = format!("{}{}{}", before_marker, mctier_section, after_marker);
        log::info!("📝 [HostsManager] 新内容大小: {} 字节", content.len());
        
        // 写回hosts文件
        log::info!("📝 [HostsManager] 正在写入hosts文件...");
        self.write_hosts(&content)?;
        
        log::info!("✅ [HostsManager] hosts记录添加成功");
        Ok(())
    }
    
    /// 删除域名映射
    /// 
    /// # 参数
    /// * `domain` - 要删除的域名
    /// 
    /// # 返回
    /// * `Ok(())` - 删除成功
    /// * `Err(AppError)` - 删除失败
    pub fn remove_entry(&self, domain: &str) -> Result<(), AppError> {
        log::info!("删除hosts记录: {}", domain);
        let _guard = hosts_lock().lock().unwrap_or_else(|e| e.into_inner());
        
        // 读取现有hosts文件内容
        let content = self.read_hosts()?;
        
        // 查找MCTier标记区域
        let (before_marker, mctier_section, after_marker) = self.split_content(&content);
        
        // 从MCTier区域删除指定域名的记录
        let lines: Vec<&str> = mctier_section.lines().collect();
        let mut new_section = String::new();
        
        for line in lines {
            if !line.contains(domain) {
                new_section.push_str(line);
                new_section.push('\n');
            }
        }
        
        // 重新组合内容
        let new_content = format!("{}{}{}", before_marker, new_section, after_marker);
        
        // 写回hosts文件
        self.write_hosts(&new_content)?;
        
        log::info!("✅ hosts记录删除成功");
        Ok(())
    }
    
    /// 清理所有MCTier相关的hosts记录
    /// 
    /// # 返回
    /// * `Ok(())` - 清理成功
    /// * `Err(AppError)` - 清理失败
    pub fn clear_all(&self) -> Result<(), AppError> {
        log::info!("清理所有MCTier hosts记录");
        let _guard = hosts_lock().lock().unwrap_or_else(|e| e.into_inner());
        
        // 读取现有hosts文件内容
        let content = self.read_hosts()?;
        
        // 查找MCTier标记区域
        let (before_marker, _, after_marker) = self.split_content(&content);
        
        // 移除MCTier区域
        let new_content = format!("{}{}", before_marker, after_marker);
        
        // 写回hosts文件
        self.write_hosts(&new_content)?;
        
        log::info!("✅ 所有MCTier hosts记录已清理");
        Ok(())
    }
    
    /// 批量添加域名映射
    /// 
    /// # 参数
    /// * `entries` - 域名和IP的映射列表 [(domain, ip), ...]
    /// 
    /// # 返回
    /// * `Ok(())` - 添加成功
    /// * `Err(AppError)` - 添加失败
    pub fn add_entries(&self, entries: &[(String, String)]) -> Result<(), AppError> {
        log::info!("批量添加{}条hosts记录", entries.len());
        
        for (domain, ip) in entries {
            self.add_entry(domain, ip)?;
        }
        
        Ok(())
    }
    
    /// 读取hosts文件内容
    fn read_hosts(&self) -> Result<String, AppError> {
        let mut file = File::open(&self.hosts_path)
            .map_err(|e| AppError::FileError(format!("无法打开hosts文件: {}", e)))?;
        
        let mut content = String::new();
        file.read_to_string(&mut content)
            .map_err(|e| AppError::FileError(format!("无法读取hosts文件: {}", e)))?;
        
        Ok(content)
    }
    
    /// 写入hosts文件内容
    fn write_hosts(&self, content: &str) -> Result<(), AppError> {
        let mut file = OpenOptions::new()
            .write(true)
            .truncate(true)
            .open(&self.hosts_path)
            .map_err(|e| AppError::FileError(format!("无法打开hosts文件进行写入: {}. 请确保以管理员权限运行", e)))?;
        
        file.write_all(content.as_bytes())
            .map_err(|e| AppError::FileError(format!("无法写入hosts文件: {}", e)))?;
        
        // 刷新DNS缓存
        self.flush_dns_cache()?;
        
        Ok(())
    }
    
    /// 分割hosts文件内容
    /// 返回：(MCTier标记之前的内容, MCTier区域内容, MCTier标记之后的内容)
    fn split_content(&self, content: &str) -> (String, String, String) {
        let lines: Vec<&str> = content.lines().collect();
        let mut before = Vec::new();
        let mut mctier = Vec::new();
        let mut after = Vec::new();
        
        let mut in_mctier_section = false;
        
        for line in lines {
            if line.starts_with(&self.marker_start) {
                in_mctier_section = true;
                mctier.push(line);
            } else if line == self.marker_end {
                mctier.push(line);
                in_mctier_section = false;
            } else if in_mctier_section {
                mctier.push(line);
            } else if mctier.is_empty() {
                before.push(line);
            } else {
                after.push(line);
            }
        }
        
        let before_str = if before.is_empty() {
            String::new()
        } else {
            format!("{}\n", before.join("\n"))
        };
        
        let mctier_str = if mctier.is_empty() {
            String::new()
        } else {
            format!("{}\n", mctier.join("\n"))
        };
        
        let after_str = if after.is_empty() {
            String::new()
        } else {
            format!("{}\n", after.join("\n"))
        };
        
        (before_str, mctier_str, after_str)
    }
    
    /// 刷新DNS缓存
    fn flush_dns_cache(&self) -> Result<(), AppError> {
        #[cfg(windows)]
        {
            use std::process::Command;
            use std::os::windows::process::CommandExt;
            
            // Windows 常量：CREATE_NO_WINDOW = 0x08000000
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            
            log::info!("🔄 [HostsManager] 正在刷新DNS缓存...");
            
            // 方法1: 使用 ipconfig /flushdns（隐藏窗口）
            match Command::new("ipconfig")
                .arg("/flushdns")
                .creation_flags(CREATE_NO_WINDOW)
                .output()
            {
                Ok(output) => {
                    if output.status.success() {
                        let stdout = String::from_utf8_lossy(&output.stdout);
                        log::info!("✅ [HostsManager] DNS缓存已刷新（ipconfig）");
                        log::debug!("ipconfig 输出: {}", stdout);
                    } else {
                        let stderr = String::from_utf8_lossy(&output.stderr);
                        log::warn!("⚠️ [HostsManager] ipconfig刷新DNS缓存失败: {}", stderr);
                    }
                }
                Err(e) => {
                    log::warn!("⚠️ [HostsManager] 执行ipconfig失败: {}", e);
                }
            }
            
            // 方法2: 使用 netsh 清除DNS缓存（更彻底，隐藏窗口）
            match Command::new("netsh")
                .args(&["interface", "ip", "delete", "arpcache"])
                .creation_flags(CREATE_NO_WINDOW)
                .output()
            {
                Ok(output) => {
                    if output.status.success() {
                        log::info!("✅ [HostsManager] ARP缓存已清除（netsh）");
                    } else {
                        log::debug!("netsh清除ARP缓存失败（可能不影响DNS解析）");
                    }
                }
                Err(e) => {
                    log::debug!("执行netsh失败: {}（可能不影响DNS解析）", e);
                }
            }
            
            // 方法3: 使用 netsh 重置DNS客户端（隐藏窗口）
            match Command::new("netsh")
                .args(&["interface", "ip", "delete", "destinationcache"])
                .creation_flags(CREATE_NO_WINDOW)
                .output()
            {
                Ok(output) => {
                    if output.status.success() {
                        log::info!("✅ [HostsManager] 目标缓存已清除（netsh）");
                    } else {
                        log::debug!("netsh清除目标缓存失败（可能不影响DNS解析）");
                    }
                }
                Err(e) => {
                    log::debug!("执行netsh失败: {}（可能不影响DNS解析）", e);
                }
            }
            
            log::info!("✅ [HostsManager] DNS缓存刷新完成");
        }
        
        #[cfg(not(windows))]
        {
            log::info!("✅ [HostsManager] 非Windows平台，跳过DNS缓存刷新");
        }
        
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_split_content() {
        let manager = HostsManager::new("测试大厅");
        
        let content = r#"127.0.0.1 localhost
# MCTier Magic DNS - 测试大厅
10.126.126.1 test.mct.net
# MCTier Magic DNS End
192.168.1.1 router
"#;
        
        let (before, mctier, after) = manager.split_content(content);
        
        assert!(before.contains("127.0.0.1 localhost"));
        assert!(mctier.contains("10.126.126.1 test.mct.net"));
        assert!(after.contains("192.168.1.1 router"));
    }
}
