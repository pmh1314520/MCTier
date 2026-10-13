use super::shared::*;
use super::{network::*, remote_files::*};

/// 节点延迟测试结果
#[derive(serde::Serialize)]
pub struct NodeLatencyResult {
    pub address: String,
    pub reachable: bool,
    pub latency_ms: Option<u64>,
}

/// 从节点地址解析出 host 和 port（best-effort）
pub(crate) fn parse_node_host_port(address: &str) -> Option<(String, u16)> {
    let trimmed = address.trim();
    // 去掉 scheme
    let (scheme, rest) = match trimmed.split_once("://") {
        Some((s, r)) => (s.to_lowercase(), r),
        None => ("".to_string(), trimmed),
    };
    // 去掉路径部分
    let host_port = rest.split('/').next().unwrap_or(rest);
    // 默认端口：wss/https->443, ws/http->80, 其它(tcp/udp)->11010
    let default_port: u16 = match scheme.as_str() {
        "wss" | "https" => 443,
        "ws" | "http" => 80,
        _ => 11010,
    };
    if let Some((h, p)) = host_port.rsplit_once(':') {
        // 处理 IPv6 不在此范围，简单处理
        if let Ok(port) = p.parse::<u16>() {
            return Some((h.to_string(), port));
        }
        return Some((host_port.to_string(), default_port));
    }
    if host_port.is_empty() {
        return None;
    }
    Some((host_port.to_string(), default_port))
}

/// 测试单个节点的延迟（通过 TCP 连接测时；连接成功或被拒绝都视为可达）
#[tauri::command]
pub async fn test_node_latency(address: String) -> NodeLatencyResult {
    use tokio::net::TcpStream;

    let (host, port) = match parse_node_host_port(&address) {
        Some(hp) => hp,
        None => {
            return NodeLatencyResult {
                address,
                reachable: false,
                latency_ms: None,
            }
        }
    };

    let start = std::time::Instant::now();
    let connect = TcpStream::connect((host.as_str(), port));
    match tokio::time::timeout(std::time::Duration::from_secs(3), connect).await {
        Ok(Ok(_stream)) => {
            // 连接成功 = 可达
            NodeLatencyResult {
                address,
                reachable: true,
                latency_ms: Some(start.elapsed().as_millis() as u64),
            }
        }
        Ok(Err(e)) => {
            // 连接被拒绝(ConnectionRefused)说明主机可达、端口未开（如UDP节点）
            let refused = e.kind() == std::io::ErrorKind::ConnectionRefused;
            NodeLatencyResult {
                address,
                reachable: refused,
                latency_ms: if refused {
                    Some(start.elapsed().as_millis() as u64)
                } else {
                    None
                },
            }
        }
        Err(_) => NodeLatencyResult {
            address,
            reachable: false,
            latency_ms: None,
        },
    }
}

/// 检测系统中正在运行的常见安全软件 / 杀毒软件（用于排障：被拦截是组网失败的常见原因）
///
/// 返回检测到的安全软件名称列表（中文友好名）。仅 Windows 有效。
#[tauri::command]
pub async fn detect_security_software() -> Vec<String> {
    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        // 进程名(小写) -> 友好名
        let known: &[(&str, &str)] = &[
            ("360tray.exe", "360安全卫士"),
            ("360safe.exe", "360安全卫士"),
            ("360sd.exe", "360杀毒"),
            ("zhudongfangyu.exe", "360主动防御"),
            ("huorong.exe", "火绒安全"),
            ("hipstray.exe", "火绒安全"),
            ("wsctrl.exe", "火绒安全"),
            ("qqpctray.exe", "腾讯电脑管家"),
            ("qqpcrtp.exe", "腾讯电脑管家"),
            ("kxetray.exe", "金山毒霸"),
            ("kxescore.exe", "金山毒霸"),
            ("ksafe.exe", "金山卫士"),
            ("baidusdtray.exe", "百度卫士"),
            ("avp.exe", "卡巴斯基"),
            ("avgui.exe", "AVG"),
            ("avastui.exe", "Avast"),
            ("msmpeng.exe", "Windows Defender"),
            ("nortonsecurity.exe", "诺顿"),
            ("mcshield.exe", "McAfee"),
            ("ecls.exe", "ESET NOD32"),
            ("egui.exe", "ESET NOD32"),
        ];

        let output = tokio::process::Command::new(windows_system_command("tasklist.exe"))
            .args(&["/fo", "csv", "/nh"])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .await;

        let mut detected: Vec<String> = Vec::new();
        if let Ok(out) = output {
            // tasklist 输出可能是 GBK，这里用 lossy 处理；进程名是 ASCII，匹配不受影响
            let text = String::from_utf8_lossy(&out.stdout).to_lowercase();
            for (proc_name, friendly) in known {
                if text.contains(proc_name) {
                    let f = friendly.to_string();
                    if !detected.contains(&f) {
                        detected.push(f);
                    }
                }
            }
        }
        detected
    }

    #[cfg(not(target_os = "windows"))]
    {
        Vec::new()
    }
}

/// 一键导出日志：将日志目录打包为 zip，返回生成的 zip 路径
#[tauri::command]
pub async fn export_logs(_app_handle: tauri::AppHandle) -> Result<String, String> {
    let log_dir = crate::modules::app_paths::data_root().map_err(|e| e.to_string())?;

    if !log_dir.exists() {
        return Err("日志目录不存在".to_string());
    }

    // 输出到桌面（无法获取时回退到日志目录）
    let out_dir = dirs::desktop_dir().unwrap_or_else(|| log_dir.clone());

    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let zip_path = out_dir.join(format!("MCTier_logs_{}.zip", ts));

    // 在阻塞线程里打包，避免阻塞异步运行时
    let log_dir_clone = log_dir.clone();
    let zip_path_clone = zip_path.clone();
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        let zip_file =
            std::fs::File::create(&zip_path_clone).map_err(|e| format!("创建zip失败: {}", e))?;
        let mut zip = zip::ZipWriter::new(zip_file);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated)
            .compression_level(Some(6));

        let entries =
            std::fs::read_dir(&log_dir_clone).map_err(|e| format!("读取日志目录失败: {}", e))?;
        let mut count = 0;
        for entry in entries.flatten() {
            let path = entry.path();
            // 只打包日志相关文件（.log / .txt），跳过子目录与其它文件
            let is_log = path
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.eq_ignore_ascii_case("log") || e.eq_ignore_ascii_case("txt"))
                .unwrap_or(false);
            if path.is_file() && is_log {
                let name = entry.file_name().to_string_lossy().to_string();
                if let Ok(mut f) = std::fs::File::open(&path) {
                    if zip.start_file(name, options).is_ok() {
                        let _ = std::io::copy(&mut f, &mut zip);
                        count += 1;
                    }
                }
            }
        }
        zip.finish().map_err(|e| format!("完成zip失败: {}", e))?;
        if count == 0 {
            return Err("没有可导出的日志文件".to_string());
        }
        Ok(())
    })
    .await
    .map_err(|e| format!("打包任务失败: {}", e))??;

    let zip_path = zip_path
        .to_str()
        .ok_or_else(|| "无法转换日志导出路径".to_string())?;
    register_path_grant(zip_path, PathAccess::Open, false)?;
    register_path_grant(zip_path, PathAccess::DeleteFile, false)?;
    Ok(zip_path.to_string())
}

/// 诊断文件共享连接
///
/// # 参数
/// * `peer_ip` - 对方的虚拟IP
///
/// # 返回
/// * `Ok(String)` - 诊断结果（JSON格式）
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn diagnose_file_share_connection(
    peer_ip: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    log::info!("🔍 开始诊断文件共享连接: {}", peer_ip);
    let target = require_file_peer_host(&peer_ip, &state).await?;

    let mut results = serde_json::json!({
        "peer_ip": peer_ip,
        "tests": []
    });

    // 测试1: Ping虚拟IP
    log::info!("📡 测试1: Ping虚拟IP...");
    let ping_result = ping_virtual_ip(peer_ip.clone()).await;
    let ping_success = ping_result.is_ok() && ping_result.unwrap_or(false);
    results["tests"]
        .as_array_mut()
        .unwrap()
        .push(serde_json::json!({
            "name": "Ping虚拟IP",
            "success": ping_success,
            "message": if ping_success {
                "✅ 虚拟网络连接正常"
            } else {
                "❌ 无法ping通虚拟IP，虚拟网络可能未连接"
            }
        }));

    // 测试2: 检查HTTP服务器端口
    log::info!("🔌 测试2: 检查HTTP服务器端口...");
    let url = format!("http://{}:14539/api/shares", target.host);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| format!("创建HTTP客户端失败: {}", e))?;

    let http_result = client
        .get(&url)
        .header(
            crate::modules::file_transfer::LOBBY_TOKEN_HEADER,
            &target.token,
        )
        .send()
        .await;
    let http_message = if http_result.is_ok() {
        "✅ HTTP文件服务器可访问".to_string()
    } else {
        format!(
            "❌ 无法连接HTTP服务器: {}",
            http_result.as_ref().err().unwrap()
        )
    };

    results["tests"]
        .as_array_mut()
        .unwrap()
        .push(serde_json::json!({
            "name": "HTTP服务器连接",
            "success": http_result.is_ok(),
            "message": http_message
        }));

    // 测试3: 获取共享列表
    if http_result.is_ok() {
        log::info!("📋 测试3: 获取共享列表...");
        match get_remote_shares(peer_ip.clone(), state).await {
            Ok(shares) => {
                results["tests"]
                    .as_array_mut()
                    .unwrap()
                    .push(serde_json::json!({
                        "name": "获取共享列表",
                        "success": true,
                        "message": format!("✅ 成功获取 {} 个共享", shares.len())
                    }));
            }
            Err(e) => {
                results["tests"]
                    .as_array_mut()
                    .unwrap()
                    .push(serde_json::json!({
                        "name": "获取共享列表",
                        "success": false,
                        "message": format!("❌ 获取共享列表失败: {}", e)
                    }));
            }
        }
    }

    log::info!("✅ 诊断完成");

    Ok(serde_json::to_string_pretty(&results).unwrap())
}
