use super::remote_files::*;
use super::shared::*;

// ==================== P2P 聊天命令 ====================

use crate::modules::chat_auth::{
    SignedRequestHeaders, CHAT_KEY_ID_HEADER, CHAT_NONCE_HEADER, CHAT_SIGNATURE_HEADER,
    CHAT_TIMESTAMP_HEADER,
};

use crate::modules::chat_service::{
    is_message_id_for_player, valid_attachment_meta, ChatAttachmentMeta,
    ChatMessage as ChatServiceMessage, ChatPeerIdentity, MessageType, SendMessageRequest,
    CHAT_TOKEN_HEADER, MAX_ANNOUNCE_BYTES, MAX_AVATAR_BYTES, MAX_CHAT_ATTACHMENT_BYTES,
    MAX_CLIPBOARD_BYTES, MAX_FILE_CONTENT_BYTES, MAX_HISTORY_MESSAGES, MAX_IMAGE_BYTES,
    MAX_IMAGE_CONTENT_BYTES, MAX_RECALL_BYTES, MAX_TEXT_BYTES, MAX_TODO_BYTES,
    MAX_VOICE_GROUP_BYTES, MAX_WHITEBOARD_BYTES, RECALL_WINDOW_SECS,
};

/// Attach the per-member signature material to an outgoing chat request.
///
/// Kept in one helper so no call site can accidentally send a request that
/// carries the lobby token but no signature - the peer would reject it, and the
/// failure would look like a network problem rather than a coding mistake.
pub(crate) fn with_chat_signature(
    request: reqwest::RequestBuilder,
    signed: &SignedRequestHeaders,
) -> reqwest::RequestBuilder {
    request
        .header(CHAT_KEY_ID_HEADER, &signed.key_id)
        .header(CHAT_SIGNATURE_HEADER, &signed.signature)
        .header(CHAT_TIMESTAMP_HEADER, &signed.timestamp)
        .header(CHAT_NONCE_HEADER, &signed.nonce)
}

pub(crate) fn chat_http_host(raw: &str) -> Result<String, String> {
    let ip = raw
        .parse::<std::net::IpAddr>()
        .map_err(|_| "聊天目标不是有效的虚拟IP".to_string())?;
    if ip.is_unspecified() || ip.is_loopback() || ip.is_multicast() {
        return Err("聊天目标IP不在允许范围内".to_string());
    }
    Ok(match ip {
        std::net::IpAddr::V4(ip) => ip.to_string(),
        std::net::IpAddr::V6(ip) => format!("[{}]", ip),
    })
}

pub(crate) fn current_unix_seconds() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

pub(crate) fn validate_outgoing_chat_payload(
    message_type: &MessageType,
    content: &str,
    image_data: Option<&Vec<u8>>,
    local_player_id: &str,
    local_is_host: bool,
    local_messages: &[ChatServiceMessage],
) -> Result<(), String> {
    let content_bytes = content.as_bytes().len();
    match message_type {
        MessageType::Voice => {
            if !crate::modules::chat_service::valid_voice_payload(
                content,
                image_data.map(|v| v.as_slice()),
            ) {
                return Err("语音消息格式或时长无效".into());
            }
        }
        MessageType::File => {
            if content_bytes == 0 || content_bytes > MAX_FILE_CONTENT_BYTES || image_data.is_some()
            {
                return Err("文件消息元数据无效".to_string());
            }
            let meta: ChatAttachmentMeta =
                serde_json::from_str(content).map_err(|_| "文件消息元数据无法解析".to_string())?;
            if !valid_attachment_meta(&meta) {
                return Err("文件消息元数据无效".to_string());
            }
        }
        MessageType::Text => {
            if content_bytes == 0 || content_bytes > MAX_TEXT_BYTES || image_data.is_some() {
                return Err("文本消息为空、过长或包含多余图片数据".to_string());
            }
        }
        MessageType::Image => {
            if content_bytes > MAX_IMAGE_CONTENT_BYTES {
                return Err("图片消息说明过长".to_string());
            }
            let image = image_data.ok_or_else(|| "图片消息缺少图片数据".to_string())?;
            if image.is_empty() || image.len() > MAX_IMAGE_BYTES {
                return Err("图片数据大小无效".to_string());
            }
        }
        MessageType::Announce => {
            if content_bytes > MAX_ANNOUNCE_BYTES || image_data.is_some() {
                return Err("公告消息大小或数据类型无效".to_string());
            }
            if !local_is_host {
                return Err("只有房主可以发送公告".to_string());
            }
        }
        MessageType::VoiceGroup => {
            if content_bytes > MAX_VOICE_GROUP_BYTES || image_data.is_some() {
                return Err("语音小队消息大小或数据类型无效".to_string());
            }
            let group = content
                .parse::<u8>()
                .map_err(|_| "语音小队编号无效".to_string())?;
            if group > 4 {
                return Err("语音小队编号超出范围".to_string());
            }
        }
        MessageType::Clipboard => {
            if content_bytes > MAX_CLIPBOARD_BYTES || image_data.is_some() {
                return Err("剪贴板消息大小或数据类型无效".to_string());
            }
        }
        MessageType::Todo => {
            if content_bytes > MAX_TODO_BYTES || image_data.is_some() {
                return Err("待办消息大小或数据类型无效".to_string());
            }
        }
        MessageType::Whiteboard => {
            if content_bytes > MAX_WHITEBOARD_BYTES || image_data.is_some() {
                return Err("白板消息大小或数据类型无效".to_string());
            }
        }
        MessageType::Recall => {
            if content_bytes == 0 || content_bytes > MAX_RECALL_BYTES || image_data.is_some() {
                return Err("撤回消息参数无效".to_string());
            }
            let target = local_messages
                .iter()
                .find(|message| message.id == content)
                .ok_or_else(|| "只能撤回本地已知消息".to_string())?;
            if target.player_id != local_player_id
                || current_unix_seconds().saturating_sub(target.timestamp) > RECALL_WINDOW_SECS
            {
                return Err("只能撤回自己两分钟内发送的消息".to_string());
            }
        }
        MessageType::Avatar => {
            if content_bytes > MAX_AVATAR_BYTES || image_data.is_some() {
                return Err("头像消息大小或数据类型无效".to_string());
            }
            if !content.is_empty() && !content.starts_with("data:image/") {
                return Err("头像消息必须使用图片 data URL".to_string());
            }
        }
    }
    Ok(())
}

/// Create (or reuse) this session's chat signing key and return its public half.
///
/// The renderer must call this *before* registering with signaling, because the
/// public key has to travel inside the authenticated `register` message: that
/// is what binds the key to a player id nobody else can claim. The private key
/// never leaves the backend.
#[tauri::command]
pub async fn prepare_p2p_chat_identity(state: State<'_, AppState>) -> Result<String, String> {
    let chat_service = {
        let core = state.core.lock().await;
        core.get_chat_service()
    };
    let key = chat_service.lock().await.ensure_signing_key();
    key
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignalingIdentity {
    pub client_id: String,
    pub identity_public_key: String,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignalingRegistrationProof {
    pub client_id: String,
    pub identity_public_key: String,
    pub challenge_signature: String,
}

#[tauri::command]
pub async fn prepare_signaling_identity(
    state: State<'_, AppState>,
) -> Result<SignalingIdentity, String> {
    log::info!("信令身份请求已收到");
    log::info!("信令身份请求：等待核心状态锁");
    let chat_service = {
        let core = state.core.lock().await;
        log::info!("信令身份请求：已取得核心状态锁");
        core.get_chat_service()
    };
    log::info!("信令身份请求：等待聊天服务锁");
    let (client_id, identity_public_key) = chat_service.lock().await.signaling_identity()?;
    log::info!("信令身份请求成功: client_id={}", client_id);
    Ok(SignalingIdentity {
        client_id,
        identity_public_key,
    })
}

#[tauri::command]
pub async fn sign_signaling_registration(
    challenge: String,
    lobby_name: String,
    virtual_ip: String,
    state: State<'_, AppState>,
) -> Result<SignalingRegistrationProof, String> {
    log::info!(
        "信令注册签名请求已收到: lobby={}, virtual_ip={}",
        lobby_name,
        virtual_ip
    );
    if challenge.len() != 64
        || !challenge
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        return Err("信令 challenge 格式无效".to_string());
    }
    if lobby_name.is_empty()
        || lobby_name.chars().count() > 128
        || lobby_name
            .chars()
            .any(|ch| ch == '\r' || ch == '\n' || ch == '\0')
    {
        return Err("大厅名称不适合用于信令签名".to_string());
    }
    let normalized_ip = virtual_ip
        .parse::<std::net::Ipv4Addr>()
        .map_err(|_| "虚拟 IP 格式无效".to_string())?
        .to_string();

    log::info!("信令注册签名：等待核心状态锁");
    let chat_service = {
        let core = state.core.lock().await;
        log::info!("信令注册签名：已取得核心状态锁");
        core.get_chat_service()
    };
    log::info!("信令注册签名：等待聊天服务锁");
    let (client_id, identity_public_key, challenge_signature) = chat_service
        .lock()
        .await
        .sign_signaling_registration(&challenge, &lobby_name, &normalized_ip)?;
    log::info!("信令注册签名请求成功: client_id={}", client_id);
    Ok(SignalingRegistrationProof {
        client_id,
        identity_public_key,
        challenge_signature,
    })
}

#[tauri::command]
pub async fn configure_p2p_chat(
    chat_token: String,
    chat_token_epoch: u64,
    player_id: String,
    player_name: String,
    host_id: Option<String>,
    peers: Vec<ChatPeerIdentity>,
    reset_auth_baseline: Option<bool>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if peers.len() > MAX_CHAT_TARGETS {
        return Err("大厅聊天成员数量超过限制".to_string());
    }
    let file_token = chat_token.clone();
    let (chat_service, file_transfer) = {
        let core = state.core.lock().await;
        (core.get_chat_service(), core.get_file_transfer())
    };
    let reset_auth = reset_auth_baseline.unwrap_or(false);
    {
        log::info!("配置聊天会话：等待聊天服务锁");
        let chat_svc = chat_service.lock().await;
        log::info!("配置聊天会话：已取得聊天服务锁");
        if reset_auth {
            log::info!("配置聊天会话：重置认证基线");
            chat_svc.reset_auth_baseline().await;
        }
        log::info!("配置聊天会话：安装令牌和成员列表");
        chat_svc.set_session(
            chat_token,
            chat_token_epoch,
            player_id,
            player_name,
            host_id,
            peers,
        )?;
    }

    // Never hold the chat lock while waiting for the file service (or while
    // binding the HTTP listener). Signaling reconnects need the same chat
    // lock to sign their challenge, so cross-service lock ordering here would
    // otherwise stall registration indefinitely.
    {
        log::info!("配置聊天会话：启动聊天 HTTP 服务");
        let chat_svc = chat_service.lock().await;
        chat_svc
            .start_server()
            .await
            .map_err(|error| format!("启动聊天服务失败: {}", error))?;
        log::info!("配置聊天会话：聊天 HTTP 服务已启动");
    }

    let file_svc = file_transfer.lock().await;
    if reset_auth {
        file_svc.clear_lobby_token();
    }
    file_svc.set_lobby_token(file_token)
}

#[tauri::command]
pub async fn update_p2p_chat_peers(
    peers: Vec<ChatPeerIdentity>,
    host_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if peers.len() > MAX_CHAT_TARGETS {
        return Err("大厅聊天成员数量超过限制".to_string());
    }
    let chat_service = {
        let core = state.core.lock().await;
        core.get_chat_service()
    };
    let chat_svc = chat_service.lock().await;
    chat_svc.update_peer_identities(peers, host_id)
}

#[tauri::command]
pub async fn stop_p2p_chat(
    preserve_signing_identity: Option<bool>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let (chat_service, file_transfer) = {
        let core = state.core.lock().await;
        (core.get_chat_service(), core.get_file_transfer())
    };
    file_transfer.lock().await.clear_lobby_token();
    let chat_svc = chat_service.lock().await;
    if preserve_signing_identity.unwrap_or(false) {
        // Revoke all request authorization, but keep the fingerprint reserved
        // for this lobby so a failed registration can retry with the same identity.
        chat_svc.reset_auth_baseline().await;
    } else {
        chat_svc.stop_server().await;
    }
    Ok(())
}

fn chat_file_mime(name: &str) -> String {
    let extension = std::path::Path::new(name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match extension.as_str() {
        "mp3" => "audio/mpeg",
        "m4a" | "aac" => "audio/mp4",
        "wav" => "audio/wav",
        "ogg" | "oga" | "opus" => "audio/ogg",
        "flac" => "audio/flac",
        "mp4" | "m4v" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        "mkv" => "video/x-matroska",
        "avi" => "video/x-msvideo",
        "pdf" => "application/pdf",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "doc" => "application/msword",
        "xls" => "application/vnd.ms-excel",
        "ppt" => "application/vnd.ms-powerpoint",
        "txt" | "log" | "ini" | "conf" => "text/plain",
        "md" => "text/markdown",
        "csv" => "text/csv",
        "json" => "application/json",
        "xml" => "application/xml",
        "html" | "htm" => "text/html",
        "js" | "ts" | "jsx" | "tsx" | "css" | "rs" | "kt" | "java" | "py" | "go" | "c" | "h"
        | "cpp" | "hpp" | "toml" | "yaml" | "yml" => "text/plain",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "zip" => "application/zip",
        "7z" => "application/x-7z-compressed",
        "rar" => "application/vnd.rar",
        _ => "application/octet-stream",
    }
    .to_string()
}

fn safe_chat_file_name(path: &std::path::Path) -> Result<String, String> {
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or("文件名无效")?;
    let name = name.trim();
    if name.is_empty()
        || name.chars().count() > 180
        || name
            .chars()
            .any(|ch| ch.is_control() || matches!(ch, '/' | '\\' | ':'))
    {
        return Err("文件名包含不安全字符或过长".to_string());
    }
    Ok(name.to_string())
}

#[tauri::command]
pub async fn select_chat_attachment(
    recipient_id: Option<String>,
    _app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<ChatAttachmentMeta>, String> {
    let Some(source) = rfd::FileDialog::new().set_title("发送文件").pick_file() else {
        return Ok(None);
    };
    let source_meta =
        std::fs::symlink_metadata(&source).map_err(|error| format!("读取文件失败: {error}"))?;
    if !source_meta.is_file()
        || source_meta.file_type().is_symlink()
        || source_meta.len() == 0
        || source_meta.len() > MAX_CHAT_ATTACHMENT_BYTES
    {
        return Err("仅支持 1 B 至 64 MiB 的普通文件".to_string());
    }
    let mut name = safe_chat_file_name(&source)?;
    let id = format!("att-{}", uuid::Uuid::new_v4());
    let mut meta = ChatAttachmentMeta {
        id: id.clone(),
        name: name.clone(),
        mime: chat_file_mime(&name),
        size: source_meta.len(),
    };
    let directory = crate::modules::app_paths::data_root()
        .map_err(|error| format!("无法获取缓存目录: {error}"))?
        .join("chat-attachments");
    std::fs::create_dir_all(&directory).map_err(|error| format!("创建附件缓存失败: {error}"))?;
    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .filter(|value| value.len() <= 16)
        .unwrap_or("bin");
    let mut cached = directory.join(format!("{id}.{extension}"));
    std::fs::copy(&source, &cached).map_err(|error| format!("缓存聊天附件失败: {error}"))?;
    let optimized = tauri::async_runtime::spawn_blocking({
        let cached = cached.clone();
        move || {
            use std::io::Read;
            let mut header = [0u8; 12];
            std::fs::File::open(&cached)
                .ok()?
                .read_exact(&mut header)
                .ok()?;
            mctier_image_optimizer::mime(&header)?;
            let bytes = std::fs::read(cached).ok()?;
            let original_mime = mctier_image_optimizer::mime(&bytes)?;
            let optimized = mctier_image_optimizer::optimize(&bytes)?;
            let mime = mctier_image_optimizer::mime(&optimized)?;
            Some((optimized, mime, original_mime))
        }
    })
    .await
    .map_err(|error| error.to_string())?;
    if let Some((optimized, mime, original_mime)) = optimized {
        std::fs::write(&cached, &optimized)
            .map_err(|error| format!("缓存优化图片失败: {error}"))?;
        if original_mime != mime {
            let stem: String = source
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("image")
                .chars()
                .take(170)
                .collect();
            name = format!("{stem}.{}", mctier_image_optimizer::extension(mime));
            let renamed =
                directory.join(format!("{id}.{}", mctier_image_optimizer::extension(mime)));
            std::fs::rename(&cached, &renamed).map_err(|error| error.to_string())?;
            cached = renamed;
        }
        meta.name = name;
        meta.mime = mime.to_string();
        meta.size = optimized.len() as u64;
    }
    let chat_service = { state.core.lock().await.get_chat_service() };
    chat_service
        .lock()
        .await
        .register_attachment(meta.clone(), cached, recipient_id)?;
    Ok(Some(meta))
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedChatImage {
    image_data_url: Option<String>,
    attachment: Option<ChatAttachmentMeta>,
}

/// Optimize before applying the inline wire limit. Large lossless images use
/// the existing attachment channel rather than being resized or degraded.
#[tauri::command]
pub async fn prepare_chat_image(
    image_data: String,
    recipient_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<PreparedChatImage, String> {
    use base64::Engine;
    if image_data.len() > mctier_image_optimizer::MAX_INPUT_BYTES.div_ceil(3) * 4 {
        return Err("图片超过 64 MiB，请使用文件共享".into());
    }
    let (bytes, mime) = tauri::async_runtime::spawn_blocking(move || {
        let source = base64::engine::general_purpose::STANDARD
            .decode(image_data)
            .map_err(|_| "图片编码无效")?;
        if source.is_empty() || source.len() > mctier_image_optimizer::MAX_INPUT_BYTES {
            return Err("图片大小无效");
        }
        mctier_image_optimizer::mime(&source).ok_or("不支持此图片格式")?;
        let bytes = mctier_image_optimizer::optimize(&source).unwrap_or(source);
        let mime = mctier_image_optimizer::mime(&bytes).ok_or("图片格式无效")?;
        Ok::<_, &str>((bytes, mime))
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(str::to_string)?;
    if bytes.len() <= 2 * 1024 * 1024 {
        return Ok(PreparedChatImage {
            image_data_url: Some(format!(
                "data:{mime};base64,{}",
                base64::engine::general_purpose::STANDARD.encode(bytes)
            )),
            attachment: None,
        });
    }
    let id = format!("att-{}", uuid::Uuid::new_v4());
    let extension = mctier_image_optimizer::extension(mime);
    let directory = crate::modules::app_paths::data_root()
        .map_err(|error| error.to_string())?
        .join("chat-attachments");
    tokio::fs::create_dir_all(&directory)
        .await
        .map_err(|error| error.to_string())?;
    let cached = directory.join(format!("{id}.{extension}"));
    let meta = ChatAttachmentMeta {
        id,
        name: format!("image.{extension}"),
        mime: mime.to_string(),
        size: bytes.len() as u64,
    };
    tokio::fs::write(&cached, bytes)
        .await
        .map_err(|error| error.to_string())?;
    let service = state.core.lock().await.get_chat_service();
    service
        .lock()
        .await
        .register_attachment(meta.clone(), cached, recipient_id)?;
    Ok(PreparedChatImage {
        image_data_url: None,
        attachment: Some(meta),
    })
}

async fn ensure_chat_attachment_cached(
    owner_player_id: &str,
    meta: &ChatAttachmentMeta,
    _app: &tauri::AppHandle,
    state: &AppState,
) -> Result<std::path::PathBuf, String> {
    if !valid_attachment_meta(meta) {
        return Err("文件附件元数据无效".to_string());
    }
    let chat_service = { state.core.lock().await.get_chat_service() };
    let chat = chat_service.lock().await;
    let local = chat.get_local_identity().ok_or("聊天会话尚未初始化")?;
    if local.player_id == owner_player_id {
        return chat
            .local_attachment_path(meta)
            .ok_or_else(|| "本地附件已失效".to_string());
    }
    let peer = chat
        .peer_by_player_id(owner_player_id)
        .ok_or("附件发送者已离开大厅")?;
    let token = chat.get_chat_token().ok_or("聊天令牌尚未就绪")?;
    drop(chat);
    let directory = crate::modules::app_paths::data_root()
        .map_err(|error| format!("无法获取缓存目录: {error}"))?
        .join("chat-attachments");
    let extension = std::path::Path::new(&meta.name)
        .extension()
        .and_then(|value| value.to_str())
        .filter(|value| value.len() <= 16)
        .unwrap_or("bin");
    let cached = directory.join(format!(
        "{}-{}.{}",
        owner_player_id.replace(|ch: char| !ch.is_ascii_alphanumeric(), "_"),
        meta.id,
        extension
    ));
    if std::fs::metadata(&cached)
        .is_ok_and(|metadata| metadata.is_file() && metadata.len() == meta.size)
    {
        return Ok(cached);
    }
    let path = format!("/api/chat/attachment/{}", meta.id);
    let signed = chat_service
        .lock()
        .await
        .sign_request("GET", &path, &peer.virtual_ip, &[])
        .ok_or("聊天签名不可用")?;
    let host = chat_http_host(&peer.virtual_ip)?;
    let response = with_chat_signature(
        reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(60))
            .connect_timeout(std::time::Duration::from_secs(4))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|error| format!("创建附件客户端失败: {error}"))?
            .get(format!("http://{host}:14540{path}"))
            .header(CHAT_TOKEN_HEADER, token),
        &signed,
    )
    .send()
    .await
    .map_err(|error| format!("获取聊天附件失败: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("获取聊天附件失败: HTTP {}", response.status()));
    }
    let encrypted = read_remote_body_limited(response, MAX_CHAT_ATTACHMENT_RESPONSE_BYTES).await?;
    let plain = chat_service
        .lock()
        .await
        .decrypt_from_peer(&peer, &path, &encrypted)?;
    if plain.len() as u64 != meta.size || plain.len() as u64 > MAX_CHAT_ATTACHMENT_BYTES {
        return Err("附件实际大小与消息元数据不一致".to_string());
    }
    tokio::fs::create_dir_all(&directory)
        .await
        .map_err(|error| format!("创建附件缓存失败: {error}"))?;
    tokio::fs::write(&cached, plain)
        .await
        .map_err(|error| format!("写入附件缓存失败: {error}"))?;
    Ok(cached)
}

#[tauri::command]
pub async fn fetch_chat_attachment(
    owner_player_id: String,
    attachment: ChatAttachmentMeta,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let path = ensure_chat_attachment_cached(&owner_player_id, &attachment, &app, &state).await?;
    path.to_str()
        .map(str::to_string)
        .ok_or_else(|| "附件缓存路径无效".to_string())
}

#[tauri::command]
pub async fn save_chat_attachment(
    owner_player_id: String,
    attachment: ChatAttachmentMeta,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<String>, String> {
    let cached = ensure_chat_attachment_cached(&owner_player_id, &attachment, &app, &state).await?;
    let Some(destination) = rfd::FileDialog::new()
        .set_title("下载文件")
        .set_file_name(&attachment.name)
        .save_file()
    else {
        return Ok(None);
    };
    std::fs::copy(&cached, &destination).map_err(|error| format!("保存文件失败: {error}"))?;
    Ok(destination.to_str().map(str::to_string))
}

/// A notification click saves the authenticated original directly into Downloads.
#[tauri::command]
pub async fn download_danmaku_attachment(
    owner_player_id: String,
    attachment: ChatAttachmentMeta,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let cached = ensure_chat_attachment_cached(&owner_player_id, &attachment, &app, &state).await?;
    let directory = dirs::download_dir().ok_or("无法定位下载文件夹")?.join("MCTier");
    tokio::fs::create_dir_all(&directory).await.map_err(|e| e.to_string())?;
    // Prefix a unique ID: never overwrite another download, even for repeated clicks.
    let destination = directory.join(format!("{}_{}", uuid::Uuid::new_v4(), attachment.name));
    tokio::fs::copy(cached, &destination).await.map_err(|e| format!("下载失败: {e}"))?;
    Ok(destination.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn preview_spreadsheet_attachment(
    owner_player_id: String,
    attachment: ChatAttachmentMeta,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    use calamine::Reader;

    let extension = std::path::Path::new(&attachment.name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !matches!(extension.as_str(), "xls" | "xlsx" | "xlsb" | "ods") {
        return Err("不支持的电子表格格式".into());
    }
    let cached = ensure_chat_attachment_cached(&owner_player_id, &attachment, &app, &state).await?;
    tokio::task::spawn_blocking(move || {
        let mut workbook = calamine::open_workbook_auto(&cached)
            .map_err(|error| format!("无法解析电子表格: {error}"))?;
        let sheet_names = workbook.sheet_names().to_vec();
        let mut sections = Vec::new();
        for (sheet_index, sheet_name) in sheet_names.into_iter().take(50).enumerate() {
            let range = workbook
                .worksheet_range(&sheet_name)
                .map_err(|error| format!("无法读取工作表: {error}"))?;
            let rows = range
                .rows()
                .take(500)
                .map(|row| {
                    row.iter()
                        .take(50)
                        .map(ToString::to_string)
                        .collect::<Vec<_>>()
                        .join("\t")
                })
                .collect::<Vec<_>>();
            if rows.iter().any(|row| !row.trim().is_empty()) {
                sections.push(format!("--- {} ---\n{}", sheet_index + 1, rows.join("\n")));
            }
        }
        if sections.is_empty() {
            return Err("电子表格中没有可预览的工作表".into());
        }
        Ok(sections)
    })
    .await
    .map_err(|error| format!("电子表格预览任务失败: {error}"))?
}

#[tauri::command]
pub async fn preview_office_attachment(
    owner_player_id: String,
    attachment: ChatAttachmentMeta,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let extension = std::path::Path::new(&attachment.name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let kind = match extension.as_str() {
        "doc" | "docx" | "odt" | "rtf" => "word",
        "ppt" | "pptx" | "odp" => "powerpoint",
        _ => return Err("该格式不需要系统 Office 转换".into()),
    };
    let cached = ensure_chat_attachment_cached(&owner_player_id, &attachment, &app, &state).await?;
    let directory = crate::modules::app_paths::data_root()
        .map_err(|error| format!("无法获取缓存目录: {error}"))?
        .join("office-previews");
    tokio::fs::create_dir_all(&directory)
        .await
        .map_err(|error| format!("无法创建文档预览缓存: {error}"))?;
    let output_path = directory.join(format!("{}.pdf", attachment.id));

    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let script = r#"$source=$env:MCTIER_OFFICE_SOURCE
$destination=$env:MCTIER_OFFICE_DESTINATION
$kind=$env:MCTIER_OFFICE_KIND
$ErrorActionPreference='Stop'
$application=$null
$document=$null
try {
  if ($kind -eq 'word') {
    $application=New-Object -ComObject Word.Application
    $application.AutomationSecurity=3
    $application.Visible=$false
    $document=$application.Documents.Open($source,$false,$true)
    $document.ExportAsFixedFormat($destination,17)
  } elseif ($kind -eq 'powerpoint') {
    $application=New-Object -ComObject PowerPoint.Application
    $application.AutomationSecurity=3
    $document=$application.Presentations.Open($source,$true,$false,$false)
    $document.SaveAs($destination,32)
  } else { throw 'Unsupported Office kind' }
} finally {
  if ($null -ne $document) { $document.Close() }
  if ($null -ne $application) { $application.Quit() }
}"#;
        let result = tokio::time::timeout(
            std::time::Duration::from_secs(35),
            tokio::process::Command::new(windows_system_command(
                "WindowsPowerShell\\v1.0\\powershell.exe",
            ))
            .args([
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                script,
            ])
            .env("MCTIER_OFFICE_SOURCE", &cached)
            .env("MCTIER_OFFICE_DESTINATION", &output_path)
            .env("MCTIER_OFFICE_KIND", kind)
            .kill_on_drop(true)
            .creation_flags(CREATE_NO_WINDOW)
            .output(),
        )
        .await
        .map_err(|_| "Office 文档转换超时".to_string())?
        .map_err(|error| format!("无法启动系统 Office 预览转换: {error}"))?;
        if !result.status.success() || !output_path.is_file() {
            return Err("无法生成文档预览，请确认已安装 Microsoft Office".into());
        }
        return output_path
            .to_str()
            .map(str::to_string)
            .ok_or_else(|| "预览路径无效".into());
    }

    #[cfg(not(windows))]
    {
        let _ = (cached, output_path, kind);
        Err("当前系统没有可用的旧版 Office 文档转换器".into())
    }
}

#[tauri::command]
pub async fn transcribe_voice_message(
    wav_data: Vec<u8>,
    language: String,
    app: tauri::AppHandle,
    progress: tauri::ipc::Channel<crate::modules::speech_transcription::SpeechProgress>,
) -> Result<String, String> {
    if wav_data.len() < 44
        || wav_data.len() > 4 * 1024 * 1024
        || &wav_data[..4] != b"RIFF"
        || &wav_data[8..12] != b"WAVE"
    {
        return Err("语音数据格式无效".into());
    }
    if !matches!(language.as_str(), "zh-CN" | "en-US") {
        return Err("不支持的识别语言".into());
    }
    crate::modules::speech_transcription::transcribe(wav_data, app, progress).await
}

/// 发送P2P聊天消息
///
/// # 参数
/// * `player_id` - 玩家ID
/// * `player_name` - 玩家名称
/// * `content` - 消息内容
/// * `message_type` - 消息类型（text/image）
/// * `image_data` - 图片数据（可选）
/// * `peer_ips` - 目标玩家的虚拟IP列表
///
/// # 返回
/// * `Ok(())` - 发送成功
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn send_p2p_chat_message(
    player_id: String,
    player_name: String,
    content: String,
    message_type: String,
    image_data: Option<Vec<u8>>,
    message_id: Option<String>,
    recipient_id: Option<String>,
    peer_ips: Vec<String>,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let _ = player_name;
    if peer_ips.len() > MAX_CHAT_TARGETS {
        return Err("聊天目标数量超过限制".to_string());
    }

    let core = state.core.lock().await;
    let chat_service = core.get_chat_service();
    let chat_svc = chat_service.lock().await;

    // The renderer supplies these fields for wire compatibility only. The
    // active chat session is the authority for both identity and targets.
    let local_identity = chat_svc
        .get_local_identity()
        .ok_or_else(|| "聊天会话尚未初始化".to_string())?;
    if player_id != local_identity.player_id {
        return Err("聊天发送者身份与当前会话不匹配".to_string());
    }
    let chat_token = chat_svc
        .get_chat_token()
        .ok_or_else(|| "聊天令牌尚未就绪".to_string())?;
    let local_is_host = chat_svc.local_is_host();

    let msg_type = match message_type.as_str() {
        "text" => MessageType::Text,
        "image" => MessageType::Image,
        "voice" => MessageType::Voice,
        "file" => MessageType::File,
        "announce" => MessageType::Announce,
        "voicegroup" => MessageType::VoiceGroup,
        "clipboard" => MessageType::Clipboard,
        "todo" => MessageType::Todo,
        "whiteboard" => MessageType::Whiteboard,
        "recall" => MessageType::Recall,
        "avatar" => MessageType::Avatar,
        _ => return Err("聊天消息类型无效".to_string()),
    };

    let local_messages = chat_svc.get_local_messages(None);
    validate_outgoing_chat_payload(
        &msg_type,
        &content,
        image_data.as_ref(),
        &local_identity.player_id,
        local_is_host,
        &local_messages,
    )?;
    if matches!(msg_type, MessageType::File) {
        let meta: ChatAttachmentMeta =
            serde_json::from_str(&content).map_err(|_| "文件消息元数据无法解析".to_string())?;
        if !chat_svc.has_attachment(&meta.id, recipient_id.as_deref()) {
            return Err("文件附件未注册或收件人不匹配".to_string());
        }
    }

    let message_id = message_id
        .filter(|id| !id.is_empty())
        .unwrap_or_else(|| format!("msg-{}-{}", local_identity.player_id, uuid::Uuid::new_v4()));
    if !is_message_id_for_player(&message_id, &local_identity.player_id) {
        return Err("聊天消息ID无效".to_string());
    }

    // The renderer may request a subset for UI reasons, but it never chooses
    // network destinations. Broadcast to the authoritative signaling roster.
    let mut authoritative_peers = chat_svc.authoritative_peers();
    if let Some(target) = recipient_id.as_ref() {
        if !matches!(
            msg_type,
            MessageType::Text
                | MessageType::Image
                | MessageType::Voice
                | MessageType::File
                | MessageType::Recall
        ) {
            return Err("此消息类型不支持私聊".to_string());
        }
        authoritative_peers.retain(|peer| &peer.player_id == target);
        if authoritative_peers.len() != 1 {
            return Err("私聊对象已离开大厅".to_string());
        }
    }

    let message = ChatServiceMessage {
        id: message_id.clone(),
        player_id: local_identity.player_id.clone(),
        player_name: local_identity.player_name.clone(),
        content: content.clone(),
        message_type: msg_type.clone(),
        timestamp: current_unix_seconds(),
        image_data: image_data.clone(),
        recipient_id: recipient_id.clone(),
    };

    // Keep an origin copy of every validated message. Remote history fetches
    // accept only messages authored by the queried peer, preventing one peer
    // from forging another member's history.
    if !chat_svc.add_local_message(message) {
        return Err("聊天消息ID重复或本地历史已满".to_string());
    }

    drop(chat_svc);
    drop(core);

    log::info!(
        "📤 [ChatService] 向 {} 个已授权玩家发送 {} 字节消息",
        authoritative_peers.len(),
        content.as_bytes().len()
    );

    let total = authoritative_peers.len();

    // 【优化】使用并发发送，提高图片传输速度
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10)) // 设置超时
        .connect_timeout(std::time::Duration::from_secs(3))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| format!("创建HTTP客户端失败: {}", e))?;

    let mut tasks = Vec::new();

    for peer in authoritative_peers {
        let peer_ip = peer.virtual_ip.clone();
        let host = chat_http_host(&peer_ip)?;
        let url = format!("http://{}:14540/api/chat/send", host);
        let request = SendMessageRequest {
            id: Some(message_id.clone()),
            player_id: local_identity.player_id.clone(),
            player_name: local_identity.player_name.clone(),
            content: content.clone(),
            message_type: msg_type.clone(),
            image_data: image_data.clone(),
            recipient_id: recipient_id.clone(),
        };
        // Serialize once and send those exact bytes, because the signature
        // covers a digest of the body: letting reqwest re-serialize could in
        // principle emit different bytes and break verification.
        let body = serde_json::to_vec(&request)
            .map_err(|error| format!("序列化聊天消息失败: {}", error))?;
        let body = chat_service
            .lock()
            .await
            .encrypt_for_peer(&peer, "/api/chat/send", &body)?;

        let client_clone = client.clone();
        let url_clone = url.clone();
        let chat_token_clone = chat_token.clone();
        let chat_service_clone = Arc::clone(&chat_service);
        let audience = peer_ip.clone();

        // 创建并发任务，返回是否送达成功（带一次快速重试，降低瞬时抖动导致的漏发）
        let task = tokio::spawn(async move {
            for attempt in 0..2 {
                // Sign per attempt: the nonce is single-use at the receiver, so
                // reusing one signature for the retry would look like a replay.
                let signed = match chat_service_clone.lock().await.sign_request(
                    "POST",
                    "/api/chat/send",
                    &audience,
                    &body,
                ) {
                    Some(signed) => signed,
                    None => {
                        log::warn!("⚠️ 聊天签名不可用，放弃发送到 {}", url_clone);
                        return false;
                    }
                };
                let start = std::time::Instant::now();
                match with_chat_signature(
                    client_clone
                        .post(&url_clone)
                        .header(CHAT_TOKEN_HEADER, &chat_token_clone)
                        .header(reqwest::header::CONTENT_TYPE, "application/json")
                        .body(body.clone()),
                    &signed,
                )
                .send()
                .await
                {
                    Ok(response) => {
                        let elapsed = start.elapsed();
                        if response.status().is_success() {
                            log::info!(
                                "✅ 消息已发送到: {} (耗时: {:?}, 第{}次)",
                                url_clone,
                                elapsed,
                                attempt + 1
                            );
                            return true;
                        } else {
                            log::warn!(
                                "⚠️ 发送消息失败 ({}): HTTP {} (第{}次)",
                                url_clone,
                                response.status(),
                                attempt + 1
                            );
                        }
                    }
                    Err(e) => {
                        let elapsed = start.elapsed();
                        log::warn!(
                            "⚠️ 发送消息失败 ({}, 耗时: {:?}, 第{}次): {}",
                            url_clone,
                            elapsed,
                            attempt + 1,
                            e
                        );
                    }
                }
                if attempt == 0 {
                    // 第一次失败后稍等再重试一次
                    tokio::time::sleep(std::time::Duration::from_millis(400)).await;
                }
            }
            false
        });

        tasks.push(task);
    }

    // 等待所有发送完成，统计送达数量（用于给前端回执）
    let mut delivered = 0usize;
    for task in tasks {
        if let Ok(true) = task.await {
            delivered += 1;
        }
    }
    log::info!(
        "🎉 [ChatService] 消息发送完成：送达 {}/{}",
        delivered,
        total
    );

    Ok(serde_json::json!({ "delivered": delivered, "total": total, "messageId": message_id }))
}

pub(crate) fn is_safe_remote_chat_message(
    message: &ChatServiceMessage,
    expected: &ChatPeerIdentity,
    host_id: Option<&str>,
) -> bool {
    if message.player_id != expected.player_id
        || message.player_name != expected.player_name
        || !is_message_id_for_player(&message.id, &message.player_id)
    {
        return false;
    }
    let content_bytes = message.content.as_bytes().len();
    let shape_is_valid = match message.message_type {
        MessageType::Voice => crate::modules::chat_service::valid_voice_payload(
            &message.content,
            message.image_data.as_deref(),
        ),
        MessageType::File => {
            content_bytes > 0
                && content_bytes <= MAX_FILE_CONTENT_BYTES
                && message.image_data.is_none()
                && serde_json::from_str::<ChatAttachmentMeta>(&message.content)
                    .is_ok_and(|meta| valid_attachment_meta(&meta))
        }
        MessageType::Text => {
            content_bytes > 0 && content_bytes <= MAX_TEXT_BYTES && message.image_data.is_none()
        }
        MessageType::Image => {
            content_bytes <= MAX_IMAGE_CONTENT_BYTES
                && message
                    .image_data
                    .as_ref()
                    .is_some_and(|image| !image.is_empty() && image.len() <= MAX_IMAGE_BYTES)
        }
        MessageType::Announce => {
            content_bytes <= MAX_ANNOUNCE_BYTES
                && message.image_data.is_none()
                && host_id == Some(message.player_id.as_str())
        }
        MessageType::VoiceGroup => {
            content_bytes <= MAX_VOICE_GROUP_BYTES
                && message.image_data.is_none()
                && message.content.parse::<u8>().is_ok_and(|group| group <= 4)
        }
        MessageType::Clipboard => {
            content_bytes <= MAX_CLIPBOARD_BYTES && message.image_data.is_none()
        }
        MessageType::Todo => content_bytes <= MAX_TODO_BYTES && message.image_data.is_none(),
        MessageType::Whiteboard => {
            content_bytes <= MAX_WHITEBOARD_BYTES && message.image_data.is_none()
        }
        MessageType::Recall => {
            content_bytes > 0 && content_bytes <= MAX_RECALL_BYTES && message.image_data.is_none()
        }
        MessageType::Avatar => {
            content_bytes <= MAX_AVATAR_BYTES
                && message.image_data.is_none()
                && (message.content.is_empty() || message.content.starts_with("data:image/"))
        }
    };
    shape_is_valid
        && serde_json::to_vec(message).is_ok_and(|encoded| encoded.len() <= MAX_CHAT_RESPONSE_BYTES)
}

/// 获取P2P聊天消息
///
/// # 参数
/// * `peer_ips` - 玩家的虚拟IP列表
/// * `since` - 获取此时间戳之后的消息（可选）
///
/// # 返回
/// * `Ok(Vec<ChatMessage>)` - 消息列表
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn get_p2p_chat_messages(
    peer_ips: Vec<String>,
    since: Option<u64>,
    state: State<'_, AppState>,
) -> Result<Vec<ChatServiceMessage>, String> {
    if peer_ips.len() > MAX_CHAT_TARGETS {
        return Err("聊天目标数量超过限制".to_string());
    }
    let chat_service = {
        let core = state.core.lock().await;
        core.get_chat_service()
    };
    let chat_svc = chat_service.lock().await;
    let mut all_messages = chat_svc.get_local_messages(since);
    let authoritative_peers = chat_svc.authoritative_peers();
    let chat_token = chat_svc
        .get_chat_token()
        .ok_or_else(|| "聊天令牌尚未就绪".to_string())?;
    let host_id = chat_svc.get_host_id();
    drop(chat_svc);

    log::info!(
        "📥 [ChatService] 从 {} 个权威玩家获取消息",
        authoritative_peers.len()
    );

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .connect_timeout(std::time::Duration::from_millis(800))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| format!("创建HTTP客户端失败: {}", e))?;

    let mut tasks = Vec::new();
    for peer in authoritative_peers {
        let host = chat_http_host(&peer.virtual_ip)?;
        let url = if let Some(ts) = since {
            format!("http://{}:14540/api/chat/messages?since={}", host, ts)
        } else {
            format!("http://{}:14540/api/chat/messages", host)
        };
        let client_clone = client.clone();
        let token = chat_token.clone();
        let expected = peer.clone();
        let expected_ip = peer.virtual_ip.clone();
        let expected_host_id = host_id.clone();
        let chat_service_clone = Arc::clone(&chat_service);
        let audience = peer.virtual_ip.clone();
        tasks.push(tokio::spawn(async move {
            // History reads are signed with an empty body: the query string is
            // not covered, so the receiver treats `since` as a filter hint only
            // and never as an authorization input.
            let signed = match chat_service_clone.lock().await.sign_request(
                "GET",
                "/api/chat/messages",
                &audience,
                &[],
            ) {
                Some(signed) => signed,
                None => {
                    log::warn!("⚠️ 聊天签名不可用，跳过历史拉取 ({})", expected_ip);
                    return Vec::new();
                }
            };
            match with_chat_signature(
                client_clone.get(&url).header(CHAT_TOKEN_HEADER, token),
                &signed,
            )
            .send()
            .await
            {
                Ok(response) => {
                    if response.status().is_success() {
                        let body = match read_remote_body_limited(response, MAX_CHAT_RESPONSE_BYTES)
                            .await
                        {
                            Ok(body) => body,
                            Err(error) => {
                                log::warn!("⚠️ 聊天历史响应超限 ({}): {}", expected_ip, error);
                                return Vec::new();
                            }
                        };
                        let Ok(body) = chat_service_clone.lock().await.decrypt_from_peer(
                            &expected,
                            "/api/chat/messages",
                            &body,
                        ) else {
                            return Vec::new();
                        };
                        let Ok(mut messages) =
                            serde_json::from_slice::<Vec<ChatServiceMessage>>(&body)
                        else {
                            log::warn!("⚠️ 聊天历史 JSON 无效 ({})", expected_ip);
                            return Vec::new();
                        };
                        if messages.len() > MAX_HISTORY_MESSAGES {
                            log::warn!("⚠️ 聊天历史条数超限 ({})", expected_ip);
                            return Vec::new();
                        }
                        messages.retain(|message| {
                            is_safe_remote_chat_message(
                                message,
                                &expected,
                                expected_host_id.as_deref(),
                            )
                        });
                        log::debug!("✅ 从 {} 获取到 {} 条本人消息", expected_ip, messages.len());
                        messages
                    } else {
                        log::warn!(
                            "⚠️ HTTP请求失败 ({}): 状态码 {}",
                            expected_ip,
                            response.status()
                        );
                        Vec::new()
                    }
                }
                Err(e) => {
                    log::debug!("⚠️ 获取消息失败 ({}): {}", expected_ip, e);
                    Vec::new()
                }
            }
        }));
    }

    for task in tasks {
        if let Ok(messages) = task.await {
            all_messages.extend(messages);
        }
    }

    all_messages.sort_by_key(|msg| msg.timestamp);
    let mut seen_ids = std::collections::HashSet::new();
    all_messages.retain(|msg| seen_ids.insert(msg.id.clone()));

    Ok(all_messages)
}

/// 清空本地聊天消息
///
/// # 返回
/// * `Ok(())` - 清空成功
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn clear_p2p_chat_messages(state: State<'_, AppState>) -> Result<(), String> {
    log::info!("🗑️ 清空本地聊天消息");

    let core = state.core.lock().await;
    let chat_service = core.get_chat_service();
    let chat_svc = chat_service.lock().await;

    chat_svc.clear_local_messages();

    Ok(())
}
