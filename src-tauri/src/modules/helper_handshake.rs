use std::io::{ErrorKind, Read};
use std::net::{TcpListener, TcpStream};
use std::time::{Duration, Instant};

pub const HANDSHAKE_PREFIX: &str = "MCTIER_PRIVILEGED_HELPER/2";

#[cfg(windows)]
pub fn accept_authenticated(
    listener: TcpListener,
    helper_pid: u32,
    timeout: Duration,
) -> Result<TcpStream, String> {
    accept_with_owner_check(listener, timeout, |stream| {
        tcp_owner_pid(stream.peer_addr().ok()?, stream.local_addr().ok()?)
            .map(|pid| pid == helper_pid)
    })
}

/// Invalid or stalled candidates cannot consume the entire authorization wait.
fn accept_with_owner_check(
    listener: TcpListener,
    timeout: Duration,
    mut owner_matches: impl FnMut(&TcpStream) -> Option<bool>,
) -> Result<TcpStream, String> {
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let deadline = Instant::now() + timeout;
    let expected = format!("{HANDSHAKE_PREFIX}\n").into_bytes();
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
            let (stream, received, started) = &mut candidates[index];
            // Once the prefix is complete, retry identity lookup without reading
            // an empty buffer (Ok(0) there is not an EOF).
            let keep = if received.len() == expected.len() {
                true
            } else {
                let mut bytes = vec![0; expected.len() - received.len()];
                match stream.read(&mut bytes) {
                    Ok(0) => false,
                    Ok(n) => {
                        received.extend_from_slice(&bytes[..n]);
                        expected.starts_with(received)
                    }
                    Err(e) => {
                        e.kind() == ErrorKind::WouldBlock || e.kind() == ErrorKind::Interrupted
                    }
                }
            };
            if keep && received == &expected {
                match owner_matches(stream) {
                    Some(true) => {
                        let (stream, _, _) = candidates.swap_remove(index);
                        stream.set_nonblocking(false).map_err(|e| e.to_string())?;
                        return Ok(stream);
                    }
                    Some(false) => {
                        candidates.swap_remove(index);
                        continue;
                    }
                    None => {}
                }
            }
            if !keep || started.elapsed() >= Duration::from_secs(1) {
                candidates.swap_remove(index);
            } else {
                index += 1;
            }
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    Err("等待特权 helper 认证超时，请确认已允许授权请求".into())
}

/// Resolve an established IPv4 connection's local owner from the Windows TCP table.
#[cfg(windows)]
pub fn tcp_owner_pid(local: std::net::SocketAddr, remote: std::net::SocketAddr) -> Option<u32> {
    use windows::Win32::Foundation::ERROR_INSUFFICIENT_BUFFER;
    use windows::Win32::NetworkManagement::IpHelper::{
        GetExtendedTcpTable, MIB_TCPROW_OWNER_PID, MIB_TCPTABLE_OWNER_PID, MIB_TCP_STATE_ESTAB,
        TCP_TABLE_OWNER_PID_CONNECTIONS,
    };
    use windows::Win32::Networking::WinSock::AF_INET;
    let (std::net::SocketAddr::V4(local), std::net::SocketAddr::V4(remote)) = (local, remote)
    else {
        return None;
    };
    let mut size = 0u32;
    let mut buffer: Vec<u32> = Vec::new();
    for _ in 0..4 {
        let pointer = (!buffer.is_empty()).then(|| buffer.as_mut_ptr().cast());
        let result = unsafe {
            GetExtendedTcpTable(
                pointer,
                &mut size,
                false,
                AF_INET.0 as u32,
                TCP_TABLE_OWNER_PID_CONNECTIONS,
                0,
            )
        };
        if result == ERROR_INSUFFICIENT_BUFFER.0 {
            if !(4..=16 * 1024 * 1024).contains(&size) {
                return None;
            }
            buffer.resize((size as usize).div_ceil(4), 0);
            continue;
        }
        if result != 0 || buffer.is_empty() {
            return None;
        }
        let offset = std::mem::offset_of!(MIB_TCPTABLE_OWNER_PID, table);
        let count = buffer[0] as usize;
        let row_size = std::mem::size_of::<MIB_TCPROW_OWNER_PID>();
        let length = offset.checked_add(count.checked_mul(row_size)?)?;
        if length > buffer.len() * 4 || length > size as usize {
            return None;
        }
        for index in 0..count {
            let row = unsafe {
                std::ptr::read_unaligned(
                    buffer
                        .as_ptr()
                        .cast::<u8>()
                        .add(offset + index * row_size)
                        .cast::<MIB_TCPROW_OWNER_PID>(),
                )
            };
            if row.dwState == MIB_TCP_STATE_ESTAB.0 as u32
                && row.dwLocalAddr == u32::from_ne_bytes(local.ip().octets())
                && row.dwRemoteAddr == u32::from_ne_bytes(remote.ip().octets())
                && row.dwLocalPort as u16 == local.port().to_be()
                && row.dwRemotePort as u16 == remote.port().to_be()
            {
                return Some(row.dwOwningPid);
            }
        }
        return None;
    }
    None
}

#[cfg(windows)]
pub fn verify_parent(stream: &TcpStream, parent_pid: u32) -> Result<(), String> {
    use std::os::windows::ffi::OsStringExt;
    use windows::core::PWSTR;
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    struct Process(HANDLE);
    impl Drop for Process {
        fn drop(&mut self) {
            let _ = unsafe { CloseHandle(self.0) };
        }
    }
    let parent = Process(
        unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, parent_pid) }
            .map_err(|e| format!("无法验证 helper 父进程: {e}"))?,
    );
    let mut path = vec![0u16; 32768];
    let mut size = path.len() as u32;
    unsafe {
        QueryFullProcessImageNameW(
            parent.0,
            PROCESS_NAME_WIN32,
            PWSTR(path.as_mut_ptr()),
            &mut size,
        )
    }
    .map_err(|e| e.to_string())?;
    let parent_path =
        std::path::PathBuf::from(std::ffi::OsString::from_wide(&path[..size as usize]));
    if std::fs::canonicalize(parent_path).map_err(|e| e.to_string())?
        != std::fs::canonicalize(std::env::current_exe().map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?
    {
        return Err("helper 父进程不是当前 MCTier 可执行文件".into());
    }
    let deadline = Instant::now() + Duration::from_secs(1);
    while Instant::now() < deadline {
        match tcp_owner_pid(
            stream.peer_addr().map_err(|e| e.to_string())?,
            stream.local_addr().map_err(|e| e.to_string())?,
        ) {
            Some(pid) if pid == parent_pid => return Ok(()),
            Some(_) => return Err("helper 父进程通道身份不匹配".into()),
            None => std::thread::sleep(Duration::from_millis(10)),
        }
    }
    Err("验证 helper 父进程通道超时".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[cfg(windows)]
    #[test]
    fn child_process_probe() {
        let Ok(address) = std::env::var("MCTIER_TEST_HELPER_ADDRESS") else {
            return;
        };
        let parent_pid = std::env::var("MCTIER_TEST_HELPER_PARENT")
            .unwrap()
            .parse()
            .unwrap();
        let mut stream = TcpStream::connect(address).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        stream
            .set_write_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        verify_parent(&stream, parent_pid).unwrap();
        writeln!(stream, "{HANDSHAKE_PREFIX}").unwrap();
        let mut request = [0; 4];
        stream.read_exact(&mut request).unwrap();
        assert_eq!(&request, b"ping");
        stream.write_all(b"pong").unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn authenticates_real_child_process_and_exchanges_data() {
        use std::os::windows::process::CommandExt;
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let mut child = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["child_process_probe", "--nocapture"])
            .env(
                "MCTIER_TEST_HELPER_ADDRESS",
                listener.local_addr().unwrap().to_string(),
            )
            .env("MCTIER_TEST_HELPER_PARENT", std::process::id().to_string())
            .creation_flags(0x08000000)
            .spawn()
            .unwrap();
        let accepted = accept_authenticated(listener, child.id(), Duration::from_secs(4));
        if accepted.is_err() {
            let _ = child.kill();
            let _ = child.wait();
        }
        let mut stream = accepted.unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        stream
            .set_write_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        stream.write_all(b"ping").unwrap();
        let mut reply = [0; 4];
        let read = stream.read_exact(&mut reply);
        let status = child.wait().unwrap();
        read.unwrap();
        assert_eq!(&reply, b"pong");
        assert!(status.success());
    }
    #[test]
    fn invalid_and_stalled_clients_do_not_block_valid_helper() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let worker = std::thread::spawn(move || {
            accept_with_owner_check(listener, Duration::from_secs(2), |_| Some(true)).unwrap()
        });
        let _stalled = TcpStream::connect(addr).unwrap();
        let mut bad = TcpStream::connect(addr).unwrap();
        bad.write_all(&[b'x'; 4096]).unwrap();
        let mut valid = TcpStream::connect(addr).unwrap();
        valid
            .write_all(format!("{HANDSHAKE_PREFIX}\n").as_bytes())
            .unwrap();
        assert!(worker.join().unwrap().peer_addr().is_ok());
    }
    #[test]
    fn timeout_is_absolute_even_with_a_silent_connection() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let _silent = TcpStream::connect(listener.local_addr().unwrap()).unwrap();
        let start = Instant::now();
        assert!(
            accept_with_owner_check(listener, Duration::from_millis(80), |_| Some(true)).is_err()
        );
        assert!(start.elapsed() < Duration::from_secs(1));
    }

    #[test]
    fn complete_prefix_survives_delayed_owner_lookup_and_preserves_payload() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let worker = std::thread::spawn(move || {
            let mut calls = 0;
            let mut stream = accept_with_owner_check(listener, Duration::from_secs(2), |_| {
                calls += 1;
                if calls < 3 {
                    None
                } else {
                    Some(true)
                }
            })
            .unwrap();
            let mut payload = [0; 7];
            stream.read_exact(&mut payload).unwrap();
            assert_eq!(&payload, b"payload");
        });
        let mut client = TcpStream::connect(addr).unwrap();
        client
            .write_all(format!("{HANDSHAKE_PREFIX}\npayload").as_bytes())
            .unwrap();
        worker.join().unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn windows_owner_checks_both_directions_and_rejects_wrong_pid() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let mut client = TcpStream::connect(addr).unwrap();
        client
            .write_all(format!("{HANDSHAKE_PREFIX}\n").as_bytes())
            .unwrap();
        let accepted =
            accept_authenticated(listener, std::process::id(), Duration::from_secs(2)).unwrap();
        verify_parent(&client, std::process::id()).unwrap();
        assert!(verify_parent(&client, 0).is_err());
        assert_eq!(
            tcp_owner_pid(accepted.peer_addr().unwrap(), addr),
            Some(std::process::id())
        );
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let mut client = TcpStream::connect(listener.local_addr().unwrap()).unwrap();
        client
            .write_all(format!("{HANDSHAKE_PREFIX}\n").as_bytes())
            .unwrap();
        assert!(accept_authenticated(listener, 0, Duration::from_millis(100)).is_err());
    }
}
