// 远程控制 - 输入注入模块
// 接收来自控制端的鼠标/键盘事件并注入到本机，实现被控端的真实操作。
// 坐标采用归一化（0.0~1.0），映射到主显示器的绝对坐标，保证不同分辨率下一致。
//
// 平台实现：
// - Windows：Win32 SendInput。
// - Linux：uinput 虚拟设备（Wayland 与 X11 通用）。Wayland 下合成器不提供全局
//   注入接口，因此走内核输入层；logind 会把活动会话用户加入 /dev/uinput 的 ACL，
//   无需提权。

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
    /// 文本输入（Unicode，逐字符注入，供手机端软键盘向电脑被控端打字）
    #[serde(rename = "text")]
    Text { text: String },
    /// 未知/对端专属事件(如手机的 home/recents)：电脑端忽略，避免整批解析失败
    #[serde(other)]
    Unknown,
}

/// 注入一批输入事件
#[tauri::command]
pub fn remote_inject_input(events: Vec<RemoteInputEvent>) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        platform::inject(&events)
    }
    #[cfg(target_os = "linux")]
    {
        linux_uinput::inject(&events)
    }
    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    {
        let _ = events;
        Err("远程控制注入暂不支持当前平台".to_string())
    }
}

#[cfg(target_os = "windows")]
mod platform {
    use super::RemoteInputEvent;
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, INPUT_MOUSE, KEYBDINPUT, KEYBD_EVENT_FLAGS,
        KEYEVENTF_EXTENDEDKEY, KEYEVENTF_KEYUP, KEYEVENTF_UNICODE, MOUSEEVENTF_ABSOLUTE,
        MOUSEEVENTF_HWHEEL, MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP, MOUSEEVENTF_MIDDLEDOWN,
        MOUSEEVENTF_MIDDLEUP, MOUSEEVENTF_MOVE, MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP,
        MOUSEEVENTF_WHEEL, MOUSEINPUT, MOUSE_EVENT_FLAGS, VIRTUAL_KEY,
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

    /// Unicode 字符注入（用于文本输入），up=false 按下，up=true 抬起
    fn unicode_input(unit: u16, up: bool) -> INPUT {
        let mut flags = KEYEVENTF_UNICODE;
        if up {
            flags |= KEYEVENTF_KEYUP;
        }
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VIRTUAL_KEY(0),
                    wScan: unit,
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
                    inputs.push(mouse_input(
                        ax,
                        ay,
                        0,
                        MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE,
                    ));
                }
                RemoteInputEvent::MouseDown { button, x, y } => {
                    let (ax, ay) = to_abs(*x, *y);
                    // 先移动到目标点，再按下，避免点偏
                    inputs.push(mouse_input(
                        ax,
                        ay,
                        0,
                        MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE,
                    ));
                    inputs.push(mouse_input(0, 0, 0, button_flags(*button, true)));
                }
                RemoteInputEvent::MouseUp { button, x, y } => {
                    let (ax, ay) = to_abs(*x, *y);
                    inputs.push(mouse_input(
                        ax,
                        ay,
                        0,
                        MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE,
                    ));
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
                RemoteInputEvent::Text { text } => {
                    // 逐 UTF-16 码元注入 Unicode 字符（支持中文/emoji 等）
                    for unit in text.encode_utf16() {
                        inputs.push(unicode_input(unit, false));
                        inputs.push(unicode_input(unit, true));
                    }
                }
                RemoteInputEvent::Unknown => { /* 忽略对端专属事件 */ }
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

/// Linux 被控端：uinput 内核级输入注入（Wayland 与 X11 通用，无需提权）。
///
/// Wayland 的合成器不提供"任意进程注入全局输入"的接口，因此走内核输入层。
/// logind 会为活动会话用户在 `/dev/uinput` 上放置 ACL，普通用户可直接打开。
///
/// 建三个虚拟设备，各管一段职责 —— 合成一个"全能设备"会让 libinput 无法归类，
/// 结果是事件被整体忽略：
///
/// | 设备 | 能力位 | 职责 |
/// |---|---|---|
/// | 触摸 | `BTN_TOUCH` + `ABS_X/ABS_Y` | 绝对定位、左键拖拽 |
/// | 鼠标 | `BTN_LEFT/RIGHT/MIDDLE` + `REL_*` | 按键、滚轮 |
/// | 键盘 | 全量 `KEY_*` | 按键注入 |
///
/// 设备创建使用传统的 `uinput_user_dev` + `write()` 路径而不是较新的
/// `UI_DEV_SETUP` / `UI_ABS_SETUP` ioctl：前者在所有在用内核上都可用，
/// 且 ioctl 号不依赖结构体大小，少一类因内核版本不同而静默失败的可能。
#[cfg(target_os = "linux")]
mod linux_uinput {
    use super::RemoteInputEvent;
    use std::sync::{Mutex, OnceLock};

    // ---- uinput / evdev 常量（linux/uinput.h、linux/input-event-codes.h）----
    // _IOW('U', nr, int) = (1<<30) | (4<<16) | (0x55<<8) | nr
    const UI_SET_EVBIT: libc::c_ulong = 0x4004_5564;
    const UI_SET_KEYBIT: libc::c_ulong = 0x4004_5565;
    const UI_SET_RELBIT: libc::c_ulong = 0x4004_5566;
    const UI_SET_ABSBIT: libc::c_ulong = 0x4004_5567;
    // _IO('U', nr)
    const UI_DEV_CREATE: libc::c_ulong = 0x5501;
    const UI_DEV_DESTROY: libc::c_ulong = 0x5502;

    const EV_SYN: u16 = 0x00;
    const EV_KEY: u16 = 0x01;
    const EV_REL: u16 = 0x02;
    const EV_ABS: u16 = 0x03;
    const SYN_REPORT: u16 = 0;

    const REL_X: u16 = 0x00;
    const REL_Y: u16 = 0x01;
    const REL_WHEEL: u16 = 0x08;
    const REL_HWHEEL: u16 = 0x0c;
    const ABS_X: u16 = 0x00;
    const ABS_Y: u16 = 0x01;
    const ABS_CNT: usize = 64;

    const BTN_LEFT: u16 = 0x110;
    const BTN_RIGHT: u16 = 0x111;
    const BTN_MIDDLE: u16 = 0x112;
    const BTN_TOUCH: u16 = 0x14a;

    const BUS_USB: u16 = 0x03;
    const UINPUT_NAME_SIZE: usize = 80;

    /// 绝对坐标的量化范围。合成器会把 0..=ABS_MAX 线性映射到屏幕，
    /// 因此被控端分辨率不需要参与计算，与 Windows 端的归一化语义一致。
    const ABS_MAX: i32 = 65535;

    /// 键盘设备需要提前声明会用到哪些键位；未声明的键码内核会直接丢弃。
    /// 逐个列举容易漏，这里覆盖到 KEY_MAX 之前的常规区间。
    const KEY_BIT_MAX: u16 = 248;

    #[repr(C)]
    struct InputEvent {
        tv_sec: libc::time_t,
        tv_usec: libc::suseconds_t,
        type_: u16,
        code: u16,
        value: libc::c_int,
    }

    #[repr(C)]
    struct InputId {
        bustype: u16,
        vendor: u16,
        product: u16,
        version: u16,
    }

    #[repr(C)]
    struct UinputUserDev {
        name: [libc::c_char; UINPUT_NAME_SIZE],
        id: InputId,
        ff_effects_max: u32,
        absmax: [i32; ABS_CNT],
        absmin: [i32; ABS_CNT],
        absfuzz: [i32; ABS_CNT],
        absflat: [i32; ABS_CNT],
    }

    impl UinputUserDev {
        fn new(name: &str) -> Self {
            let mut device = Self {
                name: [0; UINPUT_NAME_SIZE],
                id: InputId {
                    bustype: BUS_USB,
                    vendor: 0x4d43,  // "MC"
                    product: 0x5431, // "T1"
                    version: 1,
                },
                ff_effects_max: 0,
                absmax: [0; ABS_CNT],
                absmin: [0; ABS_CNT],
                absfuzz: [0; ABS_CNT],
                absflat: [0; ABS_CNT],
            };
            // 末字节留 0 作为结尾，超长名字直接截断
            for (slot, byte) in device
                .name
                .iter_mut()
                .zip(name.as_bytes().iter().take(UINPUT_NAME_SIZE - 1))
            {
                *slot = *byte as libc::c_char;
            }
            device
        }
    }

    fn emit(fd: libc::c_int, type_: u16, code: u16, value: libc::c_int) -> bool {
        let event = InputEvent {
            tv_sec: 0,
            tv_usec: 0,
            type_,
            code,
            value,
        };
        let size = std::mem::size_of::<InputEvent>();
        unsafe {
            libc::write(fd, &event as *const InputEvent as *const libc::c_void, size)
                == size as isize
        }
    }

    fn emit_syn(fd: libc::c_int) -> bool {
        emit(fd, EV_SYN, SYN_REPORT, 0)
    }

    fn set_bit(fd: libc::c_int, request: libc::c_ulong, bit: u16) -> bool {
        unsafe { libc::ioctl(fd, request, bit as libc::c_int) == 0 }
    }

    fn open_uinput() -> Result<libc::c_int, String> {
        // 路径按发行版差异有两种；先试标准位置
        for path in ["/dev/uinput\0", "/dev/input/uinput\0"] {
            let fd = unsafe {
                libc::open(
                    path.as_ptr() as *const libc::c_char,
                    libc::O_WRONLY | libc::O_NONBLOCK,
                )
            };
            if fd >= 0 {
                return Ok(fd);
            }
        }
        Err(
            "无法打开 /dev/uinput。请确认已加载 uinput 模块（sudo modprobe uinput），\
             且当前登录会话为活动会话（logind 会据此授予设备访问权）"
                .to_string(),
        )
    }

    /// 写入设备描述并创建设备。失败时负责关闭 fd，避免泄漏。
    fn finalize_device(fd: libc::c_int, device: &UinputUserDev, what: &str) -> Result<(), String> {
        let size = std::mem::size_of::<UinputUserDev>();
        let written = unsafe {
            libc::write(
                fd,
                device as *const UinputUserDev as *const libc::c_void,
                size,
            )
        };
        if written != size as isize {
            unsafe { libc::close(fd) };
            return Err(format!("创建虚拟{}设备失败（写入设备描述）", what));
        }
        if unsafe { libc::ioctl(fd, UI_DEV_CREATE) } != 0 {
            unsafe { libc::close(fd) };
            return Err(format!("创建虚拟{}设备失败（UI_DEV_CREATE）", what));
        }
        Ok(())
    }

    fn create_mouse_device() -> Result<libc::c_int, String> {
        let fd = open_uinput()?;
        let ready = set_bit(fd, UI_SET_EVBIT, EV_KEY)
            && set_bit(fd, UI_SET_EVBIT, EV_REL)
            && set_bit(fd, UI_SET_EVBIT, EV_SYN)
            && set_bit(fd, UI_SET_KEYBIT, BTN_LEFT)
            && set_bit(fd, UI_SET_KEYBIT, BTN_RIGHT)
            && set_bit(fd, UI_SET_KEYBIT, BTN_MIDDLE)
            && set_bit(fd, UI_SET_RELBIT, REL_X)
            && set_bit(fd, UI_SET_RELBIT, REL_Y)
            && set_bit(fd, UI_SET_RELBIT, REL_WHEEL)
            && set_bit(fd, UI_SET_RELBIT, REL_HWHEEL);
        if !ready {
            unsafe { libc::close(fd) };
            return Err("创建虚拟鼠标设备失败（能力位设置）".to_string());
        }
        finalize_device(fd, &UinputUserDev::new("MCTier Virtual Mouse"), "鼠标")?;
        Ok(fd)
    }

    fn create_touch_device() -> Result<libc::c_int, String> {
        let fd = open_uinput()?;
        let ready = set_bit(fd, UI_SET_EVBIT, EV_KEY)
            && set_bit(fd, UI_SET_EVBIT, EV_ABS)
            && set_bit(fd, UI_SET_EVBIT, EV_SYN)
            && set_bit(fd, UI_SET_KEYBIT, BTN_TOUCH)
            && set_bit(fd, UI_SET_ABSBIT, ABS_X)
            && set_bit(fd, UI_SET_ABSBIT, ABS_Y);
        if !ready {
            unsafe { libc::close(fd) };
            return Err("创建虚拟触摸设备失败（能力位设置）".to_string());
        }
        let mut device = UinputUserDev::new("MCTier Virtual Touch");
        for axis in [ABS_X, ABS_Y] {
            device.absmin[axis as usize] = 0;
            device.absmax[axis as usize] = ABS_MAX;
        }
        finalize_device(fd, &device, "触摸")?;
        Ok(fd)
    }

    fn create_keyboard_device() -> Result<libc::c_int, String> {
        let fd = open_uinput()?;
        if !(set_bit(fd, UI_SET_EVBIT, EV_KEY) && set_bit(fd, UI_SET_EVBIT, EV_SYN)) {
            unsafe { libc::close(fd) };
            return Err("创建虚拟键盘设备失败（能力位设置）".to_string());
        }
        // 逐个声明键位。个别键码在某些内核上不被接受，忽略单个失败即可，
        // 只要大部分键位注册成功设备就是可用的。
        for key in 1..=KEY_BIT_MAX {
            let _ = set_bit(fd, UI_SET_KEYBIT, key);
        }
        finalize_device(fd, &UinputUserDev::new("MCTier Virtual Keyboard"), "键盘")?;
        Ok(fd)
    }

    /// 归一化坐标 → ABS 量化值。越界输入被夹紧而不是丢弃，
    /// 避免控制端的浮点误差导致边缘点击失效。
    fn abs_of(x: f64, y: f64) -> (libc::c_int, libc::c_int) {
        let quantize = |value: f64| (value.clamp(0.0, 1.0) * ABS_MAX as f64).round() as libc::c_int;
        (quantize(x), quantize(y))
    }

    fn button_code(button: u8) -> u16 {
        match button {
            1 => BTN_MIDDLE,
            2 => BTN_RIGHT,
            _ => BTN_LEFT,
        }
    }

    /// 滚轮刻度换算。前端协议里 1.0 = 一格，evdev 的 REL_WHEEL 同样以格为单位，
    /// 且**正值都表示向上**（与 Windows 的 MOUSEEVENTF_WHEEL 一致），因此直接取整，
    /// 不能取反 —— 取反会让 Linux 被控端的滚动方向和控制端相反。
    fn wheel_ticks(delta: f64) -> libc::c_int {
        delta.round() as libc::c_int
    }

    /// Windows 虚拟键码（VK）→ Linux evdev 键码。
    ///
    /// 控制端统一用 VK 上报（Windows/Android 都是），所以映射只需一个方向。
    fn vk_to_key(code: u32) -> Option<u16> {
        use keys::*;
        Some(match code {
            0x08 => KEY_BACKSPACE,
            0x09 => KEY_TAB,
            0x0D => KEY_ENTER,
            0x10 => KEY_LEFTSHIFT,
            0x11 => KEY_LEFTCTRL,
            0x12 => KEY_LEFTALT,
            0x14 => KEY_CAPSLOCK,
            0x1B => KEY_ESC,
            0x20 => KEY_SPACE,
            0x21 => KEY_PAGEUP,
            0x22 => KEY_PAGEDOWN,
            0x23 => KEY_END,
            0x24 => KEY_HOME,
            0x25 => KEY_LEFT,
            0x26 => KEY_UP,
            0x27 => KEY_RIGHT,
            0x28 => KEY_DOWN,
            0x2C => KEY_SYSRQ, // PrintScreen
            0x2D => KEY_INSERT,
            0x2E => KEY_DELETE,
            // 数字键 0-9：VK 顺序是 0,1..9，而 evdev 是 1..9,0，不能直接偏移
            0x30 => KEY_0,
            0x31..=0x39 => KEY_1 + (code as u16 - 0x31),
            0x41..=0x5A => vk_letter_to_key(code),
            0x5B => KEY_LEFTMETA,
            0x5C => KEY_RIGHTMETA,
            0x5D => KEY_COMPOSE, // 应用程序键（右键菜单）
            0x60 => KEY_KP0,
            // 小键盘 1-9：evdev 按物理行排列（7,8,9 / 4,5,6 / 1,2,3），
            // 不是数值顺序，线性偏移会把 4-9 全部映射错，必须查表。
            0x61..=0x69 => vk_numpad_to_key(code),
            0x6A => KEY_KPASTERISK,
            0x6B => KEY_KPPLUS,
            0x6D => KEY_KPMINUS,
            0x6E => KEY_KPDOT,
            0x6F => KEY_KPSLASH,
            // F1-F10 连续（59-68），但 F11/F12 跳到 87/88。线性偏移会让
            // F11 变成 NumLock、F12 变成 ScrollLock。
            0x70..=0x79 => KEY_F1 + (code as u16 - 0x70),
            0x7A => KEY_F11,
            0x7B => KEY_F12,
            0x90 => KEY_NUMLOCK,
            0x91 => KEY_SCROLLLOCK,
            0xA0 => KEY_LEFTSHIFT,
            0xA1 => KEY_RIGHTSHIFT,
            0xA2 => KEY_LEFTCTRL,
            0xA3 => KEY_RIGHTCTRL,
            0xA4 => KEY_LEFTALT,
            0xA5 => KEY_RIGHTALT,
            0xBA => KEY_SEMICOLON,
            0xBB => KEY_EQUAL,
            0xBC => KEY_COMMA,
            0xBD => KEY_MINUS,
            0xBE => KEY_DOT,
            0xBF => KEY_SLASH,
            0xC0 => KEY_GRAVE,
            0xDB => KEY_LEFTBRACE,
            0xDC => KEY_BACKSLASH,
            0xDD => KEY_RIGHTBRACE,
            0xDE => KEY_APOSTROPHE,
            _ => return None,
        })
    }

    /// 小键盘 1-9：evdev 的键码按物理布局分三行排列，与数值顺序不一致。
    fn vk_numpad_to_key(code: u32) -> u16 {
        use keys::*;
        // 索引 = VK - 0x61，即小键盘 1..9
        const NUMPAD: [u16; 9] = [
            KEY_KP1, KEY_KP2, KEY_KP3, KEY_KP4, KEY_KP5, KEY_KP6, KEY_KP7, KEY_KP8, KEY_KP9,
        ];
        NUMPAD[(code - 0x61) as usize]
    }

    /// 字母键 A-Z：evdev 按 QWERTY 物理位置排列，不是字母序，必须查表。
    fn vk_letter_to_key(code: u32) -> u16 {
        use keys::*;
        const LETTERS: [u16; 26] = [
            KEY_A, KEY_B, KEY_C, KEY_D, KEY_E, KEY_F, KEY_G, KEY_H, KEY_I, KEY_J, KEY_K, KEY_L,
            KEY_M, KEY_N, KEY_O, KEY_P, KEY_Q, KEY_R, KEY_S, KEY_T, KEY_U, KEY_V, KEY_W, KEY_X,
            KEY_Y, KEY_Z,
        ];
        LETTERS[(code - 0x41) as usize]
    }

    /// evdev 键码常量（linux/input-event-codes.h）
    mod keys {
        #![allow(dead_code)]
        pub const KEY_ESC: u16 = 1;
        pub const KEY_1: u16 = 2;
        pub const KEY_0: u16 = 11;
        pub const KEY_MINUS: u16 = 12;
        pub const KEY_EQUAL: u16 = 13;
        pub const KEY_BACKSPACE: u16 = 14;
        pub const KEY_TAB: u16 = 15;
        pub const KEY_Q: u16 = 16;
        pub const KEY_W: u16 = 17;
        pub const KEY_E: u16 = 18;
        pub const KEY_R: u16 = 19;
        pub const KEY_T: u16 = 20;
        pub const KEY_Y: u16 = 21;
        pub const KEY_U: u16 = 22;
        pub const KEY_I: u16 = 23;
        pub const KEY_O: u16 = 24;
        pub const KEY_P: u16 = 25;
        pub const KEY_LEFTBRACE: u16 = 26;
        pub const KEY_RIGHTBRACE: u16 = 27;
        pub const KEY_ENTER: u16 = 28;
        pub const KEY_LEFTCTRL: u16 = 29;
        pub const KEY_A: u16 = 30;
        pub const KEY_S: u16 = 31;
        pub const KEY_D: u16 = 32;
        pub const KEY_F: u16 = 33;
        pub const KEY_G: u16 = 34;
        pub const KEY_H: u16 = 35;
        pub const KEY_J: u16 = 36;
        pub const KEY_K: u16 = 37;
        pub const KEY_L: u16 = 38;
        pub const KEY_SEMICOLON: u16 = 39;
        pub const KEY_APOSTROPHE: u16 = 40;
        pub const KEY_GRAVE: u16 = 41;
        pub const KEY_LEFTSHIFT: u16 = 42;
        pub const KEY_BACKSLASH: u16 = 43;
        pub const KEY_Z: u16 = 44;
        pub const KEY_X: u16 = 45;
        pub const KEY_C: u16 = 46;
        pub const KEY_V: u16 = 47;
        pub const KEY_B: u16 = 48;
        pub const KEY_N: u16 = 49;
        pub const KEY_M: u16 = 50;
        pub const KEY_COMMA: u16 = 51;
        pub const KEY_DOT: u16 = 52;
        pub const KEY_SLASH: u16 = 53;
        pub const KEY_RIGHTSHIFT: u16 = 54;
        pub const KEY_KPASTERISK: u16 = 55;
        pub const KEY_LEFTALT: u16 = 56;
        pub const KEY_SPACE: u16 = 57;
        pub const KEY_CAPSLOCK: u16 = 58;
        pub const KEY_F1: u16 = 59;
        // F1-F10 是 59-68，F11/F12 不接在后面，另占 87/88。
        pub const KEY_F11: u16 = 87;
        pub const KEY_F12: u16 = 88;
        pub const KEY_NUMLOCK: u16 = 69;
        pub const KEY_SCROLLLOCK: u16 = 70;
        pub const KEY_KP7: u16 = 71;
        pub const KEY_KP8: u16 = 72;
        pub const KEY_KP9: u16 = 73;
        pub const KEY_KPMINUS: u16 = 74;
        pub const KEY_KP4: u16 = 75;
        pub const KEY_KP5: u16 = 76;
        pub const KEY_KP6: u16 = 77;
        pub const KEY_KPPLUS: u16 = 78;
        pub const KEY_KP1: u16 = 79;
        pub const KEY_KP2: u16 = 80;
        pub const KEY_KP3: u16 = 81;
        pub const KEY_KP0: u16 = 82;
        pub const KEY_KPDOT: u16 = 83;
        pub const KEY_KPSLASH: u16 = 98;
        pub const KEY_SYSRQ: u16 = 99;
        pub const KEY_RIGHTALT: u16 = 100;
        pub const KEY_HOME: u16 = 102;
        pub const KEY_UP: u16 = 103;
        pub const KEY_PAGEUP: u16 = 104;
        pub const KEY_LEFT: u16 = 105;
        pub const KEY_RIGHT: u16 = 106;
        pub const KEY_END: u16 = 107;
        pub const KEY_DOWN: u16 = 108;
        pub const KEY_PAGEDOWN: u16 = 109;
        pub const KEY_INSERT: u16 = 110;
        pub const KEY_DELETE: u16 = 111;
        pub const KEY_RIGHTCTRL: u16 = 97;
        pub const KEY_LEFTMETA: u16 = 125;
        pub const KEY_RIGHTMETA: u16 = 126;
        pub const KEY_COMPOSE: u16 = 127;
    }

    /// 三个虚拟设备的句柄。进程级惰性单例：设备创建有成本（且会在桌面上
    /// 触发"检测到新输入设备"），因此建好后跨批次复用，直到进程退出。
    struct InjectState {
        mouse_fd: libc::c_int,
        touch_fd: libc::c_int,
        keyboard_fd: libc::c_int,
        /// 左键是否处于按下状态（触摸接触中）。拖拽依赖它保持接触。
        touch_contact_active: bool,
        /// 不支持的键码只提示一次，避免控制端长按时刷爆日志。
        unsupported_key_logged: bool,
    }

    impl Drop for InjectState {
        fn drop(&mut self) {
            for fd in [self.mouse_fd, self.touch_fd, self.keyboard_fd] {
                unsafe {
                    libc::ioctl(fd, UI_DEV_DESTROY);
                    libc::close(fd);
                }
            }
        }
    }

    static STATE: OnceLock<Mutex<Option<InjectState>>> = OnceLock::new();

    fn state() -> &'static Mutex<Option<InjectState>> {
        STATE.get_or_init(|| Mutex::new(None))
    }

    fn with_state(
        action: impl FnOnce(&mut InjectState) -> Result<(), String>,
    ) -> Result<(), String> {
        let mut guard = state().lock().unwrap_or_else(|e| e.into_inner());
        if guard.is_none() {
            // 任一设备建失败就整体放弃，已建的由局部变量的 close 释放，
            // 不留下"只有一半能力"的半成品状态。
            let mouse_fd = create_mouse_device()?;
            let touch_fd = match create_touch_device() {
                Ok(fd) => fd,
                Err(error) => {
                    unsafe {
                        libc::ioctl(mouse_fd, UI_DEV_DESTROY);
                        libc::close(mouse_fd);
                    }
                    return Err(error);
                }
            };
            let keyboard_fd = match create_keyboard_device() {
                Ok(fd) => fd,
                Err(error) => {
                    unsafe {
                        libc::ioctl(mouse_fd, UI_DEV_DESTROY);
                        libc::close(mouse_fd);
                        libc::ioctl(touch_fd, UI_DEV_DESTROY);
                        libc::close(touch_fd);
                    }
                    return Err(error);
                }
            };
            log::info!("Linux 虚拟输入设备已创建（鼠标 + 触摸 + 键盘）");
            *guard = Some(InjectState {
                mouse_fd,
                touch_fd,
                keyboard_fd,
                touch_contact_active: false,
                unsupported_key_logged: false,
            });
        }
        // 上一行保证了 Some，这里不会 panic
        action(guard.as_mut().expect("inject state initialized"))
    }

    /// 把光标移动到目标位置（一次瞬时触摸），不改变按键状态。
    fn tap_move(state: &InjectState, x: f64, y: f64) {
        let (ax, ay) = abs_of(x, y);
        emit(state.touch_fd, EV_KEY, BTN_TOUCH, 1);
        emit(state.touch_fd, EV_ABS, ABS_X, ax);
        emit(state.touch_fd, EV_ABS, ABS_Y, ay);
        emit_syn(state.touch_fd);
        emit(state.touch_fd, EV_KEY, BTN_TOUCH, 0);
        emit_syn(state.touch_fd);
    }

    pub fn inject(events: &[RemoteInputEvent]) -> Result<(), String> {
        with_state(|state| {
            for event in events {
                match event {
                    RemoteInputEvent::MouseMove { x, y } => {
                        if state.touch_contact_active {
                            // 拖拽中：保持接触并移动，松手前不能断开
                            let (ax, ay) = abs_of(*x, *y);
                            emit(state.touch_fd, EV_ABS, ABS_X, ax);
                            emit(state.touch_fd, EV_ABS, ABS_Y, ay);
                            emit_syn(state.touch_fd);
                        } else {
                            tap_move(state, *x, *y);
                        }
                    }
                    RemoteInputEvent::MouseDown { button, x, y } => {
                        let (ax, ay) = abs_of(*x, *y);
                        if *button == 0 {
                            // 左键按下 = 建立触摸接触，后续 Move 即拖拽
                            emit(state.touch_fd, EV_KEY, BTN_TOUCH, 1);
                            emit(state.touch_fd, EV_ABS, ABS_X, ax);
                            emit(state.touch_fd, EV_ABS, ABS_Y, ay);
                            emit_syn(state.touch_fd);
                            state.touch_contact_active = true;
                        } else {
                            // 右/中键：先把光标挪到目标位置，再从鼠标设备发按键
                            tap_move(state, *x, *y);
                            emit(state.mouse_fd, EV_KEY, button_code(*button), 1);
                            emit_syn(state.mouse_fd);
                        }
                    }
                    RemoteInputEvent::MouseUp { button, x, y } => {
                        if *button == 0 {
                            if state.touch_contact_active {
                                let (ax, ay) = abs_of(*x, *y);
                                emit(state.touch_fd, EV_ABS, ABS_X, ax);
                                emit(state.touch_fd, EV_ABS, ABS_Y, ay);
                                emit(state.touch_fd, EV_KEY, BTN_TOUCH, 0);
                                emit_syn(state.touch_fd);
                                state.touch_contact_active = false;
                            } else {
                                // 没有配对的按下（例如控制端重连后只收到抬起），
                                // 仍补一次按键抬起，避免对端认为键被按住。
                                emit(state.mouse_fd, EV_KEY, BTN_LEFT, 0);
                                emit_syn(state.mouse_fd);
                            }
                        } else {
                            emit(state.mouse_fd, EV_KEY, button_code(*button), 0);
                            emit_syn(state.mouse_fd);
                        }
                    }
                    RemoteInputEvent::MouseWheel { dx, dy } => {
                        let vertical = wheel_ticks(*dy);
                        let horizontal = wheel_ticks(*dx);
                        if vertical != 0 {
                            emit(state.mouse_fd, EV_REL, REL_WHEEL, vertical);
                        }
                        if horizontal != 0 {
                            emit(state.mouse_fd, EV_REL, REL_HWHEEL, horizontal);
                        }
                        if vertical != 0 || horizontal != 0 {
                            emit_syn(state.mouse_fd);
                        }
                    }
                    RemoteInputEvent::KeyDown { code, .. }
                    | RemoteInputEvent::KeyUp { code, .. } => {
                        let pressed = matches!(event, RemoteInputEvent::KeyDown { .. });
                        match vk_to_key(*code) {
                            // 键盘事件必须发到键盘设备：鼠标设备只声明了三个
                            // BTN_* 键位，未声明的键码会被内核直接丢弃。
                            Some(key) => {
                                emit(state.keyboard_fd, EV_KEY, key, if pressed { 1 } else { 0 });
                                emit_syn(state.keyboard_fd);
                            }
                            None if !state.unsupported_key_logged => {
                                state.unsupported_key_logged = true;
                                log::warn!(
                                    "Linux 被控端暂不支持该按键码: 0x{:02X}（后续同类不再提示）",
                                    code
                                );
                            }
                            None => {}
                        }
                    }
                    RemoteInputEvent::Text { .. } => {
                        // uinput 工作在输入法之下，无法注入中文/emoji 等需要输入法
                        // 参与的文本。这里明确降级为忽略（而不是报错中断整批事件），
                        // 手机端软键盘的英文/数字仍可通过 KeyDown/KeyUp 生效。
                    }
                    RemoteInputEvent::Unknown => {}
                }
            }
            Ok(())
        })
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn absolute_coordinates_are_clamped_not_wrapped() {
            assert_eq!(abs_of(0.0, 0.0), (0, 0));
            assert_eq!(abs_of(1.0, 1.0), (ABS_MAX, ABS_MAX));
            assert_eq!(abs_of(0.5, 0.5), (32768, 32768));
            // 越界必须夹紧，不能回绕到另一边（否则边缘点击会跳到对侧）
            assert_eq!(abs_of(-1.0, 2.0), (0, ABS_MAX));
            assert_eq!(abs_of(f64::NAN, 0.25), (0, 16384));
        }

        #[test]
        fn wheel_direction_matches_the_windows_convention() {
            // 正值 = 向上，与 Windows MOUSEEVENTF_WHEEL 一致；取反会导致双端方向相反
            assert_eq!(wheel_ticks(1.0), 1);
            assert_eq!(wheel_ticks(-1.0), -1);
            assert_eq!(wheel_ticks(3.0), 3);
            assert_eq!(wheel_ticks(0.0), 0);
        }

        #[test]
        fn mouse_buttons_follow_the_protocol_numbering() {
            assert_eq!(button_code(0), BTN_LEFT);
            assert_eq!(button_code(1), BTN_MIDDLE);
            assert_eq!(button_code(2), BTN_RIGHT);
            // 协议外的编号退化为左键，不能变成右键（避免误触上下文菜单）
            assert_eq!(button_code(9), BTN_LEFT);
        }

        #[test]
        fn digit_and_letter_keys_use_the_physical_evdev_layout() {
            // evdev 的数字键是 1..9,0 的顺序，直接用偏移会把每个数字错开一位
            assert_eq!(vk_to_key(0x31), Some(keys::KEY_1));
            assert_eq!(vk_to_key(0x39), Some(keys::KEY_9));
            assert_eq!(vk_to_key(0x30), Some(keys::KEY_0));

            // 字母按 QWERTY 物理位置排布，不是字母序
            assert_eq!(vk_to_key(0x41), Some(keys::KEY_A));
            assert_eq!(vk_to_key(0x5A), Some(keys::KEY_Z));
            assert_eq!(vk_to_key(0x51), Some(keys::KEY_Q));
            assert_eq!(vk_to_key(0x57), Some(keys::KEY_W));
            assert_eq!(vk_to_key(0x4D), Some(keys::KEY_M));
        }

        #[test]
        fn modifier_and_navigation_keys_are_mapped() {
            assert_eq!(vk_to_key(0x0D), Some(keys::KEY_ENTER));
            assert_eq!(vk_to_key(0x1B), Some(keys::KEY_ESC));
            assert_eq!(vk_to_key(0x20), Some(keys::KEY_SPACE));
            assert_eq!(vk_to_key(0xA2), Some(keys::KEY_LEFTCTRL));
            assert_eq!(vk_to_key(0xA3), Some(keys::KEY_RIGHTCTRL));
            assert_eq!(vk_to_key(0x25), Some(keys::KEY_LEFT));
            assert_eq!(vk_to_key(0x28), Some(keys::KEY_DOWN));
            assert_eq!(vk_to_key(0x70), Some(keys::KEY_F1));

            // 未映射的键码返回 None，由调用方降级处理而不是崩溃
            assert_eq!(vk_to_key(0xFF), None);
            assert_eq!(vk_to_key(0x00), None);
        }

        #[test]
        fn function_keys_handle_the_f11_f12_discontinuity() {
            // F1-F10 连续，F11/F12 另占 87/88。若按线性偏移推算，
            // F11 会变成 NumLock、F12 会变成 ScrollLock —— 被控端会被改状态。
            assert_eq!(vk_to_key(0x70), Some(keys::KEY_F1));
            assert_eq!(vk_to_key(0x79), Some(keys::KEY_F1 + 9)); // F10 = 68
            assert_eq!(vk_to_key(0x7A), Some(keys::KEY_F11));
            assert_eq!(vk_to_key(0x7B), Some(keys::KEY_F12));

            assert_ne!(vk_to_key(0x7A), Some(keys::KEY_NUMLOCK));
            assert_ne!(vk_to_key(0x7B), Some(keys::KEY_SCROLLLOCK));
        }

        #[test]
        fn numpad_digits_follow_the_physical_row_layout() {
            // evdev 的小键盘按物理行排列（7,8,9 / 4,5,6 / 1,2,3），不是数值顺序。
            // 线性偏移会让小键盘 4-9 全部打错，其中 4 会变成 KP0。
            assert_eq!(vk_to_key(0x60), Some(keys::KEY_KP0));
            assert_eq!(vk_to_key(0x61), Some(keys::KEY_KP1));
            assert_eq!(vk_to_key(0x63), Some(keys::KEY_KP3));
            assert_eq!(vk_to_key(0x64), Some(keys::KEY_KP4));
            assert_eq!(vk_to_key(0x67), Some(keys::KEY_KP7));
            assert_eq!(vk_to_key(0x69), Some(keys::KEY_KP9));

            // 回归防线：小键盘 4 曾被线性偏移算成 KP0
            assert_ne!(vk_to_key(0x64), Some(keys::KEY_KP0));

            // 九个键必须互不相同，任何重复都说明映射塌缩了
            let mut mapped: Vec<u16> = (0x61u32..=0x69)
                .map(|code| vk_to_key(code).expect("小键盘 1-9 必须全部有映射"))
                .collect();
            mapped.sort_unstable();
            mapped.dedup();
            assert_eq!(mapped.len(), 9);
        }

        #[test]
        fn keyboard_device_declares_every_key_we_can_emit() {
            // 所有映射产出的键码都必须落在键盘设备声明的位范围内，
            // 否则内核会静默丢弃该事件（按键"没反应"且无任何报错）。
            for code in 0u32..=0xFF {
                if let Some(key) = vk_to_key(code) {
                    assert!(
                        key >= 1 && key <= KEY_BIT_MAX,
                        "键码 0x{:02X} 映射到 {}，超出键盘设备声明范围",
                        code,
                        key
                    );
                }
            }
        }

        #[test]
        fn uinput_device_description_matches_the_kernel_layout() {
            // uinput_user_dev 的大小由内核 ABI 固定；写入长度不符时 write 会失败，
            // 表现为设备创建失败。这里锁定布局，防止改结构体时不知不觉写坏。
            assert_eq!(std::mem::size_of::<InputId>(), 8);
            assert_eq!(
                std::mem::size_of::<UinputUserDev>(),
                80 + 8 + 4 + 4 * 4 * ABS_CNT
            );

            let device = UinputUserDev::new("MCTier Virtual Touch");
            assert_eq!(device.id.bustype, BUS_USB);
            // 名字必须以 NUL 结尾，否则内核读越界
            assert_eq!(*device.name.last().unwrap(), 0);

            // 超长名字被截断而不是溢出
            let long = UinputUserDev::new(&"x".repeat(200));
            assert_eq!(*long.name.last().unwrap(), 0);
        }
    }
}
