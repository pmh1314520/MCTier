//! macOS 防休眠断言（IOPMAssertion）。
//!
//! `macos_platform::set_realtime_activity` 申请的是 `NSActivity` 的 App Nap
//! 豁免——它只阻止隐藏窗口后进程被节流，**不**阻止系统进入休眠。录屏或语音
//! 通话进行到一半机器睡过去，采集泵和 WebRTC 连接都会断。这里补上真正的
//! 「阻止空闲休眠」断言，与 App Nap 豁免配合使用。
//!
//! 用 `kIOPMAssertionTypePreventUserIdleSystemSleep`：只阻止「空闲」休眠，
//! 用户主动合盖仍可休眠（笔记本合盖时断线是可接受的，强行不睡反而更糟）。
//! 断言按活跃会话数的边沿驱动创建/释放，幂等且可从任意线程调用。

use std::ffi::c_void;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};

// IOKit 的电源管理断言 API。`IOPMAssertionCreateWithName` 要一个 CFString 的
// 断言类型和原因，返回一个 32 位的断言 ID；释放用 `IOPMAssertionRelease`。
#[link(name = "IOKit", kind = "framework")]
extern "C" {
    fn IOPMAssertionCreateWithName(
        assertion_type: *const c_void,
        assertion_level: u32,
        assertion_name: *const c_void,
        assertion_id: *mut u32,
    ) -> i32;
    fn IOPMAssertionRelease(assertion_id: u32) -> i32;
}

/// kIOPMAssertionLevelOn
const IOPM_ASSERTION_LEVEL_ON: u32 = 255;

static SLEEP_ASSERTION_ACTIVE: AtomicBool = AtomicBool::new(false);
static SLEEP_ASSERTION_ID: AtomicU32 = AtomicU32::new(0);

fn create_assertion() -> Option<u32> {
    use core_foundation::base::TCFType;
    use core_foundation::string::CFString;

    // 断言类型字符串必须与 IOKit 头文件完全一致，拼错会直接创建失败。
    let assertion_type = CFString::new("PreventUserIdleSystemSleep");
    let reason = CFString::new("MCTier 正在录制或进行语音通话");
    let mut assertion_id: u32 = 0;
    let result = unsafe {
        IOPMAssertionCreateWithName(
            assertion_type.as_concrete_TypeRef() as *const c_void,
            IOPM_ASSERTION_LEVEL_ON,
            reason.as_concrete_TypeRef() as *const c_void,
            &mut assertion_id,
        )
    };
    // kIOReturnSuccess == 0
    if result == 0 {
        Some(assertion_id)
    } else {
        log::warn!("创建 macOS 防休眠断言失败: IOReturn={result}");
        None
    }
}

/// 有活跃会话（录屏 / 系统声音采集 / 语音）时阻止系统空闲休眠；全部结束后释放。
///
/// 幂等且边沿驱动：重复传入同一状态不会重复创建或泄漏断言。与
/// [`crate::modules::macos_platform::set_realtime_activity`] 一同调用——
/// 一个管 App Nap，一个管系统休眠，职责不同。
pub fn set_prevent_sleep(active: bool) {
    let was = SLEEP_ASSERTION_ACTIVE.swap(active, Ordering::AcqRel);
    if was == active {
        return;
    }
    if active {
        if let Some(id) = create_assertion() {
            SLEEP_ASSERTION_ID.store(id, Ordering::Release);
            log::debug!("已申请 macOS 防休眠断言（id={id}）");
        } else {
            // 创建失败则回退状态，下次仍可重试，不至于永久卡在「以为已申请」。
            SLEEP_ASSERTION_ACTIVE.store(false, Ordering::Release);
        }
    } else {
        let id = SLEEP_ASSERTION_ID.swap(0, Ordering::AcqRel);
        if id != 0 {
            let result = unsafe { IOPMAssertionRelease(id) };
            if result != 0 {
                log::warn!("释放 macOS 防休眠断言失败: IOReturn={result}");
            } else {
                log::debug!("已释放 macOS 防休眠断言（id={id}）");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 创建/释放由 active 边沿驱动：重复 true/false 不应重复申请或泄漏断言 ID。
    /// IOPMAssertion 创建无需特殊权限，可在测试里真实跑一遍。
    #[test]
    fn prevent_sleep_toggles_are_edge_driven() {
        set_prevent_sleep(true);
        set_prevent_sleep(true);
        set_prevent_sleep(false);
        set_prevent_sleep(false);
        assert!(!SLEEP_ASSERTION_ACTIVE.load(Ordering::Acquire));
        assert_eq!(SLEEP_ASSERTION_ID.load(Ordering::Acquire), 0);
    }
}
