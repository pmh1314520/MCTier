/**
 * 应用版本号的单一来源（见 issue #17 第 12/17 条）
 *
 * 版本号只在 `src-tauri/tauri.conf.json` 中维护，运行时通过 Tauri 的
 * `getVersion()` 读取，避免在前端源码里再硬编码一份而产生不一致。
 *
 * 信令注册发生在 WebSocket 的 onopen 同步回调里，没法 await，
 * 因此这里在连接前预取并缓存，回调中同步读取缓存值。
 */
import { getVersion } from '@tauri-apps/api/app';

/** 无法从 Tauri 读取版本时使用的占位值。 */
export const UNKNOWN_APP_VERSION = 'unknown';

let cachedVersion: string | null = null;

/** 读取并缓存应用版本号。 */
export async function loadAppVersion(): Promise<string> {
  if (cachedVersion !== null) return cachedVersion;
  try {
    cachedVersion = await getVersion();
  } catch (error) {
    console.warn('读取应用版本失败，使用占位值:', error);
    cachedVersion = UNKNOWN_APP_VERSION;
  }
  return cachedVersion;
}

/**
 * 同步获取已缓存的版本号。
 *
 * 若尚未调用过 [loadAppVersion]，返回 [UNKNOWN_APP_VERSION]。
 */
export function appVersion(): string {
  return cachedVersion ?? UNKNOWN_APP_VERSION;
}