// 浏览器 KeyboardEvent.code -> Windows 虚拟键码(VK) 映射
// 用于远程控制时把控制端的按键转换为被控端可注入的 VK 码

export interface VkResult {
  code: number;
  extended: boolean;
}

// 需要 extended 标志的键（小键盘回车、方向键、Insert/Delete 等）
const EXTENDED = new Set<string>([
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Insert', 'Delete', 'Home', 'End', 'PageUp', 'PageDown',
  'NumpadEnter', 'ControlRight', 'AltRight', 'NumpadDivide', 'PrintScreen',
]);

const MAP: Record<string, number> = {
  // 字母
  KeyA: 0x41, KeyB: 0x42, KeyC: 0x43, KeyD: 0x44, KeyE: 0x45, KeyF: 0x46,
  KeyG: 0x47, KeyH: 0x48, KeyI: 0x49, KeyJ: 0x4a, KeyK: 0x4b, KeyL: 0x4c,
  KeyM: 0x4d, KeyN: 0x4e, KeyO: 0x4f, KeyP: 0x50, KeyQ: 0x51, KeyR: 0x52,
  KeyS: 0x53, KeyT: 0x54, KeyU: 0x55, KeyV: 0x56, KeyW: 0x57, KeyX: 0x58,
  KeyY: 0x59, KeyZ: 0x5a,
  // 主键盘数字
  Digit0: 0x30, Digit1: 0x31, Digit2: 0x32, Digit3: 0x33, Digit4: 0x34,
  Digit5: 0x35, Digit6: 0x36, Digit7: 0x37, Digit8: 0x38, Digit9: 0x39,
  // 功能键
  F1: 0x70, F2: 0x71, F3: 0x72, F4: 0x73, F5: 0x74, F6: 0x75,
  F7: 0x76, F8: 0x77, F9: 0x78, F10: 0x79, F11: 0x7a, F12: 0x7b,
  // 控制键
  Escape: 0x1b, Tab: 0x09, CapsLock: 0x14, Space: 0x20,
  Enter: 0x0d, NumpadEnter: 0x0d, Backspace: 0x08,
  ShiftLeft: 0xa0, ShiftRight: 0xa1, ControlLeft: 0xa2, ControlRight: 0xa3,
  AltLeft: 0xa4, AltRight: 0xa5, MetaLeft: 0x5b, MetaRight: 0x5c, ContextMenu: 0x5d,
  // 方向/编辑
  ArrowUp: 0x26, ArrowDown: 0x28, ArrowLeft: 0x25, ArrowRight: 0x27,
  Insert: 0x2d, Delete: 0x2e, Home: 0x24, End: 0x23, PageUp: 0x21, PageDown: 0x22,
  PrintScreen: 0x2c, ScrollLock: 0x91, Pause: 0x13,
  // 符号
  Backquote: 0xc0, Minus: 0xbd, Equal: 0xbb, BracketLeft: 0xdb, BracketRight: 0xdd,
  Backslash: 0xdc, Semicolon: 0xba, Quote: 0xde, Comma: 0xbc, Period: 0xbe, Slash: 0xbf,
  // 小键盘
  Numpad0: 0x60, Numpad1: 0x61, Numpad2: 0x62, Numpad3: 0x63, Numpad4: 0x64,
  Numpad5: 0x65, Numpad6: 0x66, Numpad7: 0x67, Numpad8: 0x68, Numpad9: 0x69,
  NumpadMultiply: 0x6a, NumpadAdd: 0x6b, NumpadSubtract: 0x6d,
  NumpadDecimal: 0x6e, NumpadDivide: 0x6f, NumLock: 0x90,
};

/** 把 KeyboardEvent.code 转换为 Windows VK；无法识别返回 null */
export function codeToVk(code: string): VkResult | null {
  const vk = MAP[code];
  if (vk === undefined) return null;
  return { code: vk, extended: EXTENDED.has(code) };
}
