// Tauri Command 接口模块
// 提供前端调用的所有命令接口

use crate::modules::app_core::{AppCore, AppState as CoreAppState};
use crate::modules::config_manager::UserConfig;
use crate::modules::lobby_manager::{Lobby, Player};
use crate::modules::voice_service::AudioDevice;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::sync::Mutex as StdMutex;
use std::sync::OnceLock;
use tauri::Emitter;
use tauri::Manager;
use tauri::State;
use tokio::sync::Mutex;

/// 远程文件下载的取消标志注册表（task_id -> 取消标志）
fn download_cancels() -> &'static dashmap::DashMap<String, Arc<AtomicBool>> {
    static CANCELS: OnceLock<dashmap::DashMap<String, Arc<AtomicBool>>> = OnceLock::new();
    CANCELS.get_or_init(dashmap::DashMap::new)
}

const MAX_REMOTE_FILE_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_REMOTE_METADATA_BYTES: usize = 4 * 1024 * 1024;
const MAX_REMOTE_BATCH_FILES: usize = 256;
const MAX_REMOTE_BATCH_REQUEST_BYTES: usize = 64 * 1024;
const MAX_REMOTE_BATCH_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_PATH_GRANTS: usize = 4096;
const MAX_CHAT_TARGETS: usize = 64;
const MAX_CHAT_RESPONSE_BYTES: usize = 4 * 1024 * 1024;
const AUTO_LOBBY_CREDENTIAL_TARGET: &str = "MCTier:auto-lobby-password";

#[cfg(windows)]
fn read_auto_lobby_secret() -> Option<String> {
    use windows::core::PCWSTR;
    use windows::Win32::Security::Credentials::{
        CredFree, CredReadW, CREDENTIALW, CRED_TYPE_GENERIC,
    };

    let target = AUTO_LOBBY_CREDENTIAL_TARGET
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let mut credential: *mut CREDENTIALW = std::ptr::null_mut();
    unsafe {
        CredReadW(
            PCWSTR(target.as_ptr()),
            CRED_TYPE_GENERIC,
            0,
            &mut credential,
        )
        .ok()?;
        let record = credential.as_ref()?;
        let bytes =
            std::slice::from_raw_parts(record.CredentialBlob, record.CredentialBlobSize as usize);
        let value = String::from_utf8(bytes.to_vec()).ok();
        CredFree(credential.cast());
        value.filter(|password| !password.is_empty())
    }
}

#[cfg(windows)]
fn write_auto_lobby_secret(password: &str) -> Result<(), String> {
    use windows::core::{PCWSTR, PWSTR};
    use windows::Win32::Security::Credentials::{
        CredDeleteW, CredWriteW, CREDENTIALW, CRED_MAX_CREDENTIAL_BLOB_SIZE,
        CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC,
    };

    let mut target = AUTO_LOBBY_CREDENTIAL_TARGET
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    if password.is_empty() {
        let _ = unsafe { CredDeleteW(PCWSTR(target.as_ptr()), CRED_TYPE_GENERIC, 0) };
        return Ok(());
    }
    let mut blob = password.as_bytes().to_vec();
    if blob.len() > CRED_MAX_CREDENTIAL_BLOB_SIZE as usize {
        return Err("自动大厅密码超过系统凭据库限制".to_string());
    }
    let credential = CREDENTIALW {
        Type: CRED_TYPE_GENERIC,
        TargetName: PWSTR(target.as_mut_ptr()),
        CredentialBlobSize: blob.len() as u32,
        CredentialBlob: blob.as_mut_ptr(),
        Persist: CRED_PERSIST_LOCAL_MACHINE,
        ..Default::default()
    };
    unsafe { CredWriteW(&credential, 0) }
        .map_err(|error| format!("保存自动大厅密码到 Windows 凭据管理器失败: {}", error))
}

#[cfg(not(windows))]
fn auto_lobby_session_secret() -> &'static StdMutex<Option<String>> {
    static SECRET: OnceLock<StdMutex<Option<String>>> = OnceLock::new();
    SECRET.get_or_init(|| StdMutex::new(None))
}

#[cfg(not(windows))]
fn read_auto_lobby_secret() -> Option<String> {
    auto_lobby_session_secret()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone()
}

#[cfg(not(windows))]
fn write_auto_lobby_secret(password: &str) -> Result<(), String> {
    *auto_lobby_session_secret()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) =
        (!password.is_empty()).then(|| password.to_string());
    Ok(())
}

fn overlay_http_host(raw: &str) -> Result<String, String> {
    let ip = raw
        .trim()
        .parse::<std::net::Ipv4Addr>()
        .map_err(|_| "目标不是有效的 EasyTier 虚拟 IPv4".to_string())?;
    let octets = ip.octets();
    if octets[..3] != [10, 126, 126] || octets[3] == 0 || octets[3] == 255 {
        return Err("目标 IP 不在允许的虚拟网络范围内".to_string());
    }
    Ok(ip.to_string())
}

struct FilePeerTarget {
    host: String,
    token: String,
}

async fn require_file_peer_host(raw: &str, state: &AppState) -> Result<FilePeerTarget, String> {
    let host = overlay_http_host(raw)?;
    let target = host
        .parse::<std::net::Ipv4Addr>()
        .map_err(|_| "目标不是有效的 EasyTier 虚拟 IPv4".to_string())?;
    let chat_service = {
        let core = state.core.lock().await;
        core.get_chat_service()
    };
    let chat = chat_service.lock().await;
    let token = chat
        .get_chat_token()
        .ok_or_else(|| "当前大厅尚未建立文件认证会话".to_string())?;
    let local = chat
        .get_virtual_ip()
        .ok_or_else(|| "当前 EasyTier 虚拟 IP 尚未就绪".to_string())?
        .parse::<std::net::Ipv4Addr>()
        .map_err(|_| "当前 EasyTier 虚拟 IP 无效".to_string())?;
    if local.octets()[..3] != target.octets()[..3] {
        return Err("目标 IP 不在当前 EasyTier 虚拟子网内".to_string());
    }
    if local == target {
        return Ok(FilePeerTarget { host, token });
    }
    if chat
        .allowed_peer_ips(std::slice::from_ref(&host))
        .is_empty()
    {
        return Err("目标 IP 不属于当前大厅的权威成员".to_string());
    }
    Ok(FilePeerTarget { host, token })
}

/// A renderer must not be able to turn the generic file commands into an
/// arbitrary filesystem API. Native file pickers and app-generated download
/// paths register narrowly scoped grants that are checked again by every
/// read/write/delete/open command.
#[derive(Clone, Copy)]
enum PathAccess {
    ReadFile,
    WriteFile,
    DeleteFile,
    ReadDirectory,
    WriteDirectory,
    Open,
}

#[derive(Default)]
struct PathGrant {
    read_file: bool,
    write_file: bool,
    delete_file: bool,
    read_directory: bool,
    write_directory: bool,
    open: bool,
}

#[derive(Default)]
struct PathGrantStore {
    entries: HashMap<std::path::PathBuf, PathGrant>,
}

fn path_grants() -> &'static StdMutex<PathGrantStore> {
    static GRANTS: OnceLock<StdMutex<PathGrantStore>> = OnceLock::new();
    GRANTS.get_or_init(|| StdMutex::new(PathGrantStore::default()))
}

fn path_grant_allows(grant: &mut PathGrant, access: PathAccess) {
    match access {
        PathAccess::ReadFile => grant.read_file = true,
        PathAccess::WriteFile => grant.write_file = true,
        PathAccess::DeleteFile => grant.delete_file = true,
        PathAccess::ReadDirectory => grant.read_directory = true,
        PathAccess::WriteDirectory => grant.write_directory = true,
        PathAccess::Open => grant.open = true,
    }
}

fn path_grant_matches(grant: &PathGrant, access: PathAccess) -> bool {
    match access {
        PathAccess::ReadFile => grant.read_file,
        PathAccess::WriteFile => grant.write_file,
        PathAccess::DeleteFile => grant.delete_file,
        PathAccess::ReadDirectory => grant.read_directory,
        PathAccess::WriteDirectory => grant.write_directory,
        PathAccess::Open => grant.open,
    }
}

#[cfg(windows)]
fn validate_local_path_component(component: &std::ffi::OsStr) -> Result<(), String> {
    let value = component
        .to_str()
        .ok_or_else(|| "路径包含无法处理的字符".to_string())?;
    if value.is_empty()
        || value.contains(':')
        || value
            .chars()
            .any(|ch| matches!(ch, '<' | '>' | '"' | '|' | '?' | '*'))
        || value != value.trim_end_matches([' ', '.'])
        || is_windows_reserved_name(value)
    {
        return Err("路径包含 Windows 保留名称或非法语法".to_string());
    }
    Ok(())
}

#[cfg(not(windows))]
fn validate_local_path_component(_component: &std::ffi::OsStr) -> Result<(), String> {
    Ok(())
}

/// Normalize paths without resolving user-controlled symlinks. All paths used
/// by these commands are expected to come from a native picker or an app
/// generated absolute path, so relative paths and parent traversal are denied.
fn normalize_local_path(raw: &str, allow_missing_leaf: bool) -> Result<std::path::PathBuf, String> {
    if raw.is_empty() || raw.len() > 32 * 1024 || raw.contains('\0') {
        return Err("路径为空、过长或包含非法字符".to_string());
    }

    let input = std::path::Path::new(raw);
    if !input.is_absolute() {
        return Err("只允许使用绝对路径".to_string());
    }

    #[cfg(windows)]
    {
        use std::path::Prefix;
        let text = input.to_string_lossy();
        if text.starts_with("\\\\") || text.starts_with("//") {
            return Err("不允许使用网络共享或设备路径".to_string());
        }
        if input.components().any(|component| {
            matches!(component, std::path::Component::Prefix(prefix)
                if !matches!(prefix.kind(), Prefix::Disk(_)))
        }) {
            return Err("不允许使用网络共享或设备路径".to_string());
        }
    }

    let mut normalized = std::path::PathBuf::new();
    for component in input.components() {
        match component {
            std::path::Component::ParentDir => {
                return Err("路径不得包含父目录跳转".to_string());
            }
            std::path::Component::CurDir => {}
            std::path::Component::Normal(name) => {
                validate_local_path_component(name)?;
                normalized.push(name);
            }
            _ => normalized.push(component.as_os_str()),
        }
    }

    if normalized.as_os_str().is_empty() {
        return Err("路径无效".to_string());
    }

    // `exists()` follows links and reports false for dangling symlinks. Use
    // symlink_metadata for the leaf so a new-file grant cannot be registered
    // on a dangling symlink (which a later overwrite-style API might follow).
    let parent = normalized
        .parent()
        .ok_or_else(|| "路径缺少父目录".to_string())?;
    let leaf_exists = match std::fs::symlink_metadata(&normalized) {
        Ok(_) => {
            ensure_existing_path_has_no_links(&normalized)?;
            true
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            ensure_existing_path_has_no_links(parent)?;
            false
        }
        Err(error) => return Err(format!("检查路径失败 {}: {}", normalized.display(), error)),
    };

    if !allow_missing_leaf && !leaf_exists {
        return Err("路径不存在".to_string());
    }
    if allow_missing_leaf {
        let parent_metadata =
            std::fs::symlink_metadata(parent).map_err(|e| format!("检查父目录失败: {}", e))?;
        if !parent_metadata.is_dir() {
            return Err("父路径不是目录".to_string());
        }
    }

    Ok(normalized)
}

fn ensure_existing_path_has_no_links(path: &std::path::Path) -> Result<(), String> {
    let mut current = std::path::PathBuf::new();
    for component in path.components() {
        current.push(component.as_os_str());
        let metadata = std::fs::symlink_metadata(&current)
            .map_err(|e| format!("检查路径失败 {}: {}", current.display(), e))?;
        if is_symlink_or_reparse_point(&metadata) {
            return Err(format!("拒绝经过符号链接或重解析点: {}", current.display()));
        }
    }
    Ok(())
}

fn register_path_grant(
    raw: &str,
    access: PathAccess,
    allow_missing_leaf: bool,
) -> Result<std::path::PathBuf, String> {
    let path = normalize_local_path(raw, allow_missing_leaf)?;
    let mut grants = path_grants()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if !grants.entries.contains_key(&path) && grants.entries.len() >= MAX_PATH_GRANTS {
        return Err("应用文件授权数量已达到上限，请重启应用后重试".to_string());
    }
    let grant = grants.entries.entry(path.clone()).or_default();
    path_grant_allows(grant, access);
    Ok(path)
}

fn require_path_grant(
    raw: &str,
    access: PathAccess,
    allow_missing_leaf: bool,
) -> Result<std::path::PathBuf, String> {
    let path = normalize_local_path(raw, allow_missing_leaf)?;
    let grants = path_grants()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if !grants
        .entries
        .get(&path)
        .is_some_and(|grant| path_grant_matches(grant, access))
    {
        return Err("路径未通过应用文件选择或内部授权".to_string());
    }
    Ok(path)
}

fn require_existing_file_grant(
    raw: &str,
    access: PathAccess,
) -> Result<std::path::PathBuf, String> {
    let path = require_path_grant(raw, access, false)?;
    let metadata = std::fs::symlink_metadata(&path).map_err(|e| format!("检查文件失败: {}", e))?;
    if is_symlink_or_reparse_point(&metadata) || !metadata.is_file() {
        return Err("路径不是普通本地文件".to_string());
    }
    Ok(path)
}

fn require_existing_directory_grant(
    raw: &str,
    access: PathAccess,
) -> Result<std::path::PathBuf, String> {
    let path = require_path_grant(raw, access, false)?;
    let metadata = std::fs::symlink_metadata(&path).map_err(|e| format!("检查目录失败: {}", e))?;
    if is_symlink_or_reparse_point(&metadata) || !metadata.is_dir() {
        return Err("路径不是普通本地目录".to_string());
    }
    Ok(path)
}

fn windows_run_value(exe: &std::path::Path) -> Result<String, String> {
    let value = exe
        .to_str()
        .ok_or_else(|| "程序路径不是有效的 UTF-8".to_string())?;
    if value.is_empty() || value.contains('\0') || value.contains('"') {
        return Err("程序路径包含非法字符".to_string());
    }
    Ok(format!("\"{}\"", value))
}

#[cfg(windows)]
fn windows_system_command(name: &str) -> std::path::PathBuf {
    std::env::var_os("SystemRoot")
        .map(std::path::PathBuf::from)
        .filter(|root| root.is_absolute())
        .unwrap_or_else(|| std::path::PathBuf::from(r"C:\Windows"))
        .join("System32")
        .join(name)
}

#[cfg(not(windows))]
fn unix_system_command(name: &str) -> Result<std::path::PathBuf, String> {
    // Resolve only fixed absolute paths. A renderer-controlled PATH must not
    // decide which executable handles a path or network diagnostic request.
    let candidates: &[&str] = match name {
        #[cfg(target_os = "macos")]
        "open" => &["/usr/bin/open"],
        "xdg-open" => &["/usr/bin/xdg-open", "/bin/xdg-open"],
        "ping" => &["/bin/ping", "/usr/bin/ping", "/sbin/ping"],
        "pkill" => &["/usr/bin/pkill", "/bin/pkill"],
        _ => return Err("不支持的系统命令".to_string()),
    };
    candidates
        .iter()
        .map(std::path::Path::new)
        .find(|path| path.is_file())
        .map(std::path::Path::to_path_buf)
        .ok_or_else(|| format!("找不到系统命令: {}", name))
}

/// 应用状态包装器（用于 Tauri State）
pub struct AppState {
    pub core: Arc<Mutex<AppCore>>,
}

// ==================== 大厅操作命令 ====================

/// 创建大厅
///
/// # 参数
/// * `name` - 大厅名称
/// * `password` - 大厅密码
/// * `player_name` - 玩家名称
/// * `player_id` - 玩家ID（由前端生成）
/// * `server_node` - 服务器节点地址
/// * `signaling_server` - 信令服务器地址
///
/// # 返回
/// * `Ok(Lobby)` - 成功创建的大厅信息
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn create_lobby(
    name: String,
    password: String,
    player_name: String,
    player_id: String,
    server_node: String,
    signaling_server: String,
    use_domain: Option<bool>,
    virtual_domain: Option<String>,
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Lobby, String> {
    log::info!("收到创建大厅命令: name={}, player={}, player_id={}, signaling_server={}, use_domain={:?}, virtual_domain={:?}", name, player_name, player_id, signaling_server, use_domain, virtual_domain);

    let core = state.core.lock().await;

    // 更新应用状态为连接中
    core.set_state(CoreAppState::Connecting).await;

    // 【关键修复】在这里读取配置，避免在 start_easytier 中再次获取 core 的锁
    let (global_config, lobby_config) = {
        let config_manager = core.get_config_manager();
        let cfg_mgr = config_manager.lock().await;
        let user_config = cfg_mgr.get_config();

        let global_cfg = user_config.global_easytier_advanced_config.clone();
        let lobby_cfg = user_config.lobby_easytier_advanced_config.clone();

        (global_cfg, lobby_cfg)
    };

    // 获取各个服务的引用
    let lobby_manager = core.get_lobby_manager();
    let network_service = core.get_network_service();
    let file_transfer = core.get_file_transfer();
    let chat_service = core.get_chat_service();

    // 释放 core 的锁，避免死锁
    drop(core);

    // 创建大厅
    let mut lobby_mgr = lobby_manager.lock().await;
    let network_svc = network_service.lock().await;

    match lobby_mgr
        .create_lobby_with_config(
            name,
            password,
            player_name.clone(),
            server_node,
            signaling_server.clone(),
            use_domain.unwrap_or(false),
            virtual_domain,
            &*network_svc,
            &app_handle,
            global_config,
            lobby_config,
        )
        .await
    {
        Ok(lobby) => {
            log::info!("大厅创建成功: {}", lobby.name);

            // 输出序列化后的JSON用于调试
            if let Ok(json) = serde_json::to_string(&lobby) {
                log::info!("大厅JSON: {}", json);
            }

            // 获取虚拟IP
            let virtual_ip = lobby.virtual_ip.clone();
            drop(lobby_mgr);
            drop(network_svc);

            log::info!("使用前端提供的玩家ID: {}", player_id);

            // 所有客户端都连接到官方 WebSockets 信令服务器 (wss://mctier.pmhs.top/signaling)
            log::info!("客户端将连接到官方 WebSockets 信令服务器: wss://mctier.pmhs.top/signaling");

            // 不再在创建大厅时自动启动HTTP文件服务器
            // HTTP服务器将在第一次添加共享时按需启动
            log::info!("📝 HTTP文件服务器将在添加共享时按需启动");
            let ft_service = file_transfer.lock().await;
            ft_service.set_virtual_ip(virtual_ip.clone());
            drop(ft_service);

            // 聊天服务必须等待信令服务器下发 lobby token 后才能启动。
            let chat_svc = chat_service.lock().await;
            chat_svc.stop_server().await;
            chat_svc.set_virtual_ip(virtual_ip.clone());
            drop(chat_svc);

            // 更新应用状态为在大厅中
            let core = state.core.lock().await;
            core.set_state(CoreAppState::InLobby).await;
            drop(core);

            Ok(lobby)
        }
        Err(e) => {
            log::error!("创建大厅失败: {}", e);

            // 更新应用状态为错误
            let core = state.core.lock().await;
            core.set_state(CoreAppState::Error(e.to_string())).await;
            drop(core);

            Err(e.to_string())
        }
    }
}

/// 加入大厅
///
/// # 参数
/// * `name` - 大厅名称
/// * `password` - 大厅密码
/// * `player_name` - 玩家名称
/// * `player_id` - 玩家ID（由前端生成）
/// * `server_node` - 服务器节点地址
/// * `signaling_server` - 信令服务器地址
///
/// # 返回
/// * `Ok(Lobby)` - 成功加入的大厅信息
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn join_lobby(
    name: String,
    password: String,
    player_name: String,
    player_id: String,
    server_node: String,
    signaling_server: String,
    use_domain: Option<bool>,
    virtual_domain: Option<String>,
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Lobby, String> {
    log::info!("收到加入大厅命令: name={}, player={}, player_id={}, signaling_server={}, use_domain={:?}, virtual_domain={:?}", name, player_name, player_id, signaling_server, use_domain, virtual_domain);

    let core = state.core.lock().await;

    // 更新应用状态为连接中
    core.set_state(CoreAppState::Connecting).await;

    // 【关键修复】在这里读取配置，避免在 start_easytier 中再次获取 core 的锁
    let (global_config, lobby_config) = {
        let config_manager = core.get_config_manager();
        let cfg_mgr = config_manager.lock().await;
        let user_config = cfg_mgr.get_config();

        let global_cfg = user_config.global_easytier_advanced_config.clone();
        let lobby_cfg = user_config.lobby_easytier_advanced_config.clone();

        (global_cfg, lobby_cfg)
    };

    // 获取各个服务的引用
    let lobby_manager = core.get_lobby_manager();
    let network_service = core.get_network_service();
    let voice_service = core.get_voice_service();
    let p2p_signaling = core.get_p2p_signaling();
    let file_transfer = core.get_file_transfer();
    let chat_service = core.get_chat_service();

    // 释放 core 的锁，避免死锁
    drop(core);

    // 加入大厅
    let mut lobby_mgr = lobby_manager.lock().await;
    let network_svc = network_service.lock().await;

    match lobby_mgr
        .join_lobby_with_config(
            name,
            password,
            player_name.clone(),
            server_node,
            signaling_server.clone(),
            use_domain.unwrap_or(false),
            virtual_domain,
            &*network_svc,
            &app_handle,
            global_config,
            lobby_config,
        )
        .await
    {
        Ok(lobby) => {
            log::info!("成功加入大厅: {}", lobby.name);

            // 初始化语音服务
            let voice_svc = voice_service.lock().await;
            if let Err(e) = voice_svc.initialize().await {
                log::warn!("语音服务初始化失败: {}", e);
                // 语音服务失败不应该阻止加入大厅
            }
            drop(voice_svc);

            // 获取虚拟IP（用于P2P信令服务和HTTP文件服务器）
            let virtual_ip = lobby.virtual_ip.clone();
            drop(lobby_mgr);
            drop(network_svc);

            log::info!("使用前端提供的玩家ID: {}", player_id);

            // 所有客户端都连接到官方 WebSockets 信令服务器 (wss://mctier.pmhs.top/signaling)
            log::info!("客户端将连接到官方 WebSockets 信令服务器: wss://mctier.pmhs.top/signaling");

            // 启动P2P信令服务
            log::info!("正在启动P2P信令服务（加入大厅）...");
            let p2p_svc = p2p_signaling.lock().await;
            match p2p_svc
                .start(player_id, player_name, virtual_ip.clone())
                .await
            {
                Ok(_) => {
                    log::info!("✅ P2P信令服务启动成功（加入大厅）");
                }
                Err(e) => {
                    log::error!("❌ 启动P2P信令服务失败（加入大厅）: {}", e);
                    // P2P信令服务启动失败应该返回错误，因为没有它就无法发现其他玩家
                    drop(p2p_svc);
                    let core = state.core.lock().await;
                    core.set_state(CoreAppState::Error(format!("P2P信令服务启动失败: {}", e)))
                        .await;
                    drop(core);
                    return Err(format!("P2P信令服务启动失败: {}", e));
                }
            }
            drop(p2p_svc);

            // 不再在加入大厅时自动启动HTTP文件服务器
            // HTTP服务器将在第一次添加共享时按需启动
            log::info!("📝 HTTP文件服务器将在添加共享时按需启动");
            let ft_service = file_transfer.lock().await;
            ft_service.set_virtual_ip(virtual_ip.clone());
            drop(ft_service);

            // 聊天服务必须等待信令服务器下发 lobby token 后才能启动。
            let chat_svc = chat_service.lock().await;
            chat_svc.stop_server().await;
            chat_svc.set_virtual_ip(virtual_ip.clone());
            drop(chat_svc);

            // 更新应用状态为在大厅中
            let core = state.core.lock().await;
            core.set_state(CoreAppState::InLobby).await;
            drop(core);

            Ok(lobby)
        }
        Err(e) => {
            log::error!("加入大厅失败: {}", e);

            // 更新应用状态为错误
            let core = state.core.lock().await;
            core.set_state(CoreAppState::Error(e.to_string())).await;
            drop(core);

            Err(e.to_string())
        }
    }
}

/// 退出大厅
///
/// # 返回
/// * `Ok(())` - 成功退出
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn leave_lobby(state: State<'_, AppState>) -> Result<(), String> {
    log::info!("收到退出大厅命令");

    let core = state.core.lock().await;

    // 获取各个服务的引用
    let lobby_manager = core.get_lobby_manager();
    let network_service = core.get_network_service();
    let voice_service = core.get_voice_service();
    let p2p_signaling = core.get_p2p_signaling();
    let file_transfer = core.get_file_transfer();
    let chat_service = core.get_chat_service();

    // 【修复】尽早释放 core 锁，避免在数秒级的 stop_easytier（netsh/pnputil/PowerShell）
    // 期间一直占用 core 锁，导致其它命令阻塞、界面卡死
    drop(core);

    // 先撤销聊天 token、身份映射和历史，再停止虚拟网络。
    let chat_svc = chat_service.lock().await;
    chat_svc.stop_server().await;
    drop(chat_svc);

    // 停止HTTP文件服务器
    let ft_service = file_transfer.lock().await;
    ft_service.stop_server().await;
    drop(ft_service);

    // 停止P2P信令服务
    let p2p_svc = p2p_signaling.lock().await;
    if let Err(e) = p2p_svc.stop().await {
        log::warn!("停止P2P信令服务失败: {}", e);
    }
    drop(p2p_svc);

    // 清理语音服务
    let voice_svc = voice_service.lock().await;
    if let Err(e) = voice_svc.cleanup().await {
        log::warn!("清理语音服务时发生错误: {}", e);
    }
    drop(voice_svc);

    // 退出大厅
    let mut lobby_mgr = lobby_manager.lock().await;
    let network_svc = network_service.lock().await;

    match lobby_mgr.leave_lobby(&*network_svc).await {
        Ok(_) => {
            log::info!("成功退出大厅");
            drop(lobby_mgr);
            drop(network_svc);

            // 更新应用状态为空闲（重新短暂加锁）
            let core = state.core.lock().await;
            core.set_state(CoreAppState::Idle).await;
            drop(core);

            Ok(())
        }
        Err(e) => {
            log::error!("退出大厅失败: {}", e);
            Err(e.to_string())
        }
    }
}

// ==================== 语音控制命令 ====================

/// 切换麦克风状态
///
/// # 返回
/// * `Ok(bool)` - 新的麦克风状态（true=开启，false=关闭）
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn toggle_mic(state: State<'_, AppState>, app: tauri::AppHandle) -> Result<bool, String> {
    log::info!("收到切换麦克风命令");

    let core = state.core.lock().await;

    // 使用 AppCore 的 toggle_mic 方法，它会正确处理状态切换
    match core.toggle_mic().await {
        Ok(new_state) => {
            log::info!("麦克风状态已切换: {}", new_state);

            // 发送事件到前端更新UI
            if let Err(e) = app.emit("mic-toggled", new_state) {
                log::error!("发送麦克风状态事件失败: {}", e);
            }

            Ok(new_state)
        }
        Err(e) => {
            log::error!("切换麦克风失败: {}", e);
            Err(e.to_string())
        }
    }
}

/// 显式设置麦克风状态。用于浏览器权限请求失败后把 Rust 与前端状态一起回滚。
#[tauri::command]
pub async fn set_mic_enabled(
    enabled: bool,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<bool, String> {
    let core = state.core.lock().await;
    let voice_service = core.get_voice_service();
    let new_state = voice_service
        .lock()
        .await
        .set_mic_enabled(enabled)
        .await
        .map_err(|e| e.to_string())?;

    if let Err(e) = app.emit("mic-toggled", new_state) {
        log::error!("发送麦克风状态事件失败: {}", e);
    }
    Ok(new_state)
}

/// 打开操作系统的麦克风隐私设置，供永久拒绝权限的用户恢复授权。
#[tauri::command]
pub fn open_microphone_privacy_settings() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new(windows_system_command("explorer.exe"))
            .arg("ms-settings:privacy-microphone")
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new(unix_system_command("open")?)
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone")
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    #[cfg(target_os = "linux")]
    {
        return Err(
            "当前 Linux 桌面环境无法自动定位麦克风权限页，请在系统设置中手动允许 MCTier 使用麦克风"
                .to_string(),
        );
    }

    #[allow(unreachable_code)]
    Ok(())
}

/// Restart into the permission-reset startup path. The new process waits for this
/// WebView to exit before deleting EBWebView, avoiding locked-file failures.
#[tauri::command]
pub fn reset_microphone_permission(app: tauri::AppHandle) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| format!("获取程序路径失败: {}", e))?;
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new(&exe)
            .arg("--reset-microphone-permission")
            .creation_flags(0x08000000)
            .spawn()
            .map_err(|e| format!("重启 MCTier 失败: {}", e))?;
    }
    #[cfg(not(windows))]
    {
        std::process::Command::new(&exe)
            .arg("--reset-microphone-permission")
            .spawn()
            .map_err(|e| format!("重启 MCTier 失败: {}", e))?;
    }
    app.exit(0);
    Ok(())
}

/// 静音或取消静音指定玩家
///
/// # 参数
/// * `player_id` - 玩家 ID
/// * `muted` - true=静音，false=取消静音
///
/// # 返回
/// * `Ok(())` - 操作成功
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn mute_player(
    player_id: String,
    muted: bool,
    state: State<'_, AppState>,
) -> Result<(), String> {
    log::info!("收到静音玩家命令: player_id={}, muted={}", player_id, muted);

    let core = state.core.lock().await;
    let voice_service = core.get_voice_service();
    let voice_svc = voice_service.lock().await;

    match voice_svc.mute_player(&player_id, muted).await {
        Ok(_) => {
            log::info!("玩家 {} 静音状态已更新: {}", player_id, muted);
            Ok(())
        }
        Err(e) => {
            log::error!("更新玩家静音状态失败: {}", e);
            Err(e.to_string())
        }
    }
}

/// 全局静音或取消静音所有玩家
///
/// # 参数
/// * `muted` - true=静音所有玩家，false=取消静音所有玩家
///
/// # 返回
/// * `Ok(())` - 操作成功
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn mute_all(muted: bool, state: State<'_, AppState>) -> Result<(), String> {
    log::info!("收到全局静音命令: muted={}", muted);

    let core = state.core.lock().await;
    let voice_service = core.get_voice_service();
    let voice_svc = voice_service.lock().await;

    match voice_svc.mute_all(muted).await {
        Ok(_) => {
            log::info!("全局静音状态已更新: {}", muted);
            Ok(())
        }
        Err(e) => {
            log::error!("更新全局静音状态失败: {}", e);
            Err(e.to_string())
        }
    }
}

// ==================== 配置管理命令 ====================

/// 获取用户配置
///
/// # 返回
/// * `Ok(UserConfig)` - 用户配置
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn get_config(state: State<'_, AppState>) -> Result<UserConfig, String> {
    log::info!("收到获取配置命令");

    let core = state.core.lock().await;
    let config_manager = core.get_config_manager();
    let config_mgr = config_manager.lock().await;

    let config = config_mgr.get_config_clone();

    log::debug!("返回配置: {:?}", config);

    Ok(config)
}

/// 更新用户配置
///
/// # 参数
/// * `config` - 新的用户配置
///
/// # 返回
/// * `Ok(())` - 更新成功
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn update_config(config: UserConfig, state: State<'_, AppState>) -> Result<(), String> {
    log::info!("收到更新配置命令");

    let core = state.core.lock().await;
    let config_manager = core.get_config_manager();
    let mut config_mgr = config_manager.lock().await;

    match config_mgr
        .update_config(|cfg| {
            *cfg = config.clone();
        })
        .await
    {
        Ok(_) => {
            log::info!("配置已更新");
            Ok(())
        }
        Err(e) => {
            log::error!("更新配置失败: {}", e);
            Err(e.to_string())
        }
    }
}

/// 保存窗口透明度
///
/// # 参数
/// * `opacity` - 透明度值 (0.0-1.0)
///
/// # 返回
/// * `Ok(())` - 保存成功
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn save_opacity(opacity: f64, state: State<'_, AppState>) -> Result<(), String> {
    log::info!("收到保存透明度命令: {}", opacity);

    let core = state.core.lock().await;
    let config_manager = core.get_config_manager();
    let mut config_mgr = config_manager.lock().await;

    match config_mgr.set_opacity(opacity).await {
        Ok(_) => {
            log::info!("透明度已保存: {}", opacity);
            Ok(())
        }
        Err(e) => {
            log::error!("保存透明度失败: {}", e);
            Err(e.to_string())
        }
    }
}

// ==================== 系统信息命令 ====================

/// 获取可用的音频设备列表
///
/// # 返回
/// * `Ok(Vec<AudioDevice>)` - 音频设备列表
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn get_audio_devices(state: State<'_, AppState>) -> Result<Vec<AudioDevice>, String> {
    log::info!("收到获取音频设备命令");

    let core = state.core.lock().await;
    let voice_service = core.get_voice_service();
    let voice_svc = voice_service.lock().await;

    let devices = voice_svc.get_audio_devices().await;

    log::info!("返回 {} 个音频设备", devices.len());

    Ok(devices)
}

/// 获取当前应用状态
///
/// # 返回
/// * `Ok(String)` - 应用状态的字符串表示
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn get_app_state(state: State<'_, AppState>) -> Result<String, String> {
    let core = state.core.lock().await;
    let app_state = core.get_state().await;
    Ok(format!("{:?}", app_state))
}

/// 获取当前大厅信息
///
/// # 返回
/// * `Ok(Option<Lobby>)` - 当前大厅信息，如果未加入大厅则返回 None
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn get_current_lobby(state: State<'_, AppState>) -> Result<Option<Lobby>, String> {
    log::info!("收到获取当前大厅命令");

    let core = state.core.lock().await;
    let lobby_manager = core.get_lobby_manager();
    let lobby_mgr = lobby_manager.lock().await;

    let lobby = lobby_mgr.get_current_lobby().cloned();

    Ok(lobby)
}

/// 获取玩家列表
///
/// # 返回
/// * `Ok(Vec<Player>)` - 玩家列表
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn get_players(state: State<'_, AppState>) -> Result<Vec<Player>, String> {
    log::info!("收到获取玩家列表命令");

    let core = state.core.lock().await;
    let lobby_manager = core.get_lobby_manager();
    let lobby_mgr = lobby_manager.lock().await;

    let players = lobby_mgr.get_players();

    log::info!("返回 {} 个玩家", players.len());

    Ok(players)
}

/// 获取麦克风状态
///
/// # 返回
/// * `Ok(bool)` - 麦克风状态（true=开启，false=关闭）
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn get_mic_status(state: State<'_, AppState>) -> Result<bool, String> {
    let core = state.core.lock().await;
    let voice_service = core.get_voice_service();
    let voice_svc = voice_service.lock().await;

    let status = voice_svc.is_mic_enabled();

    Ok(status)
}

/// 获取全局静音状态
///
/// # 返回
/// * `Ok(bool)` - 全局静音状态（true=静音，false=未静音）
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn get_global_mute_status(state: State<'_, AppState>) -> Result<bool, String> {
    let core = state.core.lock().await;
    let voice_service = core.get_voice_service();
    let voice_svc = voice_service.lock().await;

    let status = voice_svc.is_global_muted();

    Ok(status)
}

/// 检查玩家是否被静音
///
/// # 参数
/// * `player_id` - 玩家 ID
///
/// # 返回
/// * `Ok(bool)` - 是否被静音（true=静音，false=未静音）
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn is_player_muted(
    player_id: String,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    let core = state.core.lock().await;
    let voice_service = core.get_voice_service();
    let voice_svc = voice_service.lock().await;

    let is_muted = voice_svc.is_player_muted(&player_id).await;

    Ok(is_muted)
}

/// 保存窗口位置
///
/// # 参数
/// * `x` - X 坐标
/// * `y` - Y 坐标
/// * `width` - 窗口宽度
/// * `height` - 窗口高度
///
/// # 返回
/// * `Ok(())` - 保存成功
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn save_window_position(
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    state: State<'_, AppState>,
) -> Result<(), String> {
    use crate::modules::config_manager::WindowPosition;

    log::info!(
        "保存窗口位置: x={}, y={}, width={}, height={}",
        x,
        y,
        width,
        height
    );

    let core = state.core.lock().await;
    let config_manager = core.get_config_manager();
    let mut cfg_mgr = config_manager.lock().await;

    // 检查是否启用了记住窗口位置
    let remember = cfg_mgr
        .get_config()
        .remember_window_position
        .unwrap_or(false);

    if remember {
        let position = WindowPosition {
            x,
            y,
            width,
            height,
        };
        cfg_mgr
            .set_window_position(position)
            .await
            .map_err(|e| format!("保存窗口位置失败: {}", e))?;
        log::info!("窗口位置已保存");
    } else {
        log::debug!("未启用记住窗口位置，跳过保存");
    }

    Ok(())
}

/// 退出应用程序
///
/// # 返回
/// * `Ok(())` - 退出成功
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn exit_app(state: State<'_, AppState>, app: tauri::AppHandle) -> Result<(), String> {
    log::info!("收到退出应用命令");

    // 先清理资源
    let core = state.core.lock().await;

    // 如果在大厅中，先退出大厅
    let lobby_manager = core.get_lobby_manager();
    let lobby_mgr = lobby_manager.lock().await;
    if lobby_mgr.get_current_lobby().is_some() {
        drop(lobby_mgr);
        let network_service = core.get_network_service();
        let voice_service = core.get_voice_service();

        // 清理语音服务
        let voice_svc = voice_service.lock().await;
        if let Err(e) = voice_svc.cleanup().await {
            log::warn!("清理语音服务时发生错误: {}", e);
        }
        drop(voice_svc);

        // 退出大厅
        let mut lobby_mgr = lobby_manager.lock().await;
        let network_svc = network_service.lock().await;
        if let Err(e) = lobby_mgr.leave_lobby(&*network_svc).await {
            log::warn!("退出大厅时发生错误: {}", e);
        }
    }

    drop(core);

    log::info!("资源清理完成，正在退出应用...");

    // 退出应用
    app.exit(0);

    Ok(())
}

/// 获取网络连接状态
///
/// # 返回
/// * `Ok(String)` - 连接状态的 JSON 字符串
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn get_network_status(state: State<'_, AppState>) -> Result<String, String> {
    let core = state.core.lock().await;
    let network_service = core.get_network_service();
    let network_svc = network_service.lock().await;

    let status = network_svc.check_connection().await;

    match serde_json::to_string(&status) {
        Ok(json) => Ok(json),
        Err(e) => Err(format!("序列化连接状态失败: {}", e)),
    }
}

/// 获取虚拟 IP 地址
///
/// # 返回
/// * `Ok(Option<String>)` - 虚拟 IP 地址，如果未连接则返回 None
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn get_virtual_ip(state: State<'_, AppState>) -> Result<Option<String>, String> {
    let core = state.core.lock().await;
    let network_service = core.get_network_service();
    let network_svc = network_service.lock().await;

    let ip = network_svc.get_virtual_ip().await;

    Ok(ip)
}

/// 对等连接类型（虚拟IP -> p2p/relay）
#[derive(serde::Serialize)]
pub struct PeerConnType {
    pub ip: String,
    #[serde(rename = "connType")]
    pub conn_type: String,
    /// 链路延迟（毫秒，来自 EasyTier 自身统计），None 表示未知
    #[serde(rename = "latencyMs", skip_serializing_if = "Option::is_none")]
    pub latency_ms: Option<u64>,
    /// 累计接收字节（用于上层计算下行速率）
    #[serde(rename = "rxBytes", skip_serializing_if = "Option::is_none")]
    pub rx_bytes: Option<u64>,
    /// 累计发送字节（用于上层计算上行速率）
    #[serde(rename = "txBytes", skip_serializing_if = "Option::is_none")]
    pub tx_bytes: Option<u64>,
    /// 丢包率（百分比 0~100），None 表示未知
    #[serde(rename = "lossRate", skip_serializing_if = "Option::is_none")]
    pub loss_rate: Option<u8>,
}

/// 查询大厅内各对等节点的连接类型（P2P 直连 / 中继）。
/// 通过 easytier-cli 连接 easytier-core 的 RPC 端口获取 peer 路由，cost==1 即 P2P 直连。
#[tauri::command]
pub async fn get_peer_connection_types(
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<PeerConnType>, String> {
    // 取当前 RPC 端口
    let rpc_port = {
        let core = state.core.lock().await;
        let ns = core.get_network_service();
        let svc = ns.lock().await;
        svc.get_rpc_port().await
    };
    let port = match rpc_port {
        Some(p) => p,
        None => return Ok(vec![]),
    };

    let cli_path =
        crate::modules::resource_manager::ResourceManager::get_easytier_cli_path(&app_handle)
            .map_err(|e| format!("获取 easytier-cli 失败: {}", e))?;

    let mut cmd = tokio::process::Command::new(&cli_path);
    cmd.args(["-p", &format!("127.0.0.1:{}", port), "-o", "json", "peer"]);
    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let output = tokio::time::timeout(std::time::Duration::from_secs(5), cmd.output())
        .await
        .map_err(|_| "easytier-cli 查询超时".to_string())?
        .map_err(|e| format!("运行 easytier-cli 失败: {}", e))?;
    if !output.status.success() {
        return Ok(vec![]);
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let parsed: serde_json::Value =
        serde_json::from_str(stdout.trim()).unwrap_or(serde_json::Value::Null);

    // 递归收集所有含 ipv4 + cost 的对象（兼容单/多实例的 JSON 结构）
    let mut result: Vec<PeerConnType> = Vec::new();
    fn walk(v: &serde_json::Value, out: &mut Vec<PeerConnType>) {
        match v {
            serde_json::Value::Array(arr) => arr.iter().for_each(|x| walk(x, out)),
            serde_json::Value::Object(map) => {
                let ip = map.get("ipv4").and_then(|x| x.as_str()).unwrap_or("");
                let cost = map.get("cost").and_then(|x| x.as_str());
                if let (false, Some(cost)) = (ip.is_empty(), cost) {
                    if !cost.eq_ignore_ascii_case("local") {
                        let conn = if cost.eq_ignore_ascii_case("p2p") {
                            "p2p"
                        } else {
                            "relay"
                        };
                        // 从 stats 提取延迟/收发字节/丢包（字段名兼容大小写差异）
                        let stats = map.get("stats");
                        let latency_ms = stats
                            .and_then(|s| s.get("latency_us"))
                            .and_then(|v| v.as_u64())
                            .map(|us| us / 1000);
                        let rx_bytes = stats
                            .and_then(|s| s.get("rx_bytes"))
                            .and_then(|v| v.as_u64());
                        let tx_bytes = stats
                            .and_then(|s| s.get("tx_bytes"))
                            .and_then(|v| v.as_u64());
                        let loss_rate = map
                            .get("loss_rate")
                            .and_then(|v| v.as_f64())
                            .map(|f| ((f.clamp(0.0, 1.0)) * 100.0).round() as u8);
                        out.push(PeerConnType {
                            ip: ip.to_string(),
                            conn_type: conn.to_string(),
                            latency_ms,
                            rx_bytes,
                            tx_bytes,
                            loss_rate,
                        });
                    }
                }
                // 继续向下遍历（多实例结构里 peer 列表可能在子字段）
                map.values().for_each(|x| walk(x, out));
            }
            _ => {}
        }
    }
    walk(&parsed, &mut result);
    // 去重（同一 IP 保留首个）
    let mut seen = std::collections::HashSet::new();
    result.retain(|e| seen.insert(e.ip.clone()));
    Ok(result)
}

// ==================== 窗口控制命令 ====================

/// 设置窗口置顶状态
///
/// # 参数
/// * `always_on_top` - true=置顶，false=取消置顶
///
/// # 返回
/// * `Ok(())` - 操作成功
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn set_always_on_top(always_on_top: bool, window: tauri::Window) -> Result<(), String> {
    log::info!("设置窗口置顶状态: {}", always_on_top);

    window
        .set_always_on_top(always_on_top)
        .map_err(|e| format!("设置窗口置顶失败: {}", e))?;

    Ok(())
}

/// 切换迷你模式
///
/// # 参数
/// * `mini_mode` - true=迷你模式，false=正常模式
///
/// # 返回
/// * `Ok(())` - 操作成功
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn toggle_mini_mode(mini_mode: bool, window: tauri::Window) -> Result<(), String> {
    log::info!("切换迷你模式: {}", mini_mode);

    if mini_mode {
        // 迷你模式：小窗口 + 置顶
        window
            .set_size(tauri::Size::Physical(tauri::PhysicalSize {
                width: 320,
                height: 480,
            }))
            .map_err(|e| format!("设置窗口大小失败: {}", e))?;

        window
            .set_always_on_top(true)
            .map_err(|e| format!("设置窗口置顶失败: {}", e))?;

        window
            .set_resizable(false)
            .map_err(|e| format!("设置窗口不可调整大小失败: {}", e))?;
    } else {
        // 正常模式：恢复原始大小 + 取消置顶
        window
            .set_size(tauri::Size::Physical(tauri::PhysicalSize {
                width: 1000,
                height: 700,
            }))
            .map_err(|e| format!("设置窗口大小失败: {}", e))?;

        window
            .set_always_on_top(false)
            .map_err(|e| format!("取消窗口置顶失败: {}", e))?;

        window
            .set_resizable(true)
            .map_err(|e| format!("设置窗口可调整大小失败: {}", e))?;
    }

    Ok(())
}

/// 设置窗口透明度
///
/// # 参数
/// * `opacity` - 透明度值（0.0-1.0）
///
/// # 返回
/// * `Ok(())` - 操作成功
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn set_window_opacity(opacity: f64, window: tauri::Window) -> Result<(), String> {
    let clamped_opacity = opacity.max(0.3).min(1.0);

    // 注意：不再使用 WS_EX_LAYERED + SetLayeredWindowAttributes(LWA_ALPHA)。
    // 该方式会用“整窗统一 alpha”覆盖 Tauri 的逐像素真透明（transparent:true），
    // 导致窗口无法真正透明（圆角/留白处看不到桌面）。
    // 透明度改由前端 CSS（.mini-window 背景 rgba 的 alpha）实现，可保留真透明。
    // 这里仅广播事件，保持兼容。
    window
        .emit("opacity-changed", clamped_opacity)
        .map_err(|e| format!("发送透明度事件失败: {}", e))?;
    Ok(())
}

// ==================== WebRTC 语音通信命令 ====================

/// 发送信令消息
///
/// # 参数
/// * `message` - 信令消息内容（JSON格式）
///
/// # 返回
/// * `Ok(())` - 发送成功
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn send_signaling_message(
    message: serde_json::Value,
    state: State<'_, AppState>,
) -> Result<(), String> {
    log::info!("收到信令消息: {:?}", message);

    let core = state.core.lock().await;
    let p2p_signaling = core.get_p2p_signaling();
    let p2p_svc = p2p_signaling.lock().await;

    // 解析信令消息
    let msg_type = message.get("type").and_then(|v| v.as_str()).unwrap_or("");
    let from = message
        .get("from")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let to = message.get("to").and_then(|v| v.as_str());

    let p2p_message = match msg_type {
        "offer" => {
            let sdp = message
                .get("sdp")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            crate::modules::p2p_signaling::P2PMessage::Offer { from, sdp }
        }
        "answer" => {
            let sdp = message
                .get("sdp")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            crate::modules::p2p_signaling::P2PMessage::Answer { from, sdp }
        }
        "ice-candidate" => {
            let candidate = message
                .get("candidate")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            crate::modules::p2p_signaling::P2PMessage::IceCandidate { from, candidate }
        }
        _ => {
            return Err("未知的信令消息类型".to_string());
        }
    };

    // 发送消息
    if let Some(target) = to {
        p2p_svc
            .send_to_player(target, p2p_message)
            .await
            .map_err(|e| e.to_string())?;
    } else {
        p2p_svc
            .broadcast_to_all(p2p_message)
            .await
            .map_err(|e| e.to_string())?;
    }

    log::debug!("信令消息已处理");
    Ok(())
}

/// 广播状态更新
///
/// # 参数
/// * `player_id` - 玩家ID
/// * `mic_enabled` - 麦克风状态
///
/// # 返回
/// * `Ok(())` - 广播成功
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn broadcast_status_update(
    player_id: String,
    mic_enabled: bool,
    state: State<'_, AppState>,
) -> Result<(), String> {
    log::info!("广播状态更新: player={}, mic={}", player_id, mic_enabled);

    let core = state.core.lock().await;
    let p2p_signaling = core.get_p2p_signaling();
    let p2p_svc = p2p_signaling.lock().await;

    // 创建状态更新消息
    let message = crate::modules::p2p_signaling::P2PMessage::StatusUpdate {
        player_id,
        mic_enabled,
    };

    // 广播消息
    p2p_svc
        .broadcast_to_all(message)
        .await
        .map_err(|e| e.to_string())?;

    log::debug!("状态更新已广播");
    Ok(())
}

/// 发送心跳
///
/// # 参数
/// * `player_id` - 玩家ID
/// * `timestamp` - 时间戳
///
/// # 返回
/// * `Ok(())` - 发送成功
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn send_heartbeat(
    player_id: String,
    timestamp: i64,
    state: State<'_, AppState>,
) -> Result<(), String> {
    log::debug!("收到心跳: player={}, timestamp={}", player_id, timestamp);

    let core = state.core.lock().await;
    let voice_service = core.get_voice_service();
    let voice_svc = voice_service.lock().await;

    voice_svc
        .send_heartbeat(&player_id)
        .await
        .map_err(|e| e.to_string())?;

    log::debug!("心跳已发送");
    Ok(())
}

// ==================== 网络管理命令 ====================

/// 强制停止所有EasyTier进程
///
/// 在创建或加入大厅前调用，确保没有残留的EasyTier进程
///
/// # 返回
/// * `Ok(())` - 停止成功
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn force_stop_easytier(state: State<'_, AppState>) -> Result<(), String> {
    log::info!("🔧 收到强制停止EasyTier进程命令");

    let core = state.core.lock().await;
    let network_service = core.get_network_service();
    let network_svc = network_service.lock().await;

    // 调用NetworkService的stop_easytier方法
    // 该方法已经包含了完整的清理逻辑：
    // 1. 优雅关闭进程（SIGTERM）
    // 2. 强制终止（taskkill /F）
    // 3. 清理虚拟网卡
    // 4. 刷新DNS缓存
    match network_svc.stop_easytier().await {
        Ok(_) => {
            log::info!("✅ EasyTier进程已强制停止并清理完成");
            Ok(())
        }
        Err(e) => {
            log::warn!("⚠️ 强制停止EasyTier进程时出现警告: {}", e);
            // 即使出现错误，也返回成功，因为可能只是没有进程在运行
            Ok(())
        }
    }
}

/// 【#4】取消创建/加入大厅过程中的连接（强制手动停止）
///
/// 关键点：create_lobby/join_lobby 在 start_easytier 的等待期间会一直持有
/// network_service 锁，因此不能通过会抢同一把锁的 force_stop_easytier 来取消。
/// 这里直接用 taskkill 终止 easytier-core 进程（不加任何锁），进程退出后
/// start_easytier 的进程监控任务会把 is_running 置为 false，等待循环随即
/// 返回错误，create_lobby/join_lobby 得以结束并释放锁。
#[tauri::command]
pub async fn cancel_lobby_connecting() -> Result<(), String> {
    log::info!("🛑 收到取消连接命令，直接终止 easytier-core 进程以解除阻塞");

    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        for image in ["easytier-core.exe", "easytier-cli.exe"] {
            let _ = tokio::process::Command::new(windows_system_command("taskkill.exe"))
                .args(["/F", "/IM", image])
                .creation_flags(CREATE_NO_WINDOW)
                .output()
                .await;
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let pkill = unix_system_command("pkill")?;
        let _ = tokio::process::Command::new(pkill)
            .args(["-9", "-f", "easytier-core"])
            .output()
            .await;
    }

    log::info!("✅ 已发送终止信号给 easytier-core 进程");
    Ok(())
}

// ==================== 网络诊断命令 ====================

/// 检查虚拟网卡是否存在
///
/// # 返回
/// * `Ok(bool)` - true 表示虚拟网卡存在
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn check_virtual_adapter() -> Result<bool, String> {
    log::info!("检查虚拟网卡...");

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        use std::process::Command;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        // 使用 ipconfig 命令查找 EasyTier 创建的虚拟网卡
        let output = Command::new(windows_system_command("ipconfig.exe"))
            .arg("/all")
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|e| format!("执行 ipconfig 失败: {}", e))?;

        let output_str = String::from_utf8_lossy(&output.stdout);

        // 查找包含 "EasyTier" 或 "WinTun" 的网卡
        let has_adapter = output_str.contains("EasyTier")
            || output_str.contains("WinTun")
            || output_str.contains("wintun");

        log::info!("虚拟网卡检查结果: {}", has_adapter);
        Ok(has_adapter)
    }

    #[cfg(not(windows))]
    {
        // 非 Windows 平台暂不支持
        Ok(true)
    }
}

/// 检查防火墙规则
///
/// # 返回
/// * `Ok(bool)` - true 表示防火墙规则正常
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn check_firewall_rules() -> Result<bool, String> {
    log::info!("检查防火墙规则...");

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        use std::process::Command;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        // 检查 Windows 防火墙是否已存在 MCTier 的放行规则
        // 注意：必须与 add_firewall_rules 中添加的规则名保持一致
        let output = Command::new(windows_system_command("netsh.exe"))
            .args(&["advfirewall", "firewall", "show", "rule", "name=all"])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|e| format!("执行 netsh 失败: {}", e))?;

        let output_str = String::from_utf8_lossy(&output.stdout);

        // 检查是否存在 MCTier 自身添加的放行规则
        // add_firewall_rules 添加的规则名为：MCTier-in/-out、MCTier-EasyTier-in/-out
        let has_rules = output_str.contains("MCTier");

        log::info!("防火墙规则检查结果: {}", has_rules);
        Ok(has_rules)
    }

    #[cfg(not(windows))]
    {
        Ok(true)
    }
}

/// 查询当前是否以管理员身份运行
#[tauri::command]
pub async fn is_admin() -> bool {
    #[cfg(windows)]
    {
        use windows::Win32::Foundation::HANDLE;
        use windows::Win32::Security::{
            GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY,
        };
        use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};
        unsafe {
            let mut token: HANDLE = HANDLE::default();
            if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token).is_err() {
                return false;
            }
            let mut elevation = TOKEN_ELEVATION { TokenIsElevated: 0 };
            let mut ret_len = 0u32;
            let ok = GetTokenInformation(
                token,
                TokenElevation,
                Some(&mut elevation as *mut _ as *mut _),
                std::mem::size_of::<TOKEN_ELEVATION>() as u32,
                &mut ret_len,
            );
            ok.is_ok() && elevation.TokenIsElevated != 0
        }
    }
    #[cfg(not(windows))]
    {
        true
    }
}

/// 一键添加防火墙放行规则（按程序放行，覆盖该程序所有端口）
///
/// 为 MCTier 主程序与 easytier-core 添加入站/出站允许规则。需要管理员权限。
#[tauri::command]
pub async fn add_firewall_rules(app_handle: tauri::AppHandle) -> Result<String, String> {
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        // 收集要放行的程序路径：MCTier 主程序 + easytier-core
        let mut programs: Vec<(String, std::path::PathBuf)> = Vec::new();
        if let Ok(exe) = std::env::current_exe() {
            programs.push(("MCTier".to_string(), exe));
        }
        if let Ok(et) =
            crate::modules::resource_manager::ResourceManager::get_easytier_path(&app_handle)
        {
            programs.push(("MCTier-EasyTier".to_string(), et));
        }

        if programs.is_empty() {
            return Err("无法确定程序路径".to_string());
        }

        let mut added = 0;
        let mut last_err = String::new();
        for (base_name, path) in &programs {
            let path_str = path.to_string_lossy().to_string();
            for (suffix, dir) in [("-in", "in"), ("-out", "out")] {
                let rule_name = format!("{}{}", base_name, suffix);
                // 先删除同名旧规则避免重复堆积
                let _ = tokio::process::Command::new(windows_system_command("netsh.exe"))
                    .args(&[
                        "advfirewall",
                        "firewall",
                        "delete",
                        "rule",
                        &format!("name={}", rule_name),
                    ])
                    .creation_flags(CREATE_NO_WINDOW)
                    .output()
                    .await;

                let output = tokio::process::Command::new(windows_system_command("netsh.exe"))
                    .args(&[
                        "advfirewall",
                        "firewall",
                        "add",
                        "rule",
                        &format!("name={}", rule_name),
                        &format!("dir={}", dir),
                        "action=allow",
                        &format!("program={}", path_str),
                        "enable=yes",
                        "profile=any",
                    ])
                    .creation_flags(CREATE_NO_WINDOW)
                    .output()
                    .await
                    .map_err(|e| format!("执行 netsh 失败: {}", e))?;

                if output.status.success() {
                    added += 1;
                } else {
                    last_err = String::from_utf8_lossy(&output.stderr).to_string();
                    if last_err.trim().is_empty() {
                        last_err = String::from_utf8_lossy(&output.stdout).to_string();
                    }
                }
            }
        }

        if added > 0 {
            log::info!("✅ 已添加 {} 条防火墙放行规则", added);
            Ok(format!("已添加 {} 条防火墙放行规则", added))
        } else {
            Err(format!(
                "添加防火墙规则失败（可能需要管理员权限）: {}",
                last_err
            ))
        }
    }
    #[cfg(not(windows))]
    {
        let _ = app_handle;
        Ok("非 Windows 平台无需配置防火墙".to_string())
    }
}

/// 以管理员身份重启应用
#[tauri::command]
pub async fn restart_as_admin(app_handle: tauri::AppHandle) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        let exe = std::env::current_exe().map_err(|e| format!("无法获取程序路径: {}", e))?;
        // Keep the executable path out of PowerShell source. Passing it via an
        // environment variable prevents quote/command substitution when an
        // installation directory contains PowerShell metacharacters.
        let powershell = windows_system_command("WindowsPowerShell\\v1.0\\powershell.exe");
        let spawn = std::process::Command::new(powershell)
            .args(&[
                "-NoProfile",
                "-WindowStyle",
                "Hidden",
                "-Command",
                "Start-Process -FilePath $env:MCTIER_EXE -Verb RunAs",
            ])
            .env("MCTIER_EXE", &exe)
            .creation_flags(CREATE_NO_WINDOW)
            .spawn();

        match spawn {
            Ok(_) => {
                log::info!("已请求以管理员身份重启，当前实例即将退出");
                // 稍等片刻让新进程的 UAC 弹出
                tokio::time::sleep(std::time::Duration::from_millis(600)).await;
                app_handle.exit(0);
                Ok(())
            }
            Err(e) => Err(format!("以管理员身份重启失败: {}", e)),
        }
    }
    #[cfg(not(windows))]
    {
        let _ = app_handle;
        Err("当前平台不支持".to_string())
    }
}
///
/// # 参数
/// * `ip` - 要 ping 的 IP 地址
///
/// # 返回
/// * `Ok(bool)` - true 表示可以 ping 通
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn ping_virtual_ip(ip: String) -> Result<bool, String> {
    log::info!("Ping 虚拟 IP: {}", ip);

    let target = ip
        .parse::<std::net::IpAddr>()
        .map_err(|_| "只允许 Ping 有效的 IP 地址".to_string())?;
    if target.is_unspecified() || target.is_multicast() || target.is_loopback() {
        return Err("不允许 Ping 未指定、组播或回环地址".to_string());
    }
    let target = target.to_string();

    use std::process::Command;

    #[cfg(windows)]
    let output = {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        Command::new(windows_system_command("ping.exe"))
            .args(["-n", "2", "-w", "1000", &target])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|e| format!("执行 ping 失败: {}", e))?
    };

    #[cfg(not(windows))]
    let output = Command::new(unix_system_command("ping")?)
        .args(["-c", "2", "-W", "1", &target])
        .output()
        .map_err(|e| format!("执行 ping 失败: {}", e))?;

    let success = output.status.success();
    log::info!("Ping 结果: {}", success);

    Ok(success)
}

/// 检查 UDP 端口是否可用
///
/// # 参数
/// * `port` - 要检查的端口号
///
/// # 返回
/// * `Ok(bool)` - true 表示端口可用
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn check_udp_port(port: u16) -> Result<bool, String> {
    log::info!("检查 UDP 端口: {}", port);

    use std::net::UdpSocket;

    // 尝试绑定端口
    match UdpSocket::bind(format!("0.0.0.0:{}", port)) {
        Ok(_) => {
            log::info!("UDP 端口 {} 可用", port);
            Ok(true)
        }
        Err(e) => {
            log::warn!("UDP 端口 {} 不可用: {}", port, e);
            Ok(false)
        }
    }
}

// ==================== 系统设置命令 ====================

/// 设置开机自启动
///
/// # 参数
/// * `enable` - true=启用自启动，false=禁用自启动
///
/// # 返回
/// * `Ok(())` - 操作成功
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn set_auto_start(enable: bool) -> Result<(), String> {
    log::info!("设置开机自启动: {}", enable);

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        use std::process::Command;
        let app_name = "MCTier";
        let app_path = std::env::current_exe()
            .map_err(|e| format!("获取程序路径失败: {}", e))?
            .to_string_lossy()
            .replace("/", "\\");

        if enable {
            // A quoted executable path is sufficient for a Run key. Avoid
            // storing a PowerShell script in the registry value.
            let reg_value = windows_run_value(&std::path::PathBuf::from(&app_path))?;

            let output = Command::new(windows_system_command("reg.exe"))
                .args([
                    "add",
                    "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
                    "/v",
                    app_name,
                    "/t",
                    "REG_SZ",
                    "/d",
                    &reg_value,
                    "/f",
                ])
                .creation_flags(0x08000000)
                .output()
                .map_err(|e| format!("写入注册表失败: {}", e))?;

            if !output.status.success() {
                let error = String::from_utf8_lossy(&output.stderr);
                log::error!("写入注册表开机自启失败: {}", error);
                return Err(format!("写入注册表失败: {}", error));
            }
            log::info!("开机自启动已启用（无窗口模式），路径: {}", app_path);
            Ok(())
        } else {
            // 删除注册表项
            let output = Command::new(windows_system_command("reg.exe"))
                .args([
                    "delete",
                    "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
                    "/v",
                    app_name,
                    "/f",
                ])
                .creation_flags(0x08000000)
                .output()
                .map_err(|e| format!("删除注册表失败: {}", e))?;

            if !output.status.success() {
                log::warn!("删除注册表开机自启项时出现警告（可能本就不存在）");
            }

            log::info!("开机自启动已禁用");
            Ok(())
        }
    }

    #[cfg(not(windows))]
    {
        log::warn!("当前平台不支持开机自启动设置");
        Err("当前平台不支持开机自启动设置".to_string())
    }
}

/// 检查开机自启动状态
///
/// # 返回
/// * `Ok(bool)` - true=已启用，false=未启用
#[tauri::command]
pub async fn check_auto_start() -> Result<bool, String> {
    log::info!("检查开机自启动状态");

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        use std::process::Command;
        let app_name = "MCTier";
        let output = Command::new(windows_system_command("reg.exe"))
            .args([
                "query",
                "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
                "/v",
                app_name,
            ])
            .creation_flags(0x08000000)
            .output()
            .map_err(|e| format!("查询注册表失败: {}", e))?;

        let is_enabled = output.status.success();
        log::info!("开机自启动状态（注册表）: {}", is_enabled);
        Ok(is_enabled)
    }

    #[cfg(not(windows))]
    {
        Ok(false)
    }
}

// ==================== Magic DNS 命令 ====================

/// 添加玩家域名映射到hosts文件
///
/// # 参数
/// * `domain` - 域名（如：qyzz.mct.net）
/// * `ip` - 虚拟IP地址
/// * `state` - 应用状态
///
/// # 返回
/// * `Ok(())` - 添加成功
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn add_player_domain(
    domain: String,
    ip: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    log::info!("收到添加玩家域名映射命令: {} -> {}", domain, ip);

    let core = state.core.lock().await;
    let lobby_manager = core.get_lobby_manager();
    let manager = lobby_manager.lock().await;

    // 获取当前大厅信息
    let lobby_name = if let Some(lobby) = manager.get_current_lobby() {
        lobby.name.clone()
    } else {
        log::warn!("⚠️ 当前不在大厅中，无法添加域名映射");
        return Err("当前不在大厅中".to_string());
    };

    // 获取或创建HostsManager
    let hosts_manager = if let Some(hm) = manager.get_hosts_manager() {
        // 已存在，直接使用
        hm.add_entry(&domain, &ip)
            .map_err(|e| format!("添加域名映射失败: {}", e))?;

        log::info!("✅ 域名映射已添加: {} -> {}", domain, ip);
        Ok(())
    } else {
        // 不存在，动态创建
        log::info!("📝 HostsManager不存在，动态创建...");
        drop(manager); // 释放锁，以便调用set_hosts_manager

        let new_hosts_manager = crate::modules::hosts_manager::HostsManager::new(&lobby_name);
        new_hosts_manager
            .add_entry(&domain, &ip)
            .map_err(|e| format!("添加域名映射失败: {}", e))?;

        // 重新获取锁并设置HostsManager
        let mut manager = lobby_manager.lock().await;
        manager.set_hosts_manager(Some(new_hosts_manager));

        log::info!(
            "✅ 域名映射已添加（动态创建HostsManager）: {} -> {}",
            domain,
            ip
        );
        Ok(())
    };

    hosts_manager
}

/// 删除玩家域名映射
///
/// # 参数
/// * `domain` - 要删除的域名
/// * `state` - 应用状态
///
/// # 返回
/// * `Ok(())` - 删除成功
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn remove_player_domain(
    domain: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    log::info!("收到删除玩家域名映射命令: {}", domain);

    let core = state.core.lock().await;
    let lobby_manager = core.get_lobby_manager();
    let manager = lobby_manager.lock().await;

    // 获取HostsManager
    if let Some(hosts_manager) = manager.get_hosts_manager() {
        hosts_manager
            .remove_entry(&domain)
            .map_err(|e| format!("删除域名映射失败: {}", e))?;

        log::info!("✅ 域名映射已删除: {}", domain);
        Ok(())
    } else {
        // HostsManager不存在，说明没有域名映射需要删除，直接返回成功
        log::info!("⚠️ HostsManager不存在，跳过删除域名映射");
        Ok(())
    }
}

// ==================== 文件共享操作命令 ====================

use serde::{Deserialize, Serialize};
use std::path::Path;

/// 文件信息结构
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileInfo {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub size: u64,
    pub modified_time: u64,
}

/// 获取文件夹名称
///
/// # 参数
/// * `path` - 文件夹路径
///
/// # 返回
/// * `Ok(String)` - 文件夹名称
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn get_folder_name(path: String) -> Result<String, String> {
    log::info!("获取文件夹名称: {}", path);

    let path_obj = require_existing_directory_grant(&path, PathAccess::ReadDirectory)?;

    if let Some(name) = path_obj.file_name() {
        if let Some(name_str) = name.to_str() {
            Ok(name_str.to_string())
        } else {
            Err("无法转换文件夹名称".to_string())
        }
    } else {
        Err("无效的文件夹路径".to_string())
    }
}

/// 获取文件夹信息（文件数量和总大小）
///
/// # 参数
/// * `path` - 文件夹路径
///
/// # 返回
/// * `Ok((file_count, total_size))` - 文件数量和总大小
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn get_folder_info(path: String) -> Result<serde_json::Value, String> {
    log::info!("获取文件夹信息: {}", path);
    let path_obj = require_existing_directory_grant(&path, PathAccess::ReadDirectory)?;

    let (file_count, total_size) =
        count_files_and_size(&path_obj).map_err(|e| format!("统计文件失败: {}", e))?;

    Ok(serde_json::json!({
        "fileCount": file_count,
        "totalSize": total_size,
    }))
}

/// 递归统计文件数量和总大小
fn count_files_and_size(path: &Path) -> std::io::Result<(usize, u64)> {
    let mut file_count: usize = 0;
    let mut total_size: u64 = 0;

    let metadata = std::fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() {
        return Ok((0, 0));
    }
    if metadata.is_file() {
        file_count = 1;
        total_size = metadata.len();
    } else if metadata.is_dir() {
        for entry in std::fs::read_dir(path)? {
            let entry = entry?;
            let entry_path = entry.path();

            let entry_metadata = std::fs::symlink_metadata(&entry_path)?;
            if is_symlink_or_reparse_point(&entry_metadata) {
                continue;
            }

            let (count, size) = count_files_and_size(&entry_path)?;
            file_count = file_count.saturating_add(count);
            total_size = total_size.saturating_add(size);
        }
    }

    Ok((file_count, total_size))
}

/// 列出目录中的文件和文件夹
///
/// # 参数
/// * `path` - 目录路径
///
/// # 返回
/// * `Ok(Vec<FileInfo>)` - 文件列表
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn list_directory_files(path: String) -> Result<Vec<FileInfo>, String> {
    log::info!("📂 列出目录文件: {}", path);
    let path_obj = require_existing_directory_grant(&path, PathAccess::ReadDirectory)?;

    let mut files = Vec::new();

    let entries = std::fs::read_dir(&path_obj).map_err(|e| format!("读取目录失败: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("读取条目失败: {}", e))?;
        let entry_path = entry.path();

        let metadata =
            std::fs::symlink_metadata(&entry_path).map_err(|e| format!("获取元数据失败: {}", e))?;
        if is_symlink_or_reparse_point(&metadata) {
            log::warn!("跳过目录中的符号链接或重解析点: {}", entry_path.display());
            continue;
        }

        let name = entry.file_name().to_str().unwrap_or("未知").to_string();

        let relative_path = entry_path
            .strip_prefix(&path_obj)
            .unwrap_or(&entry_path)
            .to_str()
            .unwrap_or("")
            .to_string();

        let modified_time = metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);

        let is_dir = metadata.is_dir();

        log::info!(
            "  - {}: {} (is_directory: {})",
            if is_dir { "📁" } else { "📄" },
            name,
            is_dir
        );

        files.push(FileInfo {
            name,
            path: relative_path,
            is_directory: is_dir,
            size: metadata.len(),
            modified_time,
        });
    }

    // 按名称排序（文件夹在前）
    files.sort_by(|a, b| {
        if a.is_directory == b.is_directory {
            a.name.cmp(&b.name)
        } else if a.is_directory {
            std::cmp::Ordering::Less
        } else {
            std::cmp::Ordering::Greater
        }
    });

    log::info!("✅ 返回 {} 个文件/文件夹", files.len());

    Ok(files)
}

/// 读取文件内容（字节数组）
///
/// # 参数
/// * `path` - 文件路径
///
/// # 返回
/// * `Ok(Vec<u8>)` - 文件内容
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn read_file_bytes(path: String) -> Result<Vec<u8>, String> {
    log::info!("读取文件: {}", path);

    const MAX_GENERIC_FILE_BYTES: u64 = 256 * 1024 * 1024;
    let path_obj = require_existing_file_grant(&path, PathAccess::ReadFile)?;
    let metadata =
        std::fs::symlink_metadata(&path_obj).map_err(|e| format!("检查文件失败: {}", e))?;
    if metadata.len() > MAX_GENERIC_FILE_BYTES {
        return Err("文件超过通用读取大小限制".to_string());
    }

    std::fs::read(path_obj).map_err(|e| format!("读取文件失败: {}", e))
}

/// 写入文件内容（字节数组）
///
/// # 参数
/// * `path` - 文件路径
/// * `data` - 文件内容
///
/// # 返回
/// * `Ok(())` - 写入成功
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn write_file_bytes(path: String, data: Vec<u8>) -> Result<(), String> {
    log::info!("写入文件: {} ({} 字节)", path, data.len());

    const MAX_GENERIC_FILE_BYTES: usize = 256 * 1024 * 1024;
    if data.len() > MAX_GENERIC_FILE_BYTES {
        return Err("文件超过通用写入大小限制".to_string());
    }
    let path_obj = require_path_grant(&path, PathAccess::WriteFile, true)?;
    if path_obj.exists() {
        return Err("目标文件已存在，拒绝覆盖".to_string());
    }

    use tokio::io::AsyncWriteExt;
    let mut file = tokio::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path_obj)
        .await
        .map_err(|e| format!("创建文件失败: {}", e))?;
    file.write_all(&data)
        .await
        .map_err(|e| format!("写入文件失败: {}", e))?;
    file.sync_all()
        .await
        .map_err(|e| format!("同步文件失败: {}", e))
}

/// 选择文件夹
///
/// # 返回
/// * `Ok(Option<String>)` - 选择的文件夹路径，None表示取消
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn select_folder() -> Result<Option<String>, String> {
    log::info!("打开文件夹选择对话框");

    use rfd::FileDialog;

    let result = FileDialog::new()
        .set_title("选择要共享的文件夹")
        .pick_folder();

    if let Some(path) = result {
        if let Some(path_str) = path.to_str() {
            register_path_grant(path_str, PathAccess::ReadDirectory, false)?;
            register_path_grant(path_str, PathAccess::Open, false)?;
            log::info!("用户选择了文件夹: {}", path_str);
            Ok(Some(path_str.to_string()))
        } else {
            Err("无法转换文件夹路径".to_string())
        }
    } else {
        log::info!("用户取消了选择");
        Ok(None)
    }
}

/// 选择文件夹共享下载目录
#[tauri::command]
pub async fn select_file_share_download_folder() -> Result<Option<String>, String> {
    log::info!("打开文件共享下载目录选择对话框");
    use rfd::FileDialog;

    let result = FileDialog::new()
        .set_title("选择文件共享下载目录")
        .pick_folder();

    result
        .map(|path| {
            let value = path
                .to_str()
                .ok_or_else(|| "无法转换下载目录路径".to_string())?;
            register_path_grant(value, PathAccess::WriteDirectory, false)?;
            register_path_grant(value, PathAccess::Open, false)?;
            Ok(value.to_string())
        })
        .transpose()
}

fn default_file_share_download_dir() -> std::path::PathBuf {
    dirs::download_dir()
        .or_else(dirs::home_dir)
        .or_else(dirs::data_local_dir)
        .unwrap_or_else(std::env::temp_dir)
        .join("MCTier")
}

fn effective_file_share_download_dir(config: &UserConfig) -> std::path::PathBuf {
    config
        .file_share_download_dir
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .map(std::path::PathBuf::from)
        .unwrap_or_else(default_file_share_download_dir)
}

/// Resolve the download directory through the same authorization path used by
/// all generic filesystem commands. A persisted custom directory is only
/// usable after the native picker has granted it in this process; otherwise a
/// modified config file could turn a filename-only download helper into an
/// arbitrary directory writer.
fn prepare_file_share_download_dir(config: &UserConfig) -> Result<std::path::PathBuf, String> {
    if config
        .file_share_download_dir
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty())
    {
        let directory = effective_file_share_download_dir(config);
        let directory = require_existing_directory_grant(
            directory
                .to_str()
                .ok_or_else(|| "无法转换下载目录路径".to_string())?,
            PathAccess::WriteDirectory,
        )
        .map_err(|_| "自定义下载目录需要在本次运行中重新选择".to_string())?;
        register_path_grant(
            directory
                .to_str()
                .ok_or_else(|| "无法转换下载目录路径".to_string())?,
            PathAccess::ReadDirectory,
            false,
        )?;
        register_path_grant(
            directory
                .to_str()
                .ok_or_else(|| "无法转换下载目录路径".to_string())?,
            PathAccess::Open,
            false,
        )?;
        return Ok(directory);
    }

    let directory = default_file_share_download_dir();
    std::fs::create_dir_all(&directory).map_err(|e| format!("创建下载目录失败: {}", e))?;
    let directory = register_path_grant(
        directory
            .to_str()
            .ok_or_else(|| "无法转换下载目录路径".to_string())?,
        PathAccess::ReadDirectory,
        false,
    )?;
    register_path_grant(
        directory
            .to_str()
            .ok_or_else(|| "无法转换下载目录路径".to_string())?,
        PathAccess::WriteDirectory,
        false,
    )?;
    register_path_grant(
        directory
            .to_str()
            .ok_or_else(|| "无法转换下载目录路径".to_string())?,
        PathAccess::Open,
        false,
    )?;
    Ok(directory)
}

fn validate_download_file_name(file_name: &str) -> Result<&str, String> {
    if file_name.is_empty()
        || file_name == "."
        || file_name == ".."
        || file_name.contains('\0')
        || file_name.contains('/')
        || file_name.contains('\\')
        || file_name.contains(':')
        || file_name.chars().any(char::is_control)
        || file_name
            .chars()
            .any(|ch| matches!(ch, '<' | '>' | '"' | '|' | '?' | '*'))
    {
        return Err("文件名无效".to_string());
    }

    let trimmed = file_name.trim_end_matches([' ', '.']);
    if trimmed.is_empty() || trimmed != file_name {
        return Err("文件名无效".to_string());
    }

    let stem = file_name
        .split('.')
        .next()
        .unwrap_or("")
        .to_ascii_uppercase();
    if matches!(
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
    ) {
        return Err("文件名无效".to_string());
    }

    Ok(file_name)
}

/// 获取文件夹共享的有效下载目录。目录不存在时会自动创建。
#[tauri::command]
pub async fn get_file_share_download_dir(state: State<'_, AppState>) -> Result<String, String> {
    let core = state.core.lock().await;
    let config_manager = core.get_config_manager();
    let cfg_mgr = config_manager.lock().await;
    let directory = prepare_file_share_download_dir(cfg_mgr.get_config())?;
    directory
        .to_str()
        .map(|value| value.to_string())
        .ok_or_else(|| "无法转换下载目录路径".to_string())
}

/// 保存或清除文件夹共享下载目录。传入空字符串或 null 恢复系统默认目录。
#[tauri::command]
pub async fn set_file_share_download_dir(
    path: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let normalized = path
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let normalized = normalized
        .map(|directory| {
            let path = require_existing_directory_grant(&directory, PathAccess::WriteDirectory)?;
            path.to_str()
                .map(|value| value.to_string())
                .ok_or_else(|| "无法转换下载目录路径".to_string())
        })
        .transpose()?;

    let core = state.core.lock().await;
    let config_manager = core.get_config_manager();
    let mut cfg_mgr = config_manager.lock().await;
    cfg_mgr
        .update_config(|config| {
            config.file_share_download_dir = normalized.clone();
        })
        .await
        .map_err(|e| format!("保存下载目录失败: {}", e))
}

/// 根据文件名生成文件夹共享下载路径，统一处理 Windows 路径分隔符。
#[tauri::command]
pub async fn get_file_share_download_path(
    file_name: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let core = state.core.lock().await;
    let config_manager = core.get_config_manager();
    let cfg_mgr = config_manager.lock().await;
    let safe_name = validate_download_file_name(&file_name)?;
    let directory = prepare_file_share_download_dir(cfg_mgr.get_config())?;
    let path = directory.join(safe_name);
    if std::fs::symlink_metadata(&path).is_ok() {
        return Err("目标文件已存在".to_string());
    }
    let path = path
        .to_str()
        .ok_or_else(|| "无法转换下载文件路径".to_string())?;
    register_path_grant(path, PathAccess::WriteFile, true)?;
    register_path_grant(path, PathAccess::ReadFile, true)?;
    register_path_grant(path, PathAccess::DeleteFile, true)?;
    register_path_grant(path, PathAccess::Open, true)?;
    Ok(path.to_string())
}

/// 选择保存位置
///
/// # 参数
/// * `default_name` - 默认文件名
///
/// # 返回
/// * `Ok(Option<String>)` - 选择的保存路径，None表示取消
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn select_save_location(default_name: String) -> Result<Option<String>, String> {
    let default_name = validate_download_file_name(&default_name)?;
    log::info!("打开保存位置选择对话框: {}", default_name);

    use rfd::FileDialog;

    let result = FileDialog::new()
        .set_title("选择保存位置")
        .set_file_name(default_name)
        .save_file();

    if let Some(path) = result {
        if let Some(path_str) = path.to_str() {
            register_path_grant(path_str, PathAccess::WriteFile, true)?;
            register_path_grant(path_str, PathAccess::Open, true)?;
            log::info!("用户选择了保存位置: {}", path_str);
            Ok(Some(path_str.to_string()))
        } else {
            Err("无法转换保存路径".to_string())
        }
    } else {
        log::info!("用户取消了选择");
        Ok(None)
    }
}

/// 选择文件
///
/// # 返回
/// * `Ok(Option<String>)` - 选择的文件路径，None表示取消
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn select_file() -> Result<Option<String>, String> {
    log::info!("打开文件选择对话框");

    use rfd::FileDialog;

    let result = FileDialog::new()
        .set_title("选择配置文件")
        .add_filter("JSON 文件", &["json"])
        .pick_file();

    if let Some(path) = result {
        if let Some(path_str) = path.to_str() {
            let path = normalize_local_path(path_str, false)?;
            if path
                .extension()
                .and_then(|extension| extension.to_str())
                .is_none_or(|extension| !extension.eq_ignore_ascii_case("json"))
            {
                return Err("配置文件必须使用 .json 扩展名".to_string());
            }
            register_path_grant(
                path.to_str()
                    .ok_or_else(|| "无法转换文件路径".to_string())?,
                PathAccess::ReadFile,
                false,
            )?;
            register_path_grant(
                path.to_str()
                    .ok_or_else(|| "无法转换文件路径".to_string())?,
                PathAccess::Open,
                false,
            )?;
            log::info!("用户选择了文件: {}", path_str);
            Ok(Some(path_str.to_string()))
        } else {
            Err("无法转换文件路径".to_string())
        }
    } else {
        log::info!("用户取消了选择");
        Ok(None)
    }
}

/// 打开文件所在文件夹并选中文件
///
/// # 参数
/// * `path` - 文件的完整路径
///
/// # 返回
/// * `Ok(())` - 成功打开
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn open_file_location(path: String) -> Result<(), String> {
    log::info!("打开文件位置: {}", path);

    let path = require_existing_file_grant(&path, PathAccess::Open)?;
    use std::process::Command;

    #[cfg(target_os = "windows")]
    {
        // Windows: 使用 explorer.exe /select,<path>
        match Command::new(windows_system_command("explorer.exe"))
            .args(["/select,", path.to_string_lossy().as_ref()])
            .spawn()
        {
            Ok(_) => {
                log::info!("成功打开文件位置");
                Ok(())
            }
            Err(e) => {
                log::error!("打开文件位置失败: {}", e);
                Err(format!("打开文件位置失败: {}", e))
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        // macOS: 使用 open -R <path>
        match Command::new(unix_system_command("open")?)
            .args(["-R", path.to_string_lossy().as_ref()])
            .spawn()
        {
            Ok(_) => {
                log::info!("成功打开文件位置");
                Ok(())
            }
            Err(e) => {
                log::error!("打开文件位置失败: {}", e);
                Err(format!("打开文件位置失败: {}", e))
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        // Linux: 使用 xdg-open 打开父目录
        use std::path::Path;
        let path_obj = &path;
        if let Some(parent) = path_obj.parent() {
            if let Some(parent_str) = parent.to_str() {
                match Command::new(unix_system_command("xdg-open")?)
                    .arg(parent_str)
                    .spawn()
                {
                    Ok(_) => {
                        log::info!("成功打开文件位置");
                        Ok(())
                    }
                    Err(e) => {
                        log::error!("打开文件位置失败: {}", e);
                        Err(format!("打开文件位置失败: {}", e))
                    }
                }
            } else {
                Err("无法转换父目录路径".to_string())
            }
        } else {
            Err("无法获取父目录".to_string())
        }
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        Err("不支持的操作系统".to_string())
    }
}

/// 直接打开文件夹
///
/// # 参数
/// * `path` - 文件夹路径
///
/// # 返回
/// * `Ok(())` - 成功打开
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn open_folder(path: String) -> Result<(), String> {
    log::info!("打开文件夹: {}", path);

    let path = require_existing_directory_grant(&path, PathAccess::Open)?;
    use std::process::Command;

    #[cfg(target_os = "windows")]
    {
        // Windows: 直接使用 explorer.exe 打开文件夹
        match Command::new(windows_system_command("explorer.exe"))
            .arg(&path)
            .spawn()
        {
            Ok(_) => {
                log::info!("成功打开文件夹");
                Ok(())
            }
            Err(e) => {
                log::error!("打开文件夹失败: {}", e);
                Err(format!("打开文件夹失败: {}", e))
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        // macOS: 使用 open 打开文件夹
        match Command::new(unix_system_command("open")?)
            .arg(&path)
            .spawn()
        {
            Ok(_) => {
                log::info!("成功打开文件夹");
                Ok(())
            }
            Err(e) => {
                log::error!("打开文件夹失败: {}", e);
                Err(format!("打开文件夹失败: {}", e))
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        // Linux: 使用 xdg-open 打开文件夹
        match Command::new(unix_system_command("xdg-open")?)
            .arg(&path)
            .spawn()
        {
            Ok(_) => {
                log::info!("成功打开文件夹");
                Ok(())
            }
            Err(e) => {
                log::error!("打开文件夹失败: {}", e);
                Err(format!("打开文件夹失败: {}", e))
            }
        }
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        Err("不支持的操作系统".to_string())
    }
}

// ==================== Rust高性能文件传输命令 ====================

// 注意：由于Rust文件传输模块的复杂性，暂时保留JavaScript实现
// 未来可以考虑完全迁移到Rust后端以获得更好的性能

// ==================== HTTP 文件共享命令 ====================

use crate::modules::file_transfer::{
    FileInfo as FileTransferFileInfo, SharedFolder, SharedFolderSummary,
};

/// 启动HTTP文件服务器
#[tauri::command]
pub async fn start_file_server(
    virtual_ip: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    log::info!("启动HTTP文件服务器: {}", virtual_ip);

    let core = state.core.lock().await;
    let file_transfer = core.get_file_transfer();
    let ft_service = file_transfer.lock().await;

    // 先尝试停止旧的服务器（如果存在）
    ft_service.stop_server().await;
    log::info!("已停止旧的HTTP文件服务器（如果存在）");

    // 等待端口完全释放
    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

    // 设置虚拟IP
    ft_service.set_virtual_ip(virtual_ip);

    // 启动服务器
    match ft_service.start_server().await {
        Ok(_) => {
            log::info!("✅ HTTP文件服务器启动成功");
            Ok(())
        }
        Err(e) => {
            log::error!("❌ HTTP文件服务器启动失败: {}", e);
            Err(e.to_string())
        }
    }
}

/// 停止HTTP文件服务器
#[tauri::command]
pub async fn stop_file_server(state: State<'_, AppState>) -> Result<(), String> {
    log::info!("停止HTTP文件服务器");

    let core = state.core.lock().await;
    let file_transfer = core.get_file_transfer();
    let ft_service = file_transfer.lock().await;

    ft_service.stop_server().await;
    log::info!("✅ HTTP文件服务器已停止");
    Ok(())
}

/// 检查HTTP文件服务器状态
#[tauri::command]
pub async fn check_file_server_status(state: State<'_, AppState>) -> Result<bool, String> {
    let core = state.core.lock().await;
    let file_transfer = core.get_file_transfer();
    let ft_service = file_transfer.lock().await;

    // 检查服务器句柄是否存在
    let is_running = ft_service.is_running();
    log::info!(
        "📊 HTTP文件服务器状态: {}",
        if is_running { "运行中" } else { "未运行" }
    );
    Ok(is_running)
}

/// 添加共享文件夹
#[tauri::command]
pub async fn add_shared_folder(
    mut share: SharedFolder,
    state: State<'_, AppState>,
) -> Result<(), String> {
    log::info!("📁 添加共享文件夹: {} ({})", share.name, share.id);

    let shared_path = require_existing_directory_grant(&share.path, PathAccess::ReadDirectory)?;
    share.path = shared_path
        .to_str()
        .ok_or_else(|| "无法转换共享目录路径".to_string())?
        .to_string();

    let core = state.core.lock().await;
    let file_transfer = core.get_file_transfer();
    let ft_service = file_transfer.lock().await;

    // 检查HTTP服务器是否已启动
    let is_running = ft_service.is_running();

    if !is_running {
        log::info!("🚀 首次添加共享，启动HTTP文件服务器...");

        // 启动HTTP服务器
        match ft_service.start_server().await {
            Ok(_) => {
                log::info!("✅ HTTP文件服务器启动成功");
            }
            Err(e) => {
                log::error!("❌ HTTP文件服务器启动失败: {}", e);
                return Err(format!("启动HTTP文件服务器失败: {}", e));
            }
        }
    } else {
        log::info!("📡 HTTP文件服务器已在运行中");
    }

    // 添加共享
    ft_service.add_share(share)
}

/// 删除共享文件夹
#[tauri::command]
pub async fn remove_shared_folder(
    share_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    log::debug!("删除共享文件夹: {}", share_id);

    let core = state.core.lock().await;
    let file_transfer = core.get_file_transfer();
    let ft_service = file_transfer.lock().await;

    ft_service.remove_share(&share_id)
}

/// 获取本地共享列表
#[tauri::command]
pub async fn get_local_shares(state: State<'_, AppState>) -> Result<Vec<SharedFolder>, String> {
    let core = state.core.lock().await;
    let file_transfer = core.get_file_transfer();
    let ft_service = file_transfer.lock().await;

    Ok(ft_service.get_shares())
}

/// 清理过期共享
#[tauri::command]
pub async fn cleanup_expired_shares(state: State<'_, AppState>) -> Result<(), String> {
    log::debug!("清理过期共享");

    let core = state.core.lock().await;
    let file_transfer = core.get_file_transfer();
    let ft_service = file_transfer.lock().await;

    ft_service.cleanup_expired_shares();
    Ok(())
}

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

async fn read_remote_body_limited(
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
async fn commit_download_part_noreplace(
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

/// 节点延迟测试结果
#[derive(serde::Serialize)]
pub struct NodeLatencyResult {
    pub address: String,
    pub reachable: bool,
    pub latency_ms: Option<u64>,
}

/// 从节点地址解析出 host 和 port（best-effort）
fn parse_node_host_port(address: &str) -> Option<(String, u16)> {
    let trimmed = address.trim();
    // 去掉 scheme
    let (scheme, rest) = match trimmed.split_once("://") {
        Some((s, r)) => (s.to_lowercase(), r),
        None => ("".to_string(), trimmed),
    };
    // 去掉路径部分
    let host_port = rest.split('/').next().unwrap_or(rest);
    // 默认端口：wss/https->443, ws/http->80, 其它(tcp/udp)->11010
    let default_port: u16 = match scheme.as_str() {
        "wss" | "https" => 443,
        "ws" | "http" => 80,
        _ => 11010,
    };
    if let Some((h, p)) = host_port.rsplit_once(':') {
        // 处理 IPv6 不在此范围，简单处理
        if let Ok(port) = p.parse::<u16>() {
            return Some((h.to_string(), port));
        }
        return Some((host_port.to_string(), default_port));
    }
    if host_port.is_empty() {
        return None;
    }
    Some((host_port.to_string(), default_port))
}

/// 测试单个节点的延迟（通过 TCP 连接测时；连接成功或被拒绝都视为可达）
#[tauri::command]
pub async fn test_node_latency(address: String) -> NodeLatencyResult {
    use tokio::net::TcpStream;

    let (host, port) = match parse_node_host_port(&address) {
        Some(hp) => hp,
        None => {
            return NodeLatencyResult {
                address,
                reachable: false,
                latency_ms: None,
            }
        }
    };

    let start = std::time::Instant::now();
    let connect = TcpStream::connect((host.as_str(), port));
    match tokio::time::timeout(std::time::Duration::from_secs(3), connect).await {
        Ok(Ok(_stream)) => {
            // 连接成功 = 可达
            NodeLatencyResult {
                address,
                reachable: true,
                latency_ms: Some(start.elapsed().as_millis() as u64),
            }
        }
        Ok(Err(e)) => {
            // 连接被拒绝(ConnectionRefused)说明主机可达、端口未开（如UDP节点）
            let refused = e.kind() == std::io::ErrorKind::ConnectionRefused;
            NodeLatencyResult {
                address,
                reachable: refused,
                latency_ms: if refused {
                    Some(start.elapsed().as_millis() as u64)
                } else {
                    None
                },
            }
        }
        Err(_) => NodeLatencyResult {
            address,
            reachable: false,
            latency_ms: None,
        },
    }
}

/// 检测系统中正在运行的常见安全软件 / 杀毒软件（用于排障：被拦截是组网失败的常见原因）
///
/// 返回检测到的安全软件名称列表（中文友好名）。仅 Windows 有效。
#[tauri::command]
pub async fn detect_security_software() -> Vec<String> {
    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        // 进程名(小写) -> 友好名
        let known: &[(&str, &str)] = &[
            ("360tray.exe", "360安全卫士"),
            ("360safe.exe", "360安全卫士"),
            ("360sd.exe", "360杀毒"),
            ("zhudongfangyu.exe", "360主动防御"),
            ("huorong.exe", "火绒安全"),
            ("hipstray.exe", "火绒安全"),
            ("wsctrl.exe", "火绒安全"),
            ("qqpctray.exe", "腾讯电脑管家"),
            ("qqpcrtp.exe", "腾讯电脑管家"),
            ("kxetray.exe", "金山毒霸"),
            ("kxescore.exe", "金山毒霸"),
            ("ksafe.exe", "金山卫士"),
            ("baidusdtray.exe", "百度卫士"),
            ("avp.exe", "卡巴斯基"),
            ("avgui.exe", "AVG"),
            ("avastui.exe", "Avast"),
            ("msmpeng.exe", "Windows Defender"),
            ("nortonsecurity.exe", "诺顿"),
            ("mcshield.exe", "McAfee"),
            ("ecls.exe", "ESET NOD32"),
            ("egui.exe", "ESET NOD32"),
        ];

        let output = tokio::process::Command::new(windows_system_command("tasklist.exe"))
            .args(&["/fo", "csv", "/nh"])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .await;

        let mut detected: Vec<String> = Vec::new();
        if let Ok(out) = output {
            // tasklist 输出可能是 GBK，这里用 lossy 处理；进程名是 ASCII，匹配不受影响
            let text = String::from_utf8_lossy(&out.stdout).to_lowercase();
            for (proc_name, friendly) in known {
                if text.contains(proc_name) {
                    let f = friendly.to_string();
                    if !detected.contains(&f) {
                        detected.push(f);
                    }
                }
            }
        }
        detected
    }

    #[cfg(not(target_os = "windows"))]
    {
        Vec::new()
    }
}

/// 一键导出日志：将日志目录打包为 zip，返回生成的 zip 路径
#[tauri::command]
pub async fn export_logs(_app_handle: tauri::AppHandle) -> Result<String, String> {
    // 日志目录：%LOCALAPPDATA%/MCTier（与 get_log_file_path 保持一致）
    let log_dir = dirs::data_local_dir()
        .map(|d| d.join("MCTier"))
        .ok_or_else(|| "无法获取日志目录".to_string())?;

    if !log_dir.exists() {
        return Err("日志目录不存在".to_string());
    }

    // 输出到桌面（无法获取时回退到日志目录）
    let out_dir = dirs::desktop_dir().unwrap_or_else(|| log_dir.clone());

    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let zip_path = out_dir.join(format!("MCTier_logs_{}.zip", ts));

    // 在阻塞线程里打包，避免阻塞异步运行时
    let log_dir_clone = log_dir.clone();
    let zip_path_clone = zip_path.clone();
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        let zip_file =
            std::fs::File::create(&zip_path_clone).map_err(|e| format!("创建zip失败: {}", e))?;
        let mut zip = zip::ZipWriter::new(zip_file);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated)
            .compression_level(Some(6));

        let entries =
            std::fs::read_dir(&log_dir_clone).map_err(|e| format!("读取日志目录失败: {}", e))?;
        let mut count = 0;
        for entry in entries.flatten() {
            let path = entry.path();
            // 只打包日志相关文件（.log / .txt），跳过子目录与其它文件
            let is_log = path
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.eq_ignore_ascii_case("log") || e.eq_ignore_ascii_case("txt"))
                .unwrap_or(false);
            if path.is_file() && is_log {
                let name = entry.file_name().to_string_lossy().to_string();
                if let Ok(mut f) = std::fs::File::open(&path) {
                    if zip.start_file(name, options).is_ok() {
                        let _ = std::io::copy(&mut f, &mut zip);
                        count += 1;
                    }
                }
            }
        }
        zip.finish().map_err(|e| format!("完成zip失败: {}", e))?;
        if count == 0 {
            return Err("没有可导出的日志文件".to_string());
        }
        Ok(())
    })
    .await
    .map_err(|e| format!("打包任务失败: {}", e))??;

    let zip_path = zip_path
        .to_str()
        .ok_or_else(|| "无法转换日志导出路径".to_string())?;
    register_path_grant(zip_path, PathAccess::Open, false)?;
    register_path_grant(zip_path, PathAccess::DeleteFile, false)?;
    Ok(zip_path.to_string())
}

/// 诊断文件共享连接
///
/// # 参数
/// * `peer_ip` - 对方的虚拟IP
///
/// # 返回
/// * `Ok(String)` - 诊断结果（JSON格式）
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn diagnose_file_share_connection(
    peer_ip: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    log::info!("🔍 开始诊断文件共享连接: {}", peer_ip);
    let target = require_file_peer_host(&peer_ip, &state).await?;

    let mut results = serde_json::json!({
        "peer_ip": peer_ip,
        "tests": []
    });

    // 测试1: Ping虚拟IP
    log::info!("📡 测试1: Ping虚拟IP...");
    let ping_result = ping_virtual_ip(peer_ip.clone()).await;
    let ping_success = ping_result.is_ok() && ping_result.unwrap_or(false);
    results["tests"]
        .as_array_mut()
        .unwrap()
        .push(serde_json::json!({
            "name": "Ping虚拟IP",
            "success": ping_success,
            "message": if ping_success {
                "✅ 虚拟网络连接正常"
            } else {
                "❌ 无法ping通虚拟IP，虚拟网络可能未连接"
            }
        }));

    // 测试2: 检查HTTP服务器端口
    log::info!("🔌 测试2: 检查HTTP服务器端口...");
    let url = format!("http://{}:14539/api/shares", target.host);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| format!("创建HTTP客户端失败: {}", e))?;

    let http_result = client
        .get(&url)
        .header(
            crate::modules::file_transfer::LOBBY_TOKEN_HEADER,
            &target.token,
        )
        .send()
        .await;
    let http_message = if http_result.is_ok() {
        "✅ HTTP文件服务器可访问".to_string()
    } else {
        format!(
            "❌ 无法连接HTTP服务器: {}",
            http_result.as_ref().err().unwrap()
        )
    };

    results["tests"]
        .as_array_mut()
        .unwrap()
        .push(serde_json::json!({
            "name": "HTTP服务器连接",
            "success": http_result.is_ok(),
            "message": http_message
        }));

    // 测试3: 获取共享列表
    if http_result.is_ok() {
        log::info!("📋 测试3: 获取共享列表...");
        match get_remote_shares(peer_ip.clone(), state).await {
            Ok(shares) => {
                results["tests"]
                    .as_array_mut()
                    .unwrap()
                    .push(serde_json::json!({
                        "name": "获取共享列表",
                        "success": true,
                        "message": format!("✅ 成功获取 {} 个共享", shares.len())
                    }));
            }
            Err(e) => {
                results["tests"]
                    .as_array_mut()
                    .unwrap()
                    .push(serde_json::json!({
                        "name": "获取共享列表",
                        "success": false,
                        "message": format!("❌ 获取共享列表失败: {}", e)
                    }));
            }
        }
    }

    log::info!("✅ 诊断完成");

    Ok(serde_json::to_string_pretty(&results).unwrap())
}

// ==================== 文件下载命令 ====================

// ZIP extraction helpers keep every output path inside the selected directory.
const MAX_ZIP_ENTRIES: usize = 4096;
const MAX_ZIP_ENTRY_UNCOMPRESSED_BYTES: u64 = 512 * 1024 * 1024;
const MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES: u64 = 2 * 1024 * 1024 * 1024;

fn is_symlink_or_reparse_point(metadata: &std::fs::Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return true;
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::fs::MetadataExt;

        // FILE_ATTRIBUTE_REPARSE_POINT. Junctions and other reparse points can
        // redirect extraction outside of the user-selected directory.
        return metadata.file_attributes() & 0x400 != 0;
    }

    #[cfg(not(target_os = "windows"))]
    false
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

/// Normalize a ZIP entry using Windows path rules on every platform. Archives
/// are often produced on Linux and extracted on Windows, so backslashes,
/// device names and alternate data stream syntax must be rejected uniformly.
fn safe_zip_entry_path(name: &str) -> Result<(std::path::PathBuf, String), String> {
    if name.is_empty() || name.contains('\0') {
        return Err(format!("拒绝空或包含NUL的ZIP条目: {}", name));
    }

    let normalized = name.replace('\\', "/");
    if normalized.starts_with('/') || normalized.starts_with("//") {
        return Err(format!("拒绝绝对ZIP条目路径: {}", name));
    }

    // ZIP directory entries conventionally end in one slash. Strip only that
    // marker while rejecting repeated separators and empty path components.
    let components_text = normalized.strip_suffix('/').unwrap_or(&normalized);
    if components_text.is_empty() || components_text.ends_with('/') {
        return Err(format!("拒绝不安全的ZIP条目路径: {}", name));
    }

    let mut path = std::path::PathBuf::new();
    let mut components = Vec::new();
    for component in components_text.split('/') {
        if component == "." || component == ".." {
            return Err(format!("拒绝不安全的ZIP条目路径: {}", name));
        }
        if component.chars().any(|ch| ch.is_control())
            || component.contains(':')
            || component
                .chars()
                .any(|ch| matches!(ch, '<' | '>' | '"' | '|' | '?' | '*'))
            || component != component.trim_end_matches([' ', '.'])
            || is_windows_reserved_name(component)
        {
            return Err(format!("拒绝不安全的ZIP条目名称: {}", name));
        }
        path.push(component);
        components.push(component.to_string());
    }

    if components.is_empty() {
        return Err(format!("拒绝空的ZIP条目路径: {}", name));
    }

    let key = components
        .iter()
        .map(|component| component.to_ascii_lowercase())
        .collect::<Vec<_>>()
        .join("/");

    Ok((path, key))
}

fn ensure_no_link_components(path: &std::path::Path) -> Result<(), String> {
    let mut current = std::path::PathBuf::new();
    for component in path.components() {
        current.push(component.as_os_str());
        match std::fs::symlink_metadata(&current) {
            Ok(metadata) if is_symlink_or_reparse_point(&metadata) => {
                return Err(format!("拒绝经过符号链接或重解析点: {}", current.display()));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => break,
            Err(error) => {
                return Err(format!("检查路径失败 {}: {}", current.display(), error));
            }
        }
    }
    Ok(())
}

fn ensure_safe_zip_directory(
    extraction_root: &std::path::Path,
    relative_path: &std::path::Path,
    created_dirs: &mut Vec<std::path::PathBuf>,
) -> Result<std::path::PathBuf, String> {
    use std::io::ErrorKind;
    use std::path::Component;

    let mut current = extraction_root.to_path_buf();

    for component in relative_path.components() {
        let Component::Normal(component) = component else {
            return Err(format!(
                "ZIP条目包含不安全的目录组件: {}",
                relative_path.display()
            ));
        };

        current.push(component);
        match std::fs::symlink_metadata(&current) {
            Ok(metadata) => {
                if is_symlink_or_reparse_point(&metadata) || !metadata.is_dir() {
                    return Err(format!(
                        "ZIP解压路径包含符号链接、重解析点或非目录项: {}",
                        current.display()
                    ));
                }
            }
            Err(error) if error.kind() == ErrorKind::NotFound => {
                std::fs::create_dir(&current)
                    .map_err(|e| format!("创建目录失败 {}: {}", current.display(), e))?;
                created_dirs.push(current.clone());
            }
            Err(error) => {
                return Err(format!("检查解压目录失败 {}: {}", current.display(), error));
            }
        }

        let canonical = std::fs::canonicalize(&current)
            .map_err(|e| format!("规范化解压目录失败 {}: {}", current.display(), e))?;
        if !canonical.starts_with(extraction_root) {
            return Err(format!("ZIP条目试图写出目标目录: {}", current.display()));
        }
        current = canonical;
    }

    Ok(current)
}

fn extract_zip_archive(
    zip_path: &std::path::Path,
    extract_dir: &std::path::Path,
    requested_total_budget: Option<u64>,
) -> Result<Vec<String>, String> {
    use std::collections::HashSet;
    use std::fs::{File, OpenOptions};
    use std::io::{ErrorKind, Read};
    use zip::ZipArchive;

    let zip_metadata =
        std::fs::symlink_metadata(zip_path).map_err(|e| format!("检查ZIP文件失败: {}", e))?;
    if is_symlink_or_reparse_point(&zip_metadata) || !zip_metadata.is_file() {
        return Err(format!("ZIP路径不是普通本地文件: {}", zip_path.display()));
    }

    ensure_no_link_components(
        extract_dir
            .parent()
            .unwrap_or_else(|| std::path::Path::new(".")),
    )?;
    match std::fs::symlink_metadata(extract_dir) {
        Ok(metadata) => {
            if is_symlink_or_reparse_point(&metadata) || !metadata.is_dir() {
                return Err(format!(
                    "解压目标目录不能是符号链接或非目录: {}",
                    extract_dir.display()
                ));
            }
        }
        Err(error) if error.kind() == ErrorKind::NotFound => {
            std::fs::create_dir_all(extract_dir)
                .map_err(|e| format!("创建解压目标目录失败: {}", e))?;
            ensure_no_link_components(extract_dir)?;
        }
        Err(error) => {
            return Err(format!("检查解压目标目录失败: {}", error));
        }
    }
    let extraction_root =
        std::fs::canonicalize(extract_dir).map_err(|e| format!("规范化解压目标目录失败: {}", e))?;
    let root_metadata = std::fs::symlink_metadata(extract_dir)
        .map_err(|e| format!("检查解压目标目录失败: {}", e))?;
    if is_symlink_or_reparse_point(&root_metadata) || !root_metadata.is_dir() {
        return Err(format!(
            "解压目标目录不能是符号链接或非目录: {}",
            extract_dir.display()
        ));
    }

    let file = File::open(zip_path).map_err(|e| format!("打开ZIP文件失败: {}", e))?;
    let mut archive = ZipArchive::new(file).map_err(|e| format!("读取ZIP文件失败: {}", e))?;

    if archive.len() > MAX_ZIP_ENTRIES {
        return Err(format!("ZIP条目数量超过限制: {}", MAX_ZIP_ENTRIES));
    }

    let total_budget = requested_total_budget
        .unwrap_or(MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES)
        .min(MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES);
    let mut total_uncompressed = 0u64;
    let mut seen = HashSet::new();
    let mut files = HashSet::new();
    let mut plans = Vec::with_capacity(archive.len());

    // Validate every entry before writing anything so a malicious archive
    // cannot leave a partially extracted payload behind.
    for i in 0..archive.len() {
        let entry = archive
            .by_index(i)
            .map_err(|e| format!("读取ZIP条目失败: {}", e))?;
        if entry.is_symlink() {
            return Err(format!("拒绝ZIP中的符号链接条目: {}", entry.name()));
        }

        let (relative_path, key) = safe_zip_entry_path(entry.name())?;
        if !seen.insert(key.clone()) {
            return Err(format!("拒绝ZIP中的重复条目: {}", entry.name()));
        }

        let entry_size = entry.size();
        if entry_size > MAX_ZIP_ENTRY_UNCOMPRESSED_BYTES {
            return Err(format!("ZIP单条目解压大小超过限制: {}", entry.name()));
        }
        total_uncompressed = total_uncompressed
            .checked_add(entry_size)
            .ok_or_else(|| "ZIP总解压大小溢出".to_string())?;
        if total_uncompressed > total_budget {
            return Err(format!("ZIP总解压大小超过预算: {}", total_budget));
        }

        if !entry.is_dir() {
            files.insert(key.clone());
        }
        plans.push((i, relative_path, key, entry.is_dir(), entry_size));
    }

    // Reject a file used as a parent directory before touching the output.
    for key in &files {
        let mut prefix = String::new();
        let parts: Vec<&str> = key.split('/').collect();
        for component in parts.iter().take(parts.len().saturating_sub(1)) {
            if !prefix.is_empty() {
                prefix.push('/');
            }
            prefix.push_str(component);
            if files.contains(&prefix) {
                return Err(format!("ZIP条目文件与目录冲突: {}", key));
            }
        }
    }

    let mut extracted_files = Vec::new();
    let mut created_files = Vec::new();
    let mut created_dirs = Vec::new();
    let extraction_result: Result<(), String> = (|| {
        for (index, relative_path, _key, is_dir, entry_size) in plans {
            let mut entry = archive
                .by_index(index)
                .map_err(|e| format!("读取ZIP条目失败: {}", e))?;

            if is_dir {
                let directory =
                    ensure_safe_zip_directory(&extraction_root, &relative_path, &mut created_dirs)?;
                log::info!("📁 创建目录: {:?}", directory);
                continue;
            }

            let file_name = relative_path
                .file_name()
                .ok_or_else(|| format!("ZIP条目缺少文件名: {}", entry.name()))?;
            let parent_path = relative_path
                .parent()
                .unwrap_or_else(|| std::path::Path::new(""));
            let safe_parent =
                ensure_safe_zip_directory(&extraction_root, parent_path, &mut created_dirs)?;
            let outpath = safe_parent.join(file_name);

            // create_new prevents following a pre-existing symlink/hard link
            // and avoids silently overwriting files in the selected directory.
            let mut outfile = match OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&outpath)
            {
                Ok(file) => file,
                Err(error) if error.kind() == ErrorKind::AlreadyExists => {
                    return Err(format!("目标文件已存在，拒绝覆盖: {}", outpath.display()));
                }
                Err(error) => {
                    return Err(format!("创建文件失败 {}: {}", outpath.display(), error));
                }
            };
            created_files.push(outpath.clone());

            log::info!("📄 解压文件: {:?}", outpath);
            let mut limited_entry = (&mut entry).take(entry_size.saturating_add(1));
            let copied = std::io::copy(&mut limited_entry, &mut outfile)
                .map_err(|e| format!("写入文件失败: {}", e))?;
            if copied != entry_size {
                return Err(format!(
                    "ZIP条目实际解压大小与声明不匹配: {} ({} != {})",
                    entry.name(),
                    copied,
                    entry_size
                ));
            }
            extracted_files.push(outpath.to_string_lossy().to_string());
        }
        Ok(())
    })();

    if let Err(error) = extraction_result {
        for path in created_files.iter().rev() {
            let _ = std::fs::remove_file(path);
        }
        for path in created_dirs.iter().rev() {
            let _ = std::fs::remove_dir(path);
        }
        return Err(error);
    }

    Ok(extracted_files)
}

/// 解压ZIP文件到指定目录
///
/// # 参数
/// * `zip_path` - ZIP文件路径
/// * `extract_dir` - 解压目标目录
/// * `max_total_bytes` - 本次解压允许的最大总字节数；为空时使用硬上限
///
/// # 返回
/// * `Ok(Vec<String>)` - 解压的文件列表
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn extract_zip(
    zip_path: String,
    extract_dir: String,
    max_total_bytes: Option<u64>,
) -> Result<Vec<String>, String> {
    log::info!("📦 解压ZIP文件: {} -> {}", zip_path, extract_dir);

    let zip_path = require_existing_file_grant(&zip_path, PathAccess::ReadFile)?;
    let extract_dir = require_existing_directory_grant(&extract_dir, PathAccess::WriteDirectory)?;

    let extracted_files = tokio::task::spawn_blocking(move || {
        extract_zip_archive(&zip_path, &extract_dir, max_total_bytes)
    })
    .await
    .map_err(|e| format!("解压任务失败: {}", e))??;

    log::info!("✅ ZIP文件解压完成，共 {} 个文件", extracted_files.len());
    Ok(extracted_files)
}

#[cfg(test)]
mod path_security_tests {
    use super::{
        normalize_local_path, overlay_http_host, register_path_grant, require_existing_file_grant,
        validate_download_file_name, PathAccess,
    };

    #[test]
    fn remote_http_targets_stay_inside_the_fixed_overlay() {
        assert_eq!(overlay_http_host("10.126.126.1").unwrap(), "10.126.126.1");
        assert_eq!(
            overlay_http_host("10.126.126.254").unwrap(),
            "10.126.126.254"
        );
        for target in [
            "10.126.126.0",
            "10.126.126.255",
            "10.126.125.1",
            "192.168.1.10",
            "8.8.8.8",
        ] {
            assert!(overlay_http_host(target).is_err(), "accepted {target}");
        }
    }

    #[test]
    fn file_grants_are_required_for_existing_files() {
        let temp = tempfile::tempdir().expect("create temp dir");
        let path = temp.path().join("safe.txt");
        std::fs::write(&path, b"safe").expect("create file");
        let path = path.to_str().expect("UTF-8 path");

        assert!(require_existing_file_grant(path, PathAccess::ReadFile).is_err());
        register_path_grant(path, PathAccess::ReadFile, false).expect("register read grant");
        assert!(require_existing_file_grant(path, PathAccess::ReadFile).is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn new_file_grants_reject_dangling_symlinks() {
        use std::os::unix::fs::symlink;

        let temp = tempfile::tempdir().expect("create temp dir");
        let target = temp.path().join("missing-target");
        let link = temp.path().join("dangling-link");
        symlink(&target, &link).expect("create dangling symlink");

        assert!(normalize_local_path(link.to_str().expect("UTF-8 path"), true).is_err());
    }

    #[test]
    fn download_and_picker_names_reject_path_syntax() {
        for name in [
            "nested/file.txt",
            "nested\\file.txt",
            "payload:stream",
            "bad<name>.txt",
            "trailing.",
            "CON.txt",
        ] {
            assert!(
                validate_download_file_name(name).is_err(),
                "accepted {name:?}"
            );
        }
        assert!(validate_download_file_name("normal-file.txt").is_ok());
    }

    #[cfg(windows)]
    #[test]
    fn local_paths_reject_ads_and_device_names() {
        for path in [r"C:\safe\payload::$DATA", r"C:\safe\CON.txt"] {
            assert!(
                normalize_local_path(path, true).is_err(),
                "accepted {path:?}"
            );
        }
    }
}

#[cfg(test)]
mod zip_extraction_tests {
    use super::extract_zip_archive;
    use std::io::Write;

    fn create_zip(zip_path: &std::path::Path, entries: &[(&str, &[u8])]) {
        let file = std::fs::File::create(zip_path).expect("create test zip");
        let mut writer = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default();

        for (name, contents) in entries {
            writer.start_file(*name, options).expect("start zip entry");
            writer.write_all(contents).expect("write zip entry");
        }

        writer.finish().expect("finish test zip");
    }

    #[test]
    fn extracts_valid_nested_files() {
        let temp = tempfile::tempdir().expect("create temp dir");
        let zip_path = temp.path().join("valid.zip");
        let extract_dir = temp.path().join("output");
        create_zip(&zip_path, &[("nested/file.txt", b"safe")]);

        let extracted =
            extract_zip_archive(&zip_path, &extract_dir, None).expect("extract valid zip");

        assert_eq!(extracted.len(), 1);
        assert_eq!(
            std::fs::read(extract_dir.join("nested/file.txt")).unwrap(),
            b"safe"
        );
    }

    #[test]
    fn rejects_parent_directory_traversal_before_writing() {
        let temp = tempfile::tempdir().expect("create temp dir");
        let zip_path = temp.path().join("traversal.zip");
        let extract_dir = temp.path().join("output");
        create_zip(
            &zip_path,
            &[
                ("safe.txt", b"must not be written"),
                ("../escape.txt", b"pwned"),
            ],
        );

        let error =
            extract_zip_archive(&zip_path, &extract_dir, None).expect_err("reject traversal");

        assert!(error.contains("不安全的ZIP条目路径"));
        assert!(!extract_dir.join("safe.txt").exists());
        assert!(!temp.path().join("escape.txt").exists());
    }

    #[test]
    fn refuses_to_overwrite_existing_files() {
        let temp = tempfile::tempdir().expect("create temp dir");
        let zip_path = temp.path().join("overwrite.zip");
        let extract_dir = temp.path().join("output");
        std::fs::create_dir_all(&extract_dir).unwrap();
        std::fs::write(extract_dir.join("existing.txt"), b"original").unwrap();
        create_zip(&zip_path, &[("existing.txt", b"replacement")]);

        let error =
            extract_zip_archive(&zip_path, &extract_dir, None).expect_err("reject overwrite");

        assert!(error.contains("拒绝覆盖"));
        assert_eq!(
            std::fs::read(extract_dir.join("existing.txt")).unwrap(),
            b"original"
        );
    }

    #[test]
    fn normalizes_backslashes_but_rejects_device_names_and_ads() {
        let temp = tempfile::tempdir().expect("create temp dir");

        let zip_path = temp.path().join("backslash.zip");
        let extract_dir = temp.path().join("backslash-output");
        create_zip(&zip_path, &[(r"nested\file.txt", b"safe")]);
        extract_zip_archive(&zip_path, &extract_dir, None).expect("extract backslash path");
        assert_eq!(
            std::fs::read(extract_dir.join("nested/file.txt")).unwrap(),
            b"safe"
        );

        for (archive_name, label) in [("CON.txt", "device"), ("payload:stream", "ads")] {
            let zip_path = temp.path().join(format!("{}.zip", label));
            let output = temp.path().join(format!("{}-output", label));
            create_zip(&zip_path, &[(archive_name, b"blocked")]);
            let error = extract_zip_archive(&zip_path, &output, None)
                .expect_err("reject Windows-special ZIP name");
            assert!(error.contains("ZIP条目名称"));
            assert!(!output.join(archive_name).exists());
        }
    }

    #[test]
    fn rejects_duplicate_normalized_entries() {
        let temp = tempfile::tempdir().expect("create temp dir");
        let zip_path = temp.path().join("duplicate.zip");
        let extract_dir = temp.path().join("output");
        create_zip(&zip_path, &[("same/txt", b"one"), (r"same\txt", b"two")]);

        let error = extract_zip_archive(&zip_path, &extract_dir, None)
            .expect_err("reject duplicate normalized entries");
        assert!(error.contains("重复条目"));
        assert!(!extract_dir.exists() || std::fs::read_dir(&extract_dir).unwrap().next().is_none());
    }

    #[test]
    fn enforces_requested_uncompressed_budget() {
        let temp = tempfile::tempdir().expect("create temp dir");
        let zip_path = temp.path().join("budget.zip");
        let extract_dir = temp.path().join("output");
        create_zip(&zip_path, &[("payload.bin", b"1234")]);

        let error = extract_zip_archive(&zip_path, &extract_dir, Some(3))
            .expect_err("reject over-budget archive");
        assert!(error.contains("总解压大小超过预算"));
        assert!(!extract_dir.join("payload.bin").exists());
    }

    #[test]
    fn rolls_back_files_created_before_later_failure() {
        let temp = tempfile::tempdir().expect("create temp dir");
        let zip_path = temp.path().join("rollback.zip");
        let extract_dir = temp.path().join("output");
        std::fs::create_dir_all(&extract_dir).unwrap();
        std::fs::write(extract_dir.join("second.txt"), b"original").unwrap();
        create_zip(
            &zip_path,
            &[("first.txt", b"temporary"), ("second.txt", b"blocked")],
        );

        let error = extract_zip_archive(&zip_path, &extract_dir, None)
            .expect_err("reject collision and roll back");
        assert!(error.contains("拒绝覆盖"));
        assert!(!extract_dir.join("first.txt").exists());
        assert_eq!(
            std::fs::read(extract_dir.join("second.txt")).unwrap(),
            b"original"
        );
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlink_extraction_root() {
        use std::os::unix::fs::symlink;

        let temp = tempfile::tempdir().expect("create temp dir");
        let outside = temp.path().join("outside");
        let root = temp.path().join("root");
        std::fs::create_dir_all(&outside).unwrap();
        symlink(&outside, &root).unwrap();
        let zip_path = temp.path().join("root-symlink.zip");
        create_zip(&zip_path, &[("file.txt", b"blocked")]);

        let error = extract_zip_archive(&zip_path, &root, None)
            .expect_err("reject symlink extraction root");
        assert!(error.contains("不能是符号链接"));
        assert!(!outside.join("file.txt").exists());
    }
}

/// 删除文件
///
/// # 参数
/// * `path` - 文件路径
///
/// # 返回
/// * `Ok(())` - 成功
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn delete_file(path: String) -> Result<(), String> {
    log::info!("🗑️ 删除文件: {}", path);

    let path = require_existing_file_grant(&path, PathAccess::DeleteFile)?;
    tokio::fs::remove_file(&path)
        .await
        .map_err(|e| format!("删除文件失败: {}", e))?;

    log::info!("✅ 文件已删除: {}", path.display());
    Ok(())
}

/// 保存文件
///
/// # 参数
/// * `path` - 文件路径
/// * `data` - 文件数据（字节数组）
///
/// # 返回
/// * `Ok(())` - 保存成功
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn save_file(path: String, data: Vec<u8>) -> Result<(), String> {
    log::info!("保存文件: {}, 大小: {} bytes", path, data.len());

    const MAX_GENERIC_FILE_BYTES: usize = 256 * 1024 * 1024;
    if data.len() > MAX_GENERIC_FILE_BYTES {
        return Err("文件超过通用写入大小限制".to_string());
    }
    let path = require_path_grant(&path, PathAccess::WriteFile, true)?;
    if path.exists() {
        return Err("目标文件已存在，拒绝覆盖".to_string());
    }

    use tokio::io::AsyncWriteExt;
    let mut file = tokio::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .await
        .map_err(|e| format!("创建文件失败: {}", e))?;
    file.write_all(&data)
        .await
        .map_err(|e| format!("写入文件失败: {}", e))?;
    file.sync_all()
        .await
        .map_err(|e| format!("同步文件失败: {}", e))?;

    log::info!("✅ 文件保存成功: {}", path.display());
    Ok(())
}

/// 保存聊天图片
///
/// # 参数
/// * `image_data` - Base64编码的图片数据
///
/// # 返回
/// * `Ok(String)` - 保存的文件路径
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn save_chat_image(image_data: String) -> Result<String, String> {
    use base64::{engine::general_purpose, Engine as _};
    use tokio::fs;

    log::info!("保存聊天图片，数据长度: {} bytes", image_data.len());

    // 解码Base64数据
    let bytes = general_purpose::STANDARD
        .decode(&image_data)
        .map_err(|e| format!("Base64解码失败: {}", e))?;

    log::info!("解码后图片大小: {} bytes", bytes.len());

    // 获取下载目录
    let download_dir = dirs::download_dir().ok_or_else(|| "无法获取下载目录".to_string())?;

    // 生成文件名
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let filename = format!("MCTier_聊天图片_{}.png", timestamp);

    // 构建完整路径
    let file_path = download_dir.join(filename);
    let path_str = file_path.to_string_lossy().to_string();

    log::info!("保存图片到: {}", path_str);

    // 写入文件
    fs::write(&file_path, bytes)
        .await
        .map_err(|e| format!("写入文件失败: {}", e))?;

    log::info!("✅ 聊天图片保存成功: {}", path_str);
    Ok(path_str)
}

/// 读取文件
///
/// # 参数
/// * `path` - 文件路径
///
/// # 返回
/// * `Ok(Vec<u8>)` - 文件内容
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn read_file(path: String) -> Result<Vec<u8>, String> {
    log::info!("读取文件: {}", path);

    const MAX_GENERIC_FILE_BYTES: u64 = 256 * 1024 * 1024;
    let path = require_existing_file_grant(&path, PathAccess::ReadFile)?;
    let metadata = std::fs::symlink_metadata(&path).map_err(|e| format!("检查文件失败: {}", e))?;
    if metadata.len() > MAX_GENERIC_FILE_BYTES {
        return Err("文件超过通用读取大小限制".to_string());
    }
    let data = tokio::fs::read(&path)
        .await
        .map_err(|e| format!("读取文件失败: {}", e))?;

    log::info!(
        "✅ 文件读取成功: {}, 大小: {} bytes",
        path.display(),
        data.len()
    );
    Ok(data)
}

// ==================== P2P 聊天命令 ====================

use crate::modules::chat_service::{
    is_message_id_for_player, ChatMessage as ChatServiceMessage, ChatPeerIdentity, MessageType,
    SendMessageRequest, CHAT_TOKEN_HEADER, MAX_ANNOUNCE_BYTES, MAX_AVATAR_BYTES,
    MAX_CLIPBOARD_BYTES, MAX_HISTORY_MESSAGES, MAX_IMAGE_BYTES, MAX_IMAGE_CONTENT_BYTES,
    MAX_RECALL_BYTES, MAX_TEXT_BYTES, MAX_TODO_BYTES, MAX_VOICE_GROUP_BYTES, MAX_WHITEBOARD_BYTES,
    RECALL_WINDOW_SECS,
};

fn chat_http_host(raw: &str) -> Result<String, String> {
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

fn current_unix_seconds() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn validate_outgoing_chat_payload(
    message_type: &MessageType,
    content: &str,
    image_data: Option<&Vec<u8>>,
    local_player_id: &str,
    local_is_host: bool,
    local_messages: &[ChatServiceMessage],
) -> Result<(), String> {
    let content_bytes = content.as_bytes().len();
    match message_type {
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

#[tauri::command]
pub async fn configure_p2p_chat(
    chat_token: String,
    chat_token_epoch: u64,
    player_id: String,
    player_name: String,
    host_id: Option<String>,
    peers: Vec<ChatPeerIdentity>,
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
    let chat_svc = chat_service.lock().await;
    chat_svc.set_session(
        chat_token,
        chat_token_epoch,
        player_id,
        player_name,
        host_id,
        peers,
    )?;
    chat_svc
        .start_server()
        .await
        .map_err(|error| format!("启动聊天服务失败: {}", error))?;
    drop(chat_svc);
    let result = file_transfer.lock().await.set_lobby_token(file_token);
    result
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
pub async fn stop_p2p_chat(state: State<'_, AppState>) -> Result<(), String> {
    let (chat_service, file_transfer) = {
        let core = state.core.lock().await;
        (core.get_chat_service(), core.get_file_transfer())
    };
    file_transfer.lock().await.clear_lobby_token();
    chat_service.lock().await.stop_server().await;
    Ok(())
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

    let message_id = message_id
        .filter(|id| !id.is_empty())
        .unwrap_or_else(|| format!("msg-{}-{}", local_identity.player_id, uuid::Uuid::new_v4()));
    if !is_message_id_for_player(&message_id, &local_identity.player_id) {
        return Err("聊天消息ID无效".to_string());
    }

    // The renderer may request a subset for UI reasons, but it never chooses
    // network destinations. Broadcast to the authoritative signaling roster.
    let authoritative_peers = chat_svc.authoritative_peers();

    let message = ChatServiceMessage {
        id: message_id.clone(),
        player_id: local_identity.player_id.clone(),
        player_name: local_identity.player_name.clone(),
        content: content.clone(),
        message_type: msg_type.clone(),
        timestamp: current_unix_seconds(),
        image_data: image_data.clone(),
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
        let peer_ip = peer.virtual_ip;
        let host = chat_http_host(&peer_ip)?;
        let url = format!("http://{}:14540/api/chat/send", host);
        let request = SendMessageRequest {
            id: Some(message_id.clone()),
            player_id: local_identity.player_id.clone(),
            player_name: local_identity.player_name.clone(),
            content: content.clone(),
            message_type: msg_type.clone(),
            image_data: image_data.clone(),
        };

        let client_clone = client.clone();
        let url_clone = url.clone();
        let chat_token_clone = chat_token.clone();

        // 创建并发任务，返回是否送达成功（带一次快速重试，降低瞬时抖动导致的漏发）
        let task = tokio::spawn(async move {
            for attempt in 0..2 {
                let start = std::time::Instant::now();
                match client_clone
                    .post(&url_clone)
                    .header(CHAT_TOKEN_HEADER, &chat_token_clone)
                    .json(&request)
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

fn is_safe_remote_chat_message(
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
        tasks.push(tokio::spawn(async move {
            match client_clone
                .get(&url)
                .header(CHAT_TOKEN_HEADER, token)
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

// ==================== 屏幕共享命令 ====================

/// 打开屏幕查看窗口
///
/// # 参数
/// * `share_id` - 共享ID
/// 打开屏幕查看窗口
///
/// # 参数
/// * `share_id` - 共享ID
/// * `player_name` - 共享者名称
/// * `app` - Tauri应用句柄
///
/// # 返回
/// * `Ok(())` - 成功
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn open_screen_viewer_window(
    share_id: String,
    player_name: String,
    app: tauri::AppHandle,
) -> Result<(), String> {
    log::info!(
        "打开屏幕查看窗口: share_id={}, player_name={}",
        share_id,
        player_name
    );

    use tauri::Manager;
    use tauri::WebviewWindowBuilder;

    // 检查窗口是否已存在
    let window_label = "screen-viewer";
    if let Some(existing_window) = app.get_webview_window(window_label) {
        log::info!("屏幕查看窗口已存在，关闭旧窗口");
        let _ = existing_window.close();
        // 等待窗口关闭
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
    }

    // 构建URL，包含查询参数
    let url = format!(
        "index.html?screen-viewer=true&shareId={}&playerName={}",
        urlencoding::encode(&share_id),
        urlencoding::encode(&player_name)
    );

    // 创建新窗口
    let _window = WebviewWindowBuilder::new(
        &app,
        window_label,
        tauri::WebviewUrl::App(url.into())
    )
    .title(format!("{} 的屏幕", player_name))
    .inner_size(1280.0, 720.0)
    .min_inner_size(800.0, 600.0)
    .resizable(true)
    .decorations(true)
    .always_on_top(true)  // 设置窗口始终置顶
    .center()
    .build()
    .map_err(|e| format!("创建窗口失败: {}", e))?;

    log::info!("✅ 屏幕查看窗口已打开");
    Ok(())
}

// ==================== 弹幕覆盖窗口 ====================

/// 打开弹幕覆盖窗口：置顶、透明、无边框、鼠标穿透、覆盖整个主屏幕。
/// 用于在玩游戏时让聊天消息以弹幕形式飘过屏幕顶部，且不遮挡操作。
#[tauri::command]
pub async fn open_danmaku_window(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    use tauri::WebviewWindowBuilder;

    let window_label = "danmaku";
    if let Some(existing) = app.get_webview_window(window_label) {
        // 已存在则确保可见并置顶穿透
        let _ = existing.show();
        let _ = existing.set_always_on_top(true);
        let _ = existing.set_ignore_cursor_events(true);
        return Ok(());
    }

    let window = WebviewWindowBuilder::new(
        &app,
        window_label,
        tauri::WebviewUrl::App("index.html?danmaku=true".into()),
    )
    .title("MCTier Danmaku")
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .shadow(false)
    .resizable(false)
    .focused(false)
    .visible(false)
    .build()
    .map_err(|e| format!("创建弹幕窗口失败: {}", e))?;

    // 覆盖主屏幕（含任务栏区域，尽量铺满）
    if let Ok(Some(monitor)) = window.primary_monitor() {
        let size = monitor.size();
        let pos = monitor.position();
        let _ = window.set_position(tauri::PhysicalPosition::new(pos.x, pos.y));
        let _ = window.set_size(tauri::PhysicalSize::new(size.width, size.height));
    }
    let _ = window.set_ignore_cursor_events(true);
    let _ = window.set_always_on_top(true);
    let _ = window.show();

    log::info!("✅ 弹幕窗口已打开");
    Ok(())
}

/// 关闭弹幕覆盖窗口
#[tauri::command]
pub async fn close_danmaku_window(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    if let Some(window) = app.get_webview_window("danmaku") {
        let _ = window.close();
        log::info!("弹幕窗口已关闭");
    }
    Ok(())
}

/// 切换弹幕窗口的鼠标穿透（用于点击弹幕暂停/复制/下载时临时关闭穿透）
#[tauri::command]
pub async fn set_danmaku_ignore_cursor(app: tauri::AppHandle, ignore: bool) -> Result<(), String> {
    use tauri::Manager;
    if let Some(window) = app.get_webview_window("danmaku") {
        let _ = window.set_ignore_cursor_events(ignore);
    }
    Ok(())
}

/// 打开游戏内 HUD 浮层窗口：置顶、透明、无边框、鼠标穿透，置于主屏右上角。
/// 显示队友延迟/丢包与"谁在说话"，玩游戏时一眼掌握全队状态。
#[tauri::command]
pub async fn open_game_hud_window(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    use tauri::WebviewWindowBuilder;
    let label = "gamehud";
    if let Some(existing) = app.get_webview_window(label) {
        let _ = existing.show();
        let _ = existing.set_always_on_top(true);
        let _ = existing.set_ignore_cursor_events(true);
        return Ok(());
    }
    let mut builder = WebviewWindowBuilder::new(
        &app,
        label,
        tauri::WebviewUrl::App("index.html?gamehud=true".into()),
    )
    .title("MCTier HUD")
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .shadow(false)
    .resizable(false)
    .focused(false)
    .visible(false)
    .inner_size(600.0, 600.0);
    // 设为主窗口的子(owner)窗口：主程序进程结束时，HUD 窗口由系统随父窗口一并立即销毁，
    // 避免主程序被杀后 HUD 还残留几秒。
    if let Some(main_win) = app.get_webview_window("main") {
        builder = builder
            .parent(&main_win)
            .map_err(|e| format!("设置HUD父窗口失败: {}", e))?;
    }
    let window = builder
        .build()
        .map_err(|e| format!("创建HUD窗口失败: {}", e))?;
    // 定位到主屏右上角
    if let Ok(Some(monitor)) = window.primary_monitor() {
        let size = monitor.size();
        let pos = monitor.position();
        let scale = monitor.scale_factor();
        let w = (600.0 * scale) as i32;
        let x = pos.x + size.width as i32 - w - (24.0 * scale) as i32;
        let y = pos.y + (60.0 * scale) as i32;
        let _ = window.set_position(tauri::PhysicalPosition::new(x.max(pos.x), y));
    }
    let _ = window.set_ignore_cursor_events(true);
    let _ = window.set_always_on_top(true);
    let _ = window.show();
    log::info!("✅ 游戏HUD窗口已打开");
    Ok(())
}

/// 关闭游戏内 HUD 浮层窗口
#[tauri::command]
pub async fn close_game_hud_window(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    if let Some(window) = app.get_webview_window("gamehud") {
        let _ = window.close();
    }
    Ok(())
}

/// 切换 HUD 窗口鼠标穿透（悬停在 HUD 卡片上时关闭穿透以便拖动）
#[tauri::command]
pub async fn set_gamehud_ignore_cursor(app: tauri::AppHandle, ignore: bool) -> Result<(), String> {
    use tauri::Manager;
    if let Some(window) = app.get_webview_window("gamehud") {
        let _ = window.set_ignore_cursor_events(ignore);
    }
    Ok(())
}

/// 获取鼠标相对 HUD 窗口的逻辑坐标（穿透模式下命中检测 HUD 卡片用）
#[tauri::command]
pub async fn gamehud_cursor_pos(app: tauri::AppHandle) -> Result<Option<(f64, f64)>, String> {
    use tauri::Manager;
    let window = match app.get_webview_window("gamehud") {
        Some(w) => w,
        None => return Ok(None),
    };
    let cursor = match app.cursor_position() {
        Ok(c) => c,
        Err(_) => return Ok(None),
    };
    let pos = match window.outer_position() {
        Ok(p) => p,
        Err(_) => return Ok(None),
    };
    let scale = window.scale_factor().unwrap_or(1.0).max(0.1);
    let rx = (cursor.x - pos.x as f64) / scale;
    let ry = (cursor.y - pos.y as f64) / scale;
    Ok(Some((rx, ry)))
}

/// 获取鼠标相对弹幕窗口的逻辑坐标（用于在穿透模式下命中检测弹幕）。
/// 返回 None 表示窗口不存在或取不到坐标。
#[tauri::command]
pub async fn danmaku_cursor_pos(app: tauri::AppHandle) -> Result<Option<(f64, f64)>, String> {
    use tauri::Manager;
    let window = match app.get_webview_window("danmaku") {
        Some(w) => w,
        None => return Ok(None),
    };
    let cursor = match app.cursor_position() {
        Ok(c) => c,
        Err(_) => return Ok(None),
    };
    let pos = match window.outer_position() {
        Ok(p) => p,
        Err(_) => return Ok(None),
    };
    let scale = window.scale_factor().unwrap_or(1.0).max(0.1);
    let rx = (cursor.x - pos.x as f64) / scale;
    let ry = (cursor.y - pos.y as f64) / scale;
    Ok(Some((rx, ry)))
}

/// 保存弹幕图片（data URL）到系统下载文件夹，返回保存的完整路径。
#[tauri::command]
pub async fn save_danmaku_image(data_url: String) -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};

    // 解析 data URL：data:image/<ext>;base64,<payload>
    let (meta, payload) = data_url
        .split_once(',')
        .ok_or_else(|| "无效的图片数据".to_string())?;
    let ext = if meta.contains("png") {
        "png"
    } else if meta.contains("gif") {
        "gif"
    } else if meta.contains("webp") {
        "webp"
    } else {
        "jpg"
    };
    let bytes = STANDARD
        .decode(payload.trim())
        .map_err(|e| format!("图片解码失败: {}", e))?;

    let dir = dirs::download_dir()
        .or_else(dirs::picture_dir)
        .or_else(dirs::home_dir)
        .ok_or_else(|| "找不到下载目录".to_string())?;
    let ts = chrono::Local::now().format("%Y%m%d_%H%M%S");
    let filename = format!("MCTier_弹幕图片_{}.{}", ts, ext);
    let path = dir.join(&filename);
    std::fs::write(&path, &bytes).map_err(|e| format!("保存失败: {}", e))?;
    Ok(path.to_string_lossy().to_string())
}

/// 打开日志文件所在的文件夹
///
/// # 返回
/// * `Ok(())` - 成功
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn open_log_folder() -> Result<(), String> {
    log::info!("打开日志文件夹");

    // 获取日志文件路径
    let log_path = if let Some(data_dir) = dirs::data_local_dir() {
        data_dir.join("MCTier")
    } else {
        std::env::current_dir().map_err(|e| format!("获取当前目录失败: {}", e))?
    };

    log::info!("日志文件夹路径: {:?}", log_path);

    // 确保目录存在
    if !log_path.exists() {
        return Err("日志文件夹不存在".to_string());
    }

    // 打开文件夹
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        match Command::new(windows_system_command("explorer.exe"))
            .arg(&log_path)
            .spawn()
        {
            Ok(_) => {
                log::info!("✅ 成功打开日志文件夹");
                Ok(())
            }
            Err(e) => {
                log::error!("❌ 打开日志文件夹失败: {}", e);
                Err(format!("打开日志文件夹失败: {}", e))
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err("当前平台不支持此功能".to_string())
    }
}

/// 打开日志文件（使用默认文本编辑器）
///
/// # 返回
/// * `Ok(())` - 成功
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn open_log_file() -> Result<(), String> {
    log::info!("打开日志文件");

    // 获取日志文件路径
    let log_path = if let Some(data_dir) = dirs::data_local_dir() {
        data_dir.join("MCTier").join("mctier.log")
    } else {
        std::path::PathBuf::from("mctier.log")
    };

    log::info!("日志文件路径: {:?}", log_path);

    // 确保文件存在
    if !log_path.exists() {
        return Err("日志文件不存在".to_string());
    }

    // 打开文件
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        // 使用notepad打开日志文件
        match Command::new(windows_system_command("notepad.exe"))
            .arg(&log_path)
            .spawn()
        {
            Ok(_) => {
                log::info!("✅ 成功打开日志文件");
                Ok(())
            }
            Err(e) => {
                log::error!("❌ 打开日志文件失败: {}", e);
                Err(format!("打开日志文件失败: {}", e))
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err("当前平台不支持此功能".to_string())
    }
}

/// 获取日志文件路径
///
/// # 返回
/// * `Ok(String)` - 日志文件路径
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn get_log_file_path() -> Result<String, String> {
    let log_path = if let Some(data_dir) = dirs::data_local_dir() {
        data_dir.join("MCTier").join("mctier.log")
    } else {
        std::path::PathBuf::from("mctier.log")
    };

    Ok(log_path.to_string_lossy().to_string())
}

/// 读取最近的运行日志，供设置页内查看。仅返回末尾内容，避免日志过大阻塞界面。
#[tauri::command]
pub async fn read_log_file() -> Result<String, String> {
    let log_path = if let Some(data_dir) = dirs::data_local_dir() {
        data_dir.join("MCTier").join("mctier.log")
    } else {
        std::path::PathBuf::from("mctier.log")
    };

    let bytes = tokio::fs::read(&log_path)
        .await
        .map_err(|e| format!("读取日志失败: {}", e))?;
    const MAX_BYTES: usize = 512 * 1024;
    let start = bytes.len().saturating_sub(MAX_BYTES);
    let mut content = String::from_utf8_lossy(&bytes[start..]).into_owned();
    if start > 0 {
        content = format!("[仅显示最近 512 KB 日志]\n{}", content);
    }
    Ok(content)
}

/// 保存设置配置（开机自启 + 自动大厅）
///
/// # 参数
/// * `auto_startup` - 是否开机自启
/// * `auto_lobby_enabled` - 是否启用自动大厅
/// * `lobby_name` - 大厅名称
/// * `lobby_password` - 大厅密码
/// 保存设置
///
/// # 参数
/// * `auto_startup` - 开机自启
/// * `auto_lobby_enabled` - 自动大厅启用
/// * `lobby_name` - 大厅名称
/// * `lobby_password` - 大厅密码
/// * `player_name` - 玩家名称
/// * `use_domain` - 是否使用虚拟域名
/// * `use_private_server` - 是否使用私有服务器
/// * `private_easytier_server` - 私有 EasyTier 节点服务器地址
/// * `private_signaling_server` - 私有信令服务器地址
/// * `always_on_top` - 窗口是否置顶
/// * `remember_window_position` - 是否记住窗口位置
/// * `enable_gpu_rendering` - 是否启用 GPU 渲染
#[tauri::command]
pub async fn save_settings(
    language: Option<String>,
    auto_startup: bool,
    auto_lobby_enabled: bool,
    lobby_name: Option<String>,
    lobby_password: Option<String>,
    player_name: Option<String>,
    use_domain: bool,
    virtual_domain: Option<String>,
    use_private_server: bool,
    private_easytier_server: Option<String>,
    private_signaling_server: Option<String>,
    always_on_top: Option<bool>,
    remember_window_position: Option<bool>,
    close_to_tray: Option<bool>,
    start_minimized: Option<bool>,
    custom_easytier_nodes: Option<Vec<serde_json::Value>>,
    voice_volume: Option<f64>,
    enable_gpu_rendering: Option<bool>,
    mic_hotkey: Option<String>,
    global_mute_hotkey: Option<String>,
    push_to_talk_hotkey: Option<String>,
    summon_hotkey: Option<String>,
    enable_exit_node: Option<bool>,
    enable_as_exit_node: Option<bool>,
    proxy_cidrs: Option<String>,
    exit_nodes: Option<String>,
    subnet_proxy_cidrs: Option<String>,
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    use crate::modules::config_manager::{AutoLobbyConfig, EasyTierNode};
    log::info!("保存设置: auto_startup={}, auto_lobby_enabled={}, use_private_server={}, always_on_top={:?}, remember_window_position={:?}, voice_volume={:?}, enable_gpu_rendering={:?}, mic_hotkey={:?}, global_mute_hotkey={:?}, push_to_talk_hotkey={:?}, enable_exit_node={:?}, subnet_proxy_cidrs={:?}, virtual_domain={:?}", 
        auto_startup, auto_lobby_enabled, use_private_server, always_on_top, remember_window_position, voice_volume, enable_gpu_rendering, mic_hotkey, global_mute_hotkey, push_to_talk_hotkey, enable_exit_node, subnet_proxy_cidrs, virtual_domain);

    let legacy_config_password = {
        let core = state.core.lock().await;
        let config_manager = core.get_config_manager();
        let cfg_mgr = config_manager.lock().await;
        cfg_mgr
            .get_config()
            .auto_lobby
            .as_ref()
            .and_then(|auto_lobby| auto_lobby.lobby_password.clone())
    };
    if let Some(password) = lobby_password.clone().or(legacy_config_password) {
        tokio::task::spawn_blocking(move || write_auto_lobby_secret(&password))
            .await
            .map_err(|error| format!("保存系统凭据任务失败: {}", error))??;
    }

    // 1. 保存配置到文件
    {
        let core = state.core.lock().await;
        let config_manager = core.get_config_manager();
        let mut cfg_mgr = config_manager.lock().await;
        cfg_mgr
            .update_config(|config| {
                if let Some(value) = language.as_deref() {
                    if matches!(value, "system" | "zh" | "en") {
                        config.language = Some(value.to_string());
                    }
                }
                config.auto_startup = Some(auto_startup);
                // 读取已有的auto_lobby配置，只更新非None的字段
                let existing = config.auto_lobby.clone().unwrap_or_default();

                // 如果传入了 lobby_name、lobby_password 或 player_name，则更新这些字段
                // 如果传入了 use_domain 或 virtual_domain，则更新这些字段（独立于其他字段）
                let updated_use_domain = if lobby_name.is_some()
                    || lobby_password.is_some()
                    || player_name.is_some()
                    || virtual_domain.is_some()
                {
                    use_domain
                } else {
                    existing.use_domain
                };

                let updated_virtual_domain = if virtual_domain.is_some() {
                    virtual_domain.clone()
                } else {
                    existing.virtual_domain.clone()
                };

                log::info!(
                    "更新 auto_lobby 配置: use_domain={}, virtual_domain={:?}",
                    updated_use_domain,
                    updated_virtual_domain
                );

                config.auto_lobby = Some(AutoLobbyConfig {
                    enabled: auto_lobby_enabled,
                    lobby_name: lobby_name.clone().or(existing.lobby_name),
                    lobby_password: None,
                    player_name: player_name.clone().or(existing.player_name),
                    use_domain: updated_use_domain,
                    virtual_domain: updated_virtual_domain,
                });
                // 保存私有服务器配置
                config.use_private_server = Some(use_private_server);
                // 【修复】仅在调用方明确传入时才更新私有服务器地址，
                // 避免「保存节点列表」等只关心部分设置的调用传 null 时，把已保存的地址抹掉
                if private_easytier_server.is_some() {
                    config.private_easytier_server = private_easytier_server.clone();
                }
                if private_signaling_server.is_some() {
                    config.private_signaling_server = private_signaling_server.clone();
                }
                // 保存窗口置顶配置
                if let Some(on_top) = always_on_top {
                    config.always_on_top = Some(on_top);
                }
                // 保存记住窗口位置配置
                if let Some(remember) = remember_window_position {
                    config.remember_window_position = Some(remember);
                    // 如果关闭记住位置，清除已保存的位置
                    if !remember {
                        config.window_position = None;
                    }
                }
                // 保存「关闭时最小化到托盘」配置
                if let Some(v) = close_to_tray {
                    config.close_to_tray = Some(v);
                }
                // 保存「启动后自动隐藏到托盘」配置
                if let Some(v) = start_minimized {
                    config.start_minimized = Some(v);
                }
                // 保存自定义 EasyTier 节点
                if let Some(nodes_json) = custom_easytier_nodes.clone() {
                    let nodes: Vec<EasyTierNode> = nodes_json
                        .iter()
                        .filter_map(|n| {
                            if let (Some(name), Some(address)) = (
                                n.get("name").and_then(|v| v.as_str()),
                                n.get("address").and_then(|v| v.as_str()),
                            ) {
                                Some(EasyTierNode {
                                    name: name.to_string(),
                                    address: address.to_string(),
                                })
                            } else {
                                None
                            }
                        })
                        .collect();
                    config.custom_easytier_nodes = Some(nodes);
                }
                // 保存语音音量
                if let Some(volume) = voice_volume {
                    config.voice_volume = Some(volume.clamp(0.0, 1.0));
                }
                // 保存 GPU 渲染设置
                if let Some(enable) = enable_gpu_rendering {
                    config.enable_gpu_rendering = Some(enable);
                }
                // 保存快捷键设置
                if let Some(hotkey) = mic_hotkey {
                    config.mic_hotkey = Some(hotkey);
                }
                if let Some(hotkey) = global_mute_hotkey {
                    config.global_mute_hotkey = Some(hotkey);
                }
                if let Some(hotkey) = push_to_talk_hotkey {
                    config.push_to_talk_hotkey = Some(hotkey);
                }
                if let Some(hotkey) = summon_hotkey {
                    config.summon_hotkey = Some(hotkey);
                }
                // 保存出口节点配置
                if let Some(enable) = enable_exit_node {
                    if config.exit_node_config.is_none() {
                        config.exit_node_config =
                            Some(crate::modules::config_manager::ExitNodeConfig::default());
                    }
                    if let Some(ref mut exit_config) = config.exit_node_config {
                        exit_config.enable_exit_node = enable;
                    }
                }
                if let Some(enable) = enable_as_exit_node {
                    if config.exit_node_config.is_none() {
                        config.exit_node_config =
                            Some(crate::modules::config_manager::ExitNodeConfig::default());
                    }
                    if let Some(ref mut exit_config) = config.exit_node_config {
                        exit_config.enable_as_exit_node = enable;
                    }
                }
                if let Some(cidrs) = proxy_cidrs {
                    if config.exit_node_config.is_none() {
                        config.exit_node_config =
                            Some(crate::modules::config_manager::ExitNodeConfig::default());
                    }
                    if let Some(ref mut exit_config) = config.exit_node_config {
                        // 将字符串按行分割成 Vec<String>
                        exit_config.proxy_cidrs = cidrs
                            .lines()
                            .map(|s| s.trim().to_string())
                            .filter(|s| !s.is_empty())
                            .collect();
                    }
                }
                if let Some(nodes) = exit_nodes {
                    if config.exit_node_config.is_none() {
                        config.exit_node_config =
                            Some(crate::modules::config_manager::ExitNodeConfig::default());
                    }
                    if let Some(ref mut exit_config) = config.exit_node_config {
                        // 将字符串按行分割成 Vec<String>
                        exit_config.exit_nodes = nodes
                            .lines()
                            .map(|s| s.trim().to_string())
                            .filter(|s| !s.is_empty())
                            .collect();
                    }
                }
                if let Some(subnet_cidrs) = subnet_proxy_cidrs {
                    if config.exit_node_config.is_none() {
                        config.exit_node_config =
                            Some(crate::modules::config_manager::ExitNodeConfig::default());
                    }
                    if let Some(ref mut exit_config) = config.exit_node_config {
                        // 将字符串按行分割成 Vec<String>
                        exit_config.subnet_proxy_cidrs = subnet_cidrs
                            .lines()
                            .map(|s| s.trim().to_string())
                            .filter(|s| !s.is_empty())
                            .collect();
                    }
                }
            })
            .await
            .map_err(|e| format!("保存配置失败: {}", e))?;
    }

    // 2. 应用窗口置顶设置到主窗口
    if let Some(on_top) = always_on_top {
        if let Some(window) = app_handle.get_webview_window("main") {
            if let Err(e) = window.set_always_on_top(on_top) {
                log::warn!("设置主窗口置顶失败: {}", e);
            } else {
                log::info!("主窗口置顶设置成功: {}", on_top);
            }
        }
    }

    // 3. 处理开机自启
    match set_auto_start(auto_startup).await {
        Ok(_) => log::info!("开机自启设置成功: {}", auto_startup),
        Err(e) => log::warn!("开机自启设置失败（非致命）: {}", e),
    }

    log::info!("设置保存完成");
    Ok(())
}

/// 读取当前设置配置
#[tauri::command]
pub async fn get_settings(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    log::info!("开始读取设置配置");

    let config = {
        let core = state.core.lock().await;
        let config_manager = core.get_config_manager();
        let cfg_mgr = config_manager.lock().await;
        cfg_mgr.get_config().clone()
    };

    let _auto_startup = config.auto_startup.unwrap_or(false);
    let auto_lobby = config.auto_lobby.clone().unwrap_or_default();
    let mut lobby_password = tokio::task::spawn_blocking(read_auto_lobby_secret)
        .await
        .map_err(|error| format!("读取系统凭据任务失败: {}", error))?;
    if let Some(legacy_password) = auto_lobby.lobby_password.clone() {
        if lobby_password.is_none() {
            let password = legacy_password.clone();
            match tokio::task::spawn_blocking(move || write_auto_lobby_secret(&password)).await {
                Ok(Ok(())) => lobby_password = Some(legacy_password),
                Ok(Err(error)) => log::warn!("迁移自动大厅密码失败: {}", error),
                Err(error) => log::warn!("迁移系统凭据任务失败: {}", error),
            }
        }

        let core = state.core.lock().await;
        let config_manager = core.get_config_manager();
        let mut cfg_mgr = config_manager.lock().await;
        cfg_mgr
            .update_config(|config| {
                if let Some(auto_lobby) = config.auto_lobby.as_mut() {
                    auto_lobby.lobby_password = None;
                }
            })
            .await
            .map_err(|error| format!("清理配置中的明文密码失败: {}", error))?;
    }

    // 同时读取实际的开机自启状态
    // 直接查询注册表，不通过command函数（避免嵌套async调用死锁）
    // 添加超时保护，避免 reg 命令卡住
    let actual_auto_start = {
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            use std::time::Duration;

            log::info!("查询注册表中的开机自启状态");

            // 使用 tokio::time::timeout 添加超时保护
            let result = tokio::time::timeout(
                Duration::from_secs(2), // 2秒超时
                tokio::task::spawn_blocking(|| {
                    std::process::Command::new(windows_system_command("reg.exe"))
                        .args([
                            "query",
                            "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
                            "/v",
                            "MCTier",
                        ])
                        .creation_flags(0x08000000)
                        .output()
                        .map(|o| o.status.success())
                        .unwrap_or(false)
                }),
            )
            .await;

            match result {
                Ok(Ok(status)) => {
                    log::info!("注册表查询成功: {}", status);
                    status
                }
                Ok(Err(e)) => {
                    log::warn!("注册表查询任务失败: {}", e);
                    false
                }
                Err(_) => {
                    log::warn!("注册表查询超时，使用默认值 false");
                    false
                }
            }
        }
        #[cfg(not(windows))]
        {
            false
        }
    };

    log::info!("设置配置读取完成");

    // 读取出口节点配置
    let exit_node_config = config.exit_node_config.clone().unwrap_or_default();

    Ok(serde_json::json!({
        "language": config.language.clone(),
        "autoStartup": actual_auto_start,
        "autoLobbyEnabled": auto_lobby.enabled,
        "lobbyName": auto_lobby.lobby_name,
        "lobbyPassword": lobby_password,
        "playerName": auto_lobby.player_name,
        "avatarData": config.avatar_data.clone(),
        "useDomain": auto_lobby.use_domain,
        "virtualDomain": auto_lobby.virtual_domain,
        "usePrivateServer": config.use_private_server.unwrap_or(false),
        // 返回实际保存的值，如果是 None 就返回 null，让前端决定默认值
        "privateEasytierServer": config.private_easytier_server.clone(),
        "privateSignalingServer": config.private_signaling_server.clone(),
        "alwaysOnTop": config.always_on_top.unwrap_or(true),
        "rememberWindowPosition": config.remember_window_position.unwrap_or(false),
        "closeToTray": config.close_to_tray.unwrap_or(false),
        "startMinimized": config.start_minimized.unwrap_or(false),
        "customEasytierNodes": config.custom_easytier_nodes.clone().unwrap_or_default(),
        "voiceVolume": config.voice_volume.unwrap_or(1.0),
        "enableGpuRendering": config.enable_gpu_rendering.unwrap_or(true),
        "micHotkey": config.mic_hotkey.clone().unwrap_or_else(|| "Ctrl+M".to_string()),
        "globalMuteHotkey": config.global_mute_hotkey.clone().unwrap_or_else(|| "Ctrl+T".to_string()),
        "pushToTalkHotkey": config.push_to_talk_hotkey.clone().unwrap_or_else(|| "F2".to_string()),
        "summonHotkey": config.summon_hotkey.clone().unwrap_or_else(|| "Ctrl+Alt+M".to_string()),
        "enableExitNode": exit_node_config.enable_exit_node,
        "enableAsExitNode": exit_node_config.enable_as_exit_node,
        // 将 Vec<String> 转换为换行分隔的字符串
        "proxyCidrs": exit_node_config.proxy_cidrs.join("\n"),
        "exitNodes": exit_node_config.exit_nodes.join("\n"),
        "subnetProxyCidrs": exit_node_config.subnet_proxy_cidrs.join("\n"),
        "fileShareDownloadDir": config.file_share_download_dir.clone(),
    }))
}

/// 保存全局用户头像。头像由前端压缩后以 data URL 传入，清空时传 null。
#[tauri::command]
pub async fn set_avatar_data(
    avatar_data: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if let Some(data) = avatar_data.as_deref() {
        if !data.starts_with("data:image/") || data.len() > 180_000 {
            return Err("头像格式或大小无效".to_string());
        }
    }
    let core = state.core.lock().await;
    let config_manager = core.get_config_manager();
    let mut cfg_mgr = config_manager.lock().await;
    cfg_mgr
        .update_config(|config| {
            config.avatar_data = avatar_data.clone();
        })
        .await
        .map_err(|e| format!("保存头像失败: {}", e))
}

#[tauri::command]
pub async fn clear_avatar_cache() -> Result<(), String> {
    let Some(data_dir) = dirs::data_local_dir() else {
        return Ok(());
    };

    let cache_dir = data_dir.join("MCTier").join("avatar-cache");
    match tokio::fs::remove_dir_all(&cache_dir).await {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("清理头像缓存失败: {}", error)),
    }
}

/// 保存语音音量
///
/// # 参数
/// * `volume` - 音量值 (0.0-1.0)
/// * `state` - 应用状态
///
/// # 返回
/// * `Ok(())` - 保存成功
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn save_voice_volume(volume: f64, state: State<'_, AppState>) -> Result<(), String> {
    log::info!("保存语音音量: {}", volume);

    let core = state.core.lock().await;
    let config_manager = core.get_config_manager();
    let mut cfg_mgr = config_manager.lock().await;

    cfg_mgr
        .set_voice_volume(volume)
        .await
        .map_err(|e| format!("保存音量失败: {}", e))?;

    log::info!("语音音量保存成功");
    Ok(())
}

// ==================== 配置重置命令 ====================

/// 重置配置为默认值
///
/// # 返回
/// * `Ok(())` - 重置成功
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn reset_config_to_default(state: State<'_, AppState>) -> Result<(), String> {
    log::info!("收到重置配置命令");

    let core = state.core.lock().await;
    let config_manager = core.get_config_manager();
    let mut cfg_mgr = config_manager.lock().await;

    match cfg_mgr.reset_to_default().await {
        Ok(_) => {
            log::info!("配置已重置为默认值");
            Ok(())
        }
        Err(e) => {
            log::error!("重置配置失败: {}", e);
            Err(format!("重置配置失败: {}", e))
        }
    }
}

// ==================== 配置导入导出命令 ====================

/// 导出配置到文件
///
/// # 参数
/// * `export_path` - 导出文件路径
/// * `state` - 应用状态
///
/// # 返回
/// * `Ok(())` - 导出成功
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn export_config(export_path: String, state: State<'_, AppState>) -> Result<(), String> {
    log::info!("导出配置到: {}", export_path);

    let export_path = require_path_grant(&export_path, PathAccess::WriteFile, true)?;
    if export_path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_none_or(|extension| !extension.eq_ignore_ascii_case("json"))
    {
        return Err("配置导出路径必须使用 .json 扩展名".to_string());
    }

    let core = state.core.lock().await;
    let config_manager = core.get_config_manager();
    let cfg_mgr = config_manager.lock().await;

    cfg_mgr
        .export_config(export_path)
        .await
        .map_err(|e| format!("导出配置失败: {}", e))?;

    log::info!("配置导出成功");
    Ok(())
}

/// 从文件导入配置
///
/// # 参数
/// * `import_path` - 导入文件路径
/// * `state` - 应用状态
///
/// # 返回
/// * `Ok(())` - 导入成功
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn import_config(import_path: String, state: State<'_, AppState>) -> Result<(), String> {
    log::info!("从文件导入配置: {}", import_path);

    let import_path = require_existing_file_grant(&import_path, PathAccess::ReadFile)?;
    if import_path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_none_or(|extension| !extension.eq_ignore_ascii_case("json"))
    {
        return Err("配置导入路径必须使用 .json 扩展名".to_string());
    }

    let core = state.core.lock().await;
    let config_manager = core.get_config_manager();
    let mut cfg_mgr = config_manager.lock().await;

    cfg_mgr
        .import_config(import_path)
        .await
        .map_err(|e| format!("导入配置失败: {}", e))?;

    log::info!("配置导入成功");
    Ok(())
}

// ==================== GPU 设置命令 ====================

/// 重启应用并应用 GPU 设置
///
/// # 参数
/// * `enable_gpu` - 是否启用 GPU 渲染
/// * `app` - 应用句柄
///
/// # 返回
/// * `Ok(())` - 重启成功
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn restart_app_with_gpu_settings(
    enable_gpu: bool,
    app: tauri::AppHandle,
) -> Result<(), String> {
    log::info!("重启应用以应用 GPU 设置: enable_gpu={}", enable_gpu);

    use std::process::Command;

    // 获取当前可执行文件路径
    let exe_path = std::env::current_exe().map_err(|e| format!("获取程序路径失败: {}", e))?;

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;

        let browser_arguments = if !enable_gpu {
            "--disable-gpu --disable-software-rasterizer --disable-gpu-compositing --disable-gpu-process-crash-limit --in-process-gpu"
        } else {
            "--enable-gpu-rasterization --enable-zero-copy --ignore-gpu-blocklist"
        };
        log::info!("直接启动新进程以应用 GPU 设置");
        Command::new(&exe_path)
            .env("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", browser_arguments)
            .creation_flags(0x08000000)
            .spawn()
            .map_err(|e| format!("启动新进程失败: {}", e))?;
    }

    #[cfg(not(windows))]
    {
        // 非 Windows 平台的实现
        let mut cmd = Command::new(&exe_path);

        if !enable_gpu {
            cmd.env("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", "--disable-gpu --disable-software-rasterizer --disable-gpu-compositing --disable-gpu-process-crash-limit --in-process-gpu");
        } else {
            cmd.env(
                "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
                "--enable-gpu-rasterization --enable-zero-copy --ignore-gpu-blocklist",
            );
        }

        cmd.spawn().map_err(|e| format!("启动新进程失败: {}", e))?;
    }

    log::info!("新进程已启动，准备退出当前进程");

    // 延迟退出当前进程，确保新进程已启动
    tokio::time::sleep(tokio::time::Duration::from_millis(800)).await;
    app.exit(0);

    Ok(())
}

/// 保存出口节点高级配置
///
/// # 参数
/// * `enable_socks5` - 是否启用 SOCKS5 代理
/// * `socks5_port` - SOCKS5 代理端口
/// * `port_forward_rules` - 端口转发规则列表
/// * `no_tun` - 是否启用无 TUN 模式
/// * `proxy_forward_by_system` - 是否启用系统转发
/// * `bind_device` - 是否仅使用物理网卡
/// * `multi_thread` - 是否启用多线程
/// * `multi_thread_count` - 多线程数量
/// * `use_smoltcp` - 是否启用 smoltcp
/// * `enable_kcp_proxy` - 是否启用 KCP 代理
/// * `enable_quic_proxy` - 是否启用 QUIC 代理
/// * `latency_first` - 是否启用延迟优先模式
///
/// # 返回
/// * `Ok(())` - 保存成功
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn save_exit_node_advanced_config(
    enable_socks5: Option<bool>,
    socks5_port: Option<u16>,
    port_forward_rules: Option<Vec<serde_json::Value>>,
    no_tun: Option<bool>,
    proxy_forward_by_system: Option<bool>,
    bind_device: Option<bool>,
    multi_thread: Option<bool>,
    multi_thread_count: Option<u32>,
    use_smoltcp: Option<bool>,
    enable_kcp_proxy: Option<bool>,
    enable_quic_proxy: Option<bool>,
    latency_first: Option<bool>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    use crate::modules::config_manager::PortForwardRule;

    log::info!("保存出口节点高级配置");
    log::info!("  - enable_socks5: {:?}", enable_socks5);
    log::info!("  - socks5_port: {:?}", socks5_port);
    log::info!("  - no_tun: {:?}", no_tun);
    log::info!("  - proxy_forward_by_system: {:?}", proxy_forward_by_system);
    log::info!("  - bind_device: {:?}", bind_device);
    log::info!("  - multi_thread: {:?}", multi_thread);
    log::info!("  - multi_thread_count: {:?}", multi_thread_count);
    log::info!("  - use_smoltcp: {:?}", use_smoltcp);
    log::info!("  - enable_kcp_proxy: {:?}", enable_kcp_proxy);
    log::info!("  - enable_quic_proxy: {:?}", enable_quic_proxy);
    log::info!("  - latency_first: {:?}", latency_first);

    let core = state.core.lock().await;
    let config_manager = core.get_config_manager();
    let mut cfg_mgr = config_manager.lock().await;

    cfg_mgr
        .update_config(|config| {
            // 确保 exit_node_config 存在
            if config.exit_node_config.is_none() {
                config.exit_node_config =
                    Some(crate::modules::config_manager::ExitNodeConfig::default());
            }

            if let Some(ref mut exit_config) = config.exit_node_config {
                // 更新 SOCKS5 配置
                if let Some(enable) = enable_socks5 {
                    exit_config.enable_socks5 = enable;
                }
                if let Some(port) = socks5_port {
                    exit_config.socks5_port = Some(port);
                }

                // 更新端口转发规则
                if let Some(rules_json) = port_forward_rules {
                    let rules: Vec<PortForwardRule> = rules_json
                        .iter()
                        .filter_map(|r| {
                            if let (Some(protocol), Some(bind_addr), Some(dst_addr)) = (
                                r.get("protocol").and_then(|v| v.as_str()),
                                r.get("bind_addr").and_then(|v| v.as_str()),
                                r.get("dst_addr").and_then(|v| v.as_str()),
                            ) {
                                Some(PortForwardRule {
                                    protocol: protocol.to_string(),
                                    bind_addr: bind_addr.to_string(),
                                    dst_addr: dst_addr.to_string(),
                                })
                            } else {
                                None
                            }
                        })
                        .collect();
                    exit_config.port_forward_rules = rules;
                }

                // 更新其他高级配置
                if let Some(no_tun_val) = no_tun {
                    exit_config.no_tun = no_tun_val;
                }
                if let Some(proxy_forward) = proxy_forward_by_system {
                    exit_config.proxy_forward_by_system = proxy_forward;
                }
                if let Some(bind_dev) = bind_device {
                    exit_config.bind_device = bind_dev;
                }
                if let Some(multi_thread_val) = multi_thread {
                    exit_config.multi_thread = multi_thread_val;
                }
                if let Some(thread_count) = multi_thread_count {
                    exit_config.multi_thread_count = Some(thread_count);
                }
                if let Some(smoltcp) = use_smoltcp {
                    exit_config.use_smoltcp = smoltcp;
                }
                if let Some(kcp) = enable_kcp_proxy {
                    exit_config.enable_kcp_proxy = kcp;
                }
                if let Some(quic) = enable_quic_proxy {
                    exit_config.enable_quic_proxy = quic;
                }
                if let Some(latency) = latency_first {
                    exit_config.latency_first = latency;
                }
            }
        })
        .await
        .map_err(|e| format!("保存出口节点高级配置失败: {}", e))?;

    log::info!("出口节点高级配置保存成功");
    Ok(())
}

/// 获取出口节点高级配置
///
/// # 返回
/// * `Ok(serde_json::Value)` - 出口节点高级配置
/// * `Err(String)` - 错误信息
#[tauri::command]
pub async fn get_exit_node_advanced_config(
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    log::info!("获取出口节点高级配置");

    let core = state.core.lock().await;
    let config_manager = core.get_config_manager();
    let cfg_mgr = config_manager.lock().await;
    let config = cfg_mgr.get_config();

    let exit_config = config.exit_node_config.clone().unwrap_or_default();

    Ok(serde_json::json!({
        "enableSocks5": exit_config.enable_socks5,
        "socks5Port": exit_config.socks5_port,
        "portForwardRules": exit_config.port_forward_rules,
        "noTun": exit_config.no_tun,
        "proxyForwardBySystem": exit_config.proxy_forward_by_system,
        "bindDevice": exit_config.bind_device,
        "multiThread": exit_config.multi_thread,
        "multiThreadCount": exit_config.multi_thread_count,
        "useSmoltcp": exit_config.use_smoltcp,
        "enableKcpProxy": exit_config.enable_kcp_proxy,
        "enableQuicProxy": exit_config.enable_quic_proxy,
        "latencyFirst": exit_config.latency_first,
    }))
}
