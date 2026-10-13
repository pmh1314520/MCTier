//! Local STUN binding discovery for native-capture clients. Chromium restricts
//! interface enumeration without browser capture permission; its wildcard ICE
//! socket can still discover the actual route to the EasyTier interface via STUN.
//! This endpoint never relays audio and only answers requests from its own IP.
use std::{future::Future, io, net::{Ipv4Addr, SocketAddr}, sync::{Mutex, OnceLock}, time::Duration};
use tokio::{net::UdpSocket, task::JoinHandle};

struct Discovery { ip: Ipv4Addr, url: String, worker: JoinHandle<()> }
impl Drop for Discovery { fn drop(&mut self) { self.worker.abort(); } }
#[derive(Default)]
struct DiscoveryState { generation: u64, active: Option<Discovery> }
fn discovery() -> &'static Mutex<DiscoveryState> {
    static INSTANCE: OnceLock<Mutex<DiscoveryState>> = OnceLock::new();
    INSTANCE.get_or_init(Default::default)
}

fn binding_response(request: &[u8], source: SocketAddr, local_ip: Ipv4Addr) -> Option<[u8; 32]> {
    let SocketAddr::V4(source) = source else { return None };
    if *source.ip() != local_ip || request.len() < 20 || request.len() > 2048
        || request[0..2] != [0, 1] || request[4..8] != [0x21, 0x12, 0xa4, 0x42] {
        return None;
    }
    let length = u16::from_be_bytes([request[2], request[3]]) as usize;
    if length % 4 != 0 || length + 20 != request.len() { return None; }
    let mut response = [0u8; 32];
    response[0..4].copy_from_slice(&[1, 1, 0, 12]);
    response[4..20].copy_from_slice(&request[4..20]); // Cookie + transaction ID.
    response[20..26].copy_from_slice(&[0, 0x20, 0, 8, 0, 1]); // XOR-MAPPED-ADDRESS, IPv4.
    response[26..28].copy_from_slice(&(source.port() ^ 0x2112).to_be_bytes());
    for (index, byte) in source.ip().octets().iter().enumerate() {
        response[28 + index] = byte ^ request[4 + index];
    }
    Some(response)
}

pub(crate) fn start_for_ip(ip: Ipv4Addr) -> Result<String, String> {
    let generation = discovery().lock().unwrap_or_else(|e| e.into_inner()).generation;
    try_start_for_ip(ip, generation).map_err(|e| e.to_string())
}

fn try_start_for_ip(ip: Ipv4Addr, generation: u64) -> io::Result<String> {
    if ip.is_unspecified() || ip.is_multicast() || ip.is_broadcast() {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "无效的本机虚拟网卡地址"));
    }
    let mut current = discovery().lock().unwrap_or_else(|e| e.into_inner());
    if current.generation != generation {
        return Err(io::Error::new(io::ErrorKind::Interrupted, "大厅已退出，取消语音地址探测"));
    }
    if let Some(active) = current.active.as_ref().filter(|active| active.ip == ip && !active.worker.is_finished()) {
        return Ok(active.url.clone());
    }
    let socket = std::net::UdpSocket::bind((ip, 0))?;
    socket.set_nonblocking(true)?;
    let port = socket.local_addr()?.port();
    let socket = UdpSocket::from_std(socket)?;
    let url = format!("stun:{ip}:{port}");
    let worker = tokio::spawn(async move {
        let mut buffer = [0u8; 2049];
        while let Ok((length, source)) = socket.recv_from(&mut buffer).await {
            if let Some(response) = binding_response(&buffer[..length], source, ip) {
                let _ = socket.send_to(&response, source).await;
            }
        }
    });
    log::info!("[AudioPipeline] native ICE discovery ready: {url}");
    current.active = Some(Discovery { ip, url: url.clone(), worker });
    Ok(url)
}

pub fn stop() {
    let mut current = discovery().lock().unwrap_or_else(|e| e.into_inner());
    current.generation = current.generation.wrapping_add(1);
    current.active.take();
}

// EasyTier prints its configured IP before Windows installs that address. Retry
// the actual bind, without keeping the core/network locks across a sleep.
async fn wait_for_interface<T, F, Fut>(budget: Duration, interval: Duration, mut attempt: F) -> Result<T, String>
where F: FnMut() -> Fut, Fut: Future<Output = io::Result<T>> {
    let deadline = tokio::time::Instant::now() + budget;
    let mut waiting = false;
    loop {
        match attempt().await {
            Ok(value) => return Ok(value),
            Err(error) if error.kind() == io::ErrorKind::AddrNotAvailable || error.raw_os_error() == Some(10049) => {
                if tokio::time::Instant::now() >= deadline {
                    return Err(format!("等待大厅虚拟网卡就绪超时，无法建立实时语音连接：{error}"));
                }
                if !waiting {
                    log::info!("[AudioPipeline] native ICE waiting for virtual interface: {error}");
                    waiting = true;
                }
                tokio::time::sleep_until(deadline.min(tokio::time::Instant::now() + interval)).await;
            }
            Err(error) => return Err(format!("无法配置大厅实时语音连接：{error}")),
        }
    }
}

#[tauri::command]
pub async fn voice_ice_server(window: tauri::WebviewWindow, state: tauri::State<'_, crate::modules::tauri_commands::AppState>) -> Result<Option<String>, String> {
    if window.label() != "main" || !crate::modules::media_permission::trusted(window.url().map_err(|e| e.to_string())?.as_str()) {
        return Err("仅 MCTier 主窗口可配置语音连接".into());
    }
    if !cfg!(windows) { return Ok(None); }
    // Never accept a caller-supplied listen address: use the active lobby's endpoint.
    let generation = discovery().lock().unwrap_or_else(|e| e.into_inner()).generation;
    let service = state.core.lock().await.get_network_service();
    wait_for_interface(Duration::from_secs(15), Duration::from_millis(200), || async {
        if discovery().lock().unwrap_or_else(|e| e.into_inner()).generation != generation {
            return Err(io::Error::new(io::ErrorKind::Interrupted, "大厅已退出，取消语音地址探测"));
        }
        let ip = service.lock().await.get_virtual_ip().await
            .ok_or_else(|| io::Error::new(io::ErrorKind::AddrNotAvailable, "大厅虚拟网卡尚未分配地址"))?;
        let ip = ip.parse().map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "虚拟网卡地址不是 IPv4"))?;
        try_start_for_ip(ip, generation)
    }).await.map(Some)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn request() -> [u8; 20] { let mut r = [0u8; 20]; r[1] = 1; r[4..8].copy_from_slice(&[0x21,0x12,0xa4,0x42]); r[8..20].fill(7); r }
    #[test]
    fn binding_response_preserves_transaction_and_maps_address() {
        let ip = Ipv4Addr::new(10,126,126,110);
        let r = request();
        let result = binding_response(&r, (ip, 52341).into(), ip).unwrap();
        assert_eq!(&result[4..20], &r[4..20]);
        assert_eq!(u16::from_be_bytes([result[26],result[27]]) ^ 0x2112, 52341);
        let decoded: Vec<_> = (0..4).map(|i| result[28+i] ^ r[4+i]).collect();
        assert_eq!(decoded, ip.octets());
        assert!(binding_response(&r, (Ipv4Addr::new(10,126,126,153), 5000).into(), ip).is_none());
        for len in 0..20 { assert!(binding_response(&r[..len], (ip,5000).into(), ip).is_none()); }
        let mut invalid = r; invalid[3] = 4;
        assert!(binding_response(&invalid, (ip,5000).into(), ip).is_none());
    }
    #[tokio::test]
    async fn socket_reuses_session_and_stop_releases_port() {
        let url = start_for_ip(Ipv4Addr::LOCALHOST).unwrap();
        assert_eq!(start_for_ip(Ipv4Addr::LOCALHOST).unwrap(), url);
        let address = url.strip_prefix("stun:").unwrap();
        let client = UdpSocket::bind((Ipv4Addr::LOCALHOST,0)).await.unwrap();
        client.send_to(&request(),address).await.unwrap();
        let mut result = [0;64];
        assert_eq!(tokio::time::timeout(std::time::Duration::from_secs(2),client.recv_from(&mut result)).await.unwrap().unwrap().0,32);
        stop(); tokio::task::yield_now().await;
        assert!(std::net::UdpSocket::bind(address).is_ok());
    }

    #[tokio::test]
    async fn configured_address_is_retried_until_windows_can_bind() {
        let mut attempts = 0;
        let generation = discovery().lock().unwrap().generation;
        let url = wait_for_interface(Duration::from_secs(1), Duration::from_millis(1), || {
            attempts += 1;
            let result = if attempts < 4 {
                // Exact error from the user's log: the configured IP is not installed yet.
                Err(io::Error::from_raw_os_error(10049))
            } else { try_start_for_ip(Ipv4Addr::LOCALHOST, generation) };
            std::future::ready(result)
        }).await.unwrap();
        assert_eq!(attempts, 4);
        let client = UdpSocket::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
        client.send_to(&request(), url.strip_prefix("stun:").unwrap()).await.unwrap();
        let mut result = [0; 64];
        assert_eq!(tokio::time::timeout(Duration::from_secs(1), client.recv_from(&mut result)).await.unwrap().unwrap().0, 32);
        stop();
        tokio::task::yield_now().await;
    }

    #[tokio::test]
    async fn leaving_during_retry_cannot_resurrect_discovery() {
        let generation = discovery().lock().unwrap().generation;
        let mut attempts = 0;
        let result = wait_for_interface(Duration::from_secs(1), Duration::from_millis(1), || {
            attempts += 1;
            std::future::ready(if attempts == 1 {
                stop();
                Err(io::Error::from(io::ErrorKind::AddrNotAvailable))
            } else { try_start_for_ip(Ipv4Addr::LOCALHOST, generation) })
        }).await;
        assert!(result.unwrap_err().contains("取消"));
        assert_eq!(attempts, 2);
        assert!(discovery().lock().unwrap().active.is_none());
    }

    #[tokio::test]
    async fn missing_interface_times_out_and_permanent_errors_are_not_retried() {
        let mut attempts = 0;
        let result = wait_for_interface(Duration::from_millis(5), Duration::from_millis(1), || {
            attempts += 1;
            std::future::ready(Err::<(), _>(io::Error::from(io::ErrorKind::AddrNotAvailable)))
        }).await;
        assert!(result.unwrap_err().contains("超时"));
        assert!(attempts > 1);
        attempts = 0;
        let result = wait_for_interface(Duration::from_secs(1), Duration::from_millis(1), || {
            attempts += 1;
            std::future::ready(Err::<(), _>(io::Error::from(io::ErrorKind::PermissionDenied)))
        }).await;
        assert!(result.is_err());
        assert_eq!(attempts, 1);
    }
}
