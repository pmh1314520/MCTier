// 远程控制 - 输入注入模块（仅 Windows）
// 接收来自控制端的鼠标/键盘事件，通过 Win32 SendInput 注入到本机，实现被控端的真实操作。
// 坐标采用归一化（0.0~1.0），映射到主显示器的绝对坐标，保证不同分辨率下一致。

use serde::Deserialize;

/// 单个远程输入事件（与前端协议一致）
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind")]
pub enum RemoteInputEvent {
    /// 鼠标移动（归一化坐标）
    #[serde(rename = "move")]
    MouseMove { x: f64, y: f64 },
    /// 鼠标按下：button 0=左 1=中 2=右
    #[serde(rename = "down")]
    MouseDown { button: u8, x: f64, y: f64 },
    /// 鼠标抬起
    #[serde(rename = "up")]
    MouseUp { button: u8, x: f64, y: f64 },
    /// 滚轮：dy 正=向上，dx 正=向右（单位：刻度，1.0=一格）
    #[serde(rename = "wheel")]
    MouseWheel { dx: f64, dy: f64 },
    /// 键盘按下：code 为 Windows 虚拟键码（VK）
    #[serde(rename = "keydown")]
    KeyDown { code: u32, extended: Option<bool> },
    /// 键盘抬起
    #[serde(rename = "keyup")]
    KeyUp { code: u32, extended: Option<bool> },
}

/// 注入一批输入事件
#[tauri::command]
pub fn remote_inject_input(events: Vec<RemoteInputEvent>) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        platform::inject(&events)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = events;
        Err("远程控制注入仅支持 Windows".to_string())
    }
}

#[cfg(target_os = "windows")]
mod platform {
    use super::RemoteInputEvent;
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, INPUT_MOUSE, KEYBDINPUT, KEYBD_EVENT_FLAGS,
        KEYEVENTF_EXTENDEDKEY, KEYEVENTF_KEYUP, MOUSEINPUT, MOUSE_EVENT_FLAGS, MOUSEEVENTF_ABSOLUTE,
        MOUSEEVENTF_HWHEEL, MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP, MOUSEEVENTF_MIDDLEDOWN,
        MOUSEEVENTF_MIDDLEUP, MOUSEEVENTF_MOVE, MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP,
        MOUSEEVENTF_WHEEL, VIRTUAL_KEY,
    };
    use windows::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_CXSCREEN, SM_CYSCREEN};

    const WHEEL_DELTA: f64 = 120.0;

    fn screen_size() -> (i32, i32) {
        unsafe {
            let w = GetSystemMetrics(SM_CXSCREEN).max(1);
            let h = GetSystemMetrics(SM_CYSCREEN).max(1);
            (w, h)
        }
    }

    /// 归一化坐标 -> 绝对坐标（0..65535，主显示器）
    fn to_abs(x: f64, y: f64) -> (i32, i32) {
        let nx = x.clamp(0.0, 1.0);
        let ny = y.clamp(0.0, 1.0);
        let ax = (nx * 65535.0).round() as i32;
        let ay = (ny * 65535.0).round() as i32;
        (ax, ay)
    }

    fn mouse_input(dx: i32, dy: i32, mouse_data: i32, flags: MOUSE_EVENT_FLAGS) -> INPUT {
        INPUT {
            r#type: INPUT_MOUSE,
            Anonymous: INPUT_0 {
                mi: MOUSEINPUT {
                    dx,
                    dy,
                    mouseData: mouse_data as u32,
                    dwFlags: flags,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        }
    }

    fn key_input(code: u16, flags: KEYBD_EVENT_FLAGS) -> INPUT {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VIRTUAL_KEY(code),
                    wScan: 0,
                    dwFlags: flags,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        }
    }

    fn button_flags(button: u8, down: bool) -> MOUSE_EVENT_FLAGS {
        match button {
            2 => {
                if down {
                    MOUSEEVENTF_RIGHTDOWN
                } else {
                    MOUSEEVENTF_RIGHTUP
                }
            }
            1 => {
                if down {
                    MOUSEEVENTF_MIDDLEDOWN
                } else {
                    MOUSEEVENTF_MIDDLEUP
                }
            }
            _ => {
                if down {
                    MOUSEEVENTF_LEFTDOWN
                } else {
                    MOUSEEVENTF_LEFTUP
                }
            }
        }
    }

    pub fn inject(events: &[RemoteInputEvent]) -> Result<(), String> {
        let mut inputs: Vec<INPUT> = Vec::with_capacity(events.len() + 4);

        for ev in events {
            match ev {
                RemoteInputEvent::MouseMove { x, y } => {
                    let (ax, ay) = to_abs(*x, *y);
                    inputs.push(mouse_input(ax, ay, 0, MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE));
                }
                RemoteInputEvent::MouseDown { button, x, y } => {
                    let (ax, ay) = to_abs(*x, *y);
                    // 先移动到目标点，再按下，避免点偏
                    inputs.push(mouse_input(ax, ay, 0, MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE));
                    inputs.push(mouse_input(0, 0, 0, button_flags(*button, true)));
                }
                RemoteInputEvent::MouseUp { button, x, y } => {
                    let (ax, ay) = to_abs(*x, *y);
                    inputs.push(mouse_input(ax, ay, 0, MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE));
                    inputs.push(mouse_input(0, 0, 0, button_flags(*button, false)));
                }
                RemoteInputEvent::MouseWheel { dx, dy } => {
                    if *dy != 0.0 {
                        let amount = (dy * WHEEL_DELTA).round() as i32;
                        inputs.push(mouse_input(0, 0, amount, MOUSEEVENTF_WHEEL));
                    }
                    if *dx != 0.0 {
                        let amount = (dx * WHEEL_DELTA).round() as i32;
                        inputs.push(mouse_input(0, 0, amount, MOUSEEVENTF_HWHEEL));
                    }
                }
                RemoteInputEvent::KeyDown { code, extended } => {
                    let mut flags = KEYBD_EVENT_FLAGS(0);
                    if extended.unwrap_or(false) {
                        flags |= KEYEVENTF_EXTENDEDKEY;
                    }
                    inputs.push(key_input(*code as u16, flags));
                }
                RemoteInputEvent::KeyUp { code, extended } => {
                    let mut flags = KEYEVENTF_KEYUP;
                    if extended.unwrap_or(false) {
                        flags |= KEYEVENTF_EXTENDEDKEY;
                    }
                    inputs.push(key_input(*code as u16, flags));
                }
            }
        }

        if inputs.is_empty() {
            return Ok(());
        }

        // 触发一次屏幕尺寸读取以确保显示器存在（同时为将来多屏扩展预留）
        let _ = screen_size();

        let sent = unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) };
        if sent == 0 {
            return Err("SendInput 注入失败".to_string());
        }
        Ok(())
    }
}
