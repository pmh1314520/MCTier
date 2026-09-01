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
use crate::modules::privileged_helper::{self, HelperEvent, HelperSession};

/// 检查是否以管理员权限运行（仅 Windows）
#[cfg(windows)]
fn is_elevated() -> bool {
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::Security::{
        GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY,
    };
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

/// 非 Windows 平台始终返回 true（不需要管理员权限）。
///
/// Linux 上应用本体确实不需要 root：创建 TUN 只要求 easytier-core 这个**文件**
/// 具备 cap_net_admin，检查逻辑在 linux_platform::ensure_easytier_tun_capability，
/// 由 start_easytier 在启动前调用。所以这里返回 true 不是绕过检查，而是检查点
/// 换了位置；调用方全在 #[cfg(windows)] 内，故标注 allow(dead_code)。
#[cfg(not(windows))]
#[allow(dead_code)]
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
    /// Windows 上由窄权限 helper 管理的 EasyTier 会话
    #[cfg(windows)]
    helper_session: Arc<Mutex<Option<HelperSession>>>,
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
            #[cfg(windows)]
            helper_session: Arc::new(Mutex::new(None)),
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
            cmd.arg("--bind-device").arg("true");
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
        )
        .await
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
        // 检查是否已经在运行
        let is_running = *self.is_running.lock().await;
        if is_running {
            return Err(AppError::NetworkError("EasyTier 服务已在运行".to_string()));
        }

        log::info!("========================================");
        log::info!("正在启动 EasyTier 服务");
        log::info!("  网络名称: {}", network_name);
        log::info!("  节点服务器: {}", server_node);
        log::info!("========================================");

        // 更新状态为连接中
        *self.status.lock().await = ConnectionStatus::Connecting;

        // Windows cleanup and resource materialization are performed by the
        // narrow elevated helper. Unix keeps the existing local cleanup path.
        #[cfg(not(windows))]
        Self::cleanup_orphan_processes().await;

        // 清空上一次的 stderr 缓存
        self.last_stderr.lock().await.clear();

        // 获取 EasyTier 可执行文件路径
        let easytier_path = self.get_easytier_path()?;

        log::info!("使用 EasyTier 路径: {:?}", easytier_path);

        // Linux：创建 TUN 需要 easytier-core 具备 cap_net_admin 文件能力。
        // 这里在启动前先确认（缺失时弹一次 polkit 授权），失败就明确报错，
        // 而不是让 easytier-core 起来后再以看不懂的退出码死掉。
        #[cfg(target_os = "linux")]
        if let Err(error) =
            crate::modules::linux_platform::ensure_easytier_tun_capability(app_handle).await
        {
            log::error!("TUN 能力检查失败: {}", error);
            *self.status.lock().await = ConnectionStatus::Error(error.clone());
            return Err(AppError::NetworkError(error));
        }

        // 获取 EasyTier 所在目录作为工作目录
        let working_dir = easytier_path
            .parent()
            .ok_or_else(|| AppError::ProcessError("无法获取 EasyTier 所在目录".to_string()))?;

        log::info!("设置工作目录: {:?}", working_dir);

        #[cfg(not(windows))]
        {
            // working_dir 在非 Windows 分支没有其他用途，显式消费避免 unused 告警。
            let _ = working_dir;
            log::info!("Linux 平台：EasyTier 使用内核 TUN（/dev/net/tun），无需驱动文件");
        }

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
        #[cfg(not(windows))]
        {
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
                                    log::warn!(
                                        "清理旧配置目录失败: {:?}, 错误: {}",
                                        old_config_path,
                                        e
                                    );
                                }
                            }
                        }
                    }
                }
            }
        }

        // 创建独立的配置目录
        let config_dir = working_dir.join(format!("config_{}", instance_name));
        #[cfg(not(windows))]
        if !config_dir.exists() {
            std::fs::create_dir_all(&config_dir)
                .map_err(|e| AppError::ProcessError(format!("创建配置目录失败: {}", e)))?;
        }
        log::info!("配置目录: {:?}", config_dir);

        // 查找可用的RPC端口（随机化起点，避免二次使用时端口粘连导致 os error 10013）
        let rpc_port = Self::find_available_rpc_port_randomized().await?;
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
        // 【二次使用关键修复】不再使用端口 0（由系统自动分配），因为系统分配的
        // 临时端口可能落入 Windows(Hyper-V/Docker winnat) 保留端口段而触发 os error 10013。
        // 改为预先探测一个可用的显式端口给监听器使用，确保稳定。
        let listener_port = Self::find_available_rpc_port_randomized()
            .await
            .unwrap_or(0); // 兜底：万一找不到则退回端口 0 让系统分配
        let listener = if is_ws_peer {
            format!("ws://0.0.0.0:{}/", listener_port)
        } else {
            format!("udp://0.0.0.0:{}", listener_port)
        };
        log::info!("✅ 监听器使用显式端口: {} -> {}", listener_port, listener);
        let default_protocol = if is_ws_peer { "ws" } else { "udp" };

        // 读取高级功能配置
        use crate::modules::config_manager::EasyTierAdvancedConfig;
        use tauri::Manager;

        // 【关键修复】使用传入的配置参数，如果没有则从 ConfigManager 读取
        let (global_config, lobby_config) =
            if global_config_param.is_some() || lobby_config_param.is_some() {
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

        // 只连接用户当前选择的节点。节点选择必须具有确定性，不能在节点离线时
        // 偷换到其它内置节点，否则用户会误以为已连接到所选服务器。
        let peer_node = server_node.trim().to_string();
        log::info!("使用指定 EasyTier 节点: {}", peer_node);

        // 构建命令行参数
        let mut cmd = Command::new(&easytier_path);
        cmd.arg("--network-name")
            .arg(&network_name)
            .arg("--network-secret")
            .arg(&network_key);
        cmd.arg("--peers").arg(&peer_node);
        cmd.arg("--hostname")
            .arg(&sanitized_hostname) // 设置主机名用于Magic DNS
            .arg("--instance-name")
            .arg(&instance_name)
            .arg("--config-dir")
            .arg(&config_dir)
            .arg("--rpc-portal")
            .arg(format!("127.0.0.1:{}", rpc_port)) // 显式绑定回环地址：避免裸端口被绑到 0.0.0.0 而撞上 Windows(Hyper-V/Docker) 保留端口段导致 os error 10013
            .arg("--listeners")
            .arg(listener)
            .arg("--default-protocol")
            .arg(default_protocol);

        // 应用高级配置
        Self::apply_advanced_config(&mut cmd, &final_config);

        // 【重要】输出完整的 EasyTier 命令行，用于验证配置是否生效
        let cmd_args: Vec<String> = cmd
            .as_std()
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
                let value = if arg == "--network-secret" {
                    "<redacted>"
                } else {
                    cmd_args[i + 1].as_str()
                };
                log::info!("  {} {}", arg, value);
            } else if i % 2 != 0 {
                // 跳过已经显示的值
                continue;
            } else {
                // 单独的参数（如 --no-tun）
                log::info!("  {}", arg);
            }
        }
        log::info!("========================================");

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
        log::info!(
            "使用动态检测的RPC端口 {}，避免与其他EasyTier实例冲突",
            rpc_port
        );

        let launch_args = cmd_args.clone();

        // Windows 生产模式：使用 privileged helper
        #[cfg(all(windows, not(debug_assertions)))]
        {
            let (session, reader) = privileged_helper::start_easytier(
                easytier_path.clone(),
                working_dir.to_path_buf(),
                config_dir.clone(),
                launch_args,
            )
            .await
            .map_err(AppError::ProcessError)?;
            *self.helper_session.lock().await = Some(session);
            *self.is_running.lock().await = true;
            *self.instance_config_dir.lock().await = Some(config_dir);

            let virtual_ip = Arc::clone(&self.virtual_ip);
            let status = Arc::clone(&self.status);
            let is_running = Arc::clone(&self.is_running);
            let last_stderr = Arc::clone(&self.last_stderr);
            tokio::spawn(async move {
                Self::monitor_helper(reader, virtual_ip, status, is_running, last_stderr).await;
            });
        }

        // Windows 开发模式：直接启动进程（类似 Linux）
        #[cfg(all(windows, debug_assertions))]
        {
            log::info!("🔧 开发模式 - 直接启动 EasyTier 进程（不使用 privileged helper）");
            
            cmd.current_dir(working_dir)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .kill_on_drop(true);

            let mut child = cmd.spawn().map_err(|e| {
                log::error!("启动 EasyTier 进程失败: {}", e);
                AppError::ProcessError(format!("启动 EasyTier 进程失败: {}", e))
            })?;
            let stdout = child
                .stdout
                .take()
                .ok_or_else(|| AppError::ProcessError("无法获取 EasyTier 标准输出".to_string()))?;
            let stderr = child
                .stderr
                .take()
                .ok_or_else(|| AppError::ProcessError("无法获取 EasyTier 标准错误".to_string()))?;

            *self.easytier_process.lock().await = Some(child);
            *self.is_running.lock().await = true;
            *self.instance_config_dir.lock().await = Some(config_dir.clone());

            log::info!("EasyTier 进程已启动（开发模式），等待获取虚拟 IP...");

            let virtual_ip_clone = Arc::clone(&self.virtual_ip);
            let status_clone = Arc::clone(&self.status);
            let is_running_stdout = Arc::clone(&self.is_running);
            let stderr_buf_stdout = Arc::clone(&self.last_stderr);
            tokio::spawn(async move {
                Self::monitor_stdout(
                    stdout,
                    virtual_ip_clone,
                    status_clone,
                    is_running_stdout,
                    stderr_buf_stdout,
                )
                .await;
            });

            let is_running_clone = Arc::clone(&self.is_running);
            let status_clone2 = Arc::clone(&self.status);
            let stderr_buf_clone = Arc::clone(&self.last_stderr);
            tokio::spawn(async move {
                Self::monitor_stderr(stderr, is_running_clone, status_clone2, stderr_buf_clone)
                    .await;
            });
        }

        #[cfg(not(windows))]
        {
            cmd.current_dir(working_dir)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .kill_on_drop(true)
                .env("PATH", working_dir);

            let mut child = cmd.spawn().map_err(|e| {
                log::error!("启动 EasyTier 进程失败: {}", e);
                AppError::ProcessError(format!("启动 EasyTier 进程失败: {}", e))
            })?;
            let stdout = child
                .stdout
                .take()
                .ok_or_else(|| AppError::ProcessError("无法获取 EasyTier 标准输出".to_string()))?;
            let stderr = child
                .stderr
                .take()
                .ok_or_else(|| AppError::ProcessError("无法获取 EasyTier 标准错误".to_string()))?;

            *self.easytier_process.lock().await = Some(child);
            *self.is_running.lock().await = true;
            *self.instance_config_dir.lock().await = Some(config_dir);

            log::info!("EasyTier 进程已启动，等待获取虚拟 IP...");

            let virtual_ip_clone = Arc::clone(&self.virtual_ip);
            let status_clone = Arc::clone(&self.status);
            let is_running_stdout = Arc::clone(&self.is_running);
            let stderr_buf_stdout = Arc::clone(&self.last_stderr);
            tokio::spawn(async move {
                Self::monitor_stdout(
                    stdout,
                    virtual_ip_clone,
                    status_clone,
                    is_running_stdout,
                    stderr_buf_stdout,
                )
                .await;
            });

            let is_running_clone = Arc::clone(&self.is_running);
            let status_clone2 = Arc::clone(&self.status);
            let stderr_buf_clone = Arc::clone(&self.last_stderr);
            tokio::spawn(async move {
                Self::monitor_stderr(stderr, is_running_clone, status_clone2, stderr_buf_clone)
                    .await;
            });

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
        }

        log::info!("EasyTier 进程已启动，等待获取虚拟 IP...");

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
                let recent: Vec<String> = self.last_stderr.lock().await.iter().cloned().collect();
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

        // 同时测试 0.0.0.0 与 127.0.0.1：
        // easytier 的 RPC portal 实际绑定在 0.0.0.0，若只测 127.0.0.1，
        // 当某端口被其他进程以独占方式占用 0.0.0.0 时，会误判为"可用"，
        // 随后交给 easytier 绑定就会触发 os error 10013（访问权限不允许）。
        let addrs = [format!("0.0.0.0:{}", port), format!("127.0.0.1:{}", port)];

        for addr in &addrs {
            match TcpListener::bind(addr).await {
                Ok(listener) => {
                    // 立即释放，确保不会持有端口
                    drop(listener);
                }
                Err(_) => {
                    log::debug!("端口 {} 在 {} 上不可用", port, addr);
                    return false;
                }
            }
        }

        log::debug!("端口 {} 可用", port);
        true
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

    /// 查找可用的RPC端口（随机化起点）
    ///
    /// 【二次使用关键修复】不再固定从 15889 开始扫描。上一次的 easytier-core
    /// 退出后，其 RPC 套接字会以独占方式在系统中残留一段时间（TIME_WAIT），
    /// 若二次启动仍选中同一端口，Windows 会返回 os error 10013（访问权限不允许）。
    /// 这里每次启动从一个随机的高位端口起点扫描，彻底避开端口粘连与
    /// Windows 动态/保留端口段的冲突。
    async fn find_available_rpc_port_randomized() -> Result<u16, AppError> {
        // 在 20000-55000 之间随机选取若干个起点，每个起点向后扫描若干端口
        const RANGE_LOW: u16 = 20000;
        const RANGE_HIGH: u16 = 55000;
        const SCAN_PER_BASE: u16 = 8;
        const BASE_ATTEMPTS: u16 = 12;

        for _ in 0..BASE_ATTEMPTS {
            let base = RANGE_LOW + (rand::random::<u16>() % (RANGE_HIGH - RANGE_LOW));
            for i in 0..SCAN_PER_BASE {
                let port = base.saturating_add(i);
                if port < RANGE_LOW {
                    continue;
                }
                if Self::is_port_available(port).await {
                    log::info!("✅ 找到可用的RPC端口（随机化）: {}", port);
                    return Ok(port);
                }
            }
        }

        // 兜底：退回到旧的固定段扫描
        log::warn!("⚠️ 随机化端口查找未命中，退回固定段 15889 扫描");
        Self::find_available_rpc_port(15889, 20).await
    }

    /// 类 Unix 版：用 pkill 按可执行名清理残留进程。
    ///
    /// 只匹配 `easytier-core` 这个精确名字（-x 全名匹配，不用 -f 匹配整条命令行），
    /// 避免命令行里恰好出现该字样的无关进程被误杀。pkill 无匹配时返回非 0，
    /// 与 Windows 的 taskkill 一致，不视为错误。
    #[cfg(not(target_os = "windows"))]
    async fn cleanup_orphan_processes() {
        log::info!("🧹 [PreStart] 检查并清理可能残留的孤儿 easytier-core 进程...");
        let output = tokio::process::Command::new("pkill")
            .args(["-9", "-x", "easytier-core"])
            .output()
            .await;

        match output {
            Ok(o) if o.status.success() => {
                log::warn!(
                    "⚠️ [PreStart] 发现并清理了残留的 easytier-core 进程，等待 TUN 网卡释放..."
                );
                // 给内核一点时间回收 TUN 设备与 RPC 端口
                sleep(Duration::from_millis(800)).await;
            }
            Ok(_) => {
                log::info!("✅ [PreStart] 未发现残留进程，环境干净");
            }
            Err(e) => {
                log::warn!("⚠️ [PreStart] 清理孤儿进程命令执行失败（忽略）: {}", e);
            }
        }
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
        if recent_stderr
            .iter()
            .any(|l| l.contains("tun device error") || l.contains("Failed to create adapter"))
        {
            return "虚拟网卡创建失败：请右键以管理员身份运行 MCTier，并将本软件加入杀毒软件/防火墙白名单；若仍失败，请重启电脑后重试".to_string();
        }

        // 端口绑定被拒绝（os error 10013 / WSAEACCES）——常见于二次使用时上一个
        // 实例的端口尚未释放，或被防火墙/Hyper-V 保留端口段占用
        if recent_stderr
            .iter()
            .any(|l| l.contains("10013") || l.contains("os error 10013"))
        {
            // 尝试从错误链里找出到底是哪个操作/端口绑定失败（含 bind/portal/listener 的行）
            let detail = recent_stderr
                .iter()
                .rev()
                .find(|l| {
                    let s = l.to_lowercase();
                    (s.contains("bind") || s.contains("portal") || s.contains("listener"))
                        && !s.contains("os error 10013")
                })
                .map(|l| {
                    // 去掉前面的时间戳/链序号噪声，只保留有用部分
                    l.trim().to_string()
                });

            let base = "端口被占用或访问被拒绝（os error 10013）：通常是上一次的网络进程未完全退出，或端口被 Windows 保留端口段/防火墙占用。请稍等几秒后重试；若反复出现，请在管理员命令行执行 \"net stop winnat\" 再 \"net start winnat\"，或重启电脑";
            if let Some(d) = detail {
                return format!("{}（失败详情: {}）", base, d);
            }
            return base.to_string();
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

    fn redact_sensitive_line(line: &str) -> String {
        let lower = line.to_ascii_lowercase();
        for marker in ["--network-secret", "network-secret", "network_secret"] {
            if let Some(index) = lower.find(marker) {
                let suffix = &line[index..];
                if let Some(separator) = suffix.find(['=', ':']) {
                    return format!("{}<redacted>", &line[..index + separator + 1]);
                }
                return format!("{}<redacted>", &line[..index + marker.len()]);
            }
        }
        line.to_string()
    }

    #[cfg(windows)]
    async fn monitor_helper(
        reader: tokio::net::tcp::OwnedReadHalf,
        virtual_ip: Arc<Mutex<Option<String>>>,
        status: Arc<Mutex<ConnectionStatus>>,
        is_running: Arc<Mutex<bool>>,
        last_stderr: Arc<Mutex<std::collections::VecDeque<String>>>,
    ) {
        let mut lines = BufReader::new(reader).lines();
        while let Ok(Some(raw_line)) = lines.next_line().await {
            let Ok(event) = serde_json::from_str::<HelperEvent>(&raw_line) else {
                log::warn!("特权 helper 返回了无法解析的事件");
                continue;
            };
            match event {
                HelperEvent::Started => {
                    *is_running.lock().await = true;
                }
                HelperEvent::Stdout { line } => {
                    Self::handle_helper_output(
                        &line,
                        false,
                        &virtual_ip,
                        &status,
                        &is_running,
                        &last_stderr,
                    )
                    .await;
                }
                HelperEvent::Stderr { line } => {
                    Self::handle_helper_output(
                        &line,
                        true,
                        &virtual_ip,
                        &status,
                        &is_running,
                        &last_stderr,
                    )
                    .await;
                }
                HelperEvent::Response { ok, error, .. } => {
                    if !ok {
                        let message = error.unwrap_or_else(|| "特权 helper 操作失败".to_string());
                        log::error!("{}", message);
                        *status.lock().await = ConnectionStatus::Error(message);
                    }
                }
                HelperEvent::Exited { code } => {
                    let current = status.lock().await.clone();
                    if matches!(current, ConnectionStatus::Connected(_)) {
                        *status.lock().await = ConnectionStatus::Disconnected;
                    } else if !matches!(current, ConnectionStatus::Error(_)) {
                        let recent: Vec<String> =
                            last_stderr.lock().await.iter().cloned().collect();
                        *status.lock().await =
                            ConnectionStatus::Error(Self::describe_exit_failure(code, &recent));
                    }
                    *is_running.lock().await = false;
                    *virtual_ip.lock().await = None;
                    break;
                }
            }
        }
        if *is_running.lock().await {
            *is_running.lock().await = false;
            *virtual_ip.lock().await = None;
        }
    }

    #[cfg(windows)]
    async fn handle_helper_output(
        line: &str,
        is_stderr: bool,
        virtual_ip: &Arc<Mutex<Option<String>>>,
        status: &Arc<Mutex<ConnectionStatus>>,
        is_running: &Arc<Mutex<bool>>,
        last_stderr: &Arc<Mutex<std::collections::VecDeque<String>>>,
    ) {
        let safe_line = Self::redact_sensitive_line(line);
        if is_stderr {
            log::warn!("EasyTier stderr: {}", safe_line);
        } else {
            log::info!("EasyTier stdout: {}", safe_line);
        }
        let lower = safe_line.to_ascii_lowercase();
        if lower.contains("error")
            || lower.contains("failed")
            || lower.contains("panic")
            || lower.contains("bind")
            || lower.contains("listener")
            || lower.contains("portal")
            || lower.contains("10013")
        {
            let mut buffer = last_stderr.lock().await;
            buffer.push_back(safe_line.clone());
            while buffer.len() > 40 {
                buffer.pop_front();
            }
        }
        if safe_line.contains("tun device error") || safe_line.contains("Failed to create adapter")
        {
            *is_running.lock().await = false;
            *status.lock().await = ConnectionStatus::Error(
                "虚拟网卡创建失败：请确认已允许 UAC 请求，并确认 WinTun 驱动可用".to_string(),
            );
            return;
        }
        if safe_line.contains("DidNotSwitchProtocols(") {
            *is_running.lock().await = false;
            *status.lock().await =
                ConnectionStatus::Error("EasyTier WebSocket 节点握手失败".to_string());
            return;
        }
        if let Some(ip) = Self::extract_ip_from_line(&safe_line) {
            if let Ok(address) = ip.parse::<std::net::Ipv4Addr>() {
                let octets = address.octets();
                if octets[..3] == [10, 126, 126] && octets[3] >= 1 && octets[3] <= 254 {
                    *virtual_ip.lock().await = Some(address.to_string());
                    *status.lock().await = ConnectionStatus::Connected(address.to_string());
                }
            }
        }
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
            let safe_line = Self::redact_sensitive_line(&line);
            log::info!("EasyTier stdout: {}", safe_line);

            // 将含关键信息的行缓存进 last_stderr（统一作为"最近日志"缓冲区），
            // 供进程意外退出时 describe_exit_failure 定位真正原因。
            // easytier 的致命错误以 anyhow 错误链形式输出（形如 "0: xxx" / "1: yyy" / "2: ..."），
            // 真正的失败操作（绑定哪个端口/监听器）在链的前几层，必须一并捕获。
            {
                let lower = line.to_lowercase();
                let trimmed = line.trim_start();
                let is_error_chain_line = trimmed
                    .chars()
                    .next()
                    .map(|c| c.is_ascii_digit())
                    .unwrap_or(false)
                    && trimmed.contains(':');
                if lower.contains("error")
                    || lower.contains("failed")
                    || lower.contains("panic")
                    || lower.contains("bind")
                    || lower.contains("listener")
                    || lower.contains("portal")
                    || lower.contains("10013")
                    || is_error_chain_line
                {
                    let mut buf = last_stderr.lock().await;
                    buf.push_back(safe_line.clone());
                    while buf.len() > 40 {
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

            // WebSocket 节点升级失败。HTTP 200 通常表示域名仍指向网站，
            // 502 表示反代上游不可用；两种情况都不应继续等待虚拟 IP 超时。
            if line.contains("DidNotSwitchProtocols(") {
                log::error!("检测到 WebSocket 节点握手失败: {}", line);
                let message = if line.contains("DidNotSwitchProtocols(200)") {
                    "EasyTier WebSocket 反向代理配置错误：域名返回了普通 HTTP 页面。若由 Nginx 终止 TLS，请将 WSS 代理到 EasyTier 的 WS 端口 11011 并开启 WebSocket 升级；若直通 TLS，请使用 WSS 端口 11012".to_string()
                } else if line.contains("DidNotSwitchProtocols(502)") {
                    "EasyTier WebSocket 节点连接失败（HTTP 502）：请检查反向代理与 EasyTier WS 上游"
                        .to_string()
                } else {
                    "EasyTier WebSocket 握手失败：请检查反向代理是否开启 WebSocket，并将上游指向 WS 端口 11011（TLS 直通则使用 WSS 端口 11012）".to_string()
                };
                *is_running.lock().await = false;
                *status.lock().await = ConnectionStatus::Error(message);
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
                                log::debug!(
                                    "跳过无效的主机地址: {} (最后一位: {})",
                                    ip,
                                    last_octet
                                );
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
            let safe_line = Self::redact_sensitive_line(&line);
            log::warn!("EasyTier stderr: {}", safe_line);

            // 缓存最近的 stderr 输出（最多保留 30 行），用于进程意外退出时定位原因
            {
                let mut buf = last_stderr.lock().await;
                buf.push_back(safe_line.clone());
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
                        log::info!("输出行内容: {}", Self::redact_sensitive_line(line));
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
        let parts: Vec<u8> = ip.split('.').filter_map(|p| p.parse::<u8>().ok()).collect();

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
        let parts: Vec<u8> = ip.split('.').filter_map(|p| p.parse::<u8>().ok()).collect();

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

        #[cfg(windows)]
        let graceful_shutdown_success = {
            if !*self.is_running.lock().await && self.helper_session.lock().await.is_none() {
                log::info!("ℹ️ [StopEasyTier] EasyTier 服务未运行，无需关闭");
                true
            } else {
                let helper = self.helper_session.lock().await.take();
                if let Some(session) = helper {
                    session.stop().await.map_err(AppError::ProcessError)?;
                } else {
                    // Recover from a helper crash by asking a fresh, authenticated
                    // helper to stop only the fixed EasyTier image and MCTier devices.
                    privileged_helper::run_one_shot(privileged_helper::HelperRequest::StopEasyTier)
                        .map_err(AppError::ProcessError)?;
                }
                true
            }
        };

        #[cfg(not(windows))]
        let graceful_shutdown_success = {
            let mut process_guard = self.easytier_process.lock().await;
            let mut success = false;

            if let Some(mut child) = process_guard.take() {
                log::info!("🔄 [StopEasyTier] 正在优雅关闭 EasyTier 进程...");
                match child.kill().await {
                    Ok(_) => {
                        log::info!("✅ [StopEasyTier] 已发送终止信号到 EasyTier 进程");
                    }
                    Err(e) => {
                        log::warn!("⚠️ [StopEasyTier] 发送终止信号失败: {}", e);
                    }
                }

                log::info!("⏳ [StopEasyTier] 等待进程自然退出（最多3秒）...");
                match tokio::time::timeout(Duration::from_secs(3), child.wait()).await {
                    Ok(Ok(status)) => {
                        log::info!(
                            "✅ [StopEasyTier] EasyTier 进程已退出，状态码: {:?}",
                            status
                        );
                        success = true;
                    }
                    Ok(Err(e)) => log::warn!("⚠️ [StopEasyTier] 等待进程退出时出错: {}", e),
                    Err(_) => log::warn!("⚠️ [StopEasyTier] 等待进程退出超时（3秒）"),
                }
            } else {
                log::info!("ℹ️ [StopEasyTier] EasyTier 服务未运行，无需关闭");
                success = true;
            }
            success
        };

        // 如果优雅关闭成功，跳过强制终止
        if graceful_shutdown_success {
            log::info!("✅ [StopEasyTier] EasyTier 进程已通过优雅方式关闭，无需强制终止");
        } else {
            // 只有在优雅关闭失败时才使用强制终止
            log::warn!("⚠️ [StopEasyTier] 优雅关闭失败，现在尝试强制终止（taskkill /F）...");
            log::warn!("💡 [StopEasyTier] 这是最后的手段，仅在优雅关闭失败时使用");

            #[cfg(not(windows))]
            {
                let _ = tokio::process::Command::new("pkill")
                    .args(["-9", "-x", "easytier-core"])
                    .output()
                    .await;
            }
        }

        // 等待一小段时间确保进程完全退出
        log::info!("⏳ [StopEasyTier] 等待进程完全退出（300ms）...");
        sleep(Duration::from_millis(300)).await;
        log::info!("✅ [StopEasyTier] 进程退出等待完成");

        // 【已废弃】不再使用CLI工具清理实例
        // easytier-cli已移除，通过taskkill直接终止进程
        log::info!("ℹ️ [StopEasyTier] 跳过CLI工具清理（已废弃）");

        // Windows device cleanup is intentionally owned by the elevated
        // helper. The normal UI process never invokes pnputil/netsh.
        #[cfg(windows)]
        log::debug!("Windows EasyTier device cleanup delegated to helper");
        // 清理状态
        log::info!("🧹 [StopEasyTier] 清理服务状态...");
        *self.is_running.lock().await = false;
        *self.status.lock().await = ConnectionStatus::Disconnected;
        *self.virtual_ip.lock().await = None;
        log::info!("✅ [StopEasyTier] 服务状态已清理");

        // Windows helper owns the installation runtime and removes its config
        // directory after stopping EasyTier. The UI process only cleans up its
        // private temporary directory on non-Windows platforms.
        #[cfg(not(windows))]
        {
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
                                log::warn!(
                                    "⚠️ [StopEasyTier] 清理配置目录失败: {}，将在下次启动时自动清理",
                                    e
                                );
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

    /// 获取当前 EasyTier 实例的 RPC 端口（供 easytier-cli 查询对等连接类型）
    pub async fn get_rpc_port(&self) -> Option<u16> {
        *self.rpc_port.lock().await
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
        self.start_easytier(
            network_name,
            network_key,
            server_node,
            player_name,
            app_handle,
        )
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

    #[test]
    fn test_bind_device_argument_includes_required_boolean_value() {
        let mut config = crate::modules::config_manager::EasyTierAdvancedConfig::default();
        config.bind_device = true;
        config.dev_name = Some("MCTier_Net".to_string());

        let mut command = Command::new("easytier-core.exe");
        NetworkService::apply_advanced_config(&mut command, &config);
        let args: Vec<String> = command
            .as_std()
            .get_args()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect();

        let bind_device_index = args
            .iter()
            .position(|arg| arg == "--bind-device")
            .expect("bind-device argument should be present");
        assert_eq!(
            args.get(bind_device_index + 1).map(String::as_str),
            Some("true")
        );

        let dev_name_index = args
            .iter()
            .position(|arg| arg == "--dev-name")
            .expect("dev-name argument should be present");
        assert_eq!(
            args.get(dev_name_index + 1).map(String::as_str),
            Some("MCTier_Net")
        );
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
            ("Zero IP: 0.0.0.0", None),     // 0.0.0.0 应该被排除
            ("", None),                     // 空字符串
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
            assert!(NetworkService::is_valid_ip(ip), "应该接受有效的 IP: {}", ip);
        }

        // 无效的 IP 地址
        let invalid_ips = vec![
            "256.1.1.1",       // 超出范围
            "1.256.1.1",       // 超出范围
            "1.1.256.1",       // 超出范围
            "1.1.1.256",       // 超出范围
            "1.1.1",           // 缺少段
            "1.1",             // 缺少段
            "1",               // 缺少段
            "1.1.1.1.1",       // 多余段
            "abc.def.ghi.jkl", // 非数字
            "",                // 空字符串
            "...",             // 只有点
            "1..1.1",          // 连续的点
            "1.1.1.",          // 末尾有点
            ".1.1.1",          // 开头有点
            "-1.1.1.1",        // 负数
            "1.1.1.1a",        // 包含字母
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
        assert_eq!(
            service.check_connection().await,
            ConnectionStatus::Disconnected
        );
    }

    #[test]
    fn test_network_config_creation() {
        let config = NetworkConfig {
            easytier_path: PathBuf::from("custom/path/easytier.exe"),
            config_dir: PathBuf::from("custom/config"),
        };

        assert_eq!(
            config.easytier_path,
            PathBuf::from("custom/path/easytier.exe")
        );
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
            // 边界值：extract_ip_from_line 只接受私有网段且非回环的地址
            // （见其实现中的 is_private_ip / is_loopback 过滤），因此公网地址必须被丢弃，
            // 否则 EasyTier 日志里出现的公网对端地址会被误当成本机虚拟 IP。
            ("IP: 0.0.0.1", None),
            ("IP: 255.255.255.254", None),
            ("IP: 127.0.0.1", None),
            ("IP: 8.8.8.8", None),
            // 私有网段的边界值应当被接受
            ("IP: 10.0.0.1", Some("10.0.0.1")),
            ("IP: 172.16.0.1", Some("172.16.0.1")),
            ("IP: 172.31.255.254", Some("172.31.255.254")),
            ("IP: 192.168.1.1", Some("192.168.1.1")),
            // 172.15/172.32 不属于 172.16.0.0/12，必须落在私有网段之外
            ("IP: 172.15.0.1", None),
            ("IP: 172.32.0.1", None),
            // 特殊格式
            ("IP:10.144.144.1", Some("10.144.144.1")), // 没有空格
            ("IP: 10.144.144.1 ", Some("10.144.144.1")), // 末尾有空格
            (" IP: 10.144.144.1", Some("10.144.144.1")), // 开头有空格
            // 包含其他文本
            (
                "The virtual IP is 10.144.144.1 and ready",
                Some("10.144.144.1"),
            ),
            ("Network: 10.144.144.1/24", Some("10.144.144.1")),
        ];

        for (input, expected) in test_cases {
            let result = NetworkService::extract_ip_from_line(input);
            assert_eq!(result, expected.map(|s| s.to_string()), "输入: {}", input);
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
                assert!(
                    NetworkService::is_valid_ip(&ip),
                    "提取的应该是有效 IP: {}",
                    ip
                );
            }
        }
    }

    #[tokio::test]
    async fn test_network_service_state_consistency() {
        let service = NetworkService::new_with_defaults();

        // 多次检查状态应该保持一致
        for _ in 0..5 {
            assert!(!service.is_running().await);
            assert_eq!(
                service.check_connection().await,
                ConnectionStatus::Disconnected
            );
            assert_eq!(service.get_virtual_ip().await, None);
        }
    }
}
