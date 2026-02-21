/**
 * 高性能 P2P 文件传输模块
 * 使用 Rust 原生多线程和零拷贝 I/O 实现超高速文件传输
 */

use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use dashmap::DashMap;
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use tokio::fs::File;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;
use tokio::time::timeout;

const CHUNK_SIZE: usize = 4 * 1024 * 1024; // 4MB
const MAX_CONCURRENT_TRANSFERS: usize = 10;
const TRANSFER_TIMEOUT: Duration = Duration::from_secs(300); // 5分钟超时

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransferRequest {
    pub request_id: String,
    pub share_id: String,
    pub file_path: String,
    pub file_name: String,
    pub file_size: u64,
    pub range_start: Option<u64>,
    pub range_end: Option<u64>,
    pub thread_id: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransferProgress {
    pub request_id: String,
    pub file_name: String,
    pub total_size: u64,
    pub transferred_size: u64,
    pub progress: f64,
    pub speed: f64, // bytes per second
    pub status: String,
}

#[derive(Debug)]
struct ActiveTransfer {
    request_id: String,
    file_path: PathBuf,
    total_size: u64,
    transferred_size: Arc<RwLock<u64>>,
    start_time: Instant,
    last_update: Arc<RwLock<Instant>>,
}

pub struct FileTransferService {
    active_transfers: Arc<DashMap<String, ActiveTransfer>>,
    listener: Option<Arc<TcpListener>>,
    local_port: u16,
    progress_tx: mpsc::UnboundedSender<TransferProgress>,
}

impl FileTransferService {
    pub async fn new(progress_tx: mpsc::UnboundedSender<TransferProgress>) -> Result<Self, Box<dyn std::error::Error>> {
        // 绑定到随机端口
        let listener = TcpListener::bind("0.0.0.0:0").await?;
        let local_port = listener.local_addr()?.port();
        
        log::info!("📡 文件传输服务启动，监听端口: {}", local_port);
        
        Ok(Self {
            active_transfers: Arc::new(DashMap::new()),
            listener: Some(Arc::new(listener)),
            local_port,
            progress_tx,
        })
    }
    
    pub fn get_local_port(&self) -> u16 {
        self.local_port
    }
    
    /// 启动文件传输服务器
    pub async fn start_server(&self) {
        let listener = self.listener.as_ref().unwrap().clone();
        let active_transfers = self.active_transfers.clone();
        let progress_tx = self.progress_tx.clone();
        
        tokio::spawn(async move {
            loop {
                match listener.accept().await {
                    Ok((stream, addr)) => {
                        log::info!("📥 接受连接: {}", addr);
                        let transfers = active_transfers.clone();
                        let tx = progress_tx.clone();
                        
                        tokio::spawn(async move {
                            if let Err(e) = Self::handle_connection(stream, transfers, tx).await {
                                log::error!("❌ 处理连接失败: {}", e);
                            }
                        });
                    }
                    Err(e) => {
                        log::error!("❌ 接受连接失败: {}", e);
                    }
                }
            }
        });
    }
    
    /// 处理传入连接
    async fn handle_connection(
        mut stream: TcpStream,
        _active_transfers: Arc<DashMap<String, ActiveTransfer>>,
        progress_tx: mpsc::UnboundedSender<TransferProgress>,
    ) -> Result<(), String> {
        // 读取请求头（JSON格式）
        let mut len_buf = [0u8; 4];
        stream.read_exact(&mut len_buf).await.map_err(|e| e.to_string())?;
        let json_len = u32::from_le_bytes(len_buf) as usize;
        
        let mut json_buf = vec![0u8; json_len];
        stream.read_exact(&mut json_buf).await.map_err(|e| e.to_string())?;
        
        let request: TransferRequest = serde_json::from_slice(&json_buf).map_err(|e| e.to_string())?;
        log::info!("📥 收到传输请求: {} ({})", request.file_name, request.request_id);
        
        // 打开文件
        let mut file = File::open(&request.file_path).await.map_err(|e| e.to_string())?;
        
        // 如果是范围请求，seek到指定位置
        if let (Some(start), Some(end)) = (request.range_start, request.range_end) {
            use tokio::io::AsyncSeekExt;
            file.seek(std::io::SeekFrom::Start(start)).await.map_err(|e| e.to_string())?;
            
            let range_size = end - start;
            log::info!("📦 范围传输: {}-{} ({} bytes)", start, end, range_size);
            
            // 发送范围数据
            Self::send_file_range(&mut stream, &mut file, range_size, &request, &progress_tx).await?;
        } else {
            // 发送整个文件
            Self::send_file_full(&mut stream, &mut file, request.file_size, &request, &progress_tx).await?;
        }
        
        log::info!("✅ 文件传输完成: {}", request.file_name);
        Ok(())
    }
    
    /// 发送文件范围
    async fn send_file_range(
        stream: &mut TcpStream,
        file: &mut File,
        size: u64,
        request: &TransferRequest,
        progress_tx: &mpsc::UnboundedSender<TransferProgress>,
    ) -> Result<(), String> {
        let mut buffer = vec![0u8; CHUNK_SIZE];
        let mut sent = 0u64;
        let start_time = Instant::now();
        let mut last_progress_time = Instant::now();
        
        while sent < size {
            let to_read = std::cmp::min(CHUNK_SIZE, (size - sent) as usize);
            let n = file.read(&mut buffer[..to_read]).await.map_err(|e| e.to_string())?;
            
            if n == 0 {
                break;
            }
            
            stream.write_all(&buffer[..n]).await.map_err(|e| e.to_string())?;
            sent += n as u64;
            
            // 每100ms更新一次进度
            if last_progress_time.elapsed() >= Duration::from_millis(100) {
                let elapsed = start_time.elapsed().as_secs_f64();
                let speed = if elapsed > 0.0 { sent as f64 / elapsed } else { 0.0 };
                
                let _ = progress_tx.send(TransferProgress {
                    request_id: request.request_id.clone(),
                    file_name: request.file_name.clone(),
                    total_size: size,
                    transferred_size: sent,
                    progress: (sent as f64 / size as f64) * 100.0,
                    speed,
                    status: "transferring".to_string(),
                });
                
                last_progress_time = Instant::now();
            }
        }
        
        Ok(())
    }
    
    /// 发送完整文件
    async fn send_file_full(
        stream: &mut TcpStream,
        file: &mut File,
        size: u64,
        request: &TransferRequest,
        progress_tx: &mpsc::UnboundedSender<TransferProgress>,
    ) -> Result<(), String> {
        Self::send_file_range(stream, file, size, request, progress_tx).await
    }
    
    /// 请求下载文件（多线程）
    pub async fn request_download(
        &self,
        peer_ip: String,
        peer_port: u16,
        request: TransferRequest,
        save_path: PathBuf,
        thread_count: usize,
    ) -> Result<String, Box<dyn std::error::Error>> {
        let request_id = request.request_id.clone();
        let file_size = request.file_size;
        
        log::info!("📥 开始多线程下载: {} ({} 线程)", request.file_name, thread_count);
        
        // 创建传输记录
        let transfer = ActiveTransfer {
            request_id: request_id.clone(),
            file_path: save_path.clone(),
            total_size: file_size,
            transferred_size: Arc::new(RwLock::new(0)),
            start_time: Instant::now(),
            last_update: Arc::new(RwLock::new(Instant::now())),
        };
        
        self.active_transfers.insert(request_id.clone(), transfer);
        
        // 创建临时文件
        let temp_file = File::create(&save_path).await?;
        temp_file.set_len(file_size).await?; // 预分配空间
        drop(temp_file);
        
        // 启动多线程下载
        let peer_addr = format!("{}:{}", peer_ip, peer_port);
        let active_transfers = self.active_transfers.clone();
        let progress_tx = self.progress_tx.clone();
        
        tokio::spawn(async move {
            if let Err(e) = Self::download_multi_thread(
                peer_addr,
                request,
                save_path,
                thread_count,
                active_transfers,
                progress_tx,
            ).await {
                log::error!("❌ 多线程下载失败: {}", e);
            }
        });
        
        Ok(request_id)
    }
    
    /// 多线程下载实现
    async fn download_multi_thread(
        peer_addr: String,
        request: TransferRequest,
        save_path: PathBuf,
        thread_count: usize,
        active_transfers: Arc<DashMap<String, ActiveTransfer>>,
        progress_tx: mpsc::UnboundedSender<TransferProgress>,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let file_size = request.file_size;
        let chunk_size = file_size / thread_count as u64;
        
        let mut handles = vec![];
        
        for thread_id in 0..thread_count {
            let start = thread_id as u64 * chunk_size;
            let end = if thread_id == thread_count - 1 {
                file_size
            } else {
                start + chunk_size
            };
            
            let mut thread_request = request.clone();
            thread_request.range_start = Some(start);
            thread_request.range_end = Some(end);
            thread_request.thread_id = Some(thread_id as u32);
            
            let addr = peer_addr.clone();
            let path = save_path.clone();
            let transfers = active_transfers.clone();
            let tx = progress_tx.clone();
            
            let handle = tokio::spawn(async move {
                match Self::download_range(addr, thread_request, path, start, transfers, tx).await {
                    Ok(_) => Ok(()),
                    Err(e) => Err(e.to_string()),
                }
            });
            
            handles.push(handle);
        }
        
        // 等待所有线程完成
        for handle in handles {
            match handle.await {
                Ok(Ok(_)) => {},
                Ok(Err(e)) => return Err(e.into()),
                Err(e) => return Err(e.to_string().into()),
            }
        }
        
        // 发送完成通知
        let _ = progress_tx.send(TransferProgress {
            request_id: request.request_id.clone(),
            file_name: request.file_name.clone(),
            total_size: file_size,
            transferred_size: file_size,
            progress: 100.0,
            speed: 0.0,
            status: "completed".to_string(),
        });
        
        log::info!("✅ 多线程下载完成: {}", request.file_name);
        Ok(())
    }
    
    /// 下载文件范围
    async fn download_range(
        peer_addr: String,
        request: TransferRequest,
        save_path: PathBuf,
        offset: u64,
        active_transfers: Arc<DashMap<String, ActiveTransfer>>,
        progress_tx: mpsc::UnboundedSender<TransferProgress>,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        // 连接到对端
        let mut stream = timeout(Duration::from_secs(10), TcpStream::connect(&peer_addr)).await??;
        
        // 发送请求
        let json = serde_json::to_vec(&request)?;
        let len = (json.len() as u32).to_le_bytes();
        stream.write_all(&len).await?;
        stream.write_all(&json).await?;
        
        // 接收数据
        let range_size = request.range_end.unwrap() - request.range_start.unwrap();
        let mut buffer = vec![0u8; CHUNK_SIZE];
        let mut received = 0u64;
        
        // 打开文件用于写入（使用tokio异步文件操作）
        let mut file = tokio::fs::OpenOptions::new()
            .write(true)
            .open(&save_path)
            .await?;
        
        // 使用tokio的seek
        use tokio::io::AsyncSeekExt;
        file.seek(std::io::SeekFrom::Start(offset)).await?;
        
        while received < range_size {
            let to_read = std::cmp::min(CHUNK_SIZE, (range_size - received) as usize);
            let n = stream.read(&mut buffer[..to_read]).await?;
            
            if n == 0 {
                break;
            }
            
            // 写入文件
            file.write_all(&buffer[..n]).await?;
            received += n as u64;
            
            // 更新进度
            if let Some(transfer) = active_transfers.get(&request.request_id) {
                let mut transferred = transfer.transferred_size.write();
                *transferred += n as u64;
                
                let mut last_update = transfer.last_update.write();
                if last_update.elapsed() >= Duration::from_millis(100) {
                    let elapsed = transfer.start_time.elapsed().as_secs_f64();
                    let speed = if elapsed > 0.0 { *transferred as f64 / elapsed } else { 0.0 };
                    
                    let _ = progress_tx.send(TransferProgress {
                        request_id: request.request_id.clone(),
                        file_name: request.file_name.clone(),
                        total_size: request.file_size,
                        transferred_size: *transferred,
                        progress: (*transferred as f64 / request.file_size as f64) * 100.0,
                        speed,
                        status: "transferring".to_string(),
                    });
                    
                    *last_update = Instant::now();
                }
            }
        }
        
        // 确保数据写入磁盘
        file.flush().await?;
        
        log::info!("✅ 线程 {} 下载完成", request.thread_id.unwrap_or(0));
        Ok(())
    }
}
