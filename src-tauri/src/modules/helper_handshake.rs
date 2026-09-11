use std::io::{ErrorKind, Read};
use std::net::{TcpListener, TcpStream};
use std::time::{Duration, Instant};

/// Invalid or stalled candidates cannot consume the entire authorization wait.
pub fn accept_authenticated(
    listener: TcpListener,
    expected: &str,
    timeout: Duration,
) -> Result<TcpStream, String> {
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let deadline = Instant::now() + timeout;
    let expected = format!("{expected}\n").into_bytes();
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
                let (stream, _, _) = candidates.swap_remove(index);
                stream.set_nonblocking(false).map_err(|e| e.to_string())?;
                return Ok(stream);
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    #[test]
    fn invalid_and_stalled_clients_do_not_block_valid_helper() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let worker = std::thread::spawn(move || {
            accept_authenticated(listener, "secret", Duration::from_secs(2)).unwrap()
        });
        let _stalled = TcpStream::connect(addr).unwrap();
        let mut bad = TcpStream::connect(addr).unwrap();
        bad.write_all(&[b'x'; 4096]).unwrap();
        let mut valid = TcpStream::connect(addr).unwrap();
        valid.write_all(b"secret\n").unwrap();
        assert!(worker.join().unwrap().peer_addr().is_ok());
    }
    #[test]
    fn timeout_is_absolute_even_with_a_silent_connection() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let _silent = TcpStream::connect(listener.local_addr().unwrap()).unwrap();
        let start = Instant::now();
        assert!(accept_authenticated(listener, "secret", Duration::from_millis(80)).is_err());
        assert!(start.elapsed() < Duration::from_secs(1));
    }
}
