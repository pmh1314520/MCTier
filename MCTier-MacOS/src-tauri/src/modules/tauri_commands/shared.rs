// Tauri Command 接口模块
// 提供前端调用的所有命令接口

pub(crate) use crate::modules::app_core::{AppCore, AppState as CoreAppState};

pub(crate) use crate::modules::config_manager::UserConfig;

pub(crate) use crate::modules::lobby_manager::{Lobby, Player};

pub(crate) use crate::modules::voice_service::AudioDevice;

pub(crate) use std::collections::HashMap;

pub(crate) use std::sync::atomic::{AtomicBool, Ordering};

pub(crate) use std::sync::Arc;

pub(crate) use std::sync::Mutex as StdMutex;

pub(crate) use std::sync::OnceLock;

pub(crate) use tauri::Emitter;

pub(crate) use tauri::Manager;

pub(crate) use tauri::State;

pub(crate) use tokio::sync::Mutex;

/// 远程文件下载的取消标志注册表（task_id -> 取消标志）
pub(crate) fn download_cancels() -> &'static dashmap::DashMap<String, Arc<AtomicBool>> {
    static CANCELS: OnceLock<dashmap::DashMap<String, Arc<AtomicBool>>> = OnceLock::new();
    CANCELS.get_or_init(dashmap::DashMap::new)
}

pub(crate) const MAX_REMOTE_FILE_BYTES: u64 = 2 * 1024 * 1024 * 1024;

pub(crate) const MAX_REMOTE_METADATA_BYTES: usize = 4 * 1024 * 1024;

pub(crate) const MAX_REMOTE_BATCH_FILES: usize = 256;

pub(crate) const MAX_REMOTE_BATCH_REQUEST_BYTES: usize = 64 * 1024;

pub(crate) const MAX_REMOTE_BATCH_BYTES: u64 = 2 * 1024 * 1024 * 1024;

pub(crate) const MAX_PATH_GRANTS: usize = 4096;

pub(crate) const MAX_CHAT_TARGETS: usize = 64;

pub(crate) const MAX_CHAT_RESPONSE_BYTES: usize = 16 * 1024 * 1024;

pub(crate) const MAX_CHAT_ATTACHMENT_RESPONSE_BYTES: usize = 90 * 1024 * 1024;

pub(crate) fn require_secure_signaling(value: &str) -> Result<(), String> {
    let url = reqwest::Url::parse(value).map_err(|_| "Invalid signaling URL")?;
    if url.scheme() != "wss"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err("信令服务器必须使用 WSS 加密连接".into());
    }
    Ok(())
}
// 仅 Windows 凭据管理器路径使用；其他平台不落盘明文密码，因此这里不是死代码，
// 而是平台无关声明配平台相关使用。
#[cfg(windows)]
pub(crate) const AUTO_LOBBY_CREDENTIAL_TARGET: &str = "MCTier:auto-lobby-password";

#[cfg(windows)]
pub(crate) fn read_auto_lobby_secret() -> Result<Option<String>, String> {
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
        if let Err(error) = CredReadW(
            PCWSTR(target.as_ptr()),
            CRED_TYPE_GENERIC,
            0,
            &mut credential,
        ) {
            if error.code() == windows::core::HRESULT::from_win32(1168) {
                return Ok(None);
            }
            return Err("无法读取 Windows 凭据库".into());
        }
        let record = credential.as_ref().ok_or("Invalid credential record")?;
        let bytes =
            std::slice::from_raw_parts(record.CredentialBlob, record.CredentialBlobSize as usize);
        let value = String::from_utf8(bytes.to_vec());
        CredFree(credential.cast());
        let value = value.map_err(|_| "Invalid credential encoding")?;
        Ok((!value.is_empty()).then_some(value))
    }
}

#[cfg(windows)]
pub(crate) fn write_auto_lobby_secret(password: &str) -> Result<(), String> {
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
pub(crate) fn read_auto_lobby_secret() -> Result<Option<String>, String> {
    let entry = keyring::Entry::new("MCTier", "auto-lobby-password")
        .map_err(|_| "System credential store unavailable")?;
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err("Cannot read system credential".into()),
    }
}

#[cfg(not(windows))]
pub(crate) fn write_auto_lobby_secret(password: &str) -> Result<(), String> {
    let entry = keyring::Entry::new("MCTier", "auto-lobby-password")
        .map_err(|_| "System credential store unavailable")?;
    if password.is_empty() {
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(_) => return Err("Cannot remove saved password".into()),
        }
    } else {
        entry
            .set_password(password)
            .map_err(|_| "Cannot save system credential")?;
    }
    Ok(())
}

pub(crate) fn overlay_http_host(raw: &str) -> Result<String, String> {
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

pub(crate) struct FilePeerTarget {
    pub(crate) host: String,
    pub(crate) token: String,
}

pub(crate) async fn require_file_peer_host(
    raw: &str,
    state: &AppState,
) -> Result<FilePeerTarget, String> {
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
pub(crate) enum PathAccess {
    ReadFile,
    WriteFile,
    DeleteFile,
    ReadDirectory,
    WriteDirectory,
    Open,
}

#[derive(Default)]
pub(crate) struct PathGrant {
    read_file: bool,
    write_file: bool,
    delete_file: bool,
    read_directory: bool,
    write_directory: bool,
    open: bool,
}

#[derive(Default)]
pub(crate) struct PathGrantStore {
    entries: HashMap<std::path::PathBuf, PathGrant>,
}

pub(crate) fn path_grants() -> &'static StdMutex<PathGrantStore> {
    static GRANTS: OnceLock<StdMutex<PathGrantStore>> = OnceLock::new();
    GRANTS.get_or_init(|| StdMutex::new(PathGrantStore::default()))
}

pub(crate) fn path_grant_allows(grant: &mut PathGrant, access: PathAccess) {
    match access {
        PathAccess::ReadFile => grant.read_file = true,
        PathAccess::WriteFile => grant.write_file = true,
        PathAccess::DeleteFile => grant.delete_file = true,
        PathAccess::ReadDirectory => grant.read_directory = true,
        PathAccess::WriteDirectory => grant.write_directory = true,
        PathAccess::Open => grant.open = true,
    }
}

pub(crate) fn path_grant_matches(grant: &PathGrant, access: PathAccess) -> bool {
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
pub(crate) fn validate_local_path_component(component: &std::ffi::OsStr) -> Result<(), String> {
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
pub(crate) fn validate_local_path_component(_component: &std::ffi::OsStr) -> Result<(), String> {
    Ok(())
}

/// Normalize paths without resolving user-controlled symlinks. All paths used
/// by these commands are expected to come from a native picker or an app
/// generated absolute path, so relative paths and parent traversal are denied.
pub(crate) fn normalize_local_path(
    raw: &str,
    allow_missing_leaf: bool,
) -> Result<std::path::PathBuf, String> {
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

pub(crate) fn ensure_existing_path_has_no_links(path: &std::path::Path) -> Result<(), String> {
    let mut current = std::path::PathBuf::new();
    for component in path.components() {
        current.push(component.as_os_str());
        let metadata = std::fs::symlink_metadata(&current)
            .map_err(|e| format!("检查路径失败 {}: {}", current.display(), e))?;
        if is_symlink_or_reparse_point(&metadata) && !is_macos_system_path_alias(&current) {
            return Err(format!("拒绝经过符号链接或重解析点: {}", current.display()));
        }
    }
    Ok(())
}

pub(crate) fn is_macos_system_path_alias(path: &std::path::Path) -> bool {
    #[cfg(target_os = "macos")]
    {
        // macOS exposes these fixed system aliases for their /private targets.
        // Native temporary-directory APIs commonly return the aliased spelling.
        const ALIASES: [(&str, &str); 3] = [
            ("/etc", "/private/etc"),
            ("/tmp", "/private/tmp"),
            ("/var", "/private/var"),
        ];
        return ALIASES.iter().any(|(alias, target)| {
            path == std::path::Path::new(alias)
                && std::fs::canonicalize(path)
                    .is_ok_and(|canonical| canonical == std::path::Path::new(target))
        });
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = path;
        false
    }
}

pub(crate) fn register_path_grant(
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

pub(crate) fn require_path_grant(
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

pub(crate) fn require_existing_file_grant(
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

pub(crate) fn require_existing_directory_grant(
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

/// 仅 Windows：把程序路径转成注册表 Run 项的取值（Linux 用 XDG autostart）。
#[cfg(windows)]
pub(crate) fn windows_run_value(exe: &std::path::Path) -> Result<String, String> {
    let value = exe
        .to_str()
        .ok_or_else(|| "程序路径不是有效的 UTF-8".to_string())?;
    if value.is_empty() || value.contains('\0') || value.contains('"') {
        return Err("程序路径包含非法字符".to_string());
    }
    Ok(format!("\"{}\"", value))
}

#[cfg(windows)]
pub(crate) fn windows_system_command(name: &str) -> std::path::PathBuf {
    // Canonical example: windows_system_command("WindowsPowerShell\\v1.0\\powershell.exe")
    // Elevation is performed by the typed helper; the legacy equivalent was
    // `Start-Process -FilePath $env:MCTIER_EXE -Verb RunAs`.
    crate::modules::windows_paths::system_command(name)
}

#[cfg(not(windows))]
pub(crate) fn unix_system_command(name: &str) -> Result<std::path::PathBuf, String> {
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

impl AppState {
    /// Clone service handles without retaining the core lifecycle gate across
    /// service locks or I/O. Entry and shutdown keep their explicit core guard.
    pub(crate) async fn config_manager(
        &self,
    ) -> Arc<Mutex<crate::modules::config_manager::ConfigManager>> {
        self.core.lock().await.get_config_manager()
    }

    pub(crate) async fn file_transfer(
        &self,
    ) -> Arc<Mutex<crate::modules::file_transfer::FileTransferService>> {
        self.core.lock().await.get_file_transfer()
    }

    pub(crate) async fn p2p_signaling(
        &self,
    ) -> Arc<Mutex<crate::modules::p2p_signaling::P2PSignalingService>> {
        self.core.lock().await.get_p2p_signaling()
    }

    pub(crate) async fn voice_service(
        &self,
    ) -> Arc<Mutex<crate::modules::voice_service::VoiceService>> {
        self.core.lock().await.get_voice_service()
    }

    pub(crate) async fn lobby_manager(
        &self,
    ) -> Arc<Mutex<crate::modules::lobby_manager::LobbyManager>> {
        self.core.lock().await.get_lobby_manager()
    }
}

// ==================== Rust高性能文件传输命令 ====================

// 注意：由于Rust文件传输模块的复杂性，暂时保留JavaScript实现
// 未来可以考虑完全迁移到Rust后端以获得更好的性能

// ==================== HTTP 文件共享命令 ====================

pub(crate) use crate::modules::file_transfer::{
    FileInfo as FileTransferFileInfo, SharedFolder, SharedFolderSummary,
};

pub(crate) fn is_symlink_or_reparse_point(metadata: &std::fs::Metadata) -> bool {
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

pub(crate) fn is_windows_reserved_name(name: &str) -> bool {
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
