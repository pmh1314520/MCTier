//! Linux 平台支撑模块（仅在 target_os = "linux" 下编译）。
//!
//! 目标是让 Linux 端与 Windows 端在**语义**上对等，而不是逐个 API 照搬：
//!
//! | 能力 | Windows | Linux |
//! |---|---|---|
//! | 虚拟网卡 | wintun.dll 用户态驱动 | 内核 TUN（`/dev/net/tun`） |
//! | 创建网卡的权限 | 整个进程以管理员运行 | 只给 EasyTier 二进制文件能力（setcap） |
//! | 提权交互 | UAC | polkit（`pkexec`），桌面会话内弹图形授权框 |
//! | 网卡检测 | 解析 `ipconfig` 输出 | 扫描 `/sys/class/net` |
//! | 开机自启 | 注册表 Run 项 | XDG autostart `.desktop` |
//!
//! 关键差异：**应用本体全程以普通用户运行**。Windows 版需要管理员是因为
//! wintun 要装驱动；Linux 只需让 `easytier-core` 这个文件具备 `cap_net_admin`
//! 即可创建 TUN，因此权限检查从"进程是否提权"前移成了"二进制是否有能力"。

use std::path::{Path, PathBuf};

/// 创建 TUN 所需的文件能力。
///
/// - `cap_net_admin`：`TUNSETIFF` 建虚拟网卡、配置路由；
/// - `cap_net_raw`：原始套接字（对端探测 / ICMP）。
///
/// `+ep` = effective + permitted，令能力在 exec 后立即生效。
const TUN_CAPS: &str = "cap_net_admin,cap_net_raw+ep";

/// EasyTier 创建的虚拟网卡名（与 Windows 端保持一致，便于双端日志对照）。
pub const TUN_DEVICE_NAME: &str = "MCTier_Net";

/// `setcap` / `getcap` / `ufw` 装在 `/usr/sbin`，而从桌面菜单（.desktop）启动的
/// 应用继承的 PATH 通常不含 sbin，直接按名字调用会 ENOENT。这里优先用绝对路径，
/// 找不到时才退回 PATH 查找（兼容非 merged-usr 的发行版）。
fn resolve_sbin_tool(name: &str) -> String {
    for dir in ["/usr/sbin", "/sbin", "/usr/local/sbin"] {
        let candidate = format!("{}/{}", dir, name);
        if Path::new(&candidate).exists() {
            return candidate;
        }
    }
    name.to_string()
}

/// XDG autostart 的 desktop 条目内容。
fn autostart_desktop_entry(exe: &str) -> String {
    format!(
        "[Desktop Entry]\n\
         Type=Application\n\
         Version=1.0\n\
         Name=MCTier\n\
         Comment=MCTier 虚拟局域网通用联机工具\n\
         Exec={exe}\n\
         Terminal=false\n\
         X-GNOME-Autostart-enabled=true\n\
         Categories=Network;Game;\n",
        exe = exe,
    )
}

fn autostart_file_path() -> Option<PathBuf> {
    dirs::config_dir().map(|dir| dir.join("autostart").join("mctier.desktop"))
}

fn current_exe() -> Result<PathBuf, String> {
    std::env::current_exe().map_err(|error| format!("无法获取程序路径: {}", error))
}

/// 读取文件能力（`getcap`）。命令缺失或无输出时返回空串，由调用方当作"无能力"。
async fn file_capabilities(path: &str) -> String {
    match tokio::process::Command::new(resolve_sbin_tool("getcap"))
        .arg(path)
        .output()
        .await
    {
        Ok(output) => String::from_utf8_lossy(&output.stdout).to_string(),
        Err(_) => String::new(),
    }
}

/// 判断 getcap 输出是否已包含建 TUN 所需能力。
fn capabilities_grant_tun(caps: &str) -> bool {
    caps.contains("cap_net_admin")
}

/// 确保 EasyTier 二进制具备创建 TUN 的文件能力。
///
/// - 已具备 → 静默通过，不打扰用户；
/// - 不具备 → `pkexec setcap` 弹一次图形授权框。能力写在文件的扩展属性上，
///   因此**只需授权一次**；但每次二进制被重新提取（版本更新）后需要再授权，
///   因为新文件不继承旧文件的能力。
pub async fn ensure_easytier_tun_capability(app_handle: &tauri::AppHandle) -> Result<(), String> {
    let easytier_path =
        crate::modules::resource_manager::ResourceManager::get_easytier_path(app_handle)
            .map_err(|error| error.to_string())?;
    let path_text = easytier_path.to_string_lossy().to_string();

    if capabilities_grant_tun(&file_capabilities(&path_text).await) {
        log::debug!("EasyTier 已具备 TUN 能力，跳过授权");
        return Ok(());
    }

    log::info!("EasyTier 缺少 TUN 能力，请求 polkit 授权（pkexec setcap）");
    let setcap = resolve_sbin_tool("setcap");
    let output = tokio::process::Command::new("pkexec")
        .args([setcap.as_str(), TUN_CAPS, path_text.as_str()])
        .output()
        .await
        .map_err(|error| {
            format!(
                "无法启动 pkexec（需要桌面 polkit 授权代理，请确认已安装 policykit-1）: {}",
                error
            )
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "TUN 能力授权未完成，无法创建虚拟网卡。可在终端手动执行：sudo {} '{}' {}。详情: {}",
            setcap,
            TUN_CAPS,
            path_text,
            stderr.trim()
        ));
    }

    // 复核：pkexec 退出码为 0 不等于 setcap 真的生效（例如文件在 noexec/nosuid
    // 挂载点上，或文件系统不支持扩展属性）。必须再读一次 getcap 才能确认。
    let caps = file_capabilities(&path_text).await;
    if !capabilities_grant_tun(&caps) {
        return Err(format!(
            "setcap 已执行但能力校验未通过（getcap 输出: {}）。若 EasyTier 位于不支持扩展属性的分区（如 FAT/exFAT）或 nosuid 挂载点，请改用支持 xattr 的目录。",
            caps.trim()
        ));
    }

    log::info!("EasyTier TUN 能力已就绪: {}", caps.trim());
    Ok(())
}

/// 判断某个网卡名是否属于 MCTier/EasyTier 创建的虚拟网卡。
///
/// 单独抽出来是为了可测：不能把 `docker0`、`virbr0` 这类无关虚拟网卡算进去，
/// 否则装了 Docker 的机器在未组网时也会被判定为"虚拟网卡已存在"。
pub fn is_virtual_adapter_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    if lower.contains("easytier") || lower == TUN_DEVICE_NAME.to_ascii_lowercase() {
        return true;
    }
    // tun0 / tun1 ...：内核 TUN 设备的默认命名。要求 tun 后面全是数字，
    // 避免把 tunnel0、tuned 之类的名字误判。
    match lower.strip_prefix("tun") {
        Some(rest) => !rest.is_empty() && rest.chars().all(|ch| ch.is_ascii_digit()),
        None => false,
    }
}

/// 检测虚拟网卡是否存在。
///
/// 与 Windows 端解析 `ipconfig` 的语义一致：网卡只在 EasyTier 运行期间存在，
/// 因此离开大厅后返回 `false` 是正常结果，不代表故障。
pub fn has_virtual_adapter() -> bool {
    std::fs::read_dir("/sys/class/net")
        .map(|entries| {
            entries
                .flatten()
                .any(|entry| is_virtual_adapter_name(&entry.file_name().to_string_lossy()))
        })
        .unwrap_or(false)
}

/// 设置开机自启动（XDG autostart）。
pub fn set_auto_start(enable: bool) -> Result<(), String> {
    let Some(path) = autostart_file_path() else {
        return Err("无法确定 XDG autostart 目录".to_string());
    };

    if enable {
        let exe = current_exe()?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("创建 autostart 目录失败: {}", error))?;
        }
        std::fs::write(&path, autostart_desktop_entry(&exe.to_string_lossy()))
            .map_err(|error| format!("写入自启动配置失败: {}", error))?;
        log::info!("开机自启动已启用: {:?}", path);
        return Ok(());
    }

    match std::fs::remove_file(&path) {
        Ok(()) => {}
        // 本就不存在视为成功，与 Windows 端删除注册表项的容错语义一致。
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("删除自启动配置失败: {}", error)),
    }
    log::info!("开机自启动已禁用");
    Ok(())
}

/// 查询开机自启动是否已启用。
pub fn auto_start_enabled() -> bool {
    autostart_file_path()
        .map(|path| path.exists())
        .unwrap_or(false)
}

/// 打开某个 WebView 的 MediaStream / WebRTC 能力（Linux 专用）。
///
/// 有两个坑必须一起处理，只做一个都没用：
///
/// 1. **WebKitGTK 的 `enable-media-stream` 默认是关的**，不打开时页面里的
///    `RTCPeerConnection` 直接是 `undefined`（而 `getUserMedia` 反而存在，很容易
///    误判成"代码问题"）。语音、屏幕共享、远程控制三条链路全部依赖它。
/// 2. **wry 只在 Windows/Android 处理 `permission-request` 信号**，Linux 下
///    WebKitGTK 收不到应答，`getUserMedia` 会被默认拒绝。这里挂钩子放行。
///
/// 关于放行的范围：这里放行的是**本应用自己加载的本地页面**（frontendDist 内的
/// 资源，CSP 已限制为 `default-src 'self'`），不是任意站点；麦克风/屏幕是否真正
/// 采集仍由应用内的开关和用户操作决定，所以自动放行不会扩大攻击面。
///
/// 另外需要说明：发行版自带的 webkit2gtk 可能在**编译期**就没开 WebRTC
/// （Debian 官方构建即如此）。那种情况下本函数只是无效操作，不会报错，
/// 需要换用带 `ENABLE_WEB_RTC=ON` 的 WebKitGTK 构建才能恢复媒体能力。
pub fn enable_webview_media(window: &tauri::WebviewWindow) {
    let label = window.label().to_string();
    let result = window.with_webview(move |webview| {
        use webkit2gtk::{PermissionRequestExt, SettingsExt, WebViewExt};

        let view = webview.inner();
        if let Some(settings) = view.settings() {
            settings.set_enable_media_stream(true);
            settings.set_enable_mediasource(true);
            settings.set_enable_webaudio(true);
        }
        // 只放行媒体类请求。早先的写法是无条件 allow() 所有请求，那会连
        // 地理位置、桌面通知、指针锁定一起放行——这些能力应用本身用不到，
        // 白送出去等于凭空扩大攻击面。其余类型返回 false 交回 WebKit 默认
        // 处理（默认即拒绝）。
        view.connect_permission_request(|_view, request| {
            // glib 不是本 crate 的直接依赖，走 webkit2gtk 的再导出。
            use webkit2gtk::glib::prelude::Cast;

            // getUserMedia / getDisplayMedia：麦克风、摄像头、屏幕采集。
            // 是否真正开始采集仍由应用内的开关和用户操作决定，这里只是让
            // WebKit 不要在协议层直接掐掉请求。
            if request
                .dynamic_cast_ref::<webkit2gtk::UserMediaPermissionRequest>()
                .is_some()
            {
                request.allow();
                return true;
            }

            // enumerateDevices 需要它才能拿到设备名，否则语音设置里的麦克风
            // 列表全是空标签。暴露面仅限本应用加载的本地页面。
            if request
                .dynamic_cast_ref::<webkit2gtk::DeviceInfoPermissionRequest>()
                .is_some()
            {
                request.allow();
                return true;
            }

            request.deny();
            true
        });
    });

    match result {
        Ok(()) => log::info!("已为窗口 {} 启用 WebKitGTK 媒体能力", label),
        Err(error) => log::warn!(
            "为窗口 {} 启用 WebKitGTK 媒体能力失败: {}（语音/屏幕共享可能不可用）",
            label,
            error
        ),
    }
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn virtual_adapter_detection_ignores_unrelated_virtual_interfaces() {
        // EasyTier 创建的设备
        assert!(is_virtual_adapter_name("tun0"));
        assert!(is_virtual_adapter_name("tun12"));
        assert!(is_virtual_adapter_name("MCTier_Net"));
        assert!(is_virtual_adapter_name("easytier0"));

        // 无关的虚拟网卡：装了 Docker / libvirt / VPN 的机器不应被误判为已组网
        for name in [
            "docker0",
            "virbr0",
            "veth1a2b",
            "br-abc",
            "wg0",
            "lo",
            "eth0",
            "wlan0",
            "tailscale0",
        ] {
            assert!(!is_virtual_adapter_name(name), "误判: {}", name);
        }

        // 前缀相近但不是 TUN 设备
        assert!(!is_virtual_adapter_name("tunnel0"));
        assert!(!is_virtual_adapter_name("tun"));
    }

    #[test]
    fn autostart_entry_is_a_valid_desktop_file() {
        let entry = autostart_desktop_entry("/opt/mctier/mctier");
        assert!(entry.starts_with("[Desktop Entry]"));
        assert!(entry.contains("Exec=/opt/mctier/mctier"));
        assert!(entry.contains("Type=Application"));
        assert!(entry.ends_with('\n'));
    }

    #[test]
    fn tun_capabilities_request_only_what_is_needed() {
        // 只申请建 TUN 必需的两项能力，不申请 cap_sys_admin 之类的大权限
        assert_eq!(TUN_CAPS, "cap_net_admin,cap_net_raw+ep");
        assert!(capabilities_grant_tun(
            "/usr/bin/easytier-core cap_net_admin,cap_net_raw=ep"
        ));
        assert!(!capabilities_grant_tun(""));
        assert!(!capabilities_grant_tun(
            "/usr/bin/easytier-core cap_net_raw=ep"
        ));
    }
}
