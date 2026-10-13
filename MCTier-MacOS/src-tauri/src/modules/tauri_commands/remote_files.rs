use super::shared::*;

/// 获取远程共享列表（通过HTTP API）
#[tauri::command]
pub async fn get_remote_shares(
    peer_ip: String,
    state: State<'_, AppState>,
) -> Result<Vec<SharedFolderSummary>, String> {
    log::debug!("📡 正在获取远程共享列表: {}", peer_ip);
    let target = require_file_peer_host(&peer_ip, &state).await?;
    let url = format!("http://{}:14539/api/shares", target.host);
    log::info!("🔗 请求URL: {}", url);

    // 设置超时时间为5秒
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .connect_timeout(std::time::Duration::from_secs(2))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| {
            log::error!("❌ 创建HTTP客户端失败: {}", e);
            format!("创建HTTP客户端失败: {}", e)
        })?;

    match client
        .get(&url)
        .header(
            crate::modules::file_transfer::LOBBY_TOKEN_HEADER,
            &target.token,
        )
        .send()
        .await
    {
        Ok(response) => {
            let status = response.status();
            log::info!("📥 收到响应，状态码: {}", status);

            if !status.is_success() {
                log::error!("❌ HTTP请求失败，状态码: {}", status);
                return Err(format!("HTTP请求失败: {}", status));
            }

            let body = match read_remote_body_limited(response, MAX_REMOTE_METADATA_BYTES).await {
                Ok(body) => body,
                Err(error) => {
                    log::error!("❌ 读取响应失败: {}", error);
                    return Err(format!("读取响应失败: {}", error));
                }
            };
            match serde_json::from_slice::<serde_json::Value>(&body) {
                Ok(json) => {
                    if let Some(shares) = json.get("shares") {
                        match serde_json::from_value::<Vec<SharedFolderSummary>>(shares.clone()) {
                            Ok(shares_vec) => {
                                log::debug!("✅ 成功获取 {} 个共享", shares_vec.len());
                                for (i, share) in shares_vec.iter().enumerate() {
                                    log::debug!("  {}. {} (ID: {})", i + 1, share.name, share.id);
                                }
                                Ok(shares_vec)
                            }
                            Err(e) => {
                                log::error!("❌ 解析共享列表失败: {}", e);
                                Err(format!("解析共享列表失败: {}", e))
                            }
                        }
                    } else {
                        log::warn!("⚠️ 响应中没有shares字段，返回空列表");
                        Ok(Vec::new())
                    }
                }
                Err(e) => {
                    log::error!("❌ 解析响应JSON失败: {}", e);
                    Err(format!("解析响应失败: {}", e))
                }
            }
        }
        Err(e) => {
            log::error!("❌ HTTP请求失败: {}", e);
            log::error!("💡 可能原因:");
            log::error!("   1. 对方的HTTP文件服务器未启动");
            log::error!("   2. 虚拟网络连接不通（尝试ping {}）", peer_ip);
            log::error!("   3. 防火墙阻止了14539端口");
            log::error!("   4. 对方的虚拟IP地址不正确");
            Err(format!("请求失败: {}", e))
        }
    }
}

/// 获取远程文件列表
#[tauri::command]
pub async fn get_remote_files(
    peer_ip: String,
    share_id: String,
    path: Option<String>,
    password: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<FileTransferFileInfo>, String> {
    log::info!("获取远程文件列表: {} / {} / {:?}", peer_ip, share_id, path);

    let target = require_file_peer_host(&peer_ip, &state).await?;
    let mut url = format!(
        "http://{}:14539/api/shares/{}/files",
        target.host,
        urlencoding::encode(&share_id)
    );
    if let Some(p) = path {
        url = format!("{}?path={}", url, urlencoding::encode(&p));
    }

    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(2))
        .timeout(std::time::Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| format!("创建HTTP客户端失败: {}", e))?;
    let mut req = client.get(&url).header(
        crate::modules::file_transfer::LOBBY_TOKEN_HEADER,
        &target.token,
    );
    // 携带共享密码头，否则有密码保护的共享会返回 401
    if let Some(pwd) = password {
        if !pwd.is_empty() {
            req = req.header("x-share-password", pwd);
        }
    }

    match req.send().await {
        Ok(response) => {
            if response.status().as_u16() == 401 {
                return Err("访问被拒绝：密码错误或未提供密码".to_string());
            }
            if response.status().as_u16() == 410 {
                return Err("共享已过期".to_string());
            }
            if !response.status().is_success() {
                return Err(format!("获取文件列表失败: HTTP {}", response.status()));
            }
            let body = match read_remote_body_limited(response, MAX_REMOTE_METADATA_BYTES).await {
                Ok(body) => body,
                Err(error) => {
                    log::error!("❌ 读取响应失败: {}", error);
                    return Err(format!("读取响应失败: {}", error));
                }
            };
            match serde_json::from_slice::<serde_json::Value>(&body) {
                Ok(json) => {
                    if let Some(files) = json.get("files") {
                        match serde_json::from_value::<Vec<FileTransferFileInfo>>(files.clone()) {
                            Ok(files_vec) => {
                                log::info!("✅ 获取到 {} 个文件", files_vec.len());
                                Ok(files_vec)
                            }
                            Err(e) => {
                                log::error!("❌ 解析文件列表失败: {}", e);
                                Err(format!("解析文件列表失败: {}", e))
                            }
                        }
                    } else {
                        Ok(Vec::new())
                    }
                }
                Err(e) => {
                    log::error!("❌ 解析响应失败: {}", e);
                    Err(format!("解析响应失败: {}", e))
                }
            }
        }
        Err(e) => {
            log::error!("❌ 请求失败: {}", e);
            Err(format!("请求失败: {}", e))
        }
    }
}

/// 验证共享密码
#[tauri::command]
pub async fn verify_share_password(
    peer_ip: String,
    share_id: String,
    password: String,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    log::debug!("验证共享密码: {} / {}", peer_ip, share_id);

    let target = require_file_peer_host(&peer_ip, &state).await?;
    let url = format!(
        "http://{}:14539/api/shares/{}/verify",
        target.host,
        urlencoding::encode(&share_id)
    );
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(2))
        .timeout(std::time::Duration::from_secs(5))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| format!("创建HTTP客户端失败: {}", e))?;

    let body = serde_json::json!({
        "password": password
    });

    match client
        .post(&url)
        .header(
            crate::modules::file_transfer::LOBBY_TOKEN_HEADER,
            &target.token,
        )
        .json(&body)
        .send()
        .await
    {
        Ok(response) => {
            if response.status().as_u16() == 410 {
                return Err("共享已过期".to_string());
            }
            if response.status().as_u16() == 401 {
                return Err("访问被拒绝：密码错误或未提供密码".to_string());
            }
            if !response.status().is_success() {
                return Err(format!("验证失败: HTTP {}", response.status()));
            }
            let body = match read_remote_body_limited(response, MAX_REMOTE_METADATA_BYTES).await {
                Ok(body) => body,
                Err(error) => {
                    log::error!("❌ 读取响应失败: {}", error);
                    return Err(format!("读取响应失败: {}", error));
                }
            };
            match serde_json::from_slice::<serde_json::Value>(&body) {
                Ok(json) => {
                    if let Some(success) = json.get("success").and_then(|v| v.as_bool()) {
                        log::info!("✅ 密码验证结果: {}", success);
                        Ok(success)
                    } else {
                        Err("无效的响应格式".to_string())
                    }
                }
                Err(e) => {
                    log::error!("❌ 解析响应失败: {}", e);
                    Err(format!("解析响应失败: {}", e))
                }
            }
        }
        Err(e) => {
            log::error!("❌ 请求失败: {}", e);
            Err(format!("请求失败: {}", e))
        }
    }
}

/// 获取文件下载URL
#[tauri::command]
pub async fn get_download_url(
    peer_ip: String,
    share_id: String,
    file_path: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let target = require_file_peer_host(&peer_ip, &state).await?;
    let url = format!(
        "http://{}:14539/api/shares/{}/download/{}",
        target.host,
        urlencoding::encode(&share_id),
        urlencoding::encode(&file_path)
    );
    Ok(url)
}

pub(crate) async fn read_remote_body_limited(
    response: reqwest::Response,
    limit: usize,
) -> Result<Vec<u8>, String> {
    use futures_util::StreamExt;

    if response
        .content_length()
        .is_some_and(|length| length > limit as u64)
    {
        return Err("远程响应超过元数据大小限制".to_string());
    }

    let mut body = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| format!("读取远程响应失败: {}", error))?;
        let next_len = body
            .len()
            .checked_add(chunk.len())
            .ok_or_else(|| "远程响应大小溢出".to_string())?;
        if next_len > limit {
            return Err("远程响应超过元数据大小限制".to_string());
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

/// Publish a completed download without replacing an existing destination.
///
/// The temporary file is created in the destination directory, so hard-linking
/// it is an atomic, same-filesystem publication on the supported desktop
/// platforms. Unlike rename on Unix, hard_link never replaces an existing
/// destination.
pub(crate) async fn commit_download_part_noreplace(
    part_path: &std::path::Path,
    destination: &std::path::Path,
) -> Result<(), String> {
    tokio::fs::hard_link(part_path, destination)
        .await
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::AlreadyExists {
                "目标文件已存在".to_string()
            } else {
                format!("提交下载文件失败: {}", error)
            }
        })?;

    if let Err(error) = tokio::fs::remove_file(part_path).await {
        // Keep the published destination intact. Removing it here could delete
        // a file that another process replaced between the link and cleanup.
        log::warn!("下载已提交，但清理临时硬链接失败: {}", error);
    }
    Ok(())
}

/// 流式下载远程文件到本地磁盘（边下边写，避免大文件占满内存导致 OOM/卡死）
///
/// - 自动携带共享密码头（x-share-password），解决有密码共享下载失败的问题
/// - 通过 `download-progress` 事件上报进度（taskId/downloaded/total）
/// - 支持通过 `cancel_remote_download` 取消
#[tauri::command]
pub async fn download_remote_file(
    task_id: String,
    peer_ip: String,
    share_id: String,
    file_path: String,
    save_path: String,
    password: Option<String>,
    expected_size: Option<u64>,
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    use futures_util::StreamExt;
    use tokio::io::AsyncWriteExt;

    log::info!(
        "⬇️ 开始流式下载: task={} {}/{} -> {}",
        task_id,
        peer_ip,
        share_id,
        save_path
    );

    let cancel_flag = Arc::new(AtomicBool::new(false));
    download_cancels().insert(task_id.clone(), cancel_flag.clone());

    // 用闭包包裹，确保无论成功失败都能清理取消标志
    let mut part_path: Option<std::path::PathBuf> = None;
    let mut committed = false;
    let result: Result<(), String> = async {
        let destination = require_path_grant(&save_path, PathAccess::WriteFile, true)?;
        let target = require_file_peer_host(&peer_ip, &state).await?;
        if expected_size.is_some_and(|size| size > MAX_REMOTE_FILE_BYTES) {
            return Err("文件超过远程下载大小限制".to_string());
        }

        let url = format!(
            "http://{}:14539/api/shares/{}/download/{}",
            target.host,
            urlencoding::encode(&share_id),
            urlencoding::encode(&file_path)
        );

        let client = reqwest::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(5))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|e| format!("创建HTTP客户端失败: {}", e))?;
        let mut req = client.get(&url).header(
            crate::modules::file_transfer::LOBBY_TOKEN_HEADER,
            &target.token,
        );
        if let Some(pwd) = &password {
            if !pwd.is_empty() {
                req = req.header("x-share-password", pwd);
            }
        }

        let resp = req.send().await.map_err(|e| format!("请求失败: {}", e))?;
        let status = resp.status();
        if status.as_u16() == 401 {
            return Err("访问被拒绝：密码错误或未提供密码".to_string());
        }
        if status.as_u16() == 410 {
            return Err("共享已过期".to_string());
        }
        if status == reqwest::StatusCode::PARTIAL_CONTENT {
            return Err("服务器返回了意外的部分响应".to_string());
        }
        if !status.is_success() {
            return Err(format!("下载失败: HTTP {}", status));
        }

        let content_length = resp.content_length();
        if content_length.is_some_and(|size| size > MAX_REMOTE_FILE_BYTES) {
            return Err("响应超过远程下载大小限制".to_string());
        }
        if let (Some(expected), Some(advertised)) = (expected_size, content_length) {
            if expected != advertised {
                return Err(format!(
                    "响应长度与预期不匹配: expected={}, advertised={}",
                    expected, advertised
                ));
            }
        }
        let total = expected_size.or(content_length).unwrap_or(0);

        if tokio::fs::try_exists(&destination)
            .await
            .map_err(|e| format!("检查目标文件失败: {}", e))?
        {
            return Err("目标文件已存在".to_string());
        }

        let file_name = destination
            .file_name()
            .and_then(|name| name.to_str())
            .filter(|name| !name.is_empty())
            .ok_or_else(|| "目标文件名无效".to_string())?;
        let parent = destination
            .parent()
            .ok_or_else(|| "目标目录无效".to_string())?;
        let candidate = parent.join(format!(".{}.{}.part", file_name, uuid::Uuid::new_v4()));
        part_path = Some(candidate.clone());
        let mut file = tokio::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&candidate)
            .await
            .map_err(|e| format!("创建下载临时文件失败: {}", e))?;

        let mut downloaded: u64 = 0;
        let mut stream = resp.bytes_stream();
        let mut last_emit = std::time::Instant::now();

        while let Some(chunk) = stream.next().await {
            // 检查取消
            if cancel_flag.load(Ordering::Relaxed) {
                return Err("已取消".to_string());
            }

            let chunk = chunk.map_err(|e| format!("下载中断: {}", e))?;
            let next_downloaded = downloaded
                .checked_add(chunk.len() as u64)
                .ok_or_else(|| "下载大小溢出".to_string())?;
            let limit = expected_size
                .or(content_length)
                .unwrap_or(MAX_REMOTE_FILE_BYTES);
            if next_downloaded > limit {
                return Err("响应内容超过预期长度".to_string());
            }
            file.write_all(&chunk)
                .await
                .map_err(|e| format!("写入文件失败: {}", e))?;
            downloaded = next_downloaded;

            // 每 200ms 上报一次进度
            if last_emit.elapsed().as_millis() >= 200 {
                let _ = app_handle.emit(
                    "download-progress",
                    serde_json::json!({
                        "taskId": task_id,
                        "downloaded": downloaded,
                        "total": total,
                    }),
                );
                last_emit = std::time::Instant::now();
            }
        }

        if cancel_flag.load(Ordering::Relaxed) {
            return Err("已取消".to_string());
        }
        if let Some(limit) = expected_size.or(content_length) {
            if downloaded != limit {
                return Err(format!(
                    "下载长度不匹配: expected={}, received={}",
                    limit, downloaded
                ));
            }
        }
        file.flush()
            .await
            .map_err(|e| format!("刷新文件失败: {}", e))?;
        file.sync_all()
            .await
            .map_err(|e| format!("同步文件失败: {}", e))?;

        commit_download_part_noreplace(&candidate, &destination).await?;
        committed = true;

        // 最后上报一次 100% 进度
        let _ = app_handle.emit(
            "download-progress",
            serde_json::json!({
                "taskId": task_id,
                "downloaded": downloaded,
                "total": if total == 0 { downloaded } else { total },
            }),
        );

        log::info!("✅ 流式下载完成: task={} ({} 字节)", task_id, downloaded);
        Ok(())
    }
    .await;

    if !committed {
        if let Some(path) = part_path {
            let _ = tokio::fs::remove_file(path).await;
        }
    }

    download_cancels().remove(&task_id);
    result
}

/// 取消正在进行的远程文件下载
#[tauri::command]
pub fn cancel_remote_download(task_id: String) {
    if let Some(flag) = download_cancels().get(&task_id) {
        flag.store(true, Ordering::Relaxed);
        log::info!("🛑 已请求取消下载: {}", task_id);
    }
}

/// 流式批量打包下载：POST file_paths 到对端 batch-download，边收边写盘到 save_path
#[tauri::command]
pub async fn download_remote_batch(
    task_id: String,
    peer_ip: String,
    share_id: String,
    file_paths: Vec<String>,
    save_path: String,
    password: Option<String>,
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    use futures_util::StreamExt;
    use tokio::io::AsyncWriteExt;

    log::info!(
        "⬇️ 开始流式批量下载: task={} {}/{} ({} 个文件)",
        task_id,
        peer_ip,
        share_id,
        file_paths.len()
    );

    if file_paths.is_empty() || file_paths.len() > MAX_REMOTE_BATCH_FILES {
        return Err("批量下载文件数量超过限制".to_string());
    }
    let request_body = serde_json::to_vec(&serde_json::json!({ "file_paths": file_paths }))
        .map_err(|_| "批量下载请求无法编码".to_string())?;
    if request_body.len() > MAX_REMOTE_BATCH_REQUEST_BYTES {
        return Err("批量下载请求过大".to_string());
    }

    let cancel_flag = Arc::new(AtomicBool::new(false));
    download_cancels().insert(task_id.clone(), cancel_flag.clone());

    let mut part_path: Option<std::path::PathBuf> = None;
    let mut committed = false;
    let result: Result<(), String> = async {
        let destination = require_path_grant(&save_path, PathAccess::WriteFile, true)?;
        let target = require_file_peer_host(&peer_ip, &state).await?;
        let url = format!(
            "http://{}:14539/api/shares/{}/batch-download",
            target.host,
            urlencoding::encode(&share_id)
        );
        let client = reqwest::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(5))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|e| format!("创建HTTP客户端失败: {}", e))?;
        let mut req = client
            .post(&url)
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .header(
                crate::modules::file_transfer::LOBBY_TOKEN_HEADER,
                &target.token,
            )
            .body(request_body);
        if let Some(pwd) = &password {
            if !pwd.is_empty() {
                req = req.header("x-share-password", pwd);
            }
        }

        let resp = req.send().await.map_err(|e| format!("请求失败: {}", e))?;
        let status = resp.status();
        if status.as_u16() == 401 {
            return Err("访问被拒绝：密码错误或未提供密码".to_string());
        }
        if status.as_u16() == 410 {
            return Err("共享已过期".to_string());
        }
        if status == reqwest::StatusCode::PARTIAL_CONTENT {
            return Err("服务器返回了意外的部分响应".to_string());
        }
        if !status.is_success() {
            return Err(format!("打包下载失败: HTTP {}", status));
        }

        let content_length = resp.content_length();
        if content_length.is_some_and(|size| size > MAX_REMOTE_BATCH_BYTES) {
            return Err("批量响应超过临时磁盘预算".to_string());
        }
        let total = content_length.unwrap_or(0);
        if tokio::fs::try_exists(&destination)
            .await
            .map_err(|e| format!("检查目标文件失败: {}", e))?
        {
            return Err("目标文件已存在".to_string());
        }
        let file_name = destination
            .file_name()
            .and_then(|name| name.to_str())
            .filter(|name| !name.is_empty())
            .ok_or_else(|| "目标文件名无效".to_string())?;
        let parent = destination
            .parent()
            .ok_or_else(|| "目标目录无效".to_string())?;
        let candidate = parent.join(format!(
            ".{}.{}.part",
            file_name,
            uuid::Uuid::new_v4()
        ));
        part_path = Some(candidate.clone());
        let mut file = tokio::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&candidate)
            .await
            .map_err(|e| format!("创建下载临时文件失败: {}", e))?;

        let mut downloaded: u64 = 0;
        let mut stream = resp.bytes_stream();
        let mut last_emit = std::time::Instant::now();
        while let Some(chunk) = stream.next().await {
            if cancel_flag.load(Ordering::Relaxed) {
                return Err("已取消".to_string());
            }
            let chunk = chunk.map_err(|e| format!("下载中断: {}", e))?;
            let next_downloaded = downloaded
                .checked_add(chunk.len() as u64)
                .ok_or_else(|| "下载大小溢出".to_string())?;
            let limit = content_length.unwrap_or(MAX_REMOTE_BATCH_BYTES);
            if next_downloaded > limit {
                return Err("响应内容超过声明长度或临时磁盘预算".to_string());
            }
            file.write_all(&chunk).await.map_err(|e| format!("写入文件失败: {}", e))?;
            downloaded = next_downloaded;
            if last_emit.elapsed().as_millis() >= 200 {
                let _ = app_handle.emit(
                    "download-progress",
                    serde_json::json!({ "taskId": task_id, "downloaded": downloaded, "total": total }),
                );
                last_emit = std::time::Instant::now();
            }
        }
        if cancel_flag.load(Ordering::Relaxed) {
            return Err("已取消".to_string());
        }
        if let Some(limit) = content_length {
            if downloaded != limit {
                return Err(format!(
                    "下载长度不匹配: expected={}, received={}",
                    limit, downloaded
                ));
            }
        }
        file.flush().await.map_err(|e| format!("刷新文件失败: {}", e))?;
        file.sync_all().await.map_err(|e| format!("同步文件失败: {}", e))?;
        commit_download_part_noreplace(&candidate, &destination).await?;
        committed = true;
        let _ = app_handle.emit(
            "download-progress",
            serde_json::json!({ "taskId": task_id, "downloaded": downloaded, "total": if total == 0 { downloaded } else { total } }),
        );
        log::info!("✅ 流式批量下载完成: task={} ({} 字节)", task_id, downloaded);
        Ok(())
    }
    .await;

    if !committed {
        if let Some(path) = part_path {
            let _ = tokio::fs::remove_file(path).await;
        }
    }

    download_cancels().remove(&task_id);
    result
}
