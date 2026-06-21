// Minecraft 局域网世界自动发现模块
//
// 通过 Minecraft Server List Ping (SLP) 协议（1.7+）查询虚拟局域网内
// 各玩家虚拟 IP 上是否开放了 Minecraft 服务器（默认端口 25565），
// 并解析出 MOTD、版本、在线人数等信息，供前端展示"可加入的世界"。

use serde::Serialize;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use std::time::Duration;

/// 发现的 Minecraft 服务器信息
#[derive(Debug, Clone, Serialize)]
pub struct DiscoveredServer {
    /// 服务器虚拟 IP
    pub ip: String,
    /// 端口
    pub port: u16,
    /// 该 IP 对应的玩家名称（由前端传入映射，后端原样返回）
    #[serde(rename = "playerName")]
    pub player_name: Option<String>,
    /// MOTD（服务器描述，纯文本）
    pub motd: String,
    /// 版本名称（如 "1.20.1"）
    pub version: String,
    /// 在线人数
    #[serde(rename = "onlinePlayers")]
    pub online_players: i64,
    /// 最大人数
    #[serde(rename = "maxPlayers")]
    pub max_players: i64,
    /// 延迟（毫秒）
    #[serde(rename = "latencyMs")]
    pub latency_ms: u64,
}

/// 把 i32 编码为 Minecraft VarInt
fn write_varint(buf: &mut Vec<u8>, value: i32) {
    let mut val = value as u32;
    loop {
        let mut temp = (val & 0b0111_1111) as u8;
        val >>= 7;
        if val != 0 {
            temp |= 0b1000_0000;
        }
        buf.push(temp);
        if val == 0 {
            break;
        }
    }
}

/// 从流中读取一个 VarInt
async fn read_varint(stream: &mut TcpStream) -> std::io::Result<i32> {
    let mut num_read = 0u32;
    let mut result: i32 = 0;
    loop {
        let mut byte = [0u8; 1];
        stream.read_exact(&mut byte).await?;
        let value = (byte[0] & 0b0111_1111) as i32;
        result |= value << (7 * num_read);
        num_read += 1;
        if num_read > 5 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "VarInt 过长",
            ));
        }
        if (byte[0] & 0b1000_0000) == 0 {
            break;
        }
    }
    Ok(result)
}

/// 提取 MOTD 文本（description 可能是字符串，也可能是富文本对象）
fn extract_motd(desc: &serde_json::Value) -> String {
    match desc {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Object(_) => {
            let mut out = String::new();
            collect_text(desc, &mut out);
            out
        }
        _ => String::new(),
    }
}

/// 递归收集富文本中的 text 字段
fn collect_text(v: &serde_json::Value, out: &mut String) {
    if let Some(s) = v.get("text").and_then(|t| t.as_str()) {
        out.push_str(s);
    }
    if let Some(extra) = v.get("extra").and_then(|e| e.as_array()) {
        for child in extra {
            collect_text(child, out);
        }
    }
}

/// 查询单个 Minecraft 服务器（SLP），成功返回状态信息
async fn query_server(ip: &str, port: u16) -> Option<DiscoveredServer> {
    let start = std::time::Instant::now();

    // 连接（带超时）
    let connect = TcpStream::connect((ip, port));
    let mut stream = match tokio::time::timeout(Duration::from_millis(1500), connect).await {
        Ok(Ok(s)) => s,
        _ => return None,
    };

    // 构造 Handshake 包
    let mut handshake_data = Vec::new();
    write_varint(&mut handshake_data, 0x00); // packet id
    write_varint(&mut handshake_data, -1); // protocol version (-1 = 未指定，仅状态查询)
    write_varint(&mut handshake_data, ip.len() as i32);
    handshake_data.extend_from_slice(ip.as_bytes());
    handshake_data.extend_from_slice(&port.to_be_bytes());
    write_varint(&mut handshake_data, 1); // next state = 1 (status)

    let mut handshake_packet = Vec::new();
    write_varint(&mut handshake_packet, handshake_data.len() as i32);
    handshake_packet.extend_from_slice(&handshake_data);

    // 构造 Status Request 包（空 body，仅 packet id 0x00）
    let mut status_req = Vec::new();
    write_varint(&mut status_req, 1); // length = 1
    write_varint(&mut status_req, 0x00); // packet id

    // 发送（带超时）
    let send = async {
        stream.write_all(&handshake_packet).await?;
        stream.write_all(&status_req).await?;
        stream.flush().await
    };
    if tokio::time::timeout(Duration::from_millis(1500), send).await.is_err() {
        return None;
    }

    // 读取响应（带整体超时）
    let read = async {
        let _packet_len = read_varint(&mut stream).await?;
        let _packet_id = read_varint(&mut stream).await?;
        let json_len = read_varint(&mut stream).await?;
        if json_len <= 0 || json_len > 1024 * 512 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "状态 JSON 长度异常",
            ));
        }
        let mut json_buf = vec![0u8; json_len as usize];
        stream.read_exact(&mut json_buf).await?;
        Ok::<Vec<u8>, std::io::Error>(json_buf)
    };

    let json_buf = match tokio::time::timeout(Duration::from_millis(2000), read).await {
        Ok(Ok(b)) => b,
        _ => return None,
    };

    let json: serde_json::Value = serde_json::from_slice(&json_buf).ok()?;

    let version = json
        .get("version")
        .and_then(|v| v.get("name"))
        .and_then(|n| n.as_str())
        .unwrap_or("未知")
        .to_string();

    let online_players = json
        .get("players")
        .and_then(|p| p.get("online"))
        .and_then(|o| o.as_i64())
        .unwrap_or(0);

    let max_players = json
        .get("players")
        .and_then(|p| p.get("max"))
        .and_then(|m| m.as_i64())
        .unwrap_or(0);

    let motd = json
        .get("description")
        .map(extract_motd)
        .unwrap_or_default();

    Some(DiscoveredServer {
        ip: ip.to_string(),
        port,
        player_name: None,
        motd: motd.trim().to_string(),
        version,
        online_players,
        max_players,
        latency_ms: start.elapsed().as_millis() as u64,
    })
}

/// 扫描多个虚拟 IP 上的 Minecraft 服务器
///
/// # 参数
/// * `peer_ips` - 要扫描的虚拟 IP 列表（通常是大厅内其他玩家的虚拟 IP）
/// * `port` - 端口（默认 25565）
#[tauri::command]
pub async fn scan_minecraft_servers(
    peer_ips: Vec<String>,
    port: Option<u16>,
) -> Vec<DiscoveredServer> {
    let port = port.unwrap_or(25565);
    log::info!("🔍 扫描 Minecraft 局域网世界: {} 个IP, 端口 {}", peer_ips.len(), port);

    let mut tasks = Vec::new();
    for ip in peer_ips {
        let ip_clone = ip.clone();
        tasks.push(tokio::spawn(async move {
            query_server(&ip_clone, port).await
        }));
    }

    let mut results = Vec::new();
    for task in tasks {
        if let Ok(Some(server)) = task.await {
            results.push(server);
        }
    }

    log::info!("✅ 发现 {} 个可加入的 Minecraft 世界", results.len());
    results
}

/// 查询单个虚拟 IP 上的 Minecraft 服务器（用于精确探测某个玩家）
#[tauri::command]
pub async fn query_minecraft_server(ip: String, port: Option<u16>) -> Option<DiscoveredServer> {
    query_server(&ip, port.unwrap_or(25565)).await
}

/// 单个对等节点的连接质量
#[derive(Debug, Clone, Serialize)]
pub struct PeerLatency {
    pub ip: String,
    /// 延迟（毫秒），None 表示不可达
    #[serde(rename = "latencyMs")]
    pub latency_ms: Option<u64>,
    /// 丢包率（百分比 0~100）
    #[serde(rename = "lossRate")]
    pub loss_rate: u8,
}

/// 测量到某个虚拟 IP 的延迟（通过 TCP 连接其聊天端口 14540 估算 RTT）
async fn measure_one(ip: &str) -> Option<u64> {
    let start = std::time::Instant::now();
    let connect = TcpStream::connect((ip, 14540u16));
    match tokio::time::timeout(Duration::from_millis(800), connect).await {
        Ok(Ok(_stream)) => Some(start.elapsed().as_millis() as u64),
        // 连接被拒绝也说明主机可达（端口可能未开），仍记录 RTT
        Ok(Err(e)) if e.kind() == std::io::ErrorKind::ConnectionRefused => {
            Some(start.elapsed().as_millis() as u64)
        }
        _ => None,
    }
}

/// 批量测量到大厅内各玩家虚拟 IP 的延迟与丢包率，用于连接质量面板。
/// 每个 IP 探测 4 次：取可达样本的平均 RTT 作为延迟，未达比例作为丢包率。
#[tauri::command]
pub async fn measure_peers_latency(peer_ips: Vec<String>) -> Vec<PeerLatency> {
    let mut tasks = Vec::new();
    for ip in peer_ips {
        let ip_clone = ip.clone();
        tasks.push(tokio::spawn(async move {
            let probes = 2u32;
            let mut oks: Vec<u64> = Vec::new();
            for _ in 0..probes {
                if let Some(rtt) = measure_one(&ip_clone).await {
                    oks.push(rtt);
                }
            }
            let latency = if oks.is_empty() { None } else { Some(oks.iter().sum::<u64>() / oks.len() as u64) };
            let loss = (((probes as usize - oks.len()) * 100) / probes as usize) as u8;
            PeerLatency { ip: ip_clone, latency_ms: latency, loss_rate: loss }
        }));
    }
    let mut results = Vec::new();
    for task in tasks {
        if let Ok(r) = task.await {
            results.push(r);
        }
    }
    results
}
