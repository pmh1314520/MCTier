//! Narrow Windows privilege broker.
//!
//! The normal Tauri process is `asInvoker`.  When a privileged operation is
//! needed it starts this same executable with the `runas` verb and exchanges
//! one-time, typed requests over a loopback connection.  The broker never
//! accepts an executable name or a shell command from the renderer.

#![cfg(windows)]

use crate::modules::resource_manager::ResourceManager;
use crate::modules::windows_paths;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, BufWriter, Read, Write};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader as AsyncBufReader};
use tokio::net::tcp::{OwnedReadHalf, OwnedWriteHalf};
use tokio::net::TcpListener as AsyncTcpListener;
use tokio::sync::Mutex as AsyncMutex;

const HELPER_SWITCH: &str = "--mctier-privileged-helper";
const HANDSHAKE_PREFIX: &str = "MCTIER_PRIVILEGED_HELPER/1";
const MAX_PROTOCOL_LINE: usize = 8 * 1024 * 1024;
const MAX_HOSTS_BYTES: usize = 1024 * 1024;
const CREATE_NO_WINDOW: u32 = 0x08000000;
const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x00200000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "operation", rename_all = "snake_case")]
pub enum HelperRequest {
    StartEasyTier {
        executable: String,
        working_dir: String,
        config_dir: String,
        args: Vec<String>,
    },
    StopEasyTier,
    WriteHosts {
        expected_sha256: String,
        content: String,
    },
    AddFirewall {
        easytier_path: String,
    },
    CheckFirewall,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "event", rename_all = "snake_case")]
pub enum HelperEvent {
    Started,
    Stdout {
        line: String,
    },
    Stderr {
        line: String,
    },
    Exited {
        code: Option<i32>,
    },
    Response {
        ok: bool,
        value: Option<String>,
        error: Option<String>,
    },
}

#[derive(Clone)]
pub struct HelperSession {
    writer: Arc<AsyncMutex<OwnedWriteHalf>>,
}

impl HelperSession {
    pub async fn stop(&self) -> Result<(), String> {
        let mut writer = self.writer.lock().await;
        write_async_json(&mut *writer, &HelperRequest::StopEasyTier).await
    }
}

/// Start a long-lived elevated helper and return its event stream.
pub async fn start_easytier(
    executable: PathBuf,
    working_dir: PathBuf,
    config_dir: PathBuf,
    args: Vec<String>,
) -> Result<(HelperSession, OwnedReadHalf), String> {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
        .map_err(|e| format!("无法创建特权 helper 通道: {}", e))?;
    listener
        .set_nonblocking(true)
        .map_err(|e| format!("无法配置特权 helper 通道: {}", e))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("无法读取特权 helper 端口: {}", e))?
        .port();
    let token = uuid::Uuid::new_v4().to_string();
    launch_elevated_helper(port, &token)?;

    let listener = AsyncTcpListener::from_std(listener)
        .map_err(|e| format!("无法接管特权 helper 通道: {}", e))?;
    let deadline = Instant::now() + Duration::from_secs(10);
    let stream = loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err("等待特权 helper 响应超时，请确认已允许 UAC 请求".to_string());
        }
        let accepted = tokio::time::timeout(remaining, listener.accept())
            .await
            .map_err(|_| "等待特权 helper 响应超时，请确认已允许 UAC 请求".to_string())?
            .map_err(|e| format!("接受特权 helper 通道失败: {}", e))?;
        let (stream, _) = accepted;
        let mut handshake_reader = AsyncBufReader::new(stream);
        let mut handshake = String::new();
        handshake_reader
            .read_line(&mut handshake)
            .await
            .map_err(|e| format!("读取特权 helper 握手失败: {}", e))?;
        if handshake.trim() == format!("{} {}", HANDSHAKE_PREFIX, token) {
            break handshake_reader.into_inner();
        }
    };

    let (read_half, mut write_half) = stream.into_split();
    write_async_json(
        &mut write_half,
        &HelperRequest::StartEasyTier {
            executable: executable.to_string_lossy().into_owned(),
            working_dir: working_dir.to_string_lossy().into_owned(),
            config_dir: config_dir.to_string_lossy().into_owned(),
            args,
        },
    )
    .await?;

    let mut first_reader = AsyncBufReader::new(read_half);
    let mut first_line = String::new();
    first_reader
        .read_line(&mut first_line)
        .await
        .map_err(|e| format!("读取 EasyTier 启动结果失败: {}", e))?;
    let first: HelperEvent = serde_json::from_str(first_line.trim())
        .map_err(|e| format!("解析 EasyTier 启动结果失败: {}", e))?;
    match first {
        HelperEvent::Started => Ok((
            HelperSession {
                writer: Arc::new(AsyncMutex::new(write_half)),
            },
            first_reader.into_inner(),
        )),
        HelperEvent::Response { error, .. } => {
            Err(error.unwrap_or_else(|| "特权 helper 拒绝启动 EasyTier".to_string()))
        }
        _ => Err("特权 helper 返回了无效的启动结果".to_string()),
    }
}

/// Run a single fixed privileged operation, normally used for hosts and
/// firewall updates before an EasyTier session exists.
pub fn run_one_shot(request: HelperRequest) -> Result<Option<String>, String> {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
        .map_err(|e| format!("无法创建特权 helper 通道: {}", e))?;
    listener
        .set_nonblocking(true)
        .map_err(|e| format!("无法配置特权 helper 通道: {}", e))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("无法读取特权 helper 端口: {}", e))?
        .port();
    let token = uuid::Uuid::new_v4().to_string();
    launch_elevated_helper(port, &token)?;

    let deadline = Instant::now() + Duration::from_secs(10);
    let mut stream = loop {
        if Instant::now() >= deadline {
            return Err("等待特权 helper 响应超时，请确认已允许 UAC 请求".to_string());
        }
        match listener.accept() {
            Ok((stream, _)) => break stream,
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(20));
            }
            Err(error) => return Err(format!("接受特权 helper 通道失败: {}", error)),
        }
    };
    // 将 stream 设置为阻塞模式（listener 是非阻塞的）
    stream
        .set_nonblocking(false)
        .map_err(|e| format!("配置特权 helper 通道为阻塞模式失败: {}", e))?;
    stream
        .set_read_timeout(Some(Duration::from_secs(10)))
        .map_err(|e| format!("配置特权 helper 读取超时失败: {}", e))?;
    stream
        .set_write_timeout(Some(Duration::from_secs(10)))
        .map_err(|e| format!("配置特权 helper 写入超时失败: {}", e))?;

    let mut reader = BufReader::new(
        stream
            .try_clone()
            .map_err(|e| format!("复制特权 helper 通道失败: {}", e))?,
    );
    let mut handshake = String::new();
    reader
        .read_line(&mut handshake)
        .map_err(|e| format!("读取特权 helper 握手失败: {}", e))?;
    if handshake.trim() != format!("{} {}", HANDSHAKE_PREFIX, token) {
        return Err("特权 helper 握手令牌不匹配".to_string());
    }

    let mut writer = BufWriter::new(stream);
    write_json(&mut writer, &request)?;
    loop {
        let mut line = String::new();
        if reader
            .read_line(&mut line)
            .map_err(|e| format!("读取特权 helper 响应失败: {}", e))?
            == 0
        {
            return Err("特权 helper 意外断开连接".to_string());
        }
        let event: HelperEvent = serde_json::from_str(line.trim())
            .map_err(|e| format!("解析特权 helper 响应失败: {}", e))?;
        if let HelperEvent::Response { ok, value, error } = event {
            return if ok {
                Ok(value)
            } else {
                Err(error.unwrap_or_else(|| "特权 helper 操作失败".to_string()))
            };
        }
    }
}

async fn write_async_json(
    writer: &mut OwnedWriteHalf,
    request: &HelperRequest,
) -> Result<(), String> {
    let mut line =
        serde_json::to_vec(request).map_err(|e| format!("序列化 helper 请求失败: {}", e))?;
    line.push(b'\n');
    writer
        .write_all(&line)
        .await
        .map_err(|e| format!("发送 helper 请求失败: {}", e))?;
    writer
        .flush()
        .await
        .map_err(|e| format!("刷新 helper 请求失败: {}", e))
}

fn write_json<W: Write>(writer: &mut W, request: &HelperRequest) -> Result<(), String> {
    serde_json::to_writer(&mut *writer, request)
        .map_err(|e| format!("序列化 helper 请求失败: {}", e))?;
    writer
        .write_all(b"\n")
        .map_err(|e| format!("发送 helper 请求失败: {}", e))?;
    writer
        .flush()
        .map_err(|e| format!("刷新 helper 请求失败: {}", e))
}

fn launch_elevated_helper(port: u16, token: &str) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use std::os::windows::process::CommandExt;
    use windows::core::{w, PCWSTR};
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::UI::Shell::{ShellExecuteExW, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW};
    use windows::Win32::UI::WindowsAndMessaging::SW_HIDE;

    let executable =
        std::env::current_exe().map_err(|e| format!("无法获取 MCTier 可执行文件路径: {}", e))?;
    let executable_wide: Vec<u16> = executable
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let parameters = format!("{} {} {}", HELPER_SWITCH, port, token);
    let parameters_wide: Vec<u16> = parameters
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    let mut info = SHELLEXECUTEINFOW {
        cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
        fMask: SEE_MASK_NOCLOSEPROCESS,
        lpVerb: w!("runas"),
        lpFile: PCWSTR(executable_wide.as_ptr()),
        lpParameters: PCWSTR(parameters_wide.as_ptr()),
        nShow: SW_HIDE.0,
        ..Default::default()
    };

    unsafe { ShellExecuteExW(&mut info) }
        .map_err(|e| format!("请求 UAC 启动特权 helper 失败: {}", e))?;
    if !info.hProcess.0.is_null() {
        let _ = unsafe { CloseHandle(info.hProcess) };
    }
    Ok(())
}

pub fn run_if_requested() -> bool {
    let mut args = std::env::args();
    let _ = args.next();
    if args.next().as_deref() != Some(HELPER_SWITCH) {
        return false;
    }
    let port = match args.next().and_then(|value| value.parse::<u16>().ok()) {
        Some(port) if port != 0 => port,
        _ => std::process::exit(2),
    };
    let token = match args.next() {
        Some(token) if token.len() >= 16 && token.len() <= 128 => token,
        _ => std::process::exit(2),
    };
    let result = helper_main(port, token);
    if let Err(error) = result {
        eprintln!("MCTier privileged helper failed: {}", error);
        std::process::exit(1);
    }
    std::process::exit(0)
}

fn helper_main(port: u16, token: String) -> Result<(), String> {
    if !is_elevated() {
        return Err("特权 helper 未获得管理员令牌".to_string());
    }
    let address = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port);
    let mut stream = TcpStream::connect_timeout(&address, Duration::from_secs(5))
        .map_err(|e| format!("连接特权 helper 客户端失败: {}", e))?;
    stream
        .set_nodelay(true)
        .map_err(|e| format!("配置特权 helper 客户端失败: {}", e))?;
    writeln!(stream, "{} {}", HANDSHAKE_PREFIX, token)
        .map_err(|e| format!("发送特权 helper 握手失败: {}", e))?;

    let reader_stream = stream
        .try_clone()
        .map_err(|e| format!("复制特权 helper 通道失败: {}", e))?;
    let writer = Arc::new(Mutex::new(BufWriter::new(stream)));
    let (request_tx, request_rx) = mpsc::channel::<HelperRequest>();
    thread::spawn(move || {
        let mut reader = BufReader::new(reader_stream);
        let mut line = String::new();
        while reader.read_line(&mut line).unwrap_or(0) > 0 {
            if line.len() <= MAX_PROTOCOL_LINE {
                if let Ok(request) = serde_json::from_str::<HelperRequest>(line.trim()) {
                    if request_tx.send(request).is_err() {
                        break;
                    }
                }
            }
            line.clear();
        }
    });

    let mut child: Option<Child> = None;
    let mut current_config_dir: Option<PathBuf> = None;
    loop {
        if let Some(current) = child.as_mut() {
            if let Some(status) = current
                .try_wait()
                .map_err(|e| format!("检查 EasyTier 进程状态失败: {}", e))?
            {
                send_event(
                    &writer,
                    &HelperEvent::Exited {
                        code: status.code(),
                    },
                )?;
                child = None;
                break;
            }
        }

        match request_rx.recv_timeout(Duration::from_millis(100)) {
            Ok(HelperRequest::StartEasyTier {
                executable,
                working_dir,
                config_dir,
                args,
            }) => {
                if child.is_some() {
                    send_response(&writer, false, None, Some("EasyTier 已在运行".to_string()))?;
                    continue;
                }
                match start_easytier_child(&executable, &working_dir, &config_dir, &args, &writer) {
                    Ok(started) => {
                        child = Some(started);
                        current_config_dir = Some(PathBuf::from(config_dir));
                        send_event(&writer, &HelperEvent::Started)?;
                    }
                    Err(error) => send_response(&writer, false, None, Some(error))?,
                }
            }
            Ok(HelperRequest::StopEasyTier) => {
                let exit_code = if let Some(mut current) = child.take() {
                    let _ = current.kill();
                    let status = current.wait().ok();
                    status.and_then(|value| value.code())
                } else {
                    stop_existing_easytier()?;
                    None
                };
                cleanup_mctier_devices();
                if let Some(config_dir) = current_config_dir.take() {
                    let _ = fs::remove_dir_all(config_dir);
                }
                send_response(&writer, true, None, None)?;
                send_event(&writer, &HelperEvent::Exited { code: exit_code })?;
                break;
            }
            Ok(HelperRequest::WriteHosts {
                expected_sha256,
                content,
            }) => {
                let result = write_hosts(&expected_sha256, &content);
                match result {
                    Ok(()) => send_response(&writer, true, None, None)?,
                    Err(error) => send_response(&writer, false, None, Some(error))?,
                }
                if child.is_none() {
                    break;
                }
            }
            Ok(HelperRequest::AddFirewall { easytier_path }) => {
                let result = add_firewall_rules(&easytier_path);
                match result {
                    Ok(value) => send_response(&writer, true, Some(value), None)?,
                    Err(error) => send_response(&writer, false, None, Some(error))?,
                }
                if child.is_none() {
                    break;
                }
            }
            Ok(HelperRequest::CheckFirewall) => {
                let result = check_firewall_rules();
                match result {
                    Ok(value) => send_response(&writer, true, Some(value.to_string()), None)?,
                    Err(error) => send_response(&writer, false, None, Some(error))?,
                }
                if child.is_none() {
                    break;
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                if let Some(mut current) = child.take() {
                    let _ = current.kill();
                    let _ = current.wait();
                }
                if let Some(config_dir) = current_config_dir.take() {
                    let _ = fs::remove_dir_all(config_dir);
                }
                break;
            }
        }
    }
    Ok(())
}

fn start_easytier_child(
    executable: &str,
    working_dir: &str,
    config_dir: &str,
    args: &[String],
    writer: &Arc<Mutex<BufWriter<TcpStream>>>,
) -> Result<Child, String> {
    let executable = PathBuf::from(executable);
    let working_dir = PathBuf::from(working_dir);
    let config_dir = PathBuf::from(config_dir);
    validate_easytier_layout(&executable, &working_dir, &config_dir)?;
    validate_start_args(args, &config_dir)?;

    stop_existing_easytier()?;
    cleanup_mctier_devices();

    let mut command = Command::new(&executable);
    command
        .args(args)
        .current_dir(&working_dir)
        .env(
            "PATH",
            format!(
                "{};{}",
                working_dir.display(),
                windows_paths::system_directory().display()
            ),
        )
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .creation_flags(CREATE_NO_WINDOW);
    let mut child = command
        .spawn()
        .map_err(|e| format!("启动 EasyTier 失败: {}", e))?;
    if let Some(stdout) = child.stdout.take() {
        spawn_output_reader(stdout, writer.clone(), false);
    }
    if let Some(stderr) = child.stderr.take() {
        spawn_output_reader(stderr, writer.clone(), true);
    }
    Ok(child)
}

fn validate_easytier_layout(
    executable: &Path,
    working_dir: &Path,
    config_dir: &Path,
) -> Result<(), String> {
    // 🔧 开发模式：跳过路径验证
    #[cfg(debug_assertions)]
    {
        log::warn!("⚠️ 开发模式：跳过 EasyTier 路径安全检查");
        return Ok(());
    }
    let executable_dir = std::env::current_exe()
        .map_err(|e| format!("无法获取 MCTier 安装目录: {}", e))?
        .parent()
        .ok_or_else(|| "MCTier 可执行文件缺少安装目录".to_string())?
        .to_path_buf();
    let allowed_runtimes = [
        executable_dir.join("runtime"),
        executable_dir.join("resources").join("runtime"),
    ];
    // 开发模式：允许 target/debug/runtime 和 target/release/runtime
    #[cfg(debug_assertions)]
    let allowed_runtimes = {
        let mut runtimes = allowed_runtimes.to_vec();
        // 添加开发模式的 runtime 目录
        if let Some(workspace_dir) = executable_dir.parent() {
            runtimes.push(workspace_dir.join("runtime"));
        }
        runtimes
    };
    #[cfg(not(debug_assertions))]
    let allowed_runtimes = allowed_runtimes;
    if executable != &working_dir.join("easytier-core.exe")
        || !allowed_runtimes.iter().any(|path| path == working_dir)
    {
        return Err("EasyTier 运行路径不在受控 runtime 目录中".to_string());
    }
    if !config_dir.starts_with(working_dir)
        || config_dir.parent() != Some(working_dir)
        || !config_dir
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.starts_with("config_mctier-"))
    {
        return Err("EasyTier 配置目录不在受控 runtime 子目录中".to_string());
    }
    if !working_dir.exists() {
        fs::create_dir_all(working_dir)
            .map_err(|e| format!("创建 EasyTier runtime 目录失败: {}", e))?;
    }
    ensure_no_reparse_components(working_dir)?;
    if let Some(parent) = config_dir.parent() {
        ensure_no_reparse_components(parent)?;
    }
    fs::create_dir_all(config_dir).map_err(|e| format!("创建 EasyTier 配置目录失败: {}", e))?;
    ensure_no_reparse_components(config_dir)?;

    ResourceManager::ensure_embedded_file_at(executable, "easytier-core.exe")
        .map_err(|e| e.to_string())?;
    ResourceManager::ensure_embedded_file_at(
        &working_dir.join("easytier-cli.exe"),
        "easytier-cli.exe",
    )
    .map_err(|e| e.to_string())?;
    ResourceManager::ensure_embedded_file_at(&working_dir.join("wintun.dll"), "wintun.dll")
        .map_err(|e| e.to_string())?;
    ResourceManager::ensure_embedded_file_at(
        &working_dir.join("WinDivert64.sys"),
        "WinDivert64.sys",
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn validate_start_args(args: &[String], config_dir: &Path) -> Result<(), String> {
    if args.is_empty() || args.len() > 256 {
        return Err("EasyTier 参数数量异常".to_string());
    }
    if args
        .iter()
        .any(|arg| arg.is_empty() || arg.len() > 64 * 1024 || arg.contains('\0'))
    {
        return Err("EasyTier 参数包含非法内容".to_string());
    }
    let mut config_arg = None;
    for (index, arg) in args.iter().enumerate() {
        if arg == "--config-dir" {
            config_arg = args.get(index + 1);
            break;
        }
    }
    if config_arg.map(PathBuf::from).as_deref() != Some(config_dir) {
        return Err("EasyTier 配置目录参数不匹配".to_string());
    }
    Ok(())
}

fn spawn_output_reader<R: Read + Send + 'static>(
    reader: R,
    writer: Arc<Mutex<BufWriter<TcpStream>>>,
    stderr: bool,
) {
    thread::spawn(move || {
        let mut lines = BufReader::new(reader).lines();
        while let Some(Ok(line)) = lines.next() {
            let event = if stderr {
                HelperEvent::Stderr { line }
            } else {
                HelperEvent::Stdout { line }
            };
            let _ = send_event(&writer, &event);
        }
    });
}

fn send_event(
    writer: &Arc<Mutex<BufWriter<TcpStream>>>,
    event: &HelperEvent,
) -> Result<(), String> {
    let mut guard = writer
        .lock()
        .map_err(|_| "特权 helper 输出锁失败".to_string())?;
    serde_json::to_writer(&mut *guard, event)
        .map_err(|e| format!("序列化 helper 事件失败: {}", e))?;
    guard
        .write_all(b"\n")
        .map_err(|e| format!("发送 helper 事件失败: {}", e))?;
    guard
        .flush()
        .map_err(|e| format!("刷新 helper 事件失败: {}", e))
}

fn send_response(
    writer: &Arc<Mutex<BufWriter<TcpStream>>>,
    ok: bool,
    value: Option<String>,
    error: Option<String>,
) -> Result<(), String> {
    send_event(writer, &HelperEvent::Response { ok, value, error })
}

fn ensure_no_reparse_components(path: &Path) -> Result<(), String> {
    let mut current = path.to_path_buf();
    loop {
        let metadata = fs::symlink_metadata(&current)
            .map_err(|e| format!("检查受控路径失败 {}: {}", current.display(), e))?;
        if is_link_or_reparse(&metadata) {
            return Err(format!(
                "拒绝经过 symlink/reparse point: {}",
                current.display()
            ));
        }
        let Some(parent) = current.parent() else {
            break;
        };
        if parent == current {
            break;
        }
        current = parent.to_path_buf();
    }
    Ok(())
}

fn ensure_regular_file(path: &Path) -> Result<(), String> {
    ensure_no_reparse_components(path)?;
    let metadata = fs::symlink_metadata(path)
        .map_err(|e| format!("检查文件失败 {}: {}", path.display(), e))?;
    if is_link_or_reparse(&metadata) || !metadata.is_file() {
        return Err(format!("路径不是普通文件: {}", path.display()));
    }
    Ok(())
}

fn is_link_or_reparse(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    metadata.file_type().is_symlink() || metadata.file_attributes() & 0x400 != 0
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|byte| format!("{:02x}", byte)).collect()
}

fn write_hosts(expected_sha256: &str, content: &str) -> Result<(), String> {
    if content.len() > MAX_HOSTS_BYTES {
        return Err("hosts 文件内容超过限制".to_string());
    }
    let path = windows_paths::hosts_path();
    ensure_regular_file(&path)?;
    let old = fs::read_to_string(&path).map_err(|e| format!("读取 hosts 文件失败: {}", e))?;
    if sha256_hex(old.as_bytes()) != expected_sha256 {
        return Err("hosts 文件在检查后发生变化，请重试".to_string());
    }
    validate_hosts_update(&old, content)?;

    let mut options = OpenOptions::new();
    options.write(true).truncate(true);
    use std::os::windows::fs::OpenOptionsExt;
    options.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    let mut file = options
        .open(&path)
        .map_err(|e| format!("打开 hosts 文件失败: {}", e))?;
    file.write_all(content.as_bytes())
        .map_err(|e| format!("写入 hosts 文件失败: {}", e))?;
    file.sync_all()
        .map_err(|e| format!("同步 hosts 文件失败: {}", e))?;
    ensure_regular_file(&path)?;

    let flush = Command::new(windows_paths::system_command("ipconfig.exe"))
        .arg("/flushdns")
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| format!("刷新 DNS 缓存失败: {}", e))?;
    if !flush.status.success() {
        return Err("刷新 DNS 缓存失败".to_string());
    }
    Ok(())
}

fn validate_hosts_update(old: &str, new: &str) -> Result<(), String> {
    let old_outside = hosts_outside_mctier(old)?;
    let new_outside = hosts_outside_mctier(new)?;
    if old_outside != new_outside {
        return Err("特权 helper 只允许修改 MCTier hosts 区域".to_string());
    }
    validate_mctier_entries(new)
}

fn hosts_outside_mctier(content: &str) -> Result<String, String> {
    let mut outside = Vec::new();
    let mut in_section = false;
    for line in content.lines() {
        if line.starts_with("# MCTier Magic DNS") {
            if in_section {
                return Err("hosts MCTier 区域标记嵌套".to_string());
            }
            in_section = true;
        } else if line == "# MCTier Magic DNS End" {
            if !in_section {
                return Err("hosts MCTier 结束标记缺失起点".to_string());
            }
            in_section = false;
        } else if !in_section {
            outside.push(line);
        }
    }
    if in_section {
        return Err("hosts MCTier 区域缺少结束标记".to_string());
    }
    Ok(outside.join("\n"))
}

fn validate_mctier_entries(content: &str) -> Result<(), String> {
    let mut in_section = false;
    for line in content.lines() {
        if line.starts_with("# MCTier Magic DNS") {
            if in_section {
                return Err("hosts MCTier 区域标记嵌套".to_string());
            }
            in_section = true;
            continue;
        }
        if line == "# MCTier Magic DNS End" {
            if !in_section {
                return Err("hosts MCTier 结束标记缺失起点".to_string());
            }
            in_section = false;
            continue;
        }
        if !in_section || line.trim().is_empty() {
            continue;
        }
        if line.chars().any(|ch| ch.is_control() || ch == '#') {
            return Err("hosts MCTier 条目包含非法字符".to_string());
        }
        let mut fields = line.split_whitespace();
        let ip = fields
            .next()
            .ok_or_else(|| "hosts MCTier 条目缺少 IP".to_string())?
            .parse::<Ipv4Addr>()
            .map_err(|_| "hosts MCTier 条目 IP 无效".to_string())?;
        let octets = ip.octets();
        if octets[..3] != [10, 126, 126] || octets[3] == 0 || octets[3] == 255 {
            return Err("hosts MCTier 条目 IP 不属于 EasyTier 虚拟网段".to_string());
        }
        let mut host_count = 0;
        for host in fields {
            host_count += 1;
            if !is_mctier_domain(host) {
                return Err("hosts MCTier 条目只能使用 *.mct.net".to_string());
            }
        }
        if host_count == 0 {
            return Err("hosts MCTier 条目缺少域名".to_string());
        }
    }
    if in_section {
        return Err("hosts MCTier 区域缺少结束标记".to_string());
    }
    Ok(())
}

fn is_mctier_domain(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    let Some(prefix) = lower.strip_suffix(".mct.net") else {
        return false;
    };
    !prefix.is_empty()
        && prefix.split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label
                    .chars()
                    .all(|ch| ch.is_ascii_alphanumeric() || ch == '-')
        })
}

fn validate_easy_path(path: &Path) -> Result<(), String> {
    let executable_dir = std::env::current_exe()
        .map_err(|e| format!("无法获取 MCTier 安装目录: {}", e))?
        .parent()
        .ok_or_else(|| "MCTier 可执行文件缺少安装目录".to_string())?
        .to_path_buf();
    let allowed_runtimes = [
        executable_dir.join("runtime"),
        executable_dir.join("resources").join("runtime"),
    ];
    let runtime = allowed_runtimes
        .iter()
        .find(|candidate| path == candidate.join("easytier-core.exe"))
        .ok_or_else(|| "防火墙规则中的 EasyTier 路径不受控".to_string())?;
    if !runtime.exists() {
        fs::create_dir_all(runtime)
            .map_err(|e| format!("创建 EasyTier runtime 目录失败: {}", e))?;
    }
    if path != &runtime.join("easytier-core.exe") {
        return Err("防火墙规则中的 EasyTier 路径不受控".to_string());
    }
    ResourceManager::ensure_embedded_file_at(path, "easytier-core.exe")
        .map(|_| ())
        .map_err(|e| e.to_string())
}

fn add_firewall_rules(easytier_path: &str) -> Result<String, String> {
    let app = std::env::current_exe().map_err(|e| format!("无法获取 MCTier 路径: {}", e))?;
    ensure_regular_file(&app)?;
    let easytier = PathBuf::from(easytier_path);
    validate_easy_path(&easytier)?;
    let netsh = windows_paths::system_command("netsh.exe");
    let programs = [("MCTier", app), ("MCTier-EasyTier", easytier)];
    let mut added = 0;
    let mut last_error = String::new();
    for (base_name, program) in programs {
        for (suffix, direction) in [("-in", "in"), ("-out", "out")] {
            let rule_name = format!("{}{}", base_name, suffix);
            let _ = Command::new(&netsh)
                .args(["advfirewall", "firewall", "delete", "rule"])
                .arg(format!("name={}", rule_name))
                .creation_flags(CREATE_NO_WINDOW)
                .output();
            let output = Command::new(&netsh)
                .args(["advfirewall", "firewall", "add", "rule"])
                .arg(format!("name={}", rule_name))
                .arg(format!("dir={}", direction))
                .arg("action=allow")
                .arg(format!("program={}", program.display()))
                .args(["enable=yes", "profile=any"])
                .creation_flags(CREATE_NO_WINDOW)
                .output()
                .map_err(|e| format!("执行防火墙配置失败: {}", e))?;
            if output.status.success() {
                added += 1;
            } else {
                last_error = String::from_utf8_lossy(&output.stderr).trim().to_string();
            }
        }
    }
    if added == 4 {
        Ok(format!("已添加 {} 条防火墙放行规则", added))
    } else {
        Err(if last_error.is_empty() {
            "防火墙规则配置失败".to_string()
        } else {
            last_error
        })
    }
}

fn check_firewall_rules() -> Result<bool, String> {
    let netsh = windows_paths::system_command("netsh.exe");
    for rule in [
        "MCTier-in",
        "MCTier-out",
        "MCTier-EasyTier-in",
        "MCTier-EasyTier-out",
    ] {
        let output = Command::new(&netsh)
            .args(["advfirewall", "firewall", "show", "rule"])
            .arg(format!("name={}", rule))
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|e| format!("检查防火墙规则失败: {}", e))?;
        if !output.status.success() {
            return Ok(false);
        }
    }
    Ok(true)
}

fn stop_existing_easytier() -> Result<(), String> {
    let output = Command::new(windows_paths::system_command("taskkill.exe"))
        .args(["/F", "/IM", "easytier-core.exe"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| format!("停止 EasyTier 失败: {}", e))?;
    // taskkill returns non-zero when no matching process exists, which is the
    // expected result during a normal first start.
    if output.status.success() || output.status.code() == Some(128) {
        Ok(())
    } else {
        Err("停止残留 EasyTier 进程失败".to_string())
    }
}

fn cleanup_mctier_devices() {
    let Ok(output) = Command::new(windows_paths::system_command("pnputil.exe"))
        .args(["/enum-devices", "/class", "Net"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
    else {
        return;
    };
    let text = String::from_utf8_lossy(&output.stdout);
    let mut current_id = String::new();
    let mut target = false;
    for line in text.lines() {
        if line.contains("Instance ID:") || line.contains("实例 ID:") {
            current_id = line
                .split_once(':')
                .map(|(_, value)| value.trim().to_string())
                .unwrap_or_default();
            target = false;
        }
        if line.contains("MCTier_") && !current_id.is_empty() {
            target = true;
        }
        if target && !current_id.is_empty() {
            let _ = Command::new(windows_paths::system_command("pnputil.exe"))
                .args(["/remove-device", &current_id])
                .creation_flags(CREATE_NO_WINDOW)
                .output();
            current_id.clear();
            target = false;
        }
    }
}

fn is_elevated() -> bool {
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::Security::{
        GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY,
    };
    use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    unsafe {
        let mut token = HANDLE::default();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token).is_err() {
            return false;
        }
        let mut elevation = TOKEN_ELEVATION { TokenIsElevated: 0 };
        let mut length = 0u32;
        GetTokenInformation(
            token,
            TokenElevation,
            Some(&mut elevation as *mut _ as *mut _),
            std::mem::size_of::<TOKEN_ELEVATION>() as u32,
            &mut length,
        )
        .is_ok()
            && elevation.TokenIsElevated != 0
    }
}


