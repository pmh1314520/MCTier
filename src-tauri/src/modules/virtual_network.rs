use std::net::Ipv4Addr;

/// std creates non-inheritable sockets on Windows. The current mio bind path
/// does not, so children such as the log viewer can otherwise keep ports alive.
pub fn bind_service_listener(address: std::net::SocketAddr) -> std::io::Result<tokio::net::TcpListener> {
    let listener = std::net::TcpListener::bind(address)?;
    listener.set_nonblocking(true)?;
    tokio::net::TcpListener::from_std(listener)
}

/// Only literal host addresses in the MCTier virtual subnet can be dialed.
pub fn virtual_host(ip: &str) -> Option<Ipv4Addr> {
    let address = ip.parse::<Ipv4Addr>().ok()?;
    let octets = address.octets();
    (octets[..3] == [10, 126, 126] && (1..=254).contains(&octets[3])).then_some(address)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(windows)]
    #[tokio::test]
    async fn service_listener_cannot_be_inherited_by_child_processes() {
        use std::os::windows::io::AsRawSocket;
        use windows::Win32::Foundation::{GetHandleInformation, HANDLE, HANDLE_FLAG_INHERIT};

        let listener = bind_service_listener("127.0.0.1:0".parse().unwrap()).unwrap();
        let mut flags = 0;
        unsafe {
            GetHandleInformation(HANDLE(listener.as_raw_socket() as *mut _), &mut flags).unwrap();
        }
        assert_eq!(flags & HANDLE_FLAG_INHERIT.0, 0);
        let connection = tokio::net::TcpStream::connect(listener.local_addr().unwrap()).await.unwrap();
        let (accepted, _) = listener.accept().await.unwrap();
        unsafe {
            GetHandleInformation(HANDLE(accepted.as_raw_socket() as *mut _), &mut flags).unwrap();
        }
        assert_eq!(flags & HANDLE_FLAG_INHERIT.0, 0);
        drop(connection);
    }

    #[test]
    fn only_literal_virtual_hosts_are_allowed() {
        for host in [1, 128, 254] {
            assert!(virtual_host(&format!("10.126.126.{host}")).is_some());
        }
        for host in [
            "10.126.126.0",
            "10.126.126.255",
            "127.0.0.1",
            "192.168.1.1",
            "10.126.125.1",
            "::ffff:10.126.126.1",
            "localhost",
            "10.126.126.1.evil.com",
            "10.126.126.01",
            " 10.126.126.1",
            "8.8.8.8",
        ] {
            assert!(virtual_host(host).is_none(), "{host}");
        }
    }
}
