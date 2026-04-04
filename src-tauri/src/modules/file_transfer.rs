/**
 * HTTP 文件共享服务模块
 * 基于 WireGuard 虚拟网络的高性能文件传输
 * 使用标准 HTTP 协议，支持断点续传和多线程下载
 */

use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use axum::{
    body::Body,
    extract::{Path as AxumPath, Query, State},
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
use tower_http::cors::CorsLayer;
use zip::write::SimpleFileOptions;

const FILE_SERVER_PORT: u16 = 14539; // 固定端口，方便其他节点访问
const CHUNK_SIZE: usize = 1024 * 1024; // 1MB chunks

/// 共享文件夹信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SharedFolder {
    pub id: String,
    pub name: String,
    pub path: String,
    pub password: Option<String>,
    pub expire_time: Option<u64>, // Unix timestamp
    pub compress_before_send: Option<bool>, // 是否启用"先压后发"策略
    pub owner_id: String,
    pub created_at: u64,
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
    pub shares: Vec<SharedFolder>,
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
    expiry_timers: Arc<DashMap<String, tokio::task::JoinHandle<()>>>,
}

impl FileTransferService {
    pub fn new() -> Self {
        Self {
            shared_folders: Arc::new(DashMap::new()),
            virtual_ip: Arc::new(RwLock::new(None)),
            server_handle: Arc::new(RwLock::new(None)),
            expiry_timers: Arc::new(DashMap::new()),
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

    /// 启动HTTP文件服务器
    pub async fn start_server(&self) -> Result<(), Box<dyn std::error::Error>> {
        let virtual_ip = match self.get_virtual_ip() {
            Some(ip) => ip,
            None => {
                log::error!("❌ 虚拟IP未设置，无法启动HTTP文件服务器");
                return Err("虚拟IP未设置".into());
            }
        };

        log::info!("🔍 检查虚拟IP是否就绪: {}", virtual_ip);
        
        // 等待虚拟IP就绪（最多等待10秒）
        let mut attempts = 0;
        let max_attempts = 20; // 20次 * 500ms = 10秒
        loop {
            // 尝试绑定到虚拟IP的一个临时端口，测试IP是否可用
            match tokio::net::TcpListener::bind(format!("{}:0", virtual_ip)).await {
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
                    log::warn!("⏳ 虚拟IP尚未就绪，等待中... ({}/{})", attempts, max_attempts);
                    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
                }
            }
        }

        let addr: SocketAddr = format!("0.0.0.0:{}", FILE_SERVER_PORT)
            .parse()
            .map_err(|e| {
                log::error!("❌ 无效的地址格式: 0.0.0.0:{} - {}", FILE_SERVER_PORT, e);
                format!("无效的地址: {}", e)
            })?;

        log::info!("📍 HTTP服务器将监听所有网络接口: 0.0.0.0:{}", FILE_SERVER_PORT);
        log::info!("📍 虚拟IP: {}", virtual_ip);

        let shared_folders = self.shared_folders.clone();

        // 创建路由
        let app = Router::new()
            .route("/api/shares", get(list_shares))
            .route("/api/shares/:share_id/files", get(list_files))
            .route("/api/shares/:share_id/verify", post(verify_password))
            .route("/api/shares/:share_id/download/*file_path", get(download_file))
            .route("/api/shares/:share_id/batch-download", post(batch_download))
            .layer(CorsLayer::permissive())
            .with_state(AppState {
                shared_folders: shared_folders.clone(),
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
            if let Err(e) = axum::serve(listener, app).await {
                log::error!("❌ HTTP服务器运行错误: {}", e);
            } else {
                log::info!("🛑 HTTP服务器已正常停止");
            }
        });

        *self.server_handle.write() = Some(server_task);

        log::info!("✅ HTTP文件服务器启动成功！");
        log::info!("📡 监听地址: 0.0.0.0:{}", FILE_SERVER_PORT);
        log::info!("📡 虚拟IP: {}", virtual_ip);
        log::debug!("📡 其他玩家可以通过 http://{}:{} 访问您的共享", virtual_ip, FILE_SERVER_PORT);
        
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
    pub fn add_share(&self, share: SharedFolder) -> Result<(), String> {
        // 检查路径是否存在
        if !Path::new(&share.path).exists() {
            return Err("文件夹不存在".to_string());
        }

        let share_id = share.id.clone();
        self.shared_folders.insert(share_id.clone(), share.clone());
        log::debug!("📁 添加共享: {} ({})", share.name, share_id);
        
        // 如果设置了过期时间,创建定时器
        if let Some(expire_time) = share.expire_time {
            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_secs();
            
            if expire_time > now {
                let delay_secs = expire_time - now;
                log::info!("⏰ 为共享 {} 设置过期定时器: {}秒后过期", share_id, delay_secs);
                
                let shared_folders = self.shared_folders.clone();
                let expiry_timers = self.expiry_timers.clone();
                let share_id_clone = share_id.clone();
                
                let timer_handle = tokio::spawn(async move {
                    tokio::time::sleep(tokio::time::Duration::from_secs(delay_secs)).await;
                    
                    // 删除过期共享
                    if shared_folders.remove(&share_id_clone).is_some() {
                        log::info!("⏰ 共享已过期并自动删除: {}", share_id_clone);
                    }
                    
                    // 清理定时器
                    expiry_timers.remove(&share_id_clone);
                });
                
                self.expiry_timers.insert(share_id.clone(), timer_handle);
            } else {
                log::warn!("⚠️ 共享 {} 的过期时间已过,不添加", share_id);
                return Err("共享已过期".to_string());
            }
        }
        
        Ok(())
    }

    /// 删除共享文件夹
    pub fn remove_share(&self, share_id: &str) -> Result<(), String> {
        self.shared_folders
            .remove(share_id)
            .ok_or_else(|| "共享不存在".to_string())?;
        
        // 取消过期定时器
        if let Some((_, timer_handle)) = self.expiry_timers.remove(share_id) {
            timer_handle.abort();
            log::debug!("⏰ 取消共享 {} 的过期定时器", share_id);
        }
        
        log::debug!("🗑️ 删除共享: {}", share_id);
        Ok(())
    }

    /// 获取所有共享
    pub fn get_shares(&self) -> Vec<SharedFolder> {
        self.shared_folders
            .iter()
            .map(|entry| entry.value().clone())
            .collect()
    }

    /// 清理过期共享
    pub fn cleanup_expired_shares(&self) {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();

        let expired: Vec<String> = self
            .shared_folders
            .iter()
            .filter(|entry| {
                if let Some(expire_time) = entry.value().expire_time {
                    expire_time < now
                } else {
                    false
                }
            })
            .map(|entry| entry.key().clone())
            .collect();

        for share_id in expired {
            self.shared_folders.remove(&share_id);
            log::debug!("⏰ 清理过期共享: {}", share_id);
        }
    }
}

/// Axum 应用状态
#[derive(Clone)]
struct AppState {
    shared_folders: Arc<DashMap<String, SharedFolder>>,
}

fn is_share_access_allowed(share: &SharedFolder, headers: &HeaderMap) -> bool {
    if let Some(expected_password) = &share.password {
        let provided_password = headers
            .get("x-share-password")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");

        return provided_password == expected_password;
    }

    true
}

/// 获取共享列表
async fn list_shares(State(state): State<AppState>) -> Json<ShareListResponse> {
    let shares: Vec<SharedFolder> = state
        .shared_folders
        .iter()
        .map(|entry| entry.value().clone())
        .collect();

    log::debug!("📋 收到获取共享列表请求，返回 {} 个共享", shares.len());

    Json(ShareListResponse { shares })
}

/// 获取文件列表
async fn list_files(
    State(state): State<AppState>,
    AxumPath(share_id): AxumPath<String>,
    Query(params): Query<HashMap<String, String>>,
    headers: HeaderMap,
) -> Result<Json<FileListResponse>, StatusCode> {
    // 获取共享信息
    let share = state
        .shared_folders
        .get(&share_id)
        .ok_or(StatusCode::NOT_FOUND)?;

    if !is_share_access_allowed(&share, &headers) {
        return Err(StatusCode::UNAUTHORIZED);
    }

    let base_path = PathBuf::from(&share.path);
    let sub_path = params.get("path").map(|s| s.as_str()).unwrap_or("");
    let full_path = base_path.join(sub_path);

    // 安全检查：确保路径在共享目录内
    if !full_path.starts_with(&base_path) {
        return Err(StatusCode::FORBIDDEN);
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
        let metadata = entry
            .metadata()
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

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
    AxumPath(share_id): AxumPath<String>,
    Json(req): Json<VerifyPasswordRequest>,
) -> Json<VerifyPasswordResponse> {
    let share = match state.shared_folders.get(&share_id) {
        Some(s) => s,
        None => {
            return Json(VerifyPasswordResponse {
                success: false,
                message: "共享不存在".to_string(),
            });
        }
    };

    let success = match &share.password {
        Some(pwd) => pwd == &req.password,
        None => true, // 无密码保护
    };

    Json(VerifyPasswordResponse {
        success,
        message: if success {
            "验证成功".to_string()
        } else {
            "密码错误".to_string()
        },
    })
}

/// 下载文件（支持Range请求）
async fn download_file(
    State(state): State<AppState>,
    AxumPath((share_id, file_path)): AxumPath<(String, String)>,
    headers: HeaderMap,
) -> Result<Response, StatusCode> {
    // 获取共享信息
    let share = state
        .shared_folders
        .get(&share_id)
        .ok_or(StatusCode::NOT_FOUND)?;

    if !is_share_access_allowed(&share, &headers) {
        return Err(StatusCode::UNAUTHORIZED);
    }

    let base_path = PathBuf::from(&share.path);
    let full_path = base_path.join(&file_path);

    // 安全检查
    if !full_path.starts_with(&base_path) {
        return Err(StatusCode::FORBIDDEN);
    }

    if !full_path.exists() {
        return Err(StatusCode::NOT_FOUND);
    }

    // 获取文件元数据
    let metadata = tokio::fs::metadata(&full_path)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    if metadata.is_dir() {
        return Err(StatusCode::BAD_REQUEST);
    }

    let file_size = metadata.len();

    // 解析Range头
    let range = headers
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok())
        .and_then(parse_range);

    match range {
        Some((start, end)) => {
            // 范围请求
            let end = end.min(file_size - 1);
            let length = end - start + 1;

            let mut file = File::open(&full_path)
                .await
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

            file.seek(std::io::SeekFrom::Start(start))
                .await
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

            let stream = create_file_stream(file, length);

            Response::builder()
                .status(StatusCode::PARTIAL_CONTENT)
                .header(header::CONTENT_TYPE, "application/octet-stream")
                .header(header::CONTENT_LENGTH, length)
                .header(
                    header::CONTENT_RANGE,
                    format!("bytes {}-{}/{}", start, end, file_size),
                )
                .header(
                    header::CONTENT_DISPOSITION,
                    format!(
                        "attachment; filename=\"{}\"",
                        full_path.file_name().unwrap().to_string_lossy()
                    ),
                )
                .body(Body::from_stream(stream))
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
        }
        None => {
            // 完整文件请求
            let file = File::open(&full_path)
                .await
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

            let stream = create_file_stream(file, file_size);

            Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, "application/octet-stream")
                .header(header::CONTENT_LENGTH, file_size)
                .header(
                    header::CONTENT_DISPOSITION,
                    format!(
                        "attachment; filename=\"{}\"",
                        full_path.file_name().unwrap().to_string_lossy()
                    ),
                )
                .body(Body::from_stream(stream))
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

/// 解析Range头
fn parse_range(range_str: &str) -> Option<(u64, u64)> {
    // 格式: "bytes=start-end"
    let range_str = range_str.strip_prefix("bytes=")?;
    let parts: Vec<&str> = range_str.split('-').collect();

    if parts.len() != 2 {
        return None;
    }

    let start = parts[0].parse::<u64>().ok()?;
    let end = if parts[1].is_empty() {
        u64::MAX
    } else {
        parts[1].parse::<u64>().ok()?
    };

    Some((start, end))
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

/// 批量打包下载（先压后发）
async fn batch_download(
    State(state): State<AppState>,
    AxumPath(share_id): AxumPath<String>,
    headers: HeaderMap,
    Json(req): Json<BatchDownloadRequest>,
) -> Result<Response, StatusCode> {
    log::info!("📦 收到批量打包下载请求: share_id={}, files={}", share_id, req.file_paths.len());
    
    // 获取共享信息
    let share = state
        .shared_folders
        .get(&share_id)
        .ok_or_else(|| {
            log::error!("❌ 共享不存在: {}", share_id);
            StatusCode::NOT_FOUND
        })?;

    if !is_share_access_allowed(&share, &headers) {
        return Err(StatusCode::UNAUTHORIZED);
    }

    // 检查是否启用了"先压后发"
    if !share.compress_before_send.unwrap_or(false) {
        log::warn!("⚠️ 共享未启用先压后发功能");
        return Err(StatusCode::BAD_REQUEST);
    }

    let base_path = PathBuf::from(&share.path);
    
    // 创建临时ZIP文件
    let temp_dir = std::env::temp_dir();
    let zip_filename = format!("mctier_batch_{}_{}.zip", share_id, SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs());
    let zip_path = temp_dir.join(&zip_filename);
    
    log::info!("📦 创建临时ZIP文件: {:?}", zip_path);
    
    // 创建ZIP文件
    let zip_file = std::fs::File::create(&zip_path)
        .map_err(|e| {
            log::error!("❌ 创建ZIP文件失败: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
    
    let mut zip = zip::ZipWriter::new(zip_file);
    let options = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .compression_level(Some(6));
    
    // 添加文件到ZIP
    for file_path in &req.file_paths {
        let full_path = base_path.join(file_path);
        
        // 安全检查
        if !full_path.starts_with(&base_path) {
            log::warn!("⚠️ 路径安全检查失败: {:?}", full_path);
            continue;
        }
        
        if !full_path.exists() {
            log::warn!("⚠️ 文件不存在: {:?}", full_path);
            continue;
        }
        
        let metadata = std::fs::metadata(&full_path)
            .map_err(|e| {
                log::error!("❌ 获取文件元数据失败: {}", e);
                StatusCode::INTERNAL_SERVER_ERROR
            })?;
        
        if metadata.is_file() {
            log::info!("📄 添加文件到ZIP: {}", file_path);
            
            zip.start_file(file_path, options)
                .map_err(|e| {
                    log::error!("❌ 开始写入ZIP文件失败: {}", e);
                    StatusCode::INTERNAL_SERVER_ERROR
                })?;
            
            let mut file = std::fs::File::open(&full_path)
                .map_err(|e| {
                    log::error!("❌ 打开文件失败: {}", e);
                    StatusCode::INTERNAL_SERVER_ERROR
                })?;
            
            std::io::copy(&mut file, &mut zip)
                .map_err(|e| {
                    log::error!("❌ 复制文件到ZIP失败: {}", e);
                    StatusCode::INTERNAL_SERVER_ERROR
                })?;
        }
    }
    
    zip.finish()
        .map_err(|e| {
            log::error!("❌ 完成ZIP文件失败: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
    
    log::info!("✅ ZIP文件创建成功: {:?}", zip_path);
    
    // 读取ZIP文件
    let zip_data = tokio::fs::read(&zip_path)
        .await
        .map_err(|e| {
            log::error!("❌ 读取ZIP文件失败: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
    
    let zip_size = zip_data.len();
    log::info!("📦 ZIP文件大小: {} bytes", zip_size);
    
    // 【修复】立即删除临时文件（在发送响应前）
    // 因为zip_data已经读取到内存中了，可以安全删除文件
    if let Err(e) = tokio::fs::remove_file(&zip_path).await {
        log::warn!("⚠️ 删除临时ZIP文件失败: {}", e);
    } else {
        log::info!("🗑️ 临时ZIP文件已删除: {:?}", zip_path);
    }
    
    // 返回ZIP文件
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/zip")
        .header(header::CONTENT_LENGTH, zip_size)
        .header(
            header::CONTENT_DISPOSITION,
            format!("attachment; filename=\"{}\"", zip_filename),
        )
        .body(Body::from(zip_data))
        .map_err(|e| {
            log::error!("❌ 构建响应失败: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })
}



