//! macOS 麦克风 TCC 授权。
//!
//! 这是「麦克风在 macOS 上用不了」的根因：原生 AUHAL 输入单元在未获授权时
//! **不会**触发系统授权弹窗——它会照常 `AudioUnitInitialize` / `AudioOutputUnitStart`
//! 成功，然后只向回调吐静音采样。于是上层以为采集正常，用户却完全没声音，也
//! 没有任何弹窗提示去授权。
//!
//! WKWebView 的 `getUserMedia` 回退路径同样依赖这个授权：WebView 自己不会单独
//! 弹麦克风框，宿主进程必须先持有麦克风权限。
//!
//! 正确做法是在打开输入单元之前，通过 `AVCaptureDevice` 查询授权状态；状态为
//! 「未决定」时主动请求一次（弹出系统授权框）。这里用阻塞方式等待用户选择，
//! 以便 `native_microphone_start` 能在真正打开单元前就知道能不能用。

use objc2::runtime::Bool;
use objc2_av_foundation::{AVAuthorizationStatus, AVCaptureDevice, AVMediaTypeAudio};
use std::sync::mpsc;
use std::time::Duration;

/// 麦克风授权状态，映射自 `AVAuthorizationStatus`。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MicPermission {
    /// 从未询问过：可以主动请求以弹出系统授权框。
    NotDetermined,
    /// 用户已授权。
    Authorized,
    /// 用户已拒绝，或被家长控制 / MDM 限制——只能引导去系统设置手动开启。
    Denied,
}

fn audio_media_type() -> Option<&'static objc2_av_foundation::AVMediaType> {
    // 链接期常量，运行时解析；理论上恒存在，拿不到时按「无法判定」处理。
    unsafe { AVMediaTypeAudio }
}

/// 查询当前麦克风授权状态（不弹窗）。
pub fn status() -> MicPermission {
    let Some(media_type) = audio_media_type() else {
        // 常量缺失属异常环境，当作未决定，让调用方走请求流程。
        return MicPermission::NotDetermined;
    };
    let status = unsafe { AVCaptureDevice::authorizationStatusForMediaType(media_type) };
    match status {
        AVAuthorizationStatus::Authorized => MicPermission::Authorized,
        AVAuthorizationStatus::NotDetermined => MicPermission::NotDetermined,
        // Restricted / Denied 用户都无法在应用内改变，统一按 Denied 处理。
        _ => MicPermission::Denied,
    }
}

/// 请求麦克风授权，阻塞等待用户在系统弹窗里做出选择。
///
/// 只应在 [`status`] 返回 `NotDetermined` 时调用——其余状态下系统不会再弹窗，
/// completion 会立刻以当前结果回调。`timeout` 是兜底：理论上用户不点，block
/// 就不回调，这里超时后按「仍未授权」返回，避免调用线程永久阻塞。
pub fn request_blocking(timeout: Duration) -> MicPermission {
    let Some(media_type) = audio_media_type() else {
        return MicPermission::NotDetermined;
    };
    let (tx, rx) = mpsc::channel::<bool>();
    let handler = block2::RcBlock::new(move |granted: Bool| {
        // 用户关掉窗口而不选择时 completion 可能不触发，send 失败则忽略。
        let _ = tx.send(granted.as_bool());
    });
    unsafe {
        AVCaptureDevice::requestAccessForMediaType_completionHandler(media_type, &handler);
    }
    match rx.recv_timeout(timeout) {
        Ok(true) => MicPermission::Authorized,
        Ok(false) => MicPermission::Denied,
        // 超时：回到状态查询，可能用户已经选了但消息还没回来。
        Err(_) => status(),
    }
}

/// 确保麦克风可用：已授权直接放行；未决定则请求一次；被拒绝返回带引导的错误。
///
/// 返回 `Ok(())` 表示已获授权，可以安全打开输入单元。错误字符串面向用户，
/// 指向系统设置的麦克风授权页。
pub fn ensure_authorized() -> Result<(), String> {
    match status() {
        MicPermission::Authorized => Ok(()),
        MicPermission::NotDetermined => {
            // 首次使用：弹系统授权框并等待用户选择。给 60 秒，足够用户反应。
            match request_blocking(Duration::from_secs(60)) {
                MicPermission::Authorized => Ok(()),
                _ => Err(denied_message()),
            }
        }
        MicPermission::Denied => Err(denied_message()),
    }
}

/// 前缀让前端能把它识别成授权问题（映射成 NotAllowedError，触发设置引导弹窗），
/// 而不是当成普通错误、再去回退到同样没权限的浏览器采集。与 MIC_NOT_FOUND: 同理。
pub const DENIED_PREFIX: &str = "MIC_PERMISSION_DENIED:";

fn denied_message() -> String {
    format!(
        "{DENIED_PREFIX}麦克风未获授权。请在「系统设置 › 隐私与安全性 › 麦克风」中允许 MCTier，然后重试"
    )
}
