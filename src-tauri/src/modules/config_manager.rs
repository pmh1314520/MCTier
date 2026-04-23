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

/// 自动大厅配置
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct AutoLobbyConfig {
    /// 是否启用自动创建/加入大厅
    pub enabled: bool,
    /// 大厅名称
    pub lobby_name: Option<String>,
    /// 大厅密码
    pub lobby_password: Option<String>,
    /// 玩家名称
    pub player_name: Option<String>,
    /// 是否使用虚拟域名
    pub use_domain: bool,
    /// 虚拟域名
    pub virtual_domain: Option<String>,
}

/// EasyTier 节点配置
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EasyTierNode {
    /// 节点名称
    pub name: String,
    /// 节点地址
    pub address: String,
}

/// 端口转发规则
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PortForwardRule {
    /// 协议类型（tcp/udp）
    pub protocol: String,
    /// 本地绑定地址（例如：0.0.0.0:5678）
    pub bind_addr: String,
    /// 目标地址（例如：10.2.2.1:5678）
    pub dst_addr: String,
}

/// EasyTier 高级配置
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EasyTierAdvancedConfig {
    // ========== 配置来源 ==========
    /// 是否使用全局配置（仅用于大厅配置）
    pub use_global_config: bool,
    
    // ========== 网络模式 ==========
    /// 是否启用无 TUN 模式（不创建虚拟网卡）
    pub no_tun: bool,
    /// 是否启用 DHCP 自动分配 IP
    pub dhcp: bool,
    /// 手动指定的虚拟 IPv4 地址
    pub ipv4: Option<String>,
    
    // ========== 代理和转发 ==========
    /// 是否启用 SOCKS5 代理
    pub enable_socks5: bool,
    /// SOCKS5 代理端口
    pub socks5_port: Option<u16>,
    /// 端口转发规则列表
    pub port_forward_rules: Vec<PortForwardRule>,
    /// 是否通过系统内核转发子网代理数据包
    pub proxy_forward_by_system: bool,
    /// 子网代理 CIDR 列表（导出本地网络）
    pub proxy_networks: Vec<String>,
    
    // ========== 出口节点 ==========
    /// 是否启用作为出口节点
    pub enable_as_exit_node: bool,
    /// 出口节点列表（使用其他节点作为出口）
    pub exit_nodes: Vec<String>,
    
    // ========== 性能优化 ==========
    /// 是否启用多线程
    pub multi_thread: bool,
    /// 多线程数量（默认2）
    pub multi_thread_count: Option<u32>,
    /// 是否启用延迟优先模式
    pub latency_first: bool,
    /// 是否启用 smoltcp 堆栈
    pub use_smoltcp: bool,
    
    // ========== 协议优化 ==========
    /// 是否启用 KCP 代理
    pub enable_kcp_proxy: bool,
    /// 是否禁用 KCP 输入
    pub disable_kcp_input: bool,
    /// 是否启用 QUIC 代理
    pub enable_quic_proxy: bool,
    /// 是否禁用 QUIC 输入
    pub disable_quic_input: bool,
    /// QUIC 监听端口
    pub quic_listen_port: Option<u16>,
    
    // ========== 加密和安全 ==========
    /// 是否禁用加密
    pub disable_encryption: bool,
    /// 加密算法（aes-gcm, aes-256-gcm, xor, chacha20）
    pub encryption_algorithm: Option<String>,
    
    // ========== 网络设备 ==========
    /// 是否绑定到物理设备
    pub bind_device: bool,
    /// TUN 设备名称
    pub dev_name: Option<String>,
    /// MTU 大小
    pub mtu: Option<u32>,
    
    // ========== P2P 配置 ==========
    /// 是否仅使用 P2P 连接
    pub p2p_only: bool,
    /// 是否禁用 P2P
    pub disable_p2p: bool,
    /// 是否禁用 UDP 打洞
    pub disable_udp_hole_punching: bool,
    /// 是否禁用 TCP 打洞
    pub disable_tcp_hole_punching: bool,
    /// 是否禁用对称 NAT 打洞
    pub disable_sym_hole_punching: bool,
    
    // ========== 中继配置 ==========
    /// 中继网络白名单（支持通配符）
    pub relay_network_whitelist: Vec<String>,
    /// 是否转发所有对等节点的 RPC
    pub relay_all_peer_rpc: bool,
    /// 是否禁用中继 KCP
    pub disable_relay_kcp: bool,
    /// 是否启用中继外部网络 KCP
    pub enable_relay_foreign_network_kcp: bool,
    /// 外部网络流量转发速率限制（BPS）
    pub foreign_relay_bps_limit: Option<u64>,
    
    // ========== 路由配置 ==========
    /// 手动分配的路由 CIDR
    pub manual_routes: Vec<String>,
    
    // ========== 压缩 ==========
    /// 压缩算法（none, zstd）
    pub compression: Option<String>,
    
    // ========== 监听器配置 ==========
    /// 监听器列表
    pub listeners: Vec<String>,
    /// 映射的监听器（公网地址）
    pub mapped_listeners: Vec<String>,
    /// 是否不监听任何端口
    pub no_listener: bool,
    /// 默认协议
    pub default_protocol: Option<String>,
    
    // ========== DNS 配置 ==========
    /// 是否启用魔法 DNS
    pub accept_dns: bool,
    /// 顶级域名区域
    pub tld_dns_zone: Option<String>,
    
    // ========== 端口白名单 ==========
    /// TCP 端口白名单
    pub tcp_whitelist: Vec<String>,
    /// UDP 端口白名单
    pub udp_whitelist: Vec<String>,
    
    // ========== IPv6 ==========
    /// 是否禁用 IPv6
    pub disable_ipv6: bool,
    /// 虚拟 IPv6 地址
    pub ipv6: Option<String>,
    
    // ========== STUN 服务器 ==========
    /// 自定义 STUN 服务器列表
    pub stun_servers: Vec<String>,
    /// 自定义 IPv6 STUN 服务器列表
    pub stun_servers_v6: Vec<String>,
    
    // ========== 私有模式 ==========
    /// 是否启用私有模式
    pub private_mode: bool,
}

impl Default for EasyTierAdvancedConfig {
    fn default() -> Self {
        Self {
            // 配置来源
            use_global_config: true,
            
            // 网络模式
            no_tun: false,
            dhcp: true,
            ipv4: None,
            
            // 代理和转发
            enable_socks5: false,
            socks5_port: None,
            port_forward_rules: Vec::new(),
            proxy_forward_by_system: false,
            proxy_networks: Vec::new(),
            
            // 出口节点
            enable_as_exit_node: false,
            exit_nodes: Vec::new(),
            
            // 性能优化
            multi_thread: true,
            multi_thread_count: Some(2),
            latency_first: true,
            use_smoltcp: false,
            
            // 协议优化
            enable_kcp_proxy: false,
            disable_kcp_input: false,
            enable_quic_proxy: false,
            disable_quic_input: false,
            quic_listen_port: None,
            
            // 加密和安全
            disable_encryption: false,
            encryption_algorithm: None,
            
            // 网络设备
            bind_device: false,
            dev_name: Some("MCTier_Net".to_string()),
            mtu: None,
            
            // P2P 配置
            p2p_only: false,
            disable_p2p: false,
            disable_udp_hole_punching: false,
            disable_tcp_hole_punching: false,
            disable_sym_hole_punching: false,
            
            // 中继配置
            relay_network_whitelist: Vec::new(),
            relay_all_peer_rpc: false,
            disable_relay_kcp: false,
            enable_relay_foreign_network_kcp: false,
            foreign_relay_bps_limit: None,
            
            // 路由配置
            manual_routes: Vec::new(),
            
            // 压缩
            compression: None,
            
            // 监听器配置
            listeners: Vec::new(),
            mapped_listeners: Vec::new(),
            no_listener: false,
            default_protocol: None,
            
            // DNS 配置
            accept_dns: false,
            tld_dns_zone: None,
            
            // 端口白名单
            tcp_whitelist: Vec::new(),
            udp_whitelist: Vec::new(),
            
            // IPv6
            disable_ipv6: false,
            ipv6: None,
            
            // STUN 服务器
            stun_servers: Vec::new(),
            stun_servers_v6: Vec::new(),
            
            // 私有模式
            private_mode: false,
        }
    }
}

/// 出口节点配置（已废弃，保留用于兼容性）
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct ExitNodeConfig {
    /// 是否启用出口节点功能
    pub enable_exit_node: bool,
    /// 本机作为出口节点
    pub enable_as_exit_node: bool,
    /// 出口网段列表
    pub proxy_cidrs: Vec<String>,
    /// 客户端出口节点列表（虚拟 IPv4）
    pub exit_nodes: Vec<String>,
    /// 子网代理CIDR列表（用于共享本地子网）
    pub subnet_proxy_cidrs: Vec<String>,
    
    // ========== 新增高级配置 ==========
    /// 是否启用 SOCKS5 代理
    pub enable_socks5: bool,
    /// SOCKS5 代理端口
    pub socks5_port: Option<u16>,
    /// 端口转发规则列表
    pub port_forward_rules: Vec<PortForwardRule>,
    /// 是否启用无 TUN 模式
    pub no_tun: bool,
    /// 是否启用系统转发
    pub proxy_forward_by_system: bool,
    /// 是否仅使用物理网卡
    pub bind_device: bool,
    /// 是否启用多线程
    pub multi_thread: bool,
    /// 多线程数量（默认2）
    pub multi_thread_count: Option<u32>,
    /// 是否启用 smoltcp
    pub use_smoltcp: bool,
    /// 是否启用 KCP 代理
    pub enable_kcp_proxy: bool,
    /// 是否启用 QUIC 代理
    pub enable_quic_proxy: bool,
    /// 是否启用延迟优先模式
    pub latency_first: bool,
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
    /// 全局听筒快捷键
    pub global_mute_hotkey: Option<String>,
    /// F2临时开麦快捷键
    pub push_to_talk_hotkey: Option<String>,
    /// 状态窗口位置
    pub window_position: Option<WindowPosition>,
    /// 音频设备 ID
    pub audio_device_id: Option<String>,
    /// 窗口透明度 (0.0-1.0)，默认 0.95
    pub opacity: Option<f64>,
    /// 是否开机自启
    pub auto_startup: Option<bool>,
    /// 自动大厅配置
    pub auto_lobby: Option<AutoLobbyConfig>,
    /// 是否使用私有服务器
    pub use_private_server: Option<bool>,
    /// 私有 EasyTier 节点服务器地址
    pub private_easytier_server: Option<String>,
    /// 私有信令服务器地址
    pub private_signaling_server: Option<String>,
    /// 窗口是否置顶，默认 true
    pub always_on_top: Option<bool>,
    /// 是否记住窗口位置，默认 false
    pub remember_window_position: Option<bool>,
    /// 自定义 EasyTier 节点列表
    pub custom_easytier_nodes: Option<Vec<EasyTierNode>>,
    /// 语音音量 (0.0-1.0)，默认 1.0
    pub voice_volume: Option<f64>,
    /// 是否启用 GPU 渲染，默认 true
    pub enable_gpu_rendering: Option<bool>,
    /// 出口节点配置（已废弃，保留用于兼容性）
    pub exit_node_config: Option<ExitNodeConfig>,
    /// 全局 EasyTier 高级配置
    pub global_easytier_advanced_config: Option<EasyTierAdvancedConfig>,
    /// 大厅 EasyTier 高级配置（覆盖全局配置）
    pub lobby_easytier_advanced_config: Option<EasyTierAdvancedConfig>,
}

impl Default for UserConfig {
    fn default() -> Self {
        Self {
            player_name: None,
            preferred_server: None,
            mic_hotkey: Some("Ctrl+M".to_string()),
            global_mute_hotkey: Some("Ctrl+T".to_string()),
            push_to_talk_hotkey: Some("F2".to_string()),
            window_position: Some(WindowPosition::default()),
            audio_device_id: None,
            opacity: Some(0.95),
            auto_startup: Some(false),
            auto_lobby: Some(AutoLobbyConfig::default()),
            use_private_server: Some(false),
            private_easytier_server: Some("wss://mctiers.pmhs.top".to_string()),
            private_signaling_server: Some("wss://mctier.pmhs.top/signaling".to_string()),
            always_on_top: Some(true),
            remember_window_position: Some(false),
            custom_easytier_nodes: Some(Vec::new()),
            voice_volume: Some(1.0),
            enable_gpu_rendering: Some(true),
            exit_node_config: Some(ExitNodeConfig::default()),
            global_easytier_advanced_config: None,
            lobby_easytier_advanced_config: None,
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

    /// 设置窗口是否置顶
    /// 
    /// # 参数
    /// * `always_on_top` - 是否置顶
    /// 
    /// # 返回
    /// * `Ok(())` - 设置成功
    /// * `Err(AppError)` - 设置失败
    pub async fn set_always_on_top(&mut self, always_on_top: bool) -> Result<(), AppError> {
        self.update_config(|config| {
            config.always_on_top = Some(always_on_top);
        }).await
    }

    /// 设置是否记住窗口位置
    /// 
    /// # 参数
    /// * `remember` - 是否记住
    /// 
    /// # 返回
    /// * `Ok(())` - 设置成功
    /// * `Err(AppError)` - 设置失败
    pub async fn set_remember_window_position(&mut self, remember: bool) -> Result<(), AppError> {
        self.update_config(|config| {
            config.remember_window_position = Some(remember);
        }).await
    }

    /// 设置语音音量
    /// 
    /// # 参数
    /// * `volume` - 音量值 (0.0-1.0)
    /// 
    /// # 返回
    /// * `Ok(())` - 设置成功
    /// * `Err(AppError)` - 设置失败
    pub async fn set_voice_volume(&mut self, volume: f64) -> Result<(), AppError> {
        // 验证音量范围
        let clamped_volume = volume.clamp(0.0, 1.0);
        
        self.update_config(|config| {
            config.voice_volume = Some(clamped_volume);
        }).await
    }

    /// 设置是否启用 GPU 渲染
    /// 
    /// # 参数
    /// * `enable` - 是否启用
    /// 
    /// # 返回
    /// * `Ok(())` - 设置成功
    /// * `Err(AppError)` - 设置失败
    pub async fn set_enable_gpu_rendering(&mut self, enable: bool) -> Result<(), AppError> {
        self.update_config(|config| {
            config.enable_gpu_rendering = Some(enable);
        }).await
    }

    /// 设置自定义 EasyTier 节点列表
    /// 
    /// # 参数
    /// * `nodes` - 节点列表
    /// 
    /// # 返回
    /// * `Ok(())` - 设置成功
    /// * `Err(AppError)` - 设置失败
    pub async fn set_custom_easytier_nodes(&mut self, nodes: Vec<EasyTierNode>) -> Result<(), AppError> {
        self.update_config(|config| {
            config.custom_easytier_nodes = Some(nodes);
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

    /// 导出配置到指定路径
    /// 
    /// # 参数
    /// * `export_path` - 导出文件路径
    /// 
    /// # 返回
    /// * `Ok(())` - 导出成功
    /// * `Err(AppError)` - 导出失败
    pub async fn export_config(&self, export_path: PathBuf) -> Result<(), AppError> {
        // 序列化配置为 JSON（格式化输出）
        let json_content = serde_json::to_string_pretty(&self.config).map_err(|e| {
            AppError::ConfigError(format!("序列化配置失败: {}", e))
        })?;

        // 写入文件
        fs::write(&export_path, json_content).await.map_err(|e| {
            AppError::ConfigError(format!("导出配置文件失败: {}", e))
        })?;

        log::info!("配置已导出到: {:?}", export_path);

        Ok(())
    }

    /// 从指定路径导入配置
    /// 
    /// # 参数
    /// * `import_path` - 导入文件路径
    /// 
    /// # 返回
    /// * `Ok(())` - 导入成功
    /// * `Err(AppError)` - 导入失败
    pub async fn import_config(&mut self, import_path: PathBuf) -> Result<(), AppError> {
        // 读取文件内容
        let content = fs::read_to_string(&import_path).await.map_err(|e| {
            AppError::ConfigError(format!("读取导入文件失败: {}", e))
        })?;

        // 解析 JSON
        let imported_config: UserConfig = serde_json::from_str(&content).map_err(|e| {
            AppError::ConfigError(format!("解析导入文件失败: {}", e))
        })?;

        // 更新配置
        self.config = imported_config;
        
        // 保存到配置文件
        self.save().await?;

        log::info!("配置已从 {:?} 导入", import_path);

        Ok(())
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
