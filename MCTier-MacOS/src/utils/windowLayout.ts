/**
 * 窗口形态（竖屏 / 横排）判定与尺寸。
 *
 * macOS 上窗口既保留原有的竖屏（窄窗）布局，也可以拉宽成横排桌面布局：
 * 窗口宽度达到 LAYOUT_BREAKPOINT 自动切成横排，拖回窄窗自动切回竖屏。
 * 这里集中提供断点、窗口尺寸和形态判定，保证 JS 与 CSS 使用同一套口径——
 * CSS 侧读取 <html data-layout>，由 applyWindowLayout 写入。
 */
import { isMacOSPlatform } from './platform';

/** 形态断点：窗口宽度 ≥ 该值使用横排，否则使用竖屏。 */
export const LAYOUT_BREAKPOINT = 760;
/** 竖屏（默认形态）展开尺寸 */
const PORTRAIT_EXPANDED = { width: 420, height: 680 };
/** 横排展开尺寸 */
const LANDSCAPE_EXPANDED = { width: 980, height: 680 };
/** 非 macOS 平台沿用原有的紧凑竖窗尺寸，不受形态切换影响。 */
const COMPACT_EXPANDED = { width: 320, height: 520 };
const COMPACT_COLLAPSED = { width: 320, height: 50 };
/** macOS 收起（只显示标题栏）时的宽度与高度 */
const MACOS_COLLAPSED = { width: 420, height: 50 };

export type WindowLayout = 'portrait' | 'landscape';

export function resolveWindowLayout(width: number): WindowLayout {
  return width >= LAYOUT_BREAKPOINT ? 'landscape' : 'portrait';
}

/** 按当前窗口宽度判定形态。 */
export function currentWindowLayout(): WindowLayout {
  return resolveWindowLayout(typeof window === 'undefined' ? 0 : window.innerWidth);
}

/** 写入 <html data-layout>，CSS 依据它切换竖屏 / 横排样式。 */
export function applyWindowLayout(layout: WindowLayout): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.layout = layout;
}

/** 指定形态下的展开窗口尺寸。 */
export function expandedWindowSize(
  layout: WindowLayout = currentWindowLayout()
): { width: number; height: number } {
  if (!isMacOSPlatform) return COMPACT_EXPANDED;
  return layout === 'landscape' ? LANDSCAPE_EXPANDED : PORTRAIT_EXPANDED;
}

/** 收起（只显示标题栏）时的窗口尺寸。 */
export function collapsedWindowSize(): { width: number; height: number } {
  return isMacOSPlatform ? MACOS_COLLAPSED : COMPACT_COLLAPSED;
}
