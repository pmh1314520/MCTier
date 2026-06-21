// Minecraft 局域网中继桥（仅桌面）
//
// 把"虚拟局域网内其他玩家开放的 Minecraft 世界"重新出现在本机 Minecraft 的「局域网」列表中，
// 让玩家点一下就能加入，无需手动输入 虚拟IP:端口。
//
// 原理（应用层中继，不修改任何游戏进程）：
// 1. 对每个远端 MC 世界(虚拟IP:端口)，本机启动一个 TCP 代理监听 127.0.0.1:随机端口，
//    把连接透明转发到 远端虚拟IP:端口（经 EasyTier 虚拟网到达房主）。
// 2. 周期性向组播组 224.0.2.60:4445 发送 Minecraft LAN 公告 "[MOTD]描述[/MOTD][AD]代理端口[/AD]"，
//    发送套接字绑定 127.0.0.1，使本机 Minecraft 读取到的服务器地址为 127.0.0.1:代理端口。
// 3. 本机 Minecraft 在「局域网」列表看到该世界，点击即连到 127.0.0.1:代理端口 → 代理转发到房主。

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddrV4, TcpListener, TcpStream, UdpSocket};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::Duration;

/// 前端传入的待广播服务器
#[derive(Debug, Clone, serde::Deserialize)]
pub struct McServer {
    pub ip: String,
    pub port: u16,
    #[serde(default)]
    pub motd: String,
}

struct ProxyEntry {
    proxy_port: u16,
    motd: String,
    alive: Arc<AtomicBool>,
}

struct Bridge {
    running: bool,
    /// key = "ip:port"
    proxies: HashMap<String, ProxyEntry>,
    /// 公告线程代次，stop 或重置时自增以让旧线程退出
    emit_gen: u64,
}

static BRIDGE: OnceLock<Mutex<Bridge>> = OnceLock::new();
static EMIT_RUNNING: AtomicBool = AtomicBool::new(false);
static EMIT_GEN: AtomicU64 = AtomicU64::new(0);

fn bridge() -> &'static Mutex<Bridge> {
    BRIDGE.get_or_init(|| {
        Mutex::new(Bridge {
            running: false,
            proxies: HashMap::new(),
            emit_gen: 0,
        })
    })
}

/// 双向拷贝两个 TCP 流
fn pipe(mut a: TcpStream, mut b: TcpStream) {
    if let (Ok(mut a2), Ok(mut b2)) = (a.try_clone(), b.try_clone()) {
        let t = thread::spawn(move || {
            let mut buf = [0u8; 16 * 1024];
            loop {
                match a2.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        if b2.write_all(&buf[..n]).is_err() {
                            break;
                        }
                    }
                }
            }
            let _ = b2.shutdown(std::net::Shutdown::Both);
        });
        let mut buf = [0u8; 16 * 1024];
        loop {
            match b.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if a.write_all(&buf[..n]).is_err() {
                        break;
                    }
                }
            }
        }
        let _ = a.shutdown(std::net::Shutdown::Both);
        let _ = t.join();
    }
}

/// 启动一个本地代理监听，转发到 远端 ip:port，返回分配到的本地端口
fn start_proxy(target_ip: String, target_port: u16, alive: Arc<AtomicBool>) -> Option<u16> {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).ok()?;
    let local_port = listener.local_addr().ok()?.port();
    listener.set_nonblocking(true).ok()?;
    thread::spawn(move || {
        loop {
            if !alive.load(Ordering::Relaxed) {
                break;
            }
            match listener.accept() {
                Ok((client, _)) => {
                    let ip = target_ip.clone();
                    thread::spawn(move || {
                        let _ = client.set_nodelay(true);
                        match TcpStream::connect((ip.as_str(), target_port)) {
                            Ok(server) => {
                                let _ = server.set_nodelay(true);
                                pipe(client, server);
                            }
                            Err(_) => { /* 连接房主失败，丢弃 */ }
                        }
                    });
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(120));
                }
                Err(_) => break,
            }
        }
    });
    Some(local_port)
}

/// 确保公告线程在运行：周期向 224.0.2.60:4445 发送当前所有代理对应的 MC LAN 公告
fn ensure_emit_thread() {
    if EMIT_RUNNING.swap(true, Ordering::SeqCst) {
        return; // 已有公告线程
    }
    let my_gen = EMIT_GEN.load(Ordering::SeqCst);
    thread::spawn(move || {
        // 绑定 127.0.0.1，使 Minecraft 读到的源地址为 127.0.0.1
        let sock = match UdpSocket::bind((Ipv4Addr::LOCALHOST, 0)) {
            Ok(s) => s,
            Err(_) => {
                EMIT_RUNNING.store(false, Ordering::SeqCst);
                return;
            }
        };
        let _ = sock.set_multicast_loop_v4(true);
        let _ = sock.set_multicast_ttl_v4(1);
        let target = SocketAddrV4::new(Ipv4Addr::new(224, 0, 2, 60), 4445);
        loop {
            // 代次变化或桥已停止 → 退出
            if EMIT_GEN.load(Ordering::SeqCst) != my_gen {
                break;
            }
            let entries: Vec<(u16, String)> = {
                let b = bridge().lock().unwrap();
                if !b.running {
                    Vec::new()
                } else {
                    b.proxies
                        .values()
                        .map(|p| (p.proxy_port, p.motd.clone()))
                        .collect()
                }
            };
            if entries.is_empty() {
                // 无可广播项时退出线程，待有服务器时再启动
                break;
            }
            for (port, motd) in entries {
                let safe_motd = if motd.trim().is_empty() {
                    "MCTier 世界".to_string()
                } else {
                    motd.replace("[/MOTD]", " ").replace("[/AD]", " ")
                };
                let msg = format!("[MOTD]{}[/MOTD][AD]{}[/AD]", safe_motd, port);
                let _ = sock.send_to(msg.as_bytes(), target);
            }
            thread::sleep(Duration::from_millis(1500));
        }
        EMIT_RUNNING.store(false, Ordering::SeqCst);
    });
}

/// 设置/更新要在本机 Minecraft 局域网列表中显示的服务器集合
#[tauri::command]
pub fn start_mc_lan_broadcast(servers: Vec<McServer>) -> Result<(), String> {
    let mut b = bridge().lock().map_err(|_| "锁失败".to_string())?;
    b.running = true;

    // 期望的 key 集合
    let mut wanted: HashMap<String, McServer> = HashMap::new();
    for s in servers {
        if s.ip.trim().is_empty() || s.port == 0 {
            continue;
        }
        wanted.insert(format!("{}:{}", s.ip, s.port), s);
    }

    // 移除不再需要的代理
    let to_remove: Vec<String> = b
        .proxies
        .keys()
        .filter(|k| !wanted.contains_key(*k))
        .cloned()
        .collect();
    for k in to_remove {
        if let Some(p) = b.proxies.remove(&k) {
            p.alive.store(false, Ordering::Relaxed);
        }
    }

    // 新增需要的代理，更新已有的 motd
    for (key, s) in wanted {
        if let Some(existing) = b.proxies.get_mut(&key) {
            existing.motd = s.motd;
            continue;
        }
        let alive = Arc::new(AtomicBool::new(true));
        if let Some(port) = start_proxy(s.ip.clone(), s.port, alive.clone()) {
            b.proxies.insert(
                key,
                ProxyEntry {
                    proxy_port: port,
                    motd: s.motd,
                    alive,
                },
            );
        }
    }

    drop(b);
    ensure_emit_thread();
    Ok(())
}

/// 停止局域网中继：关闭所有代理与公告
#[tauri::command]
pub fn stop_mc_lan_broadcast() -> Result<(), String> {
    let mut b = bridge().lock().map_err(|_| "锁失败".to_string())?;
    b.running = false;
    for (_, p) in b.proxies.drain() {
        p.alive.store(false, Ordering::Relaxed);
    }
    // 让公告线程退出
    EMIT_GEN.fetch_add(1, Ordering::SeqCst);
    Ok(())
}
