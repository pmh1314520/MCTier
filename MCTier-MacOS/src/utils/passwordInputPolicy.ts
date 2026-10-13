/**
 * 密码输入框的平台策略。
 *
 * WebKitGTK（Linux 端使用的 WebView）在 `<input type="password">` 上与 fcitx5 / ibus 的
 * GTK 输入法模块存在冲突：输入法会吞掉按键，表现为「密码框一个字都打不出来」。
 * 清空 `GTK_IM_MODULE` 只能缓解一部分环境，Debian 13 + KDE Plasma 6 Wayland 上实测仍会复现
 * （见 issue #42 的实机反馈）。
 *
 * 因此 Linux 端不使用原生密码框，改用普通文本框 + CSS `-webkit-text-security` 遮罩，
 * 从引擎层规避这条冲突路径；Windows（WebView2）不受影响，继续用原生密码框，
 * 以保留浏览器自带的密码语义（避免密码被输入法候选词、拼写检查或自动填充记录）。
 *
 * 判定只依赖 User-Agent 字符串，便于在无浏览器环境下单测。
 */

/** 该运行环境是否为 Linux（含各类 X11 / Wayland 桌面）。 */
export function isLinuxUserAgent(userAgent: unknown): boolean {
  if (typeof userAgent !== 'string' || userAgent.length === 0) return false;
  // Android 同样含有 "Linux"，但 Android 端是独立的原生应用，不走这套 WebView 组件；
  // 这里显式排除，避免将来复用时误判。
  if (/Android/i.test(userAgent)) return false;
  return /\bLinux\b|\bX11\b/i.test(userAgent);
}

/**
 * 是否应避免使用原生 `<input type="password">`。
 *
 * 仅 Linux 需要规避；其余平台一律使用原生密码框。
 */
export function shouldAvoidNativePasswordInput(userAgent: unknown): boolean {
  return isLinuxUserAgent(userAgent);
}

/** 取当前运行环境的判定结果；非浏览器环境（如单测）视为不需要规避。 */
export function avoidNativePasswordInput(): boolean {
  if (typeof navigator === 'undefined') return false;
  return shouldAvoidNativePasswordInput(navigator.userAgent);
}
