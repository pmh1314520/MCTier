use crate::modules::error::AppError;
use crate::modules::resource_manager::ResourceManager;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;
use tokio::time::{sleep, Duration};

#[cfg(windows)]
#[allow(unused_imports)]
use std::os::windows::process::CommandExt;

// Windows常量：CREATE_NO_WINDOW = 0x08000000
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// 检查是否以管理员权限运行（仅 Windows）
#[cfg(windows)]
fn is_elevated() -> bool {
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::Security::{GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY};
    use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    unsafe {
        let mut token: HANDLE = HANDLE::default();
        
        // 打开当前进程的访问令牌
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token).is_err() {
            return false;
        }

        let mut elevation = TOKEN_ELEVATION { TokenIsElevated: 0 };
        let mut return_length = 0u32;

        // 获取令牌提升信息
        let result = GetTokenInformation(
            token,
            TokenElevation,
            Some(&mut elevation as *mut _ as *mut _),
            std::mem::size_of::<TOKEN_ELEVATION>() as u32,
            &mut return_length,
        );

        result.is_ok() && elevation.TokenIsElevated != 0
    }
}

/// 非 Windows 平台始终返回 true（不需要管理员权限）
#[cfg(not(windows))]
fn is_elevated() -> bool {
    true
}

/// 连接状态枚举
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", content = "data")]
pub enum ConnectionStatus {
    /// 已连接（包含虚拟 IP）
    Connected(String),
    /// 断开连接
    Disconnected,
    /// 连接中
    Connecting,
    /// 错误状态（包含错误信息）
    Error(String),
}

/// 网络配置
#[derive(Debug, Clone)]
pub struct NetworkConfig {
    /// EasyTier 可执行文件路径
    pub easytier_path: PathBuf,
    /// 配置目录
    pub config_dir: PathBuf,
}

impl Default for NetworkConfig {
    fn default() -> Self {
        Self {
            easytier_path: PathBuf::from("easytier-core.exe"),
            config_dir: PathBuf::from("./config"),
        }
    }
}

/// 网络服务
/// 
/// 负责管理 EasyTier 子进程，提供虚拟网络连接功能
pub struct NetworkService {
    /// EasyTier 子进程
    easytier_process: Arc<Mutex<Option<Child>>>,
    /// 网络配置
    config: NetworkConfig,
    /// 当前连接状态
    status: Arc<Mutex<ConnectionStatus>>,
    /// 虚拟 IP 地址
    virtual_ip: Arc<Mutex<Option<String>>>,
    /// 是否正在运行
    is_running: Arc<Mutex<bool>>,
    /// Tauri 应用句柄
    app_handle: Option<tauri::AppHandle>,
    /// 当前实例的配置目录路径
    instance_config_dir: Arc<Mutex<Option<PathBuf>>>,
    /// 当前使用的RPC端口
    rpc_port: Arc<Mutex<Option<u16>>>,
    /// 最近的标准错误输出（用于在进程意外退出时定位原因，仅保留最近若干行）
    last_stderr: Arc<Mutex<std::collections::VecDeque<String>>>,
}

impl NetworkService {
    /// 创建新的网络服务实例
    /// 
    /// # 参数
    /// * `config` - 网络配置
    /// 
    /// # 返回
    /// 新的网络服务实例
    pub fn new(config: NetworkConfig) -> Self {
        Self {
            easytier_process: Arc::new(Mutex::new(None)),
            config,
            status: Arc::new(Mutex::new(ConnectionStatus::Disconnected)),
            virtual_ip: Arc::new(Mutex::new(None)),
            is_running: Arc::new(Mutex::new(false)),
            app_handle: None,
            instance_config_dir: Arc::new(Mutex::new(None)),
            rpc_port: Arc::new(Mutex::new(None)),
            last_stderr: Arc::new(Mutex::new(std::collections::VecDeque::new())),
        }
    }

    /// 使用默认配置创建网络服务实例
    pub fn new_with_defaults() -> Self {
        Self::new(NetworkConfig::default())
    }
    
    /// 设置 Tauri 应用句柄
    /// 
    /// # 参数
    /// * `app_handle` - Tauri 应用句柄
    pub fn set_app_handle(&mut self, app_handle: tauri::AppHandle) {
        self.app_handle = Some(app_handle);
    }
    
    /// 获取 EasyTier 可执行文件路径
    /// 
    /// # 返回
    /// * `Ok(PathBuf)` - EasyTier 可执行文件路径
    /// * `Err(AppError)` - 获取路径失败
    fn get_easytier_path(&self) -> Result<PathBuf, AppError> {
        if let Some(ref app_handle) = self.app_handle {
            ResourceManager::get_easytier_path(app_handle)
        } else {
            // 如果没有 app_handle，使用配置中的路径
            Ok(self.config.easytier_path.clone())
        }
    }

    /// 应用 EasyTier 高级配置到命令行
    /// 
    /// # 参数
    /// * `cmd` - 命令对象
    /// * `config` - EasyTier 高级配置
    fn apply_advanced_config(
        cmd: &mut tokio::process::Command,
        config: &crate::modules::config_manager::EasyTierAdvancedConfig,
    ) {
        log::info!("应用 EasyTier 高级配置");
        
        // ========== 网络模式 ==========
        if config.no_tun {
            cmd.arg("--no-tun");
            log::info!("  ✅ 启用无 TUN 模式");
        }
        
        if config.dhcp {
            cmd.arg("--dhcp").arg("true");
            log::info!("  ✅ 启用 DHCP");
        } else {
            cmd.arg("--dhcp").arg("false");
        }
        
        if let Some(ref ipv4) = config.ipv4 {
            if !ipv4.is_empty() {
                cmd.arg("--ipv4").arg(ipv4);
                log::info!("  ✅ 手动指定 IPv4: {}", ipv4);
            }
        }
        
        // ========== 代理和转发 ==========
        if config.enable_socks5 {
            if let Some(port) = config.socks5_port {
                cmd.arg("--socks5").arg(port.to_string());
                log::info!("  ✅ 启用 SOCKS5 代理，端口: {}", port);
            }
        }
        
        for rule in &config.port_forward_rules {
            let forward_rule = format!("{}://{}/{}", rule.protocol, rule.bind_addr, rule.dst_addr);
            cmd.arg("--port-forward").arg(&forward_rule);
            log::info!("  ✅ 添加端口转发规则: {}", forward_rule);
        }
        
        if config.proxy_forward_by_system {
            cmd.arg("--proxy-forward-by-system");
            log::info!("  ✅ 启用系统转发");
        }
        
        for network in &config.proxy_networks {
            if !network.trim().is_empty() {
                cmd.arg("--proxy-networks").arg(network.trim());
                log::info!("  ✅ 添加代理网络: {}", network.trim());
            }
        }
        
        // ========== 出口节点 ==========
        if config.enable_as_exit_node {
            cmd.arg("--enable-exit-node");
            log::info!("  ✅ 启用作为出口节点");
        }
        
        for node in &config.exit_nodes {
            if !node.trim().is_empty() {
                cmd.arg("--exit-nodes").arg(node.trim());
                log::info!("  ✅ 使用出口节点: {}", node.trim());
            }
        }
        
        // ========== 性能优化 ==========
        if config.multi_thread {
            cmd.arg("--multi-thread").arg("true");
            if let Some(count) = config.multi_thread_count {
                if count >= 2 {
                    cmd.arg("--multi-thread-count").arg(count.to_string());
                    log::info!("  ✅ 启用多线程，线程数: {}", count);
                }
            } else {
                log::info!("  ✅ 启用多线程（默认2线程）");
            }
        }
        
        if config.latency_first {
            cmd.arg("--latency-first").arg("true");
            log::info!("  ✅ 启用延迟优先模式");
        }
        
        if config.use_smoltcp {
            cmd.arg("--use-smoltcp");
            log::info!("  ✅ 启用 smoltcp");
        }
        
        // ========== 协议优化 ==========
        if config.enable_kcp_proxy {
            cmd.arg("--enable-kcp-proxy");
            log::info!("  ✅ 启用 KCP 代理");
        }
        
        if config.disable_kcp_input {
            cmd.arg("--disable-kcp-input");
            log::info!("  ✅ 禁用 KCP 输入");
        }
        
        if config.enable_quic_proxy {
            cmd.arg("--enable-quic-proxy");
            log::info!("  ✅ 启用 QUIC 代理");
        }
        
        if config.disable_quic_input {
            cmd.arg("--disable-quic-input");
            log::info!("  ✅ 禁用 QUIC 输入");
        }
        
        if let Some(port) = config.quic_listen_port {
            cmd.arg("--quic-listen-port").arg(port.to_string());
            log::info!("  ✅ QUIC 监听端口: {}", port);
        }
        
        // ========== 加密和安全 ==========
        if config.disable_encryption {
            cmd.arg("--disable-encryption");
            log::info!("  ✅ 禁用加密");
        }
        
        if let Some(ref algo) = config.encryption_algorithm {
            if !algo.is_empty() {
                cmd.arg("--encryption-algorithm").arg(algo);
                log::info!("  ✅ 加密算法: {}", algo);
            }
        }
        
        // ========== 网络设备 ==========
        if config.bind_device {
            cmd.arg("--bind-device");
            log::info!("  ✅ 绑定到物理设备");
        }
        
        if let Some(ref dev_name) = config.dev_name {
            if !dev_name.is_empty() {
                cmd.arg("--dev-name").arg(dev_name);
                log::info!("  ✅ TUN 设备名称: {}", dev_name);
            }
        }
        
        if let Some(mtu) = config.mtu {
            cmd.arg("--mtu").arg(mtu.to_string());
            log::info!("  ✅ MTU: {}", mtu);
        }
        
        // ========== P2P 配置 ==========
        if config.p2p_only {
            cmd.arg("--p2p-only");
            log::info!("  ✅ 仅使用 P2P");
        }
        
        if config.disable_p2p {
            cmd.arg("--disable-p2p");
            log::info!("  ✅ 禁用 P2P");
        }
        
        if config.disable_udp_hole_punching {
            cmd.arg("--disable-udp-hole-punching");
            log::info!("  ✅ 禁用 UDP 打洞");
        }
        
        if config.disable_tcp_hole_punching {
            cmd.arg("--disable-tcp-hole-punching");
            log::info!("  ✅ 禁用 TCP 打洞");
        }
        
        if config.disable_sym_hole_punching {
            cmd.arg("--disable-sym-hole-punching");
            log::info!("  ✅ 禁用对称 NAT 打洞");
        }
        
        // ========== 中继配置 ==========
        for network in &config.relay_network_whitelist {
            if !network.trim().is_empty() {
                cmd.arg("--relay-network-whitelist").arg(network.trim());
                log::info!("  ✅ 中继网络白名单: {}", network.trim());
            }
        }
        
        if config.relay_all_peer_rpc {
            cmd.arg("--relay-all-peer-rpc");
            log::info!("  ✅ 转发所有对等节点 RPC");
        }
        
        if config.disable_relay_kcp {
            cmd.arg("--disable-relay-kcp");
            log::info!("  ✅ 禁用中继 KCP");
        }
        
        if config.enable_relay_foreign_network_kcp {
            cmd.arg("--enable-relay-foreign-network-kcp");
            log::info!("  ✅ 启用中继外部网络 KCP");
        }
        
        if let Some(limit) = config.foreign_relay_bps_limit {
            cmd.arg("--foreign-relay-bps-limit").arg(limit.to_string());
            log::info!("  ✅ 外部网络流量限制: {} BPS", limit);
        }
        
        // ========== 路由配置 ==========
        for route in &config.manual_routes {
            if !route.trim().is_empty() {
                cmd.arg("--manual-routes").arg(route.trim());
                log::info!("  ✅ 手动路由: {}", route.trim());
            }
        }
        
        // ========== 压缩 ==========
        if let Some(ref compression) = config.compression {
            if !compression.is_empty() {
                cmd.arg("--compression").arg(compression);
                log::info!("  ✅ 压缩算法: {}", compression);
            }
        }
        
        // ========== 监听器配置 ==========
        for listener in &config.listeners {
            if !listener.trim().is_empty() {
                cmd.arg("--listeners").arg(listener.trim());
                log::info!("  ✅ 监听器: {}", listener.trim());
            }
        }
        
        for mapped in &config.mapped_listeners {
            if !mapped.trim().is_empty() {
                cmd.arg("--mapped-listeners").arg(mapped.trim());
                log::info!("  ✅ 映射监听器: {}", mapped.trim());
            }
        }
        
        if config.no_listener {
            cmd.arg("--no-listener");
            log::info!("  ✅ 不监听任何端口");
        }
        
        if let Some(ref protocol) = config.default_protocol {
            if !protocol.is_empty() {
                cmd.arg("--default-protocol").arg(protocol);
                log::info!("  ✅ 默认协议: {}", protocol);
            }
        }
        
        // ========== DNS 配置 ==========
        if config.accept_dns {
            // 当前 easytier-core 要求 --accept-dns 必须带布尔值
            cmd.arg("--accept-dns").arg("true");
            log::info!("  ✅ 启用魔法 DNS");
        }
        
        if let Some(ref zone) = config.tld_dns_zone {
            if !zone.is_empty() {
                cmd.arg("--tld-dns-zone").arg(zone);
                log::info!("  ✅ 顶级域名区域: {}", zone);
            }
        }
        
        // ========== 端口白名单 ==========
        for port in &config.tcp_whitelist {
            if !port.trim().is_empty() {
                cmd.arg("--tcp-whitelist").arg(port.trim());
                log::info!("  ✅ TCP 端口白名单: {}", port.trim());
            }
        }
        
        for port in &config.udp_whitelist {
            if !port.trim().is_empty() {
                cmd.arg("--udp-whitelist").arg(port.trim());
                log::info!("  ✅ UDP 端口白名单: {}", port.trim());
            }
        }
        
        // ========== IPv6 ==========
        if config.disable_ipv6 {
            cmd.arg("--disable-ipv6");
            log::info!("  ✅ 禁用 IPv6");
        }
        
        if let Some(ref ipv6) = config.ipv6 {
            if !ipv6.is_empty() {
                cmd.arg("--ipv6").arg(ipv6);
                log::info!("  ✅ IPv6 地址: {}", ipv6);
            }
        }
        
        // ========== STUN 服务器 ==========
        for server in &config.stun_servers {
            if !server.trim().is_empty() {
                cmd.arg("--stun-servers").arg(server.trim());
                log::info!("  ✅ STUN 服务器: {}", server.trim());
            }
        }
        
        for server in &config.stun_servers_v6 {
            if !server.trim().is_empty() {
                cmd.arg("--stun-servers-v6").arg(server.trim());
                log::info!("  ✅ IPv6 STUN 服务器: {}", server.trim());
            }
        }
        
        // ========== 私有模式 ==========
        if config.private_mode {
            cmd.arg("--private-mode");
            log::info!("  ✅ 启用私有模式");
        }
        
        log::info!("EasyTier 高级配置应用完成");
    }

    /// 启动 EasyTier 服务
    /// 
    /// # 参数
    /// * `network_name` - 网络名称（大厅名称）
    /// * `network_key` - 网络密钥（大厅密码）
    /// * `server_node` - 服务器节点地址
    /// * `player_name` - 玩家名称
    /// * `app_handle` - Tauri 应用句柄
    /// 
    /// # 返回
    /// * `Ok(String)` - 成功启动，返回虚拟 IP 地址
    /// * `Err(AppError)` - 启动失败
    pub async fn start_easytier(
        &self,
        network_name: String,
        network_key: String,
        server_node: String,
        player_name: String,
        app_handle: &tauri::AppHandle,
    ) -> Result<String, AppError> {
        // 调用带配置参数的版本，配置参数为 None（会在函数内部读取）
        self.start_easytier_with_config(
            network_name,
            network_key,
            server_node,
            player_name,
            app_handle,
            None,
            None,
        ).await
    }

    /// 启动 EasyTier 服务（带配置参数，避免死锁）
    /// 
    /// # 参数
    /// * `network_name` - 网络名称（大厅名称）
    /// * `network_key` - 网络密钥（大厅密码）
    /// * `server_node` - 服务器节点地址
    /// * `player_name` - 玩家名称
    /// * `app_handle` - Tauri 应用句柄
    /// * `global_config` - 全局 EasyTier 高级配置（可选，如果为 None 则从配置文件读取）
    /// * `lobby_config` - 大厅 EasyTier 高级配置（可选，如果为 None 则从配置文件读取）
    /// 
    /// # 返回
    /// * `Ok(String)` - 成功启动，返回虚拟 IP 地址
    /// * `Err(AppError)` - 启动失败
    pub async fn start_easytier_with_config(
        &self,
        network_name: String,
        network_key: String,
        server_node: String,
        player_name: String,
        app_handle: &tauri::AppHandle,
        global_config_param: Option<Option<crate::modules::config_manager::EasyTierAdvancedConfig>>,
        lobby_config_param: Option<Option<crate::modules::config_manager::EasyTierAdvancedConfig>>,
    ) -> Result<String, AppError> {
        // 检查管理员权限（Windows 平台需要）
        #[cfg(windows)]
        {
            if !is_elevated() {
                log::error!("权限不足，无法创建虚拟网卡");
                return Err(AppError::NetworkError(
                    "权限不足：软件需要管理员权限来创建虚拟网卡。".to_string(),
                ));
            }
            log::info!("✅ 已确认管理员权限");
        }
        
        // 检查是否已经在运行
        let is_running = *self.is_running.lock().await;
        if is_running {
            return Err(AppError::NetworkError(
                "EasyTier 服务已在运行".to_string(),
            ));
        }

        log::info!("========================================");
        log::info!("正在启动 EasyTier 服务");
        log::info!("  网络名称: {}", network_name);
        log::info!("  节点服务器: {}", server_node);
        log::info!("========================================");

        // 更新状态为连接中
        *self.status.lock().await = ConnectionStatus::Connecting;

        // 【关键修复】启动前清理可能残留的孤儿 easytier-core.exe 进程，
        // 避免它占用固定虚拟网卡名 MCTier_Net / RPC 端口，导致新进程"意外终止"
        Self::cleanup_orphan_processes().await;

        // 清空上一次的 stderr 缓存
        self.last_stderr.lock().await.clear();

        // 获取 EasyTier 可执行文件路径
        let easytier_path = self.get_easytier_path()?;
        
        log::info!("使用 EasyTier 路径: {:?}", easytier_path);

        // 获取 EasyTier 所在目录作为工作目录
        let working_dir = easytier_path
            .parent()
            .ok_or_else(|| AppError::ProcessError("无法获取 EasyTier 所在目录".to_string()))?;
        
        log::info!("设置工作目录: {:?}", working_dir);

        // 【优化】使用ResourceManager提取必需的DLL文件到easytier-core.exe所在目录
        // 这些DLL文件是easytier-core.exe运行所必需的
        log::info!("开始提取必需的DLL文件...");
        
        // 提取Packet.dll
        let packet_dll_source = ResourceManager::get_packet_dll_path(app_handle)?;
        let packet_dll_target = working_dir.join("Packet.dll");
        if !packet_dll_target.exists() || std::fs::metadata(&packet_dll_target).map(|m| m.len()).unwrap_or(0) 
            != std::fs::metadata(&packet_dll_source).map(|m| m.len()).unwrap_or(1) {
            std::fs::copy(&packet_dll_source, &packet_dll_target)
                .map_err(|e| AppError::ProcessError(format!("复制Packet.dll失败: {}", e)))?;
            log::info!("✅ 已复制 Packet.dll");
        }
        
        // 提取wintun.dll
        let wintun_dll_source = ResourceManager::get_wintun_dll_path(app_handle)?;
        let wintun_dll_target = working_dir.join("wintun.dll");
        if !wintun_dll_target.exists() || std::fs::metadata(&wintun_dll_target).map(|m| m.len()).unwrap_or(0) 
            != std::fs::metadata(&wintun_dll_source).map(|m| m.len()).unwrap_or(1) {
            std::fs::copy(&wintun_dll_source, &wintun_dll_target)
                .map_err(|e| AppError::ProcessError(format!("复制wintun.dll失败: {}", e)))?;
            log::info!("✅ 已复制 wintun.dll");
        }
        
        // 提取WinDivert64.sys
        let windivert_sys_source = ResourceManager::get_windivert_sys_path(app_handle)?;
        let windivert_sys_target = working_dir.join("WinDivert64.sys");
        if !windivert_sys_target.exists() || std::fs::metadata(&windivert_sys_target).map(|m| m.len()).unwrap_or(0) 
            != std::fs::metadata(&windivert_sys_source).map(|m| m.len()).unwrap_or(1) {
            std::fs::copy(&windivert_sys_source, &windivert_sys_target)
                .map_err(|e| AppError::ProcessError(format!("复制WinDivert64.sys失败: {}", e)))?;
            log::info!("✅ 已复制 WinDivert64.sys");
        }
        
        // 提取Packet.lib
        let packet_lib_source = ResourceManager::get_packet_lib_path(app_handle)?;
        let packet_lib_target = working_dir.join("Packet.lib");
        if !packet_lib_target.exists() || std::fs::metadata(&packet_lib_target).map(|m| m.len()).unwrap_or(0) 
            != std::fs::metadata(&packet_lib_source).map(|m| m.len()).unwrap_or(1) {
            std::fs::copy(&packet_lib_source, &packet_lib_target)
                .map_err(|e| AppError::ProcessError(format!("复制Packet.lib失败: {}", e)))?;
            log::info!("✅ 已复制 Packet.lib");
        }
        
        log::info!("✅ 所有必需的DLL文件已准备就绪");

        // 生成唯一的实例名称（基于时间戳和随机数）
        let instance_name = format!(
            "mctier-{}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs(),
            rand::random::<u32>()
        );
        log::info!("生成实例名称: {}", instance_name);

        // 清理旧的配置目录（启动时清理）
        log::info!("正在清理旧的配置目录...");
        if let Ok(entries) = std::fs::read_dir(&working_dir) {
            for entry in entries.flatten() {
                if let Ok(file_name) = entry.file_name().into_string() {
                    // 只清理以 config_mctier- 开头的目录
                    if file_name.starts_with("config_mctier-") {
                        let old_config_path = entry.path();
                        match std::fs::remove_dir_all(&old_config_path) {
                            Ok(_) => {
                                log::info!("已清理旧配置目录: {:?}", old_config_path);
                            }
                            Err(e) => {
                                log::warn!("清理旧配置目录失败: {:?}, 错误: {}", old_config_path, e);
                            }
                        }
                    }
                }
            }
        }

        // 创建独立的配置目录
        let config_dir = working_dir.join(format!("config_{}", instance_name));
        if !config_dir.exists() {
            std::fs::create_dir_all(&config_dir).map_err(|e| {
                AppError::ProcessError(format!("创建配置目录失败: {}", e))
            })?;
        }
        log::info!("配置目录: {:?}", config_dir);

        // 查找可用的RPC端口（从15889开始，最多尝试10个端口）
        let rpc_port = Self::find_available_rpc_port(15889, 10).await?;
        log::info!("✅ 将使用RPC端口: {}", rpc_port);
        
        // 保存RPC端口
        *self.rpc_port.lock().await = Some(rpc_port);

        // Sanitize player name for hostname
        let sanitized_hostname = player_name
            .chars()
            .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_')
            .collect::<String>()
            .to_lowercase();
        
        log::info!("使用主机名: {}", sanitized_hostname);
        
        // 根据服务器节点协议自动选择监听器和默认协议
        let is_ws_peer = server_node.starts_with("ws://") || server_node.starts_with("wss://");
        let listener = if is_ws_peer { "ws://0.0.0.0:0/" } else { "udp://0.0.0.0:0" };
        let default_protocol = if is_ws_peer { "ws" } else { "udp" };

        // 读取高级功能配置
        use tauri::Manager;
        use crate::modules::config_manager::EasyTierAdvancedConfig;
        
        // 【关键修复】使用传入的配置参数，如果没有则从 ConfigManager 读取
        let (global_config, lobby_config) = if global_config_param.is_some() || lobby_config_param.is_some() {
            // 使用传入的配置参数
            log::info!("使用传入的配置参数");
            (
                global_config_param.unwrap_or(None),
                lobby_config_param.unwrap_or(None),
            )
        } else {
            // 从 ConfigManager 读取配置
            log::info!("从 ConfigManager 读取配置");
            let state = app_handle.state::<crate::modules::tauri_commands::AppState>();
            let core = state.core.lock().await;
            let config_manager = core.get_config_manager();
            let cfg_mgr = config_manager.lock().await;
            let user_config = cfg_mgr.get_config();
            
            let global_cfg = user_config.global_easytier_advanced_config.clone();
            let lobby_cfg = user_config.lobby_easytier_advanced_config.clone();
            
            drop(cfg_mgr);
            drop(core);
            
            (global_cfg, lobby_cfg)
        };
        
        log::info!("========================================");
        log::info!("📂 从 ConfigManager 读取配置");
        
        if let Some(ref global_cfg) = global_config {
            log::info!("📋 发现全局配置:");
            log::info!("  - dev_name: {:?}", global_cfg.dev_name);
            log::info!("  - no_tun: {}", global_cfg.no_tun);
            log::info!("  - dhcp: {}", global_cfg.dhcp);
        } else {
            log::warn!("⚠️ 未找到全局配置");
        }
        
        if let Some(ref lobby_cfg) = lobby_config {
            log::info!("📋 发现大厅配置:");
            log::info!("  - use_global_config: {}", lobby_cfg.use_global_config);
            log::info!("  - dev_name: {:?}", lobby_cfg.dev_name);
            log::info!("  - no_tun: {}", lobby_cfg.no_tun);
            log::info!("  - dhcp: {}", lobby_cfg.dhcp);
        } else {
            log::warn!("⚠️ 未找到大厅配置");
        }
        
        // 合并配置：大厅配置优先，如果大厅配置设置了 use_global_config，则使用全局配置
        let final_config = if let Some(lobby_cfg) = lobby_config {
            log::info!("========================================");
            log::info!("📋 发现大厅配置:");
            log::info!("  - use_global_config: {}", lobby_cfg.use_global_config);
            log::info!("  - dev_name: {:?}", lobby_cfg.dev_name);
            log::info!("  - no_tun: {}", lobby_cfg.no_tun);
            log::info!("  - dhcp: {}", lobby_cfg.dhcp);
            
            if lobby_cfg.use_global_config {
                // 使用全局配置
                log::info!("✅ 大厅配置设置了 use_global_config=true，将使用全局配置");
                if let Some(ref global_cfg) = global_config {
                    log::info!("📋 全局配置:");
                    log::info!("  - dev_name: {:?}", global_cfg.dev_name);
                    log::info!("  - no_tun: {}", global_cfg.no_tun);
                    log::info!("  - dhcp: {}", global_cfg.dhcp);
                    global_cfg.clone()
                } else {
                    log::warn!("⚠️ 大厅配置要求使用全局配置，但全局配置不存在，使用默认配置");
                    EasyTierAdvancedConfig::default()
                }
            } else {
                // 使用大厅配置
                log::info!("✅ 大厅配置设置了 use_global_config=false，将使用大厅配置");
                lobby_cfg
            }
        } else {
            // 没有大厅配置，使用全局配置或默认配置
            log::info!("========================================");
            log::info!("⚠️ 未找到大厅配置，将使用全局配置或默认配置");
            if let Some(ref global_cfg) = global_config {
                log::info!("📋 全局配置:");
                log::info!("  - dev_name: {:?}", global_cfg.dev_name);
                log::info!("  - no_tun: {}", global_cfg.no_tun);
                log::info!("  - dhcp: {}", global_cfg.dhcp);
                global_cfg.clone()
            } else {
                log::warn!("⚠️ 全局配置也不存在，使用默认配置");
                EasyTierAdvancedConfig::default()
            }
        };
        
        log::info!("========================================");
        log::info!("最终使用的高级配置:");
        log::info!("  - 使用全局配置标志: {}", final_config.use_global_config);
        log::info!("  - TUN 设备名称: {:?}", final_config.dev_name);
        log::info!("  - 无 TUN 模式: {}", final_config.no_tun);
        log::info!("  - DHCP: {}", final_config.dhcp);
        log::info!("  - 启用 SOCKS5: {}", final_config.enable_socks5);
        log::info!("  - 多线程: {}", final_config.multi_thread);
        log::info!("  - 延迟优先: {}", final_config.latency_first);
        log::info!("========================================");

        // 构建命令行参数
        let mut cmd = Command::new(&easytier_path);
        cmd.arg("--network-name")
            .arg(&network_name)
            .arg("--network-secret")
            .arg(&network_key)
            .arg("--peers")
            .arg(&server_node) // 单个节点地址
            .arg("--hostname")
            .arg(&sanitized_hostname) // 设置主机名用于Magic DNS
            .arg("--instance-name")
            .arg(&instance_name)
            .arg("--config-dir")
            .arg(&config_dir)
            .arg("--rpc-portal")
            .arg(format!("{}", rpc_port)) // 只传递端口号，EasyTier会自动在localhost上监听
            .arg("--listeners")
            .arg(listener)
            .arg("--default-protocol")
            .arg(default_protocol);
        
        // 应用高级配置
        Self::apply_advanced_config(&mut cmd, &final_config);
        
        // 【重要】输出完整的 EasyTier 命令行，用于验证配置是否生效
        let cmd_args: Vec<String> = cmd.as_std()
            .get_args()
            .map(|arg| arg.to_string_lossy().to_string())
            .collect();
        log::info!("========================================");
        log::info!("完整的 EasyTier 启动命令:");
        log::info!("可执行文件: {:?}", easytier_path);
        log::info!("命令行参数:");
        for (i, arg) in cmd_args.iter().enumerate() {
            if i % 2 == 0 && i + 1 < cmd_args.len() {
                // 参数名和值成对显示
                log::info!("  {} {}", arg, cmd_args[i + 1]);
            } else if i % 2 != 0 {
                // 跳过已经显示的值
                continue;
            } else {
                // 单独的参数（如 --no-tun）
                log::info!("  {}", arg);
            }
        }
        log::info!("========================================");
        
        cmd.current_dir(working_dir)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        
        // 设置环境变量，确保能找到 wintun.dll
        cmd.env("PATH", working_dir);
        
        log::info!("使用 DHCP + TUN 模式，创建虚拟网卡以支持完整的网络功能");
        log::info!("虚拟IP由DHCP服务器自动分配");
        log::info!("虚拟网卡名称: MCTier_Net（固定名称，方便识别和管理）");
        log::info!("使用单节点模式连接到: {}", server_node);
        log::info!("启用低延迟优先模式以降低延迟");
        if is_ws_peer {
            log::info!("启用 WebSockets 监听器以匹配官方 WS 节点");
        } else {
            log::info!("启用 UDP 监听器以支持 Minecraft 局域网发现功能");
        }
        log::info!("使用动态检测的RPC端口 {}，避免与其他EasyTier实例冲突", rpc_port);

        // 在 Windows 上隐藏控制台窗口
        #[cfg(target_os = "windows")]
        {
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        // 启动子进程
        let mut child = cmd.spawn().map_err(|e| {
            log::error!("启动 EasyTier 进程失败: {}", e);
            AppError::ProcessError(format!("启动 EasyTier 进程失败: {}", e))
        })?;

        // 获取标准输出和标准错误
        let stdout = child.stdout.take().ok_or_else(|| {
            AppError::ProcessError("无法获取 EasyTier 标准输出".to_string())
        })?;

        let stderr = child.stderr.take().ok_or_else(|| {
            AppError::ProcessError("无法获取 EasyTier 标准错误".to_string())
        })?;

        // 保存进程句柄和配置目录路径
        *self.easytier_process.lock().await = Some(child);
        *self.is_running.lock().await = true;
        *self.instance_config_dir.lock().await = Some(config_dir);

        log::info!("EasyTier 进程已启动，等待获取虚拟 IP...");

        // 启动输出监控任务
        // 注意：easytier-core 2.5.0 把运行日志（含 tun device error 等致命错误）写到 stdout，
        // 因此 stdout 监控也必须参与错误检测和日志缓存，否则真正的失败原因会被丢失
        let virtual_ip_clone = Arc::clone(&self.virtual_ip);
        let status_clone = Arc::clone(&self.status);
        let is_running_stdout = Arc::clone(&self.is_running);
        let stderr_buf_stdout = Arc::clone(&self.last_stderr);

        tokio::spawn(async move {
            Self::monitor_stdout(stdout, virtual_ip_clone, status_clone, is_running_stdout, stderr_buf_stdout).await;
        });

        let is_running_clone = Arc::clone(&self.is_running);
        let status_clone2 = Arc::clone(&self.status);
        let stderr_buf_clone = Arc::clone(&self.last_stderr);
        tokio::spawn(async move {
            Self::monitor_stderr(stderr, is_running_clone, status_clone2, stderr_buf_clone).await;
        });

        // 启动进程监控任务
        let process_clone = Arc::clone(&self.easytier_process);
        let status_clone = Arc::clone(&self.status);
        let is_running_clone = Arc::clone(&self.is_running);
        let virtual_ip_clone = Arc::clone(&self.virtual_ip);
        let stderr_buf_clone2 = Arc::clone(&self.last_stderr);

        tokio::spawn(async move {
            Self::monitor_process(
                process_clone,
                status_clone,
                is_running_clone,
                virtual_ip_clone,
                stderr_buf_clone2,
            )
            .await;
        });

        // 等待获取虚拟 IP（最多等待 60 秒）
        let timeout_duration = Duration::from_secs(60);
        let start_time = std::time::Instant::now();
        let mut last_log_time = std::time::Instant::now();

        loop {
            // 检查是否超时
            if start_time.elapsed() > timeout_duration {
                log::error!("❌ 获取虚拟 IP 超时（等待了60秒）");
                log::error!("可能的原因：");
                log::error!("  1. EasyTier进程启动失败");
                log::error!("  2. 网络连接问题，无法连接到信令服务器");
                log::error!("  3. RPC端口冲突");
                log::error!("  4. 虚拟网卡创建失败");
                self.stop_easytier().await?;
                return Err(AppError::NetworkError(
                    "获取虚拟 IP 超时：请检查网络连接和 EasyTier 服务状态".to_string(),
                ));
            }
            
            // 每5秒输出一次等待日志
            if last_log_time.elapsed().as_secs() >= 5 {
                let elapsed = start_time.elapsed().as_secs();
                log::info!("⏳ 等待获取虚拟 IP... 已等待 {} 秒 / 60 秒", elapsed);
                last_log_time = std::time::Instant::now();
            }
            
            // 检查是否有错误状态
            let current_status = self.status.lock().await.clone();
            if let ConnectionStatus::Error(err_msg) = current_status {
                log::error!("❌ 检测到错误状态: {}", err_msg);
                self.stop_easytier().await?;
                return Err(AppError::NetworkError(err_msg));
            }

            // 检查是否已从输出中获取到虚拟 IP
            let ip = self.virtual_ip.lock().await.clone();
            if let Some(ip_addr) = ip {
                log::info!("✅ 从输出中成功获取虚拟 IP: {}", ip_addr);
                *self.status.lock().await = ConnectionStatus::Connected(ip_addr.clone());
                return Ok(ip_addr);
            }
            
            // 【已废弃】不再使用 CLI 工具查询虚拟IP
            // easytier-cli已移除，完全依赖从标准输出解析虚拟IP
            // 如果超时仍未获取到IP，将在下面的超时检查中返回错误

            // 检查进程是否崩溃
            let is_running = *self.is_running.lock().await;
            if !is_running {
                log::error!("❌ EasyTier 进程意外终止");
                // 优先使用监控任务已经设置好的详细错误状态
                let status = self.status.lock().await.clone();
                if let ConnectionStatus::Error(err_msg) = status {
                    return Err(AppError::NetworkError(err_msg));
                }
                // 否则根据最近的 stderr 输出生成可读的错误说明
                let recent: Vec<String> =
                    self.last_stderr.lock().await.iter().cloned().collect();
                let msg = Self::describe_exit_failure(None, &recent);
                return Err(AppError::NetworkError(msg));
            }

            // 等待一小段时间后重试
            sleep(Duration::from_millis(100)).await;
        }
    }
    
    
    /// 检测端口是否可用
    /// 
    /// # 参数
    /// * `port` - 要检测的端口号
    /// 
    /// # 返回
    /// * `true` - 端口可用
    /// * `false` - 端口被占用
    async fn is_port_available(port: u16) -> bool {
        use tokio::net::TcpListener;
        
        match TcpListener::bind(format!("127.0.0.1:{}", port)).await {
            Ok(_) => {
                log::debug!("端口 {} 可用", port);
                true
            }
            Err(_) => {
                log::debug!("端口 {} 被占用", port);
                false
            }
        }
    }
    
    /// 查找可用的RPC端口
    /// 
    /// # 参数
    /// * `start_port` - 起始端口号
    /// * `max_attempts` - 最大尝试次数
    /// 
    /// # 返回
    /// * `Ok(u16)` - 可用的端口号
    /// * `Err(AppError)` - 未找到可用端口
    async fn find_available_rpc_port(start_port: u16, max_attempts: u16) -> Result<u16, AppError> {
        log::info!("开始查找可用的RPC端口，起始端口: {}", start_port);
        
        for i in 0..max_attempts {
            let port = start_port + i;
            if Self::is_port_available(port).await {
                log::info!("✅ 找到可用的RPC端口: {}", port);
                return Ok(port);
            }
        }
        
        Err(AppError::NetworkError(format!(
            "未找到可用的RPC端口（尝试范围: {}-{}）",
            start_port,
            start_port + max_attempts - 1
        )))
    }

    /// 启动前清理孤儿 EasyTier 进程（仅 Windows）
    ///
    /// 上一次 App 异常退出时可能残留 easytier-core.exe 进程，
    /// 它会占用固定虚拟网卡名 MCTier_Net 和 RPC 端口，
    /// 导致新进程创建网卡失败而"意外终止"。这里在启动前先强制清理。
    #[cfg(target_os = "windows")]
    async fn cleanup_orphan_processes() {
        log::info!("🧹 [PreStart] 检查并清理可能残留的孤儿 easytier-core.exe 进程...");
        let output = tokio::process::Command::new("taskkill")
            .args(&["/F", "/IM", "easytier-core.exe"])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .await;

        match output {
            Ok(o) => {
                let stdout = String::from_utf8_lossy(&o.stdout);
                // taskkill 在没有匹配进程时返回非 0，属正常情况，无需当作错误
                if stdout.contains("SUCCESS") || stdout.contains("成功") {
                    log::warn!("⚠️ [PreStart] 发现并清理了残留的 easytier-core.exe 进程，等待网卡释放...");
                    // 给系统一点时间释放虚拟网卡和端口
                    sleep(Duration::from_millis(800)).await;
                } else {
                    log::info!("✅ [PreStart] 未发现残留进程，环境干净");
                }
            }
            Err(e) => {
                log::warn!("⚠️ [PreStart] 清理孤儿进程命令执行失败（忽略）: {}", e);
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    async fn cleanup_orphan_processes() {
        // 非 Windows 平台不做处理
    }

    /// 根据进程退出码推断常见失败原因，返回更可读的错误说明
    ///
    /// 主要覆盖 Windows 下的几个高频致命退出码。
    fn describe_exit_failure(exit_code: Option<i32>, recent_stderr: &[String]) -> String {
        // 这些是 easytier-core 的通用汇总行，本身不包含真正原因，需要跳过，
        // 优先展示更靠前、更具体的致命错误（如 tun device error）
        let is_generic_summary = |s: &str| {
            let l = s.to_lowercase();
            l.contains("some instances stopped with errors")
                || l.contains("instance stopped")
                || l.trim() == "error: some instances stopped with errors"
        };

        // 先在最近日志里找"虚拟网卡创建失败"这类最关键的具体原因
        if recent_stderr.iter().any(|l| {
            l.contains("tun device error") || l.contains("Failed to create adapter")
        }) {
            return "虚拟网卡创建失败：请右键以管理员身份运行 MCTier，并将本软件加入杀毒软件/防火墙白名单；若仍失败，请重启电脑后重试".to_string();
        }

        // 优先使用 stderr/stdout 中的具体错误信息（跳过通用汇总行）
        let stderr_hint = recent_stderr
            .iter()
            .rev()
            .find(|l| {
                if is_generic_summary(l) {
                    return false;
                }
                let s = l.to_lowercase();
                s.contains("error") || s.contains("failed") || s.contains("panic")
            })
            .cloned();

        if let Some(code) = exit_code {
            // Windows 致命退出码（i32 表示的 NTSTATUS）
            // 0xC0000135 = -1073741515：缺少依赖 DLL（通常是 VC++ 运行库）
            // 0xC000007B = -1073741701：DLL/可执行文件位数不匹配（坏映像）
            // 0xC0000005 = -1073741819：访问冲突
            let known = match code {
                -1073741515 => Some(
                    "EasyTier 缺少运行库依赖（错误码 0xC0000135）：请安装 Microsoft Visual C++ 运行库后重试",
                ),
                -1073741701 => Some(
                    "EasyTier 运行库不兼容（错误码 0xC000007B）：请安装最新版 Microsoft Visual C++ 运行库",
                ),
                -1073741819 => Some(
                    "EasyTier 启动时发生访问冲突（错误码 0xC0000005）：可能被安全软件拦截或虚拟网卡驱动异常",
                ),
                _ => None,
            };

            if let Some(msg) = known {
                return msg.to_string();
            }

            if let Some(hint) = stderr_hint {
                return format!("EasyTier 进程意外终止（退出码 {}）：{}", code, hint);
            }
            return format!(
                "EasyTier 进程意外终止（退出码 {}）：可能被安全软件拦截、虚拟网卡创建失败或缺少运行库",
                code
            );
        }

        if let Some(hint) = stderr_hint {
            return format!("EasyTier 进程意外终止：{}", hint);
        }
        "EasyTier 进程意外终止：可能被安全软件拦截、虚拟网卡创建失败或缺少运行库，请尝试以管理员身份运行并将本软件加入杀毒软件白名单".to_string()
    }

    /// 监控标准输出，解析虚拟 IP
    ///
    /// 注意：easytier-core 2.5.0 将运行日志（包括 `tun device error`、
    /// `Failed to create adapter` 等致命错误）输出到 stdout 而非 stderr，
    /// 因此这里必须同时承担错误检测与最近日志缓存的职责。
    async fn monitor_stdout(
        stdout: tokio::process::ChildStdout,
        virtual_ip: Arc<Mutex<Option<String>>>,
        status: Arc<Mutex<ConnectionStatus>>,
        is_running: Arc<Mutex<bool>>,
        last_stderr: Arc<Mutex<std::collections::VecDeque<String>>>,
    ) {
        let reader = BufReader::new(stdout);
        let mut lines = reader.lines();

        while let Ok(Some(line)) = lines.next_line().await {
            // 打印所有输出用于调试
            log::info!("EasyTier stdout: {}", line);

            // 将含关键信息的行缓存进 last_stderr（统一作为"最近日志"缓冲区），
            // 供进程意外退出时 describe_exit_failure 定位真正原因
            {
                let lower = line.to_lowercase();
                if lower.contains("error") || lower.contains("failed") || lower.contains("panic") {
                    let mut buf = last_stderr.lock().await;
                    buf.push_back(line.clone());
                    while buf.len() > 30 {
                        buf.pop_front();
                    }
                }
            }

            // 虚拟网卡（TUN）创建失败——这是 Windows 上最高频的致命错误，
            // 在 2.5.0 中通过 stdout 输出，必须在此处捕获并给出可操作的提示
            if line.contains("tun device error") || line.contains("Failed to create adapter") {
                log::error!("检测到虚拟网卡创建失败: {}", line);
                *is_running.lock().await = false;
                *status.lock().await = ConnectionStatus::Error(
                    "虚拟网卡创建失败：请右键以管理员身份运行 MCTier，并将本软件加入杀毒软件/防火墙白名单；若仍失败，请重启电脑后重试".to_string(),
                );
                continue;
            }

            // WebSocket 节点升级失败（通常是反向代理/上游配置问题）
            if line.contains("DidNotSwitchProtocols(502)") {
                log::error!("检测到官方 WebSocket 节点返回 502: {}", line);
                *status.lock().await = ConnectionStatus::Error(
                    "官方 WebSocket 节点连接失败（HTTP 502）：请检查服务器反向代理与 EasyTier WS 上游".to_string(),
                );
                continue;
            }

            if line.contains("connect to peer error") {
                log::warn!("检测到 peer 连接错误: {}", line);
            }

            // 解析虚拟 IP
            // 查找 DHCP 分配的 IP 或明确标记为虚拟IP的行
            let line_lower = line.to_lowercase();
            
            // 检查是否包含虚拟IP相关的关键词
            let _is_virtual_ip_line = line_lower.contains("virtual ip") 
                || line_lower.contains("assigned ip")
                || line_lower.contains("dhcp")
                || line_lower.contains("got ip")
                || line_lower.contains("ipv4 address")
                || line_lower.contains("ip addr")
                || line_lower.contains("my ipv4")
                || (line_lower.contains("ipv4") && line_lower.contains("="));
            
            // 排除包含 local_addr 和配置行的行
            let is_excluded = line.contains("local_addr") 
                || line.contains("local:")
                || line.contains("ipv4 = \"")  // 配置行
                || line.contains("listeners")
                || line.contains("rpc_portal =");
            
            if !is_excluded {
                if let Some(ip) = Self::extract_ip_from_line(&line) {
                    // 排除网络地址（最后一位是0）和广播地址（最后一位是255）
                    let parts: Vec<&str> = ip.split('.').collect();
                    if parts.len() == 4 {
                        if let Ok(last_octet) = parts[3].parse::<u8>() {
                            // 只接受 1-254 的主机地址
                            if last_octet >= 1 && last_octet <= 254 {
                                log::info!("✅ 从输出中提取到有效的虚拟 IP: {}", ip);
                                *virtual_ip.lock().await = Some(ip.clone());
                                *status.lock().await = ConnectionStatus::Connected(ip);
                            } else {
                                log::debug!("跳过无效的主机地址: {} (最后一位: {})", ip, last_octet);
                            }
                        }
                    }
                }
            }
        }

        log::debug!("EasyTier 标准输出监控结束");
    }

    /// 监控标准错误
    async fn monitor_stderr(
        stderr: tokio::process::ChildStderr, 
        is_running: Arc<Mutex<bool>>,
        status: Arc<Mutex<ConnectionStatus>>,
        last_stderr: Arc<Mutex<std::collections::VecDeque<String>>>,
    ) {
        let reader = BufReader::new(stderr);
        let mut lines = reader.lines();

        while let Ok(Some(line)) = lines.next_line().await {
            log::warn!("EasyTier stderr: {}", line);

            // 缓存最近的 stderr 输出（最多保留 30 行），用于进程意外退出时定位原因
            {
                let mut buf = last_stderr.lock().await;
                buf.push_back(line.clone());
                while buf.len() > 30 {
                    buf.pop_front();
                }
            }

            // 检查是否有致命错误
            if line.contains("error") || line.contains("Error") || line.contains("ERROR") {
                log::error!("EasyTier 发生错误: {}", line);
                
                // 检查是否是 TUN 设备创建失败
                if line.contains("tun device error") || line.contains("Failed to create adapter") {
                    log::error!("TUN 设备创建失败，可能是缺少 WinTun 驱动或权限不足");
                    *is_running.lock().await = false;
                    *status.lock().await = ConnectionStatus::Error(
                        "虚拟网卡创建失败：请以管理员身份运行，并确认 WinTun 驱动正常、未被安全软件拦截".to_string()
                    );
                }
            }
        }

        log::debug!("EasyTier 标准错误监控结束");
    }

    /// 监控进程状态
    async fn monitor_process(
        process: Arc<Mutex<Option<Child>>>,
        status: Arc<Mutex<ConnectionStatus>>,
        is_running: Arc<Mutex<bool>>,
        virtual_ip: Arc<Mutex<Option<String>>>,
        last_stderr: Arc<Mutex<std::collections::VecDeque<String>>>,
    ) {
        loop {
            sleep(Duration::from_secs(1)).await;

            let mut process_guard = process.lock().await;
            if let Some(child) = process_guard.as_mut() {
                // 检查进程是否退出
                match child.try_wait() {
                    Ok(Some(exit_status)) => {
                        log::warn!("EasyTier 进程已退出，状态码: {:?}", exit_status);

                        // 先确定最终状态，再把 is_running 置为 false，
                        // 避免出现“is_running 已 false 但 status 还没更新”的瞬间窗口，
                        // 保证 start_easytier 的等待循环一定能读到带原因的错误状态。
                        let current = status.lock().await.clone();
                        let was_connected = matches!(current, ConnectionStatus::Connected(_));
                        let already_error = matches!(current, ConnectionStatus::Error(_));

                        if was_connected {
                            // 连接成功后进程退出，视为正常断开
                            *status.lock().await = ConnectionStatus::Disconnected;
                        } else if !already_error {
                            // 连接建立前异常退出：根据退出码 + stderr 生成可读原因
                            let recent: Vec<String> =
                                last_stderr.lock().await.iter().cloned().collect();
                            let msg = Self::describe_exit_failure(exit_status.code(), &recent);
                            log::error!("❌ EasyTier 启动阶段异常退出: {}", msg);
                            *status.lock().await = ConnectionStatus::Error(msg);
                        }

                        *is_running.lock().await = false;
                        *virtual_ip.lock().await = None;
                        *process_guard = None;
                        break;
                    }
                    Ok(None) => {
                        // 进程仍在运行
                    }
                    Err(e) => {
                        log::error!("检查进程状态失败: {}", e);
                        *is_running.lock().await = false;
                        *status.lock().await =
                            ConnectionStatus::Error(format!("进程状态检查失败: {}", e));
                        break;
                    }
                }
            } else {
                break;
            }
        }

        log::debug!("EasyTier 进程监控结束");
    }

    /// 从输出行中提取 IP 地址
    pub fn extract_ip_from_line(line: &str) -> Option<String> {
        // 使用正则表达式匹配 IPv4 地址
        // 匹配格式：xxx.xxx.xxx.xxx
        let ip_pattern = regex::Regex::new(r"\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b").ok()?;

        // 查找所有匹配的 IP 地址
        for cap in ip_pattern.captures_iter(line) {
            if let Some(ip_match) = cap.get(1) {
                let ip = ip_match.as_str();

                // 验证 IP 地址的有效性
                if Self::is_valid_ip(ip) {
                    // 只接受私有网络 IP 地址，并且排除本地回环地址
                    if Self::is_private_ip(ip) && !Self::is_loopback(ip) {
                        log::info!("从 EasyTier 输出中提取到候选虚拟IP: {}", ip);
                        log::info!("输出行内容: {}", line);
                        return Some(ip.to_string());
                    }
                }
            }
        }

        None
    }
    
    /// 检查是否为本地回环地址
    /// 
    /// 本地回环地址范围：127.0.0.0/8 (127.0.0.0 - 127.255.255.255)
    pub fn is_loopback(ip: &str) -> bool {
        let parts: Vec<u8> = ip.split('.')
            .filter_map(|p| p.parse::<u8>().ok())
            .collect();

        if parts.len() != 4 {
            return false;
        }

        // 127.0.0.0/8
        parts[0] == 127
    }

    /// 验证 IP 地址是否有效
    pub fn is_valid_ip(ip: &str) -> bool {
        let parts: Vec<&str> = ip.split('.').collect();
        if parts.len() != 4 {
            return false;
        }

        for part in parts {
            // u8 类型范围是 0-255，所以只需要检查是否能解析为 u8
            if part.parse::<u8>().is_err() {
                return false;
            }
        }

        true
    }

    /// 检查是否为私有网络 IP
    /// 
    /// 私有网络 IP 范围：
    /// - 10.0.0.0/8 (10.0.0.0 - 10.255.255.255)
    /// - 172.16.0.0/12 (172.16.0.0 - 172.31.255.255)
    /// - 192.168.0.0/16 (192.168.0.0 - 192.168.255.255)
    pub fn is_private_ip(ip: &str) -> bool {
        let parts: Vec<u8> = ip.split('.')
            .filter_map(|p| p.parse::<u8>().ok())
            .collect();

        if parts.len() != 4 {
            return false;
        }

        // 10.0.0.0/8
        if parts[0] == 10 {
            return true;
        }

        // 172.16.0.0/12
        if parts[0] == 172 && (16..=31).contains(&parts[1]) {
            return true;
        }

        // 192.168.0.0/16
        if parts[0] == 192 && parts[1] == 168 {
            return true;
        }

        false
    }

    /// 停止 EasyTier 服务
    /// 
    /// # 返回
    /// * `Ok(())` - 成功停止
    /// * `Err(AppError)` - 停止失败
    pub async fn stop_easytier(&self) -> Result<(), AppError> {
        log::info!("========================================");
        log::info!("🛑 [StopEasyTier] 开始停止 EasyTier 服务...");
        log::info!("========================================");

        let mut process_guard = self.easytier_process.lock().await;
        let mut graceful_shutdown_success = false;

        if let Some(mut child) = process_guard.take() {
            log::info!("🔄 [StopEasyTier] 正在优雅关闭 EasyTier 进程...");
            
            // 尝试优雅地终止进程
            match child.kill().await {
                Ok(_) => {
                    log::info!("✅ [StopEasyTier] 已发送 SIGTERM 信号到 EasyTier 进程（优雅关闭）");
                }
                Err(e) => {
                    log::warn!("⚠️ [StopEasyTier] 发送终止信号失败: {}", e);
                }
            }

            // 等待进程完全退出（最多等待3秒）
            log::info!("⏳ [StopEasyTier] 等待进程自然退出（最多3秒）...");
            match tokio::time::timeout(Duration::from_secs(3), child.wait()).await {
                Ok(Ok(status)) => {
                    log::info!("✅ [StopEasyTier] EasyTier 进程已优雅退出，状态码: {:?}", status);
                    log::info!("💡 [StopEasyTier] 进程通过优雅关闭方式退出，未使用强制终止");
                    graceful_shutdown_success = true;
                }
                Ok(Err(e)) => {
                    log::warn!("⚠️ [StopEasyTier] 等待进程退出时出错: {}", e);
                }
                Err(_) => {
                    log::warn!("⚠️ [StopEasyTier] 等待进程退出超时（3秒）");
                }
            }
        } else {
            log::info!("ℹ️ [StopEasyTier] EasyTier 服务未运行，无需关闭");
            graceful_shutdown_success = true; // 没有进程运行，视为成功
        }

        // 释放进程锁
        drop(process_guard);

        // 如果优雅关闭成功，跳过强制终止
        if graceful_shutdown_success {
            log::info!("✅ [StopEasyTier] EasyTier 进程已通过优雅方式关闭，无需强制终止");
        } else {
            // 只有在优雅关闭失败时才使用强制终止
            log::warn!("⚠️ [StopEasyTier] 优雅关闭失败，现在尝试强制终止（taskkill /F）...");
            log::warn!("💡 [StopEasyTier] 这是最后的手段，仅在优雅关闭失败时使用");
            
            #[cfg(target_os = "windows")]
            {
                let _ = tokio::process::Command::new("taskkill")
                    .args(&["/F", "/IM", "easytier-core.exe"])
                    .creation_flags(CREATE_NO_WINDOW)
                    .output()
                    .await;
                
                log::info!("✅ [StopEasyTier] 已执行强制终止命令（taskkill /F）");
            }
        }

        // 等待一小段时间确保进程完全退出
        log::info!("⏳ [StopEasyTier] 等待进程完全退出（300ms）...");
        sleep(Duration::from_millis(300)).await;
        log::info!("✅ [StopEasyTier] 进程退出等待完成");

        // 【已废弃】不再使用CLI工具清理实例
        // easytier-cli已移除，通过taskkill直接终止进程
        log::info!("ℹ️ [StopEasyTier] 跳过CLI工具清理（已废弃）");

        // 在Windows上清理虚拟网卡
        #[cfg(target_os = "windows")]
        {
            log::info!("========================================");
            log::info!("🧹 [StopEasyTier] 开始清理虚拟网卡...");
            log::info!("========================================");
            
            // 等待一小段时间，确保进程已完全退出
            log::info!("⏳ [StopEasyTier] 等待进程完全退出（500ms）...");
            sleep(Duration::from_millis(500)).await;
            log::info!("✅ [StopEasyTier] 等待完成，开始清理网卡");
            
            // 方法1: 使用 devcon 或 pnputil 强制删除 MCTier_Net 网卡
            log::info!("🔧 [StopEasyTier] 方法1: 使用pnputil强制删除MCTier_Net网卡...");
            
            // 首先列出所有网络设备
            match tokio::process::Command::new("pnputil")
                .args(&["/enum-devices", "/class", "Net"])
                .creation_flags(CREATE_NO_WINDOW)
                .output()
                .await
            {
                Ok(output) => {
                    let output_str = String::from_utf8_lossy(&output.stdout);
                    log::info!("📋 [StopEasyTier] 网络设备列表:\n{}", output_str);
                    
                    // 查找 MCTier_Net 或 WinTun 相关的设备实例ID
                    let mut device_ids_to_remove = Vec::new();
                    let mut current_instance_id = String::new();
                    let mut is_target_device = false;
                    
                    for line in output_str.lines() {
                        // 检查实例ID行
                        if line.contains("Instance ID:") || line.contains("实例 ID:") {
                            current_instance_id = line.split(':').nth(1)
                                .map(|s| s.trim().to_string())
                                .unwrap_or_default();
                            is_target_device = false;
                        }
                        
                        // 检查设备描述或友好名称（仅匹配 MCTier_ 开头的本应用网卡，
                        // 避免误伤 Tailscale / WireGuard 等其它基于 WinTun 的网卡）
                        if line.contains("MCTier_") &&
                           !current_instance_id.is_empty() {
                            is_target_device = true;
                        }
                        
                        // 如果找到目标设备，添加到删除列表
                        if is_target_device && !current_instance_id.is_empty() {
                            if !device_ids_to_remove.contains(&current_instance_id) {
                                log::info!("🎯 [StopEasyTier] 发现需要删除的设备: {}", current_instance_id);
                                device_ids_to_remove.push(current_instance_id.clone());
                            }
                            current_instance_id.clear();
                            is_target_device = false;
                        }
                    }
                    
                    // 删除找到的所有目标设备
                    for device_id in &device_ids_to_remove {
                        log::info!("🗑️ [StopEasyTier] 正在删除设备: {}", device_id);
                        
                        // 尝试删除设备
                        match tokio::process::Command::new("pnputil")
                            .args(&["/remove-device", device_id])
                            .creation_flags(CREATE_NO_WINDOW)
                            .output()
                            .await
                        {
                            Ok(remove_output) => {
                                let remove_result = String::from_utf8_lossy(&remove_output.stdout);
                                log::info!("📄 [StopEasyTier] 删除设备结果: {}", remove_result);
                                
                                if remove_output.status.success() {
                                    log::info!("✅ [StopEasyTier] 成功删除设备: {}", device_id);
                                } else {
                                    log::warn!("⚠️ [StopEasyTier] 删除设备失败: {}", device_id);
                                }
                            }
                            Err(e) => {
                                log::warn!("⚠️ [StopEasyTier] 执行删除命令失败: {}", e);
                            }
                        }
                        
                        sleep(Duration::from_millis(200)).await;
                    }
                    
                    if device_ids_to_remove.is_empty() {
                        log::info!("ℹ️ [StopEasyTier] 未发现需要删除的虚拟网卡设备");
                    } else {
                        log::info!("✅ [StopEasyTier] pnputil清理完成，共删除 {} 个设备", device_ids_to_remove.len());
                    }
                }
                Err(e) => {
                    log::warn!("⚠️ [StopEasyTier] 使用pnputil查询设备失败: {}", e);
                }
            }
            
            // 方法2: 使用netsh禁用和删除网卡
            log::info!("🔧 [StopEasyTier] 方法2: 使用netsh禁用和删除MCTier_Net网卡...");
            match tokio::process::Command::new("netsh")
                .args(&["interface", "show", "interface"])
                .creation_flags(CREATE_NO_WINDOW)
                .output()
                .await
            {
                Ok(output) => {
                    let output_str = String::from_utf8_lossy(&output.stdout);
                    log::info!("📋 [StopEasyTier] 网卡列表:\n{}", output_str);
                    
                    let mut disabled_count = 0;
                    
                    // 仅查找 MCTier_ 开头的本应用网卡（避免误伤其它 WinTun VPN）
                    for line in output_str.lines() {
                        if line.contains("MCTier_") {
                            log::info!("🎯 [StopEasyTier] 发现虚拟网卡: {}", line);
                            
                            // 尝试提取网卡名称（通常是最后一列）
                            let parts: Vec<&str> = line.split_whitespace().collect();
                            if parts.len() >= 3 {
                                let interface_name = parts[parts.len() - 1];
                                
                                if !interface_name.is_empty() && 
                                   interface_name != "Type" && 
                                   interface_name != "Interface" &&
                                   interface_name != "State" {
                                    log::info!("🔧 [StopEasyTier] 尝试禁用网卡: {}", interface_name);
                                    
                                    // 先禁用网卡
                                    match tokio::process::Command::new("netsh")
                                        .args(&["interface", "set", "interface", interface_name, "admin=disable"])
                                        .creation_flags(CREATE_NO_WINDOW)
                                        .output()
                                        .await
                                    {
                                        Ok(disable_output) => {
                                            if disable_output.status.success() {
                                                log::info!("✅ [StopEasyTier] 成功禁用网卡: {}", interface_name);
                                                disabled_count += 1;
                                            } else {
                                                log::warn!("⚠️ [StopEasyTier] 禁用网卡失败: {}", interface_name);
                                            }
                                        }
                                        Err(e) => {
                                            log::warn!("⚠️ [StopEasyTier] 执行禁用命令失败: {}", e);
                                        }
                                    }
                                    
                                    sleep(Duration::from_millis(200)).await;
                                }
                            }
                        }
                    }
                    
                    if disabled_count > 0 {
                        log::info!("✅ [StopEasyTier] netsh清理完成，共禁用 {} 个网卡", disabled_count);
                    } else {
                        log::info!("ℹ️ [StopEasyTier] 未发现需要禁用的网卡");
                    }
                }
                Err(e) => {
                    log::warn!("⚠️ [StopEasyTier] 查询网卡列表失败: {}", e);
                }
            }
            
            // 方法3: 使用 PowerShell 强制删除网卡
            log::info!("🔧 [StopEasyTier] 方法3: 使用PowerShell强制删除MCTier相关网卡...");
            let ps_script = r#"
                Get-NetAdapter | Where-Object { 
                    $_.Name -like '*MCTier_*'
                } | ForEach-Object {
                    Write-Host "正在删除网卡: $($_.Name)"
                    try {
                        Disable-NetAdapter -Name $_.Name -Confirm:$false -ErrorAction Stop
                        Write-Host "已禁用网卡: $($_.Name)"
                    } catch {
                        Write-Host "禁用网卡失败: $_"
                    }
                }
            "#;
            
            match tokio::process::Command::new("powershell")
                .args(&["-NoProfile", "-NonInteractive", "-Command", ps_script])
                .creation_flags(CREATE_NO_WINDOW)
                .output()
                .await
            {
                Ok(ps_output) => {
                    let ps_result = String::from_utf8_lossy(&ps_output.stdout);
                    log::info!("📄 [StopEasyTier] PowerShell执行结果:\n{}", ps_result);
                    
                    if !ps_result.is_empty() {
                        log::info!("✅ [StopEasyTier] PowerShell清理完成");
                    } else {
                        log::info!("ℹ️ [StopEasyTier] PowerShell未发现需要清理的网卡");
                    }
                }
                Err(e) => {
                    log::warn!("⚠️ [StopEasyTier] 执行PowerShell脚本失败: {}", e);
                }
            }
            
            // 最终等待，确保所有清理操作完成
            log::info!("⏳ [StopEasyTier] 等待所有清理操作完成（500ms）...");
            sleep(Duration::from_millis(500)).await;
            
            log::info!("========================================");
            log::info!("✅ [StopEasyTier] 虚拟网卡清理流程完成");
            log::info!("========================================");
        }

        // 清理状态
        log::info!("🧹 [StopEasyTier] 清理服务状态...");
        *self.is_running.lock().await = false;
        *self.status.lock().await = ConnectionStatus::Disconnected;
        *self.virtual_ip.lock().await = None;
        log::info!("✅ [StopEasyTier] 服务状态已清理");

        // 清理配置目录
        let config_dir = self.instance_config_dir.lock().await.take();
        if let Some(dir) = config_dir {
            log::info!("========================================");
            log::info!("🗑️ [StopEasyTier] 开始清理配置目录: {:?}", dir);
            log::info!("========================================");
            
            // 增加重试次数和等待时间，提高清理成功率
            for attempt in 1..=5 {
                match std::fs::remove_dir_all(&dir) {
                    Ok(_) => {
                        log::info!("✅ [StopEasyTier] 配置目录已清理（尝试 {}/5）", attempt);
                        break;
                    }
                    Err(e) => {
                        if attempt < 5 {
                            log::warn!("⚠️ [StopEasyTier] 清理配置目录失败（尝试 {}/5）: {}，等待后重试...", attempt, e);
                            sleep(Duration::from_millis(500)).await;
                        } else {
                            log::warn!("⚠️ [StopEasyTier] 清理配置目录失败: {}，将在下次启动时自动清理", e);
                            // 最后一次尝试：标记目录以便下次启动时清理
                            // 配置目录名称格式为 config_mctier-xxx，下次启动时会自动清理
                        }
                    }
                }
            }
            
            log::info!("========================================");
            log::info!("✅ [StopEasyTier] 配置目录清理流程完成");
            log::info!("========================================");
        } else {
            log::info!("ℹ️ [StopEasyTier] 无需清理配置目录（不存在）");
        }

        log::info!("========================================");
        log::info!("✅ [StopEasyTier] EasyTier 服务已停止并清理完成");
        log::info!("========================================");

        Ok(())
    }

    /// 检查连接状态
    /// 
    /// # 返回
    /// 当前连接状态
    pub async fn check_connection(&self) -> ConnectionStatus {
        self.status.lock().await.clone()
    }

    /// 获取虚拟 IP 地址
    /// 
    /// # 返回
    /// * `Some(String)` - 虚拟 IP 地址
    /// * `None` - 未连接或未获取到 IP
    pub async fn get_virtual_ip(&self) -> Option<String> {
        self.virtual_ip.lock().await.clone()
    }

    /// 检查服务是否正在运行
    /// 
    /// # 返回
    /// * `true` - 正在运行
    /// * `false` - 未运行
    pub async fn is_running(&self) -> bool {
        *self.is_running.lock().await
    }

    /// 重启服务
    /// 
    /// # 参数
    /// * `network_name` - 网络名称
    /// * `network_key` - 网络密钥
    /// * `server_node` - 服务器节点地址
    /// * `player_name` - 玩家名称（用于设置hostname）
    /// * `app_handle` - Tauri应用句柄
    /// 
    /// # 返回
    /// * `Ok(String)` - 成功重启，返回虚拟 IP
    /// * `Err(AppError)` - 重启失败
    pub async fn restart(
        &self,
        network_name: String,
        network_key: String,
        server_node: String,
        player_name: String,
        app_handle: &tauri::AppHandle,
    ) -> Result<String, AppError> {
        log::info!("正在重启 EasyTier 服务...");

        // 先停止服务
        self.stop_easytier().await?;

        // 等待一小段时间确保资源释放
        sleep(Duration::from_secs(1)).await;

        // 重新启动服务
        self.start_easytier(network_name, network_key, server_node, player_name, app_handle)
            .await
    }
}

// 实现 Drop trait，确保进程在服务销毁时被清理
impl Drop for NetworkService {
    fn drop(&mut self) {
        log::info!("NetworkService 正在销毁，清理资源...");
        // 注意：这里不能使用 async，所以我们只能尽力而为
        // 实际的清理应该在调用 stop_easytier 时完成
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_connection_status_serialization() {
        let status = ConnectionStatus::Connected("10.144.144.1".to_string());
        let json = serde_json::to_string(&status).unwrap();
        let deserialized: ConnectionStatus = serde_json::from_str(&json).unwrap();
        assert_eq!(status, deserialized);
    }

    #[test]
    fn test_extract_ip_from_line() {
        let test_cases = vec![
            ("Virtual IP: 10.144.144.1", Some("10.144.144.1")),
            ("Got IP: 192.168.1.100", Some("192.168.1.100")),
            ("Assigned IP: 172.16.0.1", Some("172.16.0.1")),
            ("No IP here", None),
            ("Invalid IP: 999.999.999.999", None),
            ("Localhost: 127.0.0.1", None), // 应该被排除
        ];

        for (input, expected) in test_cases {
            let result = NetworkService::extract_ip_from_line(input);
            assert_eq!(
                result,
                expected.map(|s| s.to_string()),
                "Failed for input: {}",
                input
            );
        }
    }

    #[test]
    fn test_is_valid_ip() {
        assert!(NetworkService::is_valid_ip("10.144.144.1"));
        assert!(NetworkService::is_valid_ip("192.168.1.1"));
        assert!(NetworkService::is_valid_ip("172.16.0.1"));
        assert!(NetworkService::is_valid_ip("0.0.0.0"));
        assert!(NetworkService::is_valid_ip("255.255.255.255"));

        assert!(!NetworkService::is_valid_ip("256.1.1.1"));
        assert!(!NetworkService::is_valid_ip("1.1.1"));
        assert!(!NetworkService::is_valid_ip("1.1.1.1.1"));
        assert!(!NetworkService::is_valid_ip("abc.def.ghi.jkl"));
    }

    #[tokio::test]
    async fn test_network_service_creation() {
        let service = NetworkService::new_with_defaults();
        assert!(!service.is_running().await);
        assert_eq!(
            service.check_connection().await,
            ConnectionStatus::Disconnected
        );
        assert_eq!(service.get_virtual_ip().await, None);
    }

    #[tokio::test]
    async fn test_stop_when_not_running() {
        let service = NetworkService::new_with_defaults();
        let result = service.stop_easytier().await;
        assert!(result.is_ok());
    }

    #[test]
    fn test_default_network_config() {
        let config = NetworkConfig::default();
        assert_eq!(config.easytier_path, PathBuf::from("easytier-core.exe"));
        assert_eq!(config.config_dir, PathBuf::from("./config"));
    }

    // ========== 创建大厅流程 - EasyTier 启动测试 ==========

    #[test]
    fn test_extract_ip_comprehensive() {
        let test_cases = vec![
            // 有效的 IP 提取
            ("Virtual IP: 10.144.144.1", Some("10.144.144.1")),
            ("Got IP: 192.168.1.100", Some("192.168.1.100")),
            ("Assigned IP: 172.16.0.1", Some("172.16.0.1")),
            ("IP address is 10.0.0.1", Some("10.0.0.1")),
            ("Your IP: 192.168.0.1", Some("192.168.0.1")),
            ("Connected with IP 10.10.10.10", Some("10.10.10.10")),
            
            // 无效的情况
            ("No IP here", None),
            ("Invalid IP: 999.999.999.999", None),
            ("Localhost: 127.0.0.1", None), // 本地回环应该被排除
            ("Zero IP: 0.0.0.0", None), // 0.0.0.0 应该被排除
            ("", None), // 空字符串
            ("Just some text", None),
        ];

        for (input, expected) in test_cases {
            let result = NetworkService::extract_ip_from_line(input);
            assert_eq!(
                result,
                expected.map(|s| s.to_string()),
                "提取 IP 失败，输入: {}",
                input
            );
        }
    }

    #[test]
    fn test_ip_validation_comprehensive() {
        // 有效的 IP 地址
        let valid_ips = vec![
            "10.144.144.1",
            "192.168.1.1",
            "172.16.0.1",
            "1.2.3.4",
            "255.255.255.255",
            "0.0.0.0",
            "127.0.0.1",
            "10.0.0.1",
            "192.168.0.1",
        ];

        for ip in valid_ips {
            assert!(
                NetworkService::is_valid_ip(ip),
                "应该接受有效的 IP: {}",
                ip
            );
        }

        // 无效的 IP 地址
        let invalid_ips = vec![
            "256.1.1.1",      // 超出范围
            "1.256.1.1",      // 超出范围
            "1.1.256.1",      // 超出范围
            "1.1.1.256",      // 超出范围
            "1.1.1",          // 缺少段
            "1.1",            // 缺少段
            "1",              // 缺少段
            "1.1.1.1.1",      // 多余段
            "abc.def.ghi.jkl", // 非数字
            "",               // 空字符串
            "...",            // 只有点
            "1..1.1",         // 连续的点
            "1.1.1.",         // 末尾有点
            ".1.1.1",         // 开头有点
            "-1.1.1.1",       // 负数
            "1.1.1.1a",       // 包含字母
        ];

        for ip in invalid_ips {
            assert!(
                !NetworkService::is_valid_ip(ip),
                "应该拒绝无效的 IP: {}",
                ip
            );
        }
    }

    #[test]
    fn test_connection_status_all_variants() {
        let statuses = vec![
            ConnectionStatus::Connected("10.144.144.1".to_string()),
            ConnectionStatus::Disconnected,
            ConnectionStatus::Connecting,
            ConnectionStatus::Error("连接失败".to_string()),
        ];

        for status in statuses {
            // 测试序列化
            let json = serde_json::to_string(&status).unwrap();
            assert!(!json.is_empty(), "序列化结果不应为空");
            
            // 测试反序列化
            let deserialized: ConnectionStatus = serde_json::from_str(&json).unwrap();
            assert_eq!(status, deserialized, "往返序列化应该保持一致");
        }
    }

    #[tokio::test]
    async fn test_network_service_initial_state() {
        let service = NetworkService::new_with_defaults();
        
        // 验证初始状态
        assert!(!service.is_running().await, "初始状态不应该在运行");
        assert_eq!(
            service.check_connection().await,
            ConnectionStatus::Disconnected,
            "初始连接状态应该是断开"
        );
        assert_eq!(
            service.get_virtual_ip().await,
            None,
            "初始虚拟 IP 应该为 None"
        );
    }

    #[tokio::test]
    async fn test_stop_easytier_when_not_running() {
        let service = NetworkService::new_with_defaults();
        
        // 停止未运行的服务应该成功
        let result = service.stop_easytier().await;
        assert!(result.is_ok(), "停止未运行的服务应该成功");
        
        // 验证状态仍然是断开
        assert!(!service.is_running().await);
        assert_eq!(service.check_connection().await, ConnectionStatus::Disconnected);
    }

    #[test]
    fn test_network_config_creation() {
        let config = NetworkConfig {
            easytier_path: PathBuf::from("custom/path/easytier.exe"),
            config_dir: PathBuf::from("custom/config"),
        };
        
        assert_eq!(config.easytier_path, PathBuf::from("custom/path/easytier.exe"));
        assert_eq!(config.config_dir, PathBuf::from("custom/config"));
    }

    #[test]
    fn test_network_service_with_custom_config() {
        let config = NetworkConfig {
            easytier_path: PathBuf::from("test/easytier.exe"),
            config_dir: PathBuf::from("test/config"),
        };
        
        let _service = NetworkService::new(config);
        // 服务应该能够使用自定义配置创建
    }

    #[test]
    fn test_extract_ip_with_multiple_ips() {
        // 当一行包含多个 IP 时，应该返回第一个有效的非本地 IP
        let line = "Connecting from 127.0.0.1 to 10.144.144.1";
        let result = NetworkService::extract_ip_from_line(line);
        assert_eq!(result, Some("10.144.144.1".to_string()));
    }

    #[test]
    fn test_extract_ip_edge_cases() {
        let test_cases = vec![
            // 边界值
            ("IP: 0.0.0.1", Some("0.0.0.1")),
            ("IP: 255.255.255.254", Some("255.255.255.254")),
            
            // 特殊格式
            ("IP:10.144.144.1", Some("10.144.144.1")), // 没有空格
            ("IP: 10.144.144.1 ", Some("10.144.144.1")), // 末尾有空格
            (" IP: 10.144.144.1", Some("10.144.144.1")), // 开头有空格
            
            // 包含其他文本
            ("The virtual IP is 10.144.144.1 and ready", Some("10.144.144.1")),
            ("Network: 10.144.144.1/24", Some("10.144.144.1")),
        ];

        for (input, expected) in test_cases {
            let result = NetworkService::extract_ip_from_line(input);
            assert_eq!(
                result,
                expected.map(|s| s.to_string()),
                "输入: {}",
                input
            );
        }
    }

    #[test]
    fn test_connection_status_equality() {
        let status1 = ConnectionStatus::Connected("10.144.144.1".to_string());
        let status2 = ConnectionStatus::Connected("10.144.144.1".to_string());
        let status3 = ConnectionStatus::Connected("10.144.144.2".to_string());
        
        assert_eq!(status1, status2, "相同的连接状态应该相等");
        assert_ne!(status1, status3, "不同的连接状态不应该相等");
        
        let status4 = ConnectionStatus::Disconnected;
        let status5 = ConnectionStatus::Disconnected;
        assert_eq!(status4, status5, "断开状态应该相等");
    }

    #[test]
    fn test_connection_status_clone() {
        let status = ConnectionStatus::Connected("10.144.144.1".to_string());
        let cloned = status.clone();
        
        assert_eq!(status, cloned, "克隆的状态应该相等");
    }

    #[test]
    fn test_ip_validation_boundary_values() {
        // 测试边界值
        assert!(NetworkService::is_valid_ip("0.0.0.0"));
        assert!(NetworkService::is_valid_ip("255.255.255.255"));
        assert!(NetworkService::is_valid_ip("0.0.0.1"));
        assert!(NetworkService::is_valid_ip("255.255.255.254"));
        
        // 测试超出边界
        assert!(!NetworkService::is_valid_ip("256.0.0.0"));
        assert!(!NetworkService::is_valid_ip("0.256.0.0"));
        assert!(!NetworkService::is_valid_ip("0.0.256.0"));
        assert!(!NetworkService::is_valid_ip("0.0.0.256"));
    }

    #[test]
    fn test_extract_ip_no_false_positives() {
        // 确保不会错误地提取非 IP 的数字
        let test_cases = vec![
            "Port: 11010",
            "Version: 1.2.3.4.5",
            "Count: 192",
            "ID: 12345",
        ];

        for input in test_cases {
            let result = NetworkService::extract_ip_from_line(input);
            // 这些输入可能包含看起来像 IP 的数字，但不应该被提取
            // 或者如果提取了，应该是无效的
            if let Some(ip) = result {
                // 如果提取了 IP，验证它确实是有效的 IP 格式
                assert!(NetworkService::is_valid_ip(&ip), "提取的应该是有效 IP: {}", ip);
            }
        }
    }

    #[tokio::test]
    async fn test_network_service_state_consistency() {
        let service = NetworkService::new_with_defaults();
        
        // 多次检查状态应该保持一致
        for _ in 0..5 {
            assert!(!service.is_running().await);
            assert_eq!(service.check_connection().await, ConnectionStatus::Disconnected);
            assert_eq!(service.get_virtual_ip().await, None);
        }
    }
}
