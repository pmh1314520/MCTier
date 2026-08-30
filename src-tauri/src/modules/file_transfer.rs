/**
 * HTTP 文件共享服务模块
 * 基于 WireGuard 虚拟网络的高性能文件传输
 * 使用标准 HTTP 协议，支持断点续传和多线程下载
 */
use std::collections::{HashMap, HashSet, VecDeque};
use std::fs::OpenOptions;
use std::net::{IpAddr, SocketAddr};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use super::http_cors::lan_cors_layer;
use axum::{
    body::Body,
    extract::{ConnectInfo, DefaultBodyLimit, Path as AxumPath, Query, State},
    http::{header, HeaderMap, StatusCode},
    response::Response,
    routing::{get, post},
    Json, Router,
};
use dashmap::DashMap;
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use tokio::fs::File;
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tokio::sync::{Mutex, OwnedSemaphorePermit, Semaphore};
use uuid::Uuid;
use zip::write::SimpleFileOptions;

const FILE_SERVER_PORT: u16 = 14539; // 固定端口，方便其他节点访问
const CHUNK_SIZE: usize = 1024 * 1024; // 1MB chunks
const MAX_JSON_BODY_BYTES: usize = 64 * 1024;
const MAX_BATCH_FILES: usize = 256;
const MAX_BATCH_SOURCE_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_BATCH_ZIP_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const ZIP_OUTPUT_LIMIT_ERROR: &str = "ZIP output exceeds configured size limit";
const SHARE_INVALID_ERROR: &str = "share is no longer available";
const MAX_PASSWORD_FAILURES: usize = 10;
const MAX_PASSWORD_FAILURE_KEYS: usize = 4096;
const PASSWORD_FAILURE_WINDOW: Duration = Duration::from_secs(30);
pub const LOBBY_TOKEN_HEADER: &str = "x-mctier-lobby-token";

/// 共享文件夹信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SharedFolder {
    pub id: String,
    pub name: String,
    pub path: String,
    pub password: Option<String>,
    pub expire_time: Option<u64>,           // Unix timestamp
    pub compress_before_send: Option<bool>, // 是否启用"先压后发"策略
    pub owner_id: String,
    pub created_at: u64,
    #[serde(skip)]
    expiry_token: Uuid,
}

/// 可安全暴露给远程节点的共享摘要。
///
/// 本地文件系统路径和共享密码只保留在服务端，绝不能通过 HTTP API 序列化。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SharedFolderSummary {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub has_password: bool,
    pub expire_time: Option<u64>,
    pub compress_before_send: Option<bool>,
    pub owner_id: String,
    pub created_at: u64,
}

impl From<&SharedFolder> for SharedFolderSummary {
    fn from(share: &SharedFolder) -> Self {
        Self {
            id: share.id.clone(),
            name: share.name.clone(),
            has_password: share
                .password
                .as_deref()
                .is_some_and(|password| !password.trim().is_empty()),
            expire_time: share.expire_time,
            compress_before_send: share.compress_before_send,
            owner_id: share.owner_id.clone(),
            created_at: share.created_at,
        }
    }
}

/// 文件信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileInfo {
    pub name: String,
    pub path: String, // 相对于共享文件夹的路径
    pub size: u64,
    pub is_dir: bool,
    pub modified: u64,
}

/// 共享列表响应
#[derive(Debug, Serialize, Deserialize)]
pub struct ShareListResponse {
    pub shares: Vec<SharedFolderSummary>,
}

/// 文件列表响应
#[derive(Debug, Serialize, Deserialize)]
pub struct FileListResponse {
    pub files: Vec<FileInfo>,
    pub current_path: String,
}

/// 验证密码请求
#[derive(Debug, Deserialize)]
pub struct VerifyPasswordRequest {
    pub password: String,
}

/// 验证密码响应
#[derive(Debug, Serialize)]
pub struct VerifyPasswordResponse {
    pub success: bool,
    pub message: String,
}

/// 批量打包下载请求
#[derive(Debug, Deserialize)]
pub struct BatchDownloadRequest {
    pub file_paths: Vec<String>,
}

/// 文件传输服务状态
pub struct FileTransferService {
    /// 本地共享的文件夹
    shared_folders: Arc<DashMap<String, SharedFolder>>,
    /// 虚拟IP地址
    virtual_ip: Arc<RwLock<Option<String>>>,
    /// 服务器句柄
    server_handle: Arc<RwLock<Option<tokio::task::JoinHandle<()>>>>,
    /// 过期定时器句柄
    expiry_timers: Arc<DashMap<String, ExpiryTimer>>,
    /// 信令服务器签发的当前大厅凭据；成员变化时会轮换。
    lobby_token: Arc<RwLock<Option<String>>>,
}

struct ExpiryTimer {
    deadline: u64,
    token: Uuid,
    handle: tokio::task::JoinHandle<()>,
}

impl FileTransferService {
    pub fn new() -> Self {
        Self {
            shared_folders: Arc::new(DashMap::new()),
            virtual_ip: Arc::new(RwLock::new(None)),
            server_handle: Arc::new(RwLock::new(None)),
            expiry_timers: Arc::new(DashMap::new()),
            lobby_token: Arc::new(RwLock::new(None)),
        }
    }

    /// 设置虚拟IP地址
    pub fn set_virtual_ip(&self, ip: String) {
        log::info!("📡 设置虚拟IP: {}", ip);
        *self.virtual_ip.write() = Some(ip);
    }

    /// 获取虚拟IP地址
    pub fn get_virtual_ip(&self) -> Option<String> {
        self.virtual_ip.read().clone()
    }

    pub fn set_lobby_token(&self, token: String) -> Result<(), String> {
        if token.len() != 64 || !token.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err("文件服务大厅凭据格式无效".to_string());
        }
        *self.lobby_token.write() = Some(token);
        Ok(())
    }

    pub fn clear_lobby_token(&self) {
        *self.lobby_token.write() = None;
    }

    /// 启动HTTP文件服务器
    pub async fn start_server(&self) -> Result<(), Box<dyn std::error::Error>> {
        let virtual_ip = match self.get_virtual_ip() {
            Some(ip) => ip,
            None => {
                log::error!("❌ 虚拟IP未设置，无法启动HTTP文件服务器");
                return Err("虚拟IP未设置".into());
            }
        };

        let addr = overlay_socket_addr(&virtual_ip, FILE_SERVER_PORT)?;
        log::info!("🔍 检查虚拟IP是否就绪: {}", virtual_ip);

        // 等待虚拟IP就绪（最多等待10秒）
        let mut attempts = 0;
        let max_attempts = 20; // 20次 * 500ms = 10秒
        loop {
            // 尝试绑定到虚拟IP的一个临时端口，测试IP是否可用
            match tokio::net::TcpListener::bind(SocketAddr::new(addr.ip(), 0)).await {
                Ok(test_listener) => {
                    drop(test_listener);
                    log::info!("✅ 虚拟IP已就绪");
                    break;
                }
                Err(e) => {
                    attempts += 1;
                    if attempts >= max_attempts {
                        log::error!("❌ 虚拟IP未就绪，超时: {}", e);
                        return Err(format!("虚拟IP未就绪: {}", e).into());
                    }
                    log::warn!(
                        "⏳ 虚拟IP尚未就绪，等待中... ({}/{})",
                        attempts,
                        max_attempts
                    );
                    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
                }
            }
        }

        log::info!(
            "📍 HTTP服务器将仅监听虚拟网卡: {}:{}",
            virtual_ip,
            FILE_SERVER_PORT
        );
        log::info!("📍 虚拟IP: {}", virtual_ip);

        let shared_folders = self.shared_folders.clone();

        // 创建路由
        let app = Router::new()
            .route("/api/shares", get(list_shares))
            .route("/api/shares/:share_id/files", get(list_files))
            .route("/api/shares/:share_id/verify", post(verify_password))
            .route(
                "/api/shares/:share_id/download/*file_path",
                get(download_file),
            )
            .route("/api/shares/:share_id/batch-download", post(batch_download))
            .layer(DefaultBodyLimit::max(MAX_JSON_BODY_BYTES))
            .layer(lan_cors_layer())
            .with_state(AppState {
                shared_folders: shared_folders.clone(),
                batch_slots: Arc::new(Semaphore::new(1)),
                password_failures: Arc::new(Mutex::new(HashMap::new())),
                lobby_token: self.lobby_token.clone(),
            });

        log::info!("🚀 正在启动HTTP文件服务器...");
        log::info!("📍 监听地址: http://{}", addr);
        log::debug!("📂 共享文件夹数量: {}", shared_folders.len());

        // 尝试绑定端口
        let listener = match tokio::net::TcpListener::bind(addr).await {
            Ok(l) => {
                log::info!("✅ 成功绑定端口 {}", FILE_SERVER_PORT);
                l
            }
            Err(e) => {
                log::error!("❌ 绑定端口失败: {} - 错误: {}", FILE_SERVER_PORT, e);
                log::error!("💡 可能原因: 1) 端口被占用 2) 虚拟网卡未就绪 3) 防火墙阻止");
                return Err(format!("绑定端口失败: {}", e).into());
            }
        };

        // 启动服务器
        let server_task = tokio::spawn(async move {
            log::info!("🌐 HTTP文件服务器开始监听请求...");
            if let Err(e) = axum::serve(
                listener,
                app.into_make_service_with_connect_info::<SocketAddr>(),
            )
            .await
            {
                log::error!("❌ HTTP服务器运行错误: {}", e);
            } else {
                log::info!("🛑 HTTP服务器已正常停止");
            }
        });

        *self.server_handle.write() = Some(server_task);

        log::info!("✅ HTTP文件服务器启动成功！");
        log::info!(
            "📡 监听地址: {}:{}（仅虚拟网卡）",
            virtual_ip,
            FILE_SERVER_PORT
        );
        log::info!("📡 虚拟IP: {}", virtual_ip);
        log::debug!(
            "📡 其他玩家可以通过 http://{}:{} 访问您的共享",
            virtual_ip,
            FILE_SERVER_PORT
        );

        // 等待一小段时间，确保服务器完全启动
        tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
        log::info!("🎉 HTTP文件服务器已完全就绪");

        Ok(())
    }

    /// 停止HTTP文件服务器
    pub async fn stop_server(&self) {
        if let Some(handle) = self.server_handle.write().take() {
            handle.abort();
            log::info!("🛑 HTTP文件服务器已停止");
        }
    }

    /// 检查HTTP文件服务器是否正在运行
    pub fn is_running(&self) -> bool {
        self.server_handle.read().is_some()
    }

    /// 添加共享文件夹
    pub fn add_share(&self, mut share: SharedFolder) -> Result<(), String> {
        let share_path = Path::new(&share.path);
        if !share_path.is_absolute() {
            return Err("共享路径必须是绝对路径".to_string());
        }
        let metadata =
            std::fs::symlink_metadata(share_path).map_err(|_| "文件夹不存在".to_string())?;
        if is_link_or_reparse_point(&metadata) || !metadata.is_dir() {
            return Err("共享路径必须是实际目录，不能是符号链接或reparse point".to_string());
        }

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        if is_expired(share.expire_time, now) {
            return Err("共享已过期".to_string());
        }

        let share_id = share.id.clone();
        let expiry_token = Uuid::new_v4();
        share.expiry_token = expiry_token;
        if let Some((_, old_timer)) = self.expiry_timers.remove(&share_id) {
            old_timer.handle.abort();
        }
        self.shared_folders.insert(share_id.clone(), share.clone());
        log::debug!("📁 添加共享: {} ({})", share.name, share_id);

        // 如果设置了过期时间,创建定时器
        if let Some(expire_time) = share.expire_time {
            if expire_time > now {
                let delay_secs = expire_time - now;
                log::info!(
                    "⏰ 为共享 {} 设置过期定时器: {}秒后过期",
                    share_id,
                    delay_secs
                );

                let shared_folders = self.shared_folders.clone();
                let expiry_timers = self.expiry_timers.clone();
                let share_id_clone = share_id.clone();
                let deadline = expire_time;
                let token = expiry_token;

                let timer_handle = tokio::spawn(async move {
                    tokio::time::sleep(tokio::time::Duration::from_secs(delay_secs)).await;

                    // Do not let a stale timer remove a replacement share, even
                    // when it reuses the same ID and deadline.
                    if shared_folders
                        .remove_if(&share_id_clone, |_, current| {
                            current.expiry_token == token && current.expire_time == Some(deadline)
                        })
                        .is_some()
                    {
                        log::info!("⏰ 共享已过期并自动删除: {}", share_id_clone);
                    }

                    expiry_timers.remove_if(&share_id_clone, |_, timer| {
                        timer.deadline == deadline && timer.token == token
                    });
                });

                self.expiry_timers.insert(
                    share_id.clone(),
                    ExpiryTimer {
                        deadline: expire_time,
                        token: expiry_token,
                        handle: timer_handle,
                    },
                );
            }
        }

        Ok(())
    }

    /// 删除共享文件夹
    pub fn remove_share(&self, share_id: &str) -> Result<(), String> {
        let (_, share) = self
            .shared_folders
            .remove(share_id)
            .ok_or_else(|| "共享不存在".to_string())?;

        // 取消过期定时器
        if let Some((_, timer)) = self
            .expiry_timers
            .remove_if(share_id, |_, timer| timer.token == share.expiry_token)
        {
            timer.handle.abort();
            log::debug!("⏰ 取消共享 {} 的过期定时器", share_id);
        }

        log::debug!("🗑️ 删除共享: {}", share_id);
        Ok(())
    }

    /// 获取所有共享
    pub fn get_shares(&self) -> Vec<SharedFolder> {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        self.shared_folders
            .iter()
            .filter(|entry| !is_expired(entry.value().expire_time, now))
            .map(|entry| entry.value().clone())
            .collect()
    }

    /// 清理过期共享
    pub fn cleanup_expired_shares(&self) {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        let expired: Vec<(String, Uuid)> = self
            .shared_folders
            .iter()
            .filter(|entry| {
                if let Some(expire_time) = entry.value().expire_time {
                    expire_time <= now
                } else {
                    false
                }
            })
            .map(|entry| (entry.key().clone(), entry.value().expiry_token))
            .collect();

        for (share_id, token) in expired {
            if self
                .shared_folders
                .remove_if(&share_id, |_, share| {
                    share.expiry_token == token && is_expired(share.expire_time, now)
                })
                .is_none()
            {
                continue;
            }
            if let Some((_, timer)) = self
                .expiry_timers
                .remove_if(&share_id, |_, timer| timer.token == token)
            {
                timer.handle.abort();
            }
            log::debug!("⏰ 清理过期共享: {}", share_id);
        }
    }
}

/// Axum 应用状态
#[derive(Clone)]
struct AppState {
    shared_folders: Arc<DashMap<String, SharedFolder>>,
    batch_slots: Arc<Semaphore>,
    password_failures: Arc<Mutex<HashMap<(String, IpAddr), VecDeque<Instant>>>>,
    lobby_token: Arc<RwLock<Option<String>>>,
}

fn authenticate_lobby(state: &AppState, headers: &HeaderMap) -> Result<(), StatusCode> {
    let expected = state
        .lobby_token
        .read()
        .clone()
        .ok_or(StatusCode::SERVICE_UNAVAILABLE)?;
    let mut values = headers.get_all(LOBBY_TOKEN_HEADER).iter();
    let supplied = values
        .next()
        .and_then(|value| value.to_str().ok())
        .ok_or(StatusCode::UNAUTHORIZED)?;
    if values.next().is_some() || !ct_eq(supplied.as_bytes(), expected.as_bytes()) {
        return Err(StatusCode::UNAUTHORIZED);
    }
    Ok(())
}

fn overlay_socket_addr(ip: &str, port: u16) -> Result<SocketAddr, Box<dyn std::error::Error>> {
    let parsed: std::net::Ipv4Addr = ip
        .trim()
        .parse()
        .map_err(|error| format!("无效的虚拟IP: {} ({})", ip, error))?;
    let octets = parsed.octets();
    if octets[..3] != [10, 126, 126] || octets[3] == 0 || octets[3] == 255 {
        return Err(format!("文件服务器只能绑定具体的EasyTier虚拟IP: {}", ip).into());
    }
    Ok(SocketAddr::new(IpAddr::V4(parsed), port))
}

async fn is_share_access_allowed(
    state: &AppState,
    share_id: &str,
    share: &SharedFolder,
    peer: SocketAddr,
    provided_password: &str,
) -> bool {
    let Some(expected_password) = share
        .password
        .as_deref()
        .filter(|password| !password.trim().is_empty())
    else {
        return true;
    };

    let key = (share_id.to_string(), peer.ip());
    let now = Instant::now();
    let mut failures = state.password_failures.lock().await;
    failures.retain(|_, attempts| {
        while attempts
            .front()
            .is_some_and(|attempt| now.duration_since(*attempt) > PASSWORD_FAILURE_WINDOW)
        {
            attempts.pop_front();
        }
        !attempts.is_empty()
    });
    if !failures.contains_key(&key) && failures.len() >= MAX_PASSWORD_FAILURE_KEYS {
        return false;
    }
    {
        let attempts = failures.entry(key.clone()).or_default();
        if attempts.len() >= MAX_PASSWORD_FAILURES {
            return false;
        }
    }

    let valid = ct_eq(provided_password.as_bytes(), expected_password.as_bytes());
    if valid {
        failures.remove(&key);
    } else {
        failures.entry(key).or_default().push_back(now);
    }
    valid
}

fn share_password_header(headers: &HeaderMap) -> &str {
    headers
        .get("x-share-password")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
}

fn is_expired(expire_time: Option<u64>, now: u64) -> bool {
    expire_time.is_some_and(|deadline| deadline <= now)
}

/// 常量时间字符串比较，避免密码校验的时间侧信道
fn ct_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff: u8 = 0;
    for i in 0..a.len() {
        diff |= a[i] ^ b[i];
    }
    diff == 0
}

/// 安全地把共享内的相对路径拼接到共享根目录，防止路径穿越（`..` 逃逸）。
///
/// 仅允许「正常」路径段，拒绝绝对路径、根、盘符前缀以及任何 `..` 父目录段，
/// 从而保证最终路径一定位于共享目录内部。返回 `None` 表示路径非法。
fn is_link_or_reparse_point(metadata: &std::fs::Metadata) -> bool {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_type().is_symlink() || metadata.file_attributes() & 0x400 != 0
    }

    #[cfg(not(target_os = "windows"))]
    metadata.file_type().is_symlink()
}

fn is_windows_reserved_name(name: &str) -> bool {
    let trimmed = name.trim_end_matches([' ', '.']);
    let stem = trimmed.split('.').next().unwrap_or("").to_ascii_uppercase();
    matches!(
        stem.as_str(),
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
    )
}

/// Return a portable ZIP member name and a case-insensitive collision key.
/// ZIPs can be created on Unix and extracted on Windows, so apply the
/// stricter Windows filename rules on every platform.
fn safe_zip_entry_name(name: &str) -> Option<(String, String)> {
    if name.is_empty() || name.contains('\0') {
        return None;
    }

    let normalized = name.replace('\\', "/");
    if normalized.starts_with('/') {
        return None;
    }

    let mut components = Vec::new();
    for component in normalized.split('/') {
        if component.is_empty()
            || component == "."
            || component == ".."
            || component.chars().any(char::is_control)
            || component.contains(':')
            || component
                .chars()
                .any(|ch| matches!(ch, '<' | '>' | '"' | '|' | '?' | '*'))
            || component != component.trim_end_matches([' ', '.'])
            || is_windows_reserved_name(component)
        {
            return None;
        }
        components.push(component.to_string());
    }

    if components.is_empty() {
        return None;
    }

    let entry_name = components.join("/");
    let key = components
        .iter()
        .map(|component| component.to_ascii_lowercase())
        .collect::<Vec<_>>()
        .join("/");
    Some((entry_name, key))
}

fn safe_join(base: &Path, rel: &str) -> Option<PathBuf> {
    if rel.contains('\0') {
        return None;
    }
    let normalized = rel.replace('\\', "/");
    if normalized.starts_with('/') {
        return None;
    }

    let mut result = base.to_path_buf();
    for component in normalized.split('/') {
        if component.is_empty() || component == "." {
            continue;
        }
        if component == ".." || component.chars().any(char::is_control) {
            return None;
        }
        #[cfg(windows)]
        if component.contains(':')
            || component != component.trim_end_matches([' ', '.'])
            || is_windows_reserved_name(component)
        {
            return None;
        }
        result.push(component);
    }
    Some(result)
}

fn safe_existing_join(base: &Path, rel: &str) -> Option<PathBuf> {
    let candidate = safe_join(base, rel)?;
    let base_metadata = std::fs::symlink_metadata(base).ok()?;
    if is_link_or_reparse_point(&base_metadata) {
        return None;
    }
    let canonical_base = std::fs::canonicalize(base).ok()?;
    let relative = candidate.strip_prefix(base).ok()?;
    let mut current = base.to_path_buf();
    for component in relative.components() {
        let std::path::Component::Normal(name) = component else {
            return None;
        };
        current.push(name);
        let metadata = std::fs::symlink_metadata(&current).ok()?;
        if is_link_or_reparse_point(&metadata) {
            return None;
        }
        if !std::fs::canonicalize(&current)
            .ok()?
            .starts_with(&canonical_base)
        {
            return None;
        }
    }
    Some(candidate)
}

fn open_readonly_no_follow(path: &Path) -> std::io::Result<std::fs::File> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        // Open the reparse point itself so a last-moment leaf swap cannot be
        // followed outside the shared directory.
        options.custom_flags(0x0020_0000);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    let file = options.open(path)?;
    if is_link_or_reparse_point(&file.metadata()?) {
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "refusing to follow a link or reparse point",
        ));
    }
    Ok(file)
}

fn content_disposition(path: &Path) -> String {
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy())
        .unwrap_or_else(|| "download".into());
    let sanitized: String = name
        .chars()
        .map(|ch| {
            if ch == '"' || ch == '\\' || ch.is_control() {
                '_'
            } else {
                ch
            }
        })
        .collect();
    format!(
        "attachment; filename=\"{}\"",
        if sanitized.is_empty() {
            "download"
        } else {
            &sanitized
        }
    )
}

/// 获取共享列表
async fn list_shares(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ShareListResponse>, StatusCode> {
    authenticate_lobby(&state, &headers)?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let shares: Vec<SharedFolderSummary> = state
        .shared_folders
        .iter()
        .filter(|entry| !is_expired(entry.value().expire_time, now))
        .map(|entry| SharedFolderSummary::from(entry.value()))
        .collect();

    log::debug!("📋 收到获取共享列表请求，返回 {} 个共享", shares.len());

    Ok(Json(ShareListResponse { shares }))
}

#[cfg(test)]
mod share_list_response_tests {
    use super::{ShareListResponse, SharedFolder, SharedFolderSummary};
    use uuid::Uuid;

    fn protected_share() -> SharedFolder {
        SharedFolder {
            id: "share-1".to_string(),
            name: "Test share".to_string(),
            path: r"C:\Users\test\private".to_string(),
            password: Some("secret-password".to_string()),
            expire_time: Some(1_900_000_000),
            compress_before_send: Some(true),
            owner_id: "owner-1".to_string(),
            created_at: 1_800_000_000,
            expiry_token: Uuid::nil(),
        }
    }

    #[test]
    fn public_share_summary_omits_path_and_password() {
        let response = ShareListResponse {
            shares: vec![SharedFolderSummary::from(&protected_share())],
        };
        let json = serde_json::to_value(response).expect("serialize share list response");
        let share = &json["shares"][0];

        assert_eq!(share["has_password"], true);
        assert!(share.get("path").is_none());
        assert!(share.get("password").is_none());
        assert!(!json.to_string().contains("secret-password"));
        assert!(!json.to_string().contains(r"C:\Users\test\private"));
    }

    #[test]
    fn empty_password_is_reported_as_unprotected() {
        let mut share = protected_share();
        share.password = Some(String::new());

        assert!(!SharedFolderSummary::from(&share).has_password);
    }

    #[test]
    fn whitespace_password_is_reported_as_unprotected() {
        let mut share = protected_share();
        share.password = Some("  \t".to_string());

        assert!(!SharedFolderSummary::from(&share).has_password);
    }
}

/// 获取文件列表
async fn list_files(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    AxumPath(share_id): AxumPath<String>,
    Query(params): Query<HashMap<String, String>>,
    headers: HeaderMap,
) -> Result<Json<FileListResponse>, StatusCode> {
    authenticate_lobby(&state, &headers)?;
    // 获取共享信息
    let share = state
        .shared_folders
        .get(&share_id)
        .map(|share| share.clone())
        .ok_or(StatusCode::NOT_FOUND)?;

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    if is_expired(share.expire_time, now) {
        return Err(StatusCode::GONE);
    }

    if !is_share_access_allowed(
        &state,
        &share_id,
        &share,
        peer,
        share_password_header(&headers),
    )
    .await
    {
        return Err(StatusCode::UNAUTHORIZED);
    }

    let base_path = PathBuf::from(&share.path);
    let sub_path = params.get("path").map(|s| s.as_str()).unwrap_or("");

    // 安全检查：使用 safe_join 防止路径穿越，确保路径在共享目录内
    let full_path = match safe_existing_join(&base_path, sub_path) {
        Some(p) => p,
        None => return Err(StatusCode::FORBIDDEN),
    };

    let directory_metadata = tokio::fs::symlink_metadata(&full_path)
        .await
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                StatusCode::NOT_FOUND
            } else {
                StatusCode::INTERNAL_SERVER_ERROR
            }
        })?;
    if is_link_or_reparse_point(&directory_metadata) || !directory_metadata.is_dir() {
        return Err(StatusCode::BAD_REQUEST);
    }

    // 读取目录
    let mut files = Vec::new();
    let mut entries = tokio::fs::read_dir(&full_path)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    {
        let metadata = tokio::fs::symlink_metadata(entry.path())
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        if is_link_or_reparse_point(&metadata) {
            continue;
        }

        let name = entry.file_name().to_string_lossy().to_string();
        let relative_path = if sub_path.is_empty() {
            name.clone()
        } else {
            format!("{}/{}", sub_path, name)
        };

        let modified = metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);

        files.push(FileInfo {
            name,
            path: relative_path,
            size: metadata.len(),
            is_dir: metadata.is_dir(),
            modified,
        });
    }

    // 按名称排序，文件夹在前
    files.sort_by(|a, b| {
        if a.is_dir == b.is_dir {
            a.name.cmp(&b.name)
        } else if a.is_dir {
            std::cmp::Ordering::Less
        } else {
            std::cmp::Ordering::Greater
        }
    });

    Ok(Json(FileListResponse {
        files,
        current_path: sub_path.to_string(),
    }))
}

/// 验证密码
async fn verify_password(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    AxumPath(share_id): AxumPath<String>,
    headers: HeaderMap,
    Json(req): Json<VerifyPasswordRequest>,
) -> Result<Json<VerifyPasswordResponse>, StatusCode> {
    authenticate_lobby(&state, &headers)?;
    let share = state
        .shared_folders
        .get(&share_id)
        .map(|share| share.clone())
        .ok_or(StatusCode::NOT_FOUND)?;

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    if is_expired(share.expire_time, now) {
        return Err(StatusCode::GONE);
    }

    let success = is_share_access_allowed(&state, &share_id, &share, peer, &req.password).await;

    Ok(Json(VerifyPasswordResponse {
        success,
        message: if success {
            "验证成功".to_string()
        } else {
            "密码错误".to_string()
        },
    }))
}

/// 下载文件（支持Range请求）
async fn download_file(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    AxumPath((share_id, file_path)): AxumPath<(String, String)>,
    headers: HeaderMap,
) -> Result<Response, StatusCode> {
    authenticate_lobby(&state, &headers)?;
    // 获取共享信息
    let share = state
        .shared_folders
        .get(&share_id)
        .map(|share| share.clone())
        .ok_or(StatusCode::NOT_FOUND)?;

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    if is_expired(share.expire_time, now) {
        return Err(StatusCode::GONE);
    }

    if !is_share_access_allowed(
        &state,
        &share_id,
        &share,
        peer,
        share_password_header(&headers),
    )
    .await
    {
        return Err(StatusCode::UNAUTHORIZED);
    }

    let base_path = PathBuf::from(&share.path);

    // 安全检查：使用 safe_join 防止路径穿越
    let full_path = match safe_existing_join(&base_path, &file_path) {
        Some(p) => p,
        None => return Err(StatusCode::FORBIDDEN),
    };

    // Re-check the leaf without following links immediately before opening it.
    // The path was validated earlier, but a file can be replaced while a
    // request is in flight.
    let metadata = tokio::fs::symlink_metadata(&full_path)
        .await
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                StatusCode::NOT_FOUND
            } else {
                StatusCode::INTERNAL_SERVER_ERROR
            }
        })?;

    if is_link_or_reparse_point(&metadata) {
        return Err(StatusCode::FORBIDDEN);
    }
    if !metadata.is_file() {
        return Err(StatusCode::BAD_REQUEST);
    }

    let opened_file = open_readonly_no_follow(&full_path).map_err(|_| StatusCode::FORBIDDEN)?;
    let opened_metadata = opened_file
        .metadata()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if !opened_metadata.is_file() {
        return Err(StatusCode::BAD_REQUEST);
    }
    let file_size = opened_metadata.len();
    let mut file = File::from_std(opened_file);

    // 解析Range头
    let range = match headers.get(header::RANGE) {
        Some(value) => {
            let value = value
                .to_str()
                .map_err(|_| StatusCode::RANGE_NOT_SATISFIABLE)?;
            Some(parse_range(value).ok_or(StatusCode::RANGE_NOT_SATISFIABLE)?)
        }
        None => None,
    };

    match range {
        Some(range) => {
            let Some((start, end)) = resolve_range(range, file_size) else {
                return Response::builder()
                    .status(StatusCode::RANGE_NOT_SATISFIABLE)
                    .header(header::CONTENT_RANGE, format!("bytes */{}", file_size))
                    .header(header::ACCEPT_RANGES, "bytes")
                    .body(Body::empty())
                    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR);
            };
            // 范围请求
            let length = end - start + 1;

            file.seek(std::io::SeekFrom::Start(start))
                .await
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

            let stream = create_file_stream(file, length);

            Response::builder()
                .status(StatusCode::PARTIAL_CONTENT)
                .header(header::CONTENT_TYPE, "application/octet-stream")
                .header(header::CONTENT_LENGTH, length)
                .header(header::ACCEPT_RANGES, "bytes")
                .header(
                    header::CONTENT_RANGE,
                    format!("bytes {}-{}/{}", start, end, file_size),
                )
                .header(header::CONTENT_DISPOSITION, content_disposition(&full_path))
                .body(Body::from_stream(stream))
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
        }
        None => {
            // 完整文件请求
            let stream = create_file_stream(file, file_size);

            Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, "application/octet-stream")
                .header(header::CONTENT_LENGTH, file_size)
                .header(header::ACCEPT_RANGES, "bytes")
                .header(header::CONTENT_DISPOSITION, content_disposition(&full_path))
                .body(Body::from_stream(stream))
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

/// 解析Range头
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ByteRange {
    From { start: u64, end: Option<u64> },
    Suffix(u64),
}

fn parse_range(range_str: &str) -> Option<ByteRange> {
    let (unit, value) = range_str.split_once('=')?;
    if !unit.eq_ignore_ascii_case("bytes") || value.contains(',') {
        return None;
    }
    let (start, end) = value.split_once('-')?;
    if end.contains('-') {
        return None;
    }
    if start.is_empty() {
        let length = end.parse::<u64>().ok()?;
        return (length > 0).then_some(ByteRange::Suffix(length));
    }
    let start = start.parse::<u64>().ok()?;
    let end = if end.is_empty() {
        None
    } else {
        Some(end.parse::<u64>().ok()?)
    };
    Some(ByteRange::From { start, end })
}

fn resolve_range(range: ByteRange, file_size: u64) -> Option<(u64, u64)> {
    if file_size == 0 {
        return None;
    }
    match range {
        ByteRange::From { start, end } => {
            if start >= file_size {
                return None;
            }
            let end = end.unwrap_or(file_size - 1).min(file_size - 1);
            (end >= start).then_some((start, end))
        }
        ByteRange::Suffix(length) => {
            let length = length.min(file_size);
            Some((file_size - length, file_size - 1))
        }
    }
}

#[cfg(test)]
mod range_tests {
    use super::{parse_range, resolve_range, ByteRange};

    #[test]
    fn parses_open_ended_and_suffix_ranges() {
        assert_eq!(
            parse_range("bytes=4-"),
            Some(ByteRange::From {
                start: 4,
                end: None
            })
        );
        assert_eq!(parse_range("BYTES=-8"), Some(ByteRange::Suffix(8)));
        assert_eq!(parse_range("bytes=0-3,5-7"), None);
        assert_eq!(parse_range("bytes=-0"), None);
    }

    #[test]
    fn resolves_ranges_without_rejecting_a_large_end() {
        assert_eq!(
            resolve_range(
                ByteRange::From {
                    start: 2,
                    end: Some(999)
                },
                10
            ),
            Some((2, 9))
        );
        assert_eq!(resolve_range(ByteRange::Suffix(4), 10), Some((6, 9)));
        assert_eq!(resolve_range(ByteRange::Suffix(40), 10), Some((0, 9)));
        assert_eq!(
            resolve_range(
                ByteRange::From {
                    start: 10,
                    end: None
                },
                10
            ),
            None
        );
        assert_eq!(resolve_range(ByteRange::Suffix(1), 0), None);
    }
}

/// 创建文件流
fn create_file_stream(
    mut file: File,
    length: u64,
) -> impl futures_util::Stream<Item = Result<bytes::Bytes, std::io::Error>> {
    async_stream::stream! {
        let mut remaining = length;
        let mut buffer = vec![0u8; CHUNK_SIZE];

        while remaining > 0 {
            let to_read = std::cmp::min(CHUNK_SIZE as u64, remaining) as usize;
            match file.read(&mut buffer[..to_read]).await {
                Ok(0) => break,
                Ok(n) => {
                    remaining -= n as u64;
                    yield Ok(bytes::Bytes::copy_from_slice(&buffer[..n]));
                }
                Err(e) => {
                    yield Err(e);
                    break;
                }
            }
        }
    }
}

struct TempFileStreamGuard {
    file: Option<File>,
    path: PathBuf,
    _permit: OwnedSemaphorePermit,
}

impl Drop for TempFileStreamGuard {
    fn drop(&mut self) {
        self.file.take();
        if let Err(error) = std::fs::remove_file(&self.path) {
            if error.kind() != std::io::ErrorKind::NotFound {
                log::warn!("清理临时ZIP失败 {:?}: {}", self.path, error);
            }
        }
    }
}

fn create_temp_file_stream(
    file: File,
    path: PathBuf,
    length: u64,
    permit: OwnedSemaphorePermit,
) -> impl futures_util::Stream<Item = Result<bytes::Bytes, std::io::Error>> {
    let guard = TempFileStreamGuard {
        file: Some(file),
        path,
        _permit: permit,
    };
    async_stream::stream! {
        let mut guard = guard;
        let mut remaining = length;
        let mut buffer = vec![0u8; CHUNK_SIZE];
        while remaining > 0 {
            let to_read = std::cmp::min(CHUNK_SIZE as u64, remaining) as usize;
            let result = match guard.file.as_mut() {
                Some(file) => file.read(&mut buffer[..to_read]).await,
                None => break,
            };
            match result {
                Ok(0) => break,
                Ok(read) => {
                    remaining -= read as u64;
                    yield Ok(bytes::Bytes::copy_from_slice(&buffer[..read]));
                }
                Err(error) => {
                    yield Err(error);
                    break;
                }
            }
        }
    }
}

struct TempPathCleanup {
    path: PathBuf,
    armed: bool,
}

struct PreparedBatchZip {
    file: Option<std::fs::File>,
    path: PathBuf,
    filename: String,
    size: u64,
    permit: Option<OwnedSemaphorePermit>,
    armed: bool,
}

impl PreparedBatchZip {
    fn into_stream_parts(mut self) -> (File, PathBuf, String, u64, OwnedSemaphorePermit) {
        self.armed = false;
        (
            File::from_std(self.file.take().expect("prepared ZIP file missing")),
            self.path.clone(),
            self.filename.clone(),
            self.size,
            self.permit.take().expect("prepared ZIP permit missing"),
        )
    }
}

impl Drop for PreparedBatchZip {
    fn drop(&mut self) {
        self.file.take();
        if self.armed {
            let _ = std::fs::remove_file(&self.path);
        }
    }
}

fn ensure_share_current(
    shared_folders: &DashMap<String, SharedFolder>,
    share_id: &str,
    share_token: Uuid,
) -> Result<(), StatusCode> {
    let share = shared_folders.get(share_id).ok_or(StatusCode::GONE)?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    if share.expiry_token != share_token || is_expired(share.expire_time, now) {
        return Err(StatusCode::GONE);
    }
    Ok(())
}

struct ShareValidityReader<R> {
    inner: R,
    shared_folders: Arc<DashMap<String, SharedFolder>>,
    share_id: String,
    share_token: Uuid,
}

impl<R: std::io::Read> std::io::Read for ShareValidityReader<R> {
    fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
        ensure_share_current(&self.shared_folders, &self.share_id, self.share_token).map_err(
            |_| std::io::Error::new(std::io::ErrorKind::Interrupted, SHARE_INVALID_ERROR),
        )?;
        self.inner.read(buffer)
    }
}

struct SizeLimitedWriter<W> {
    inner: W,
    position: u64,
    written: u64,
    limit: u64,
}

impl<W: std::io::Write> std::io::Write for SizeLimitedWriter<W> {
    fn write(&mut self, buffer: &[u8]) -> std::io::Result<usize> {
        let available = self.limit.saturating_sub(self.position);
        if buffer.len() as u64 > available {
            return Err(std::io::Error::new(
                std::io::ErrorKind::Other,
                ZIP_OUTPUT_LIMIT_ERROR,
            ));
        }

        let written = self.inner.write(buffer)?;
        self.position = self.position.saturating_add(written as u64);
        self.written = self.written.max(self.position);
        Ok(written)
    }

    fn flush(&mut self) -> std::io::Result<()> {
        self.inner.flush()
    }
}

impl<W: std::io::Seek> std::io::Seek for SizeLimitedWriter<W> {
    fn seek(&mut self, position: std::io::SeekFrom) -> std::io::Result<u64> {
        let position = self.inner.seek(position)?;
        if position > self.limit {
            return Err(std::io::Error::new(
                std::io::ErrorKind::Other,
                ZIP_OUTPUT_LIMIT_ERROR,
            ));
        }
        self.position = position;
        Ok(position)
    }
}

impl Drop for TempPathCleanup {
    fn drop(&mut self) {
        if self.armed {
            let _ = std::fs::remove_file(&self.path);
        }
    }
}

fn build_batch_zip(
    base_path: PathBuf,
    file_paths: Vec<String>,
    shared_folders: Arc<DashMap<String, SharedFolder>>,
    share_id: String,
    share_token: Uuid,
    permit: OwnedSemaphorePermit,
) -> Result<PreparedBatchZip, StatusCode> {
    use std::io::{Read, Seek};

    if file_paths.is_empty() || file_paths.len() > MAX_BATCH_FILES {
        return Err(StatusCode::BAD_REQUEST);
    }
    ensure_share_current(&shared_folders, &share_id, share_token)?;

    let zip_filename = format!("mctier_batch_{}.zip", Uuid::new_v4());
    let zip_path = std::env::temp_dir().join(&zip_filename);
    let mut cleanup = TempPathCleanup {
        path: zip_path.clone(),
        armed: true,
    };
    let zip_file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&zip_path)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let mut zip = zip::ZipWriter::new(SizeLimitedWriter {
        inner: zip_file,
        position: 0,
        written: 0,
        limit: MAX_BATCH_ZIP_BYTES,
    });
    let options = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .compression_level(Some(6));
    let mut seen = HashSet::new();
    let mut total_source_bytes = 0u64;

    for requested_path in file_paths {
        ensure_share_current(&shared_folders, &share_id, share_token)?;
        let (entry_name, entry_key) =
            safe_zip_entry_name(&requested_path).ok_or(StatusCode::BAD_REQUEST)?;
        let full_path =
            safe_existing_join(&base_path, &requested_path).ok_or(StatusCode::BAD_REQUEST)?;
        let metadata = std::fs::symlink_metadata(&full_path).map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                StatusCode::NOT_FOUND
            } else {
                StatusCode::INTERNAL_SERVER_ERROR
            }
        })?;
        if is_link_or_reparse_point(&metadata) || !metadata.is_file() {
            return Err(StatusCode::BAD_REQUEST);
        }
        if !seen.insert(entry_key) {
            return Err(StatusCode::BAD_REQUEST);
        }
        let file = open_readonly_no_follow(&full_path).map_err(|_| StatusCode::FORBIDDEN)?;
        let opened_metadata = file
            .metadata()
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        if !opened_metadata.is_file() {
            return Err(StatusCode::BAD_REQUEST);
        }
        if total_source_bytes
            .checked_add(opened_metadata.len())
            .is_none_or(|total| total > MAX_BATCH_SOURCE_BYTES)
        {
            return Err(StatusCode::PAYLOAD_TOO_LARGE);
        }

        zip.start_file(entry_name, options).map_err(|error| {
            if error.to_string().contains(ZIP_OUTPUT_LIMIT_ERROR) {
                StatusCode::PAYLOAD_TOO_LARGE
            } else {
                StatusCode::INTERNAL_SERVER_ERROR
            }
        })?;
        let remaining = MAX_BATCH_SOURCE_BYTES - total_source_bytes;
        let mut reader = ShareValidityReader {
            inner: file.take(remaining + 1),
            shared_folders: shared_folders.clone(),
            share_id: share_id.clone(),
            share_token,
        };
        let copied = std::io::copy(&mut reader, &mut zip).map_err(|error| {
            if error.to_string() == SHARE_INVALID_ERROR {
                StatusCode::GONE
            } else if error.kind() == std::io::ErrorKind::Other
                && error.to_string() == ZIP_OUTPUT_LIMIT_ERROR
            {
                StatusCode::PAYLOAD_TOO_LARGE
            } else {
                StatusCode::INTERNAL_SERVER_ERROR
            }
        })?;
        if copied > remaining {
            return Err(StatusCode::PAYLOAD_TOO_LARGE);
        }
        total_source_bytes += copied;
    }

    let mut zip_file = zip.finish().map_err(|error| {
        if error.to_string().contains(ZIP_OUTPUT_LIMIT_ERROR) {
            StatusCode::PAYLOAD_TOO_LARGE
        } else {
            StatusCode::INTERNAL_SERVER_ERROR
        }
    })?;
    let zip_size = zip_file.written;
    zip_file
        .inner
        .sync_all()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    ensure_share_current(&shared_folders, &share_id, share_token)?;
    zip_file
        .inner
        .seek(std::io::SeekFrom::Start(0))
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    cleanup.armed = false;
    Ok(PreparedBatchZip {
        file: Some(zip_file.inner),
        path: zip_path,
        filename: zip_filename,
        size: zip_size,
        permit: Some(permit),
        armed: true,
    })
}

/// 批量打包下载（先压后发）
async fn batch_download(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    AxumPath(share_id): AxumPath<String>,
    headers: HeaderMap,
    Json(req): Json<BatchDownloadRequest>,
) -> Result<Response, StatusCode> {
    authenticate_lobby(&state, &headers)?;
    log::info!(
        "📦 收到批量打包下载请求: share_id={}, files={}",
        share_id,
        req.file_paths.len()
    );

    // 获取共享信息
    let share = state
        .shared_folders
        .get(&share_id)
        .map(|share| share.clone())
        .ok_or_else(|| {
            log::error!("❌ 共享不存在: {}", share_id);
            StatusCode::NOT_FOUND
        })?;

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    if is_expired(share.expire_time, now) {
        return Err(StatusCode::GONE);
    }

    if !is_share_access_allowed(
        &state,
        &share_id,
        &share,
        peer,
        share_password_header(&headers),
    )
    .await
    {
        return Err(StatusCode::UNAUTHORIZED);
    }

    // 检查是否启用了"先压后发"
    if !share.compress_before_send.unwrap_or(false) {
        log::warn!("⚠️ 共享未启用先压后发功能");
        return Err(StatusCode::BAD_REQUEST);
    }

    let base_path = PathBuf::from(&share.path);
    let share_token = share.expiry_token;
    let file_paths = req.file_paths;
    // Keep one slot occupied from compression start until the response body
    // is dropped. This bounds both CPU and temporary-disk pressure.
    let permit = state
        .batch_slots
        .clone()
        .acquire_owned()
        .await
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;

    let current = state
        .shared_folders
        .get(&share_id)
        .ok_or(StatusCode::NOT_FOUND)?;
    if current.expiry_token != share_token
        || is_expired(
            current.expire_time,
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
        )
    {
        return Err(StatusCode::GONE);
    }
    drop(current);

    let shared_folders = state.shared_folders.clone();
    let build_share_id = share_id.clone();
    let prepared = tokio::task::spawn_blocking(move || {
        build_batch_zip(
            base_path,
            file_paths,
            shared_folders,
            build_share_id,
            share_token,
            permit,
        )
    })
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)??;

    let current = state
        .shared_folders
        .get(&share_id)
        .ok_or(StatusCode::NOT_FOUND)?;
    let still_allowed = current.expiry_token == share_token
        && !is_expired(
            current.expire_time,
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
        );
    drop(current);
    if !still_allowed {
        return Err(StatusCode::GONE);
    }

    let (zip_file, zip_path, zip_filename, zip_size, permit) = prepared.into_stream_parts();
    let stream = create_temp_file_stream(zip_file, zip_path, zip_size, permit);

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/zip")
        .header(header::CONTENT_LENGTH, zip_size)
        .header(
            header::CONTENT_DISPOSITION,
            format!("attachment; filename=\"{}\"", zip_filename),
        )
        .body(Body::from_stream(stream))
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}
