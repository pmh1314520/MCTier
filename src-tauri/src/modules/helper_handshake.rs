use std::io::{ErrorKind, Read};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::time::{Duration, Instant};

/// helper 首行握手前缀。仅作噪音过滤；真正的认证是对端进程身份（PID 绑定）。
pub const HANDSHAKE_PREFIX: &str = "MCTIER_PRIVILEGED_HELPER/1";

/// 特权 helper 通道的父进程侧认证。
///
/// 不再使用共享 token：随 `runas` 命令行下发的 token 会被同一会话内的任意
/// 进程读取（Win32_Process / NtQueryInformationProcess），并随 4688 进程审计
/// 日志永久留存。命令行只携带端口（非机密），对端的身份由父进程持有的提升
/// 进程句柄绑定 —— 仅接受 TCP owner PID（GetExtendedTcpTable 的内核事实）
/// 与 helper 进程一致、且首行匹配握手前缀的连接。
pub fn accept_authenticated(
    listener: TcpListener,
    helper_pid: u32,
    timeout: Duration,
) -> Result<TcpStream, String> {
    let local = listener.local_addr().map_err(|e| e.to_string())?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let deadline = Instant::now() + timeout;
    let expected = format!("{}\n", HANDSHAKE_PREFIX).into_bytes();
    let mut candidates: Vec<(TcpStream, Vec<u8>, Instant)> = Vec::new();
    while Instant::now() < deadline {
        // Bound both accept work per iteration and memory used by unauthenticated peers.
        for _ in 0..32 {
            match listener.accept() {
                Ok((stream, peer)) if peer.ip().is_loopback() && candidates.len() < 32 => {
                    if stream.set_nonblocking(true).is_ok() {
                        candidates.push((
                            stream,
                            Vec::with_capacity(expected.len()),
                            Instant::now(),
                        ));
                    }
                }
                Ok(_) => {}
                Err(e) if e.kind() == ErrorKind::WouldBlock => break,
                Err(e) => return Err(e.to_string()),
            }
        }
        let mut index = 0;
        while index < candidates.len() {
            let verdict = {
                let (stream, received, started) = &mut candidates[index];
                let mut bytes = vec![0; expected.len() - received.len()];
                let keep = match stream.read(&mut bytes) {
                    Ok(0) => false,
                    Ok(n) => {
                        received.extend_from_slice(&bytes[..n]);
                        expected.starts_with(received)
                    }
                    Err(e) => e.kind() == ErrorKind::WouldBlock || e.kind() == ErrorKind::Interrupted,
                };
                if keep && received == &expected {
                    match candidate_owner_matches(stream, &local, helper_pid) {
                        CandidateCheck::Match => Some(true),
                        CandidateCheck::Mismatch => Some(false),
                        // TCP owner 表对刚建立的连接可能滞后一轮轮询；保留候选
                        // 直到其单候选存活上限到期。
                        CandidateCheck::Unknown => {
                            if started.elapsed() >= Duration::from_secs(1) {
                                Some(false)
                            } else {
                                None
                            }
                        }
                    }
                } else if !keep || started.elapsed() >= Duration::from_secs(1) {
                    Some(false)
                } else {
                    None
                }
            };
            match verdict {
                Some(true) => {
                    let (stream, _, _) = candidates.swap_remove(index);
                    stream.set_nonblocking(false).map_err(|e| e.to_string())?;
                    return Ok(stream);
                }
                Some(false) => {
                    candidates.swap_remove(index);
                }
                None => {
                    index += 1;
                }
            }
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    Err("等待特权 helper 认证超时，请确认已允许授权请求".into())
}

#[derive(Debug, PartialEq, Eq)]
enum CandidateCheck {
    Match,
    Mismatch,
    Unknown,
}

#[cfg(windows)]
fn candidate_owner_matches(
    stream: &TcpStream,
    listener_addr: &SocketAddr,
    expected_pid: u32,
) -> CandidateCheck {
    match socket_owner_pid(stream, listener_addr) {
        Some(pid) if pid == expected_pid => CandidateCheck::Match,
        Some(_) => CandidateCheck::Mismatch,
        None => CandidateCheck::Unknown,
    }
}

#[cfg(not(windows))]
fn candidate_owner_matches(
    _stream: &TcpStream,
    _listener_addr: &SocketAddr,
    _expected_pid: u32,
) -> CandidateCheck {
    // 特权提升通道只存在于 Windows；其余平台退回仅前缀校验，供跨平台测试。
    CandidateCheck::Match
}

#[cfg(windows)]
fn socket_owner_pid(stream: &TcpStream, listener_addr: &SocketAddr) -> Option<u32> {
    tcp_connection_owner_pid(stream.peer_addr().ok()?, *listener_addr)
}

/// 通过 GetExtendedTcpTable 查询「client:port -> server:port」已建立连接的
/// 客户端侧属主 PID。表由内核维护，本地进程无法伪造他人连接的属主。
/// 返回 None 表示暂时查不到该行（表滞后或地址族不符），调用方应稍后重试。
#[cfg(windows)]
fn tcp_connection_owner_pid(client: SocketAddr, server: SocketAddr) -> Option<u32> {
    use windows::Win32::Foundation::ERROR_INSUFFICIENT_BUFFER;
    use windows::Win32::NetworkManagement::IpHelper::{
        GetExtendedTcpTable, TCP_TABLE_OWNER_PID_CONNECTIONS,
    };
    use windows::Win32::Networking::WinSock::AF_INET;

    let to_v4 = |ip: std::net::IpAddr| -> Option<std::net::Ipv4Addr> {
        match ip {
            std::net::IpAddr::V4(v4) => Some(v4),
            std::net::IpAddr::V6(v6) => v6.to_ipv4_mapped(),
        }
    };
    let (client_port_raw, server_port_raw) = (client.port(), server.port());
    let (Some(client), Some(server)) = (to_v4(client.ip()), to_v4(server.ip())) else {
        return None;
    };
    let client_raw = u32::from(client).swap_bytes();
    let server_raw = u32::from(server).swap_bytes();
    let client_port_raw = client_port_raw.to_be() as u32;
    let server_port_raw = server_port_raw.to_be() as u32;

    let mut size: u32 = 0;
    let result = unsafe {
        GetExtendedTcpTable(
            None,
            &mut size,
            false,
            AF_INET.0 as u32,
            TCP_TABLE_OWNER_PID_CONNECTIONS,
            0,
        )
    };
    if result != ERROR_INSUFFICIENT_BUFFER.0 || size < 4 || size > 64 * 1024 * 1024 {
        return None;
    }
    let mut buffer = vec![0u8; size as usize];
    let result = unsafe {
        GetExtendedTcpTable(
            Some(buffer.as_mut_ptr().cast()),
            &mut size,
            false,
            AF_INET.0 as u32,
            TCP_TABLE_OWNER_PID_CONNECTIONS,
            0,
        )
    };
    if result != 0 {
        return None;
    }
    // MIB_TCPTABLE_OWNER_PID：dwNumEntries 后跟 MIB_TCPROW_OWNER_PID 数组，
    // 每行 6 个 u32：state, localAddr, localPort, remoteAddr, remotePort, pid。
    let field = |offset: usize| -> Option<u32> {
        let bytes = buffer.get(offset..offset + 4)?;
        Some(u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
    };
    let count = field(0)? as usize;
    for index in 0..count {
        let base = 4 + index.checked_mul(24)?;
        let (Some(_state), Some(local_addr)) = (field(base), field(base + 4)) else {
            return None;
        };
        let (Some(local_port), Some(remote_addr)) = (field(base + 8), field(base + 12)) else {
            return None;
        };
        let (Some(remote_port), Some(pid)) = (field(base + 16), field(base + 20)) else {
            return None;
        };
        if local_addr == client_raw
            && local_port == client_port_raw
            && remote_addr == server_raw
            && remote_port == server_port_raw
        {
            return Some(pid);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    fn handshake_line() -> String {
        format!("{}\n", HANDSHAKE_PREFIX)
    }

    #[test]
    fn invalid_and_stalled_clients_do_not_block_valid_helper() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let pid = std::process::id();
        let worker = std::thread::spawn(move || {
            accept_authenticated(listener, pid, Duration::from_secs(2)).unwrap()
        });
        let _stalled = TcpStream::connect(addr).unwrap();
        let mut bad = TcpStream::connect(addr).unwrap();
        bad.write_all(&[b'x'; 4096]).unwrap();
        let mut valid = TcpStream::connect(addr).unwrap();
        valid.write_all(handshake_line().as_bytes()).unwrap();
        assert!(worker.join().unwrap().peer_addr().is_ok());
    }
    #[test]
    fn timeout_is_absolute_even_with_a_silent_connection() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let _silent = TcpStream::connect(listener.local_addr().unwrap()).unwrap();
        let start = Instant::now();
        assert!(accept_authenticated(
            listener,
            std::process::id(),
            Duration::from_millis(80)
        )
        .is_err());
        assert!(start.elapsed() < Duration::from_secs(1));
    }
    #[cfg(windows)]
    #[test]
    fn foreign_process_with_valid_prefix_is_rejected() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        // 非零且必然不等于本进程 PID 的期望值：合法前缀也必须因属主不符被拒。
        let wrong_pid = std::process::id().wrapping_add(1).max(1);
        let worker = std::thread::spawn(move || {
            accept_authenticated(listener, wrong_pid, Duration::from_millis(300))
        });
        let mut client = TcpStream::connect(addr).unwrap();
        client.write_all(handshake_line().as_bytes()).unwrap();
        assert!(worker.join().unwrap().is_err());
    }
}
