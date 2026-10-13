/** macOS（含 iPad 桌面端 UA）判定。集中一处，避免每个组件各写一份正则。 */
export const isMacOSPlatform = /Mac|iPhone|iPad|iPod/.test(navigator.platform);

/**
 * 「关闭时最小化到托盘」的缺省值，与后端 `config_manager::default_close_to_tray` 保持一致。
 *
 * macOS 上红点关窗按 Mac 惯例是隐藏而非退出，缺省隐藏到菜单栏、点 Dock 图标即可唤回；
 * 其他平台保持关闭即退出。设置页读取失败时也要用同一个缺省，免得开关显示的状态
 * 与实际行为相反。
 */
export const defaultCloseToTray = isMacOSPlatform;
