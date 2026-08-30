/**
 * Store 持久化工具
 * 负责将配置保存到本地存储并在应用启动时恢复
 */

import { useAppStore } from './appStore';
import type { UserConfig, WindowPosition } from '../types';
import {
  isSafeImageDataUrl,
  isSafeServerNode,
  isSafeVirtualDomain,
  sanitizeUntrustedText,
} from '../security/trustBoundary';

/**
 * 本地存储键名
 */
const STORAGE_KEYS = {
  CONFIG: 'mctier_user_config',
  WINDOW_POSITION: 'mctier_window_position',
} as const;

const MAX_CONFIG_FILE_BYTES = 256 * 1024;
const MAX_CONFIG_LIST_ITEMS = 64;

const finiteNumberInRange = (value: unknown, min: number, max: number): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : undefined;

const safeString = (value: unknown, maxLength: number): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const sanitized = sanitizeUntrustedText(value, maxLength).trim();
  return sanitized || undefined;
};

const normalizeWindowPosition = (value: unknown): WindowPosition | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  const x = finiteNumberInRange(input.x, -100_000, 100_000);
  const y = finiteNumberInRange(input.y, -100_000, 100_000);
  const width = finiteNumberInRange(input.width, 100, 20_000);
  const height = finiteNumberInRange(input.height, 100, 20_000);
  if (x === undefined || y === undefined) return undefined;
  return {
    x: Math.trunc(x),
    y: Math.trunc(y),
    ...(width === undefined ? {} : { width: Math.trunc(width) }),
    ...(height === undefined ? {} : { height: Math.trunc(height) }),
  };
};

const normalizeStringList = (value: unknown, maxLength: number): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const values = value
    .slice(0, MAX_CONFIG_LIST_ITEMS)
    .map((item) => safeString(item, maxLength))
    .filter((item): item is string => !!item);
  return values;
};

/**
 * Import/storage data is untrusted JSON. Keep only fields understood by the
 * frontend and deliberately drop lobby passwords; localStorage is not a
 * secret store and old records are migrated by omission.
 */
export const sanitizePersistedConfig = (value: unknown): UserConfig => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;
  const result: UserConfig = {};

  if (input.language === 'system' || input.language === 'zh' || input.language === 'en') result.language = input.language;
  const playerName = safeString(input.playerName, 64);
  if (playerName) result.playerName = playerName;
  if (isSafeImageDataUrl(input.avatarData)) result.avatarData = input.avatarData;
  if (input.preferredServer === 'custom' || isSafeServerNode(input.preferredServer)) {
    result.preferredServer = input.preferredServer;
  }
  const micHotkey = safeString(input.micHotkey, 64);
  const globalMuteHotkey = safeString(input.globalMuteHotkey, 64);
  const pushToTalkHotkey = safeString(input.pushToTalkHotkey, 64);
  if (micHotkey) result.micHotkey = micHotkey;
  if (globalMuteHotkey) result.globalMuteHotkey = globalMuteHotkey;
  if (pushToTalkHotkey) result.pushToTalkHotkey = pushToTalkHotkey;
  const windowPosition = normalizeWindowPosition(input.windowPosition);
  if (windowPosition) result.windowPosition = windowPosition;
  const audioDeviceId = safeString(input.audioDeviceId, 512);
  if (audioDeviceId) result.audioDeviceId = audioDeviceId;
  const opacity = finiteNumberInRange(input.opacity, 0, 1);
  const voiceVolume = finiteNumberInRange(input.voiceVolume, 0, 1);
  if (opacity !== undefined) result.opacity = opacity;
  if (voiceVolume !== undefined) result.voiceVolume = voiceVolume;
  if (typeof input.enableGpuRendering === 'boolean') result.enableGpuRendering = input.enableGpuRendering;
  if (typeof input.autoStartup === 'boolean') result.autoStartup = input.autoStartup;

  if (input.advancedNetwork && typeof input.advancedNetwork === 'object' && !Array.isArray(input.advancedNetwork)) {
    const virtualDomain = (input.advancedNetwork as Record<string, unknown>).virtualDomain;
    if (isSafeVirtualDomain(virtualDomain)) result.advancedNetwork = { virtualDomain: virtualDomain.trim() };
  }

  if (input.autoLobby && typeof input.autoLobby === 'object' && !Array.isArray(input.autoLobby)) {
    const autoLobbyInput = input.autoLobby as Record<string, unknown>;
    const autoLobby: NonNullable<UserConfig['autoLobby']> = {
      enabled: typeof autoLobbyInput.enabled === 'boolean' ? autoLobbyInput.enabled : false,
    };
    const lobbyName = safeString(autoLobbyInput.lobbyName, 64);
    const autoPlayerName = safeString(autoLobbyInput.playerName, 64);
    if (lobbyName) autoLobby.lobbyName = lobbyName;
    if (autoPlayerName) autoLobby.playerName = autoPlayerName;
    if (typeof autoLobbyInput.useDomain === 'boolean') autoLobby.useDomain = autoLobbyInput.useDomain;
    // Intentionally omit autoLobbyInput.lobbyPassword.
    result.autoLobby = autoLobby;
  }

  if (input.exitNodeConfig && typeof input.exitNodeConfig === 'object' && !Array.isArray(input.exitNodeConfig)) {
    const exitInput = input.exitNodeConfig as Record<string, unknown>;
    const exitNodeConfig: NonNullable<UserConfig['exitNodeConfig']> = {};
    if (typeof exitInput.enableExitNode === 'boolean') exitNodeConfig.enableExitNode = exitInput.enableExitNode;
    if (typeof exitInput.enableAsExitNode === 'boolean') exitNodeConfig.enableAsExitNode = exitInput.enableAsExitNode;
    const proxyCidrs = normalizeStringList(exitInput.proxyCidrs, 128);
    const exitNodes = normalizeStringList(exitInput.exitNodes, 128);
    if (proxyCidrs) exitNodeConfig.proxyCidrs = proxyCidrs;
    if (exitNodes) exitNodeConfig.exitNodes = exitNodes;
    result.exitNodeConfig = exitNodeConfig;
  }

  return result;
};

/**
 * 保存用户配置到本地存储
 */
export const saveConfigToStorage = (config: UserConfig): void => {
  try {
    const configJson = JSON.stringify(sanitizePersistedConfig(config));
    localStorage.setItem(STORAGE_KEYS.CONFIG, configJson);
  } catch (error) {
    console.error('保存配置失败:', error);
  }
};

/**
 * 从本地存储加载用户配置
 */
export const loadConfigFromStorage = (): UserConfig | null => {
  try {
    const configJson = localStorage.getItem(STORAGE_KEYS.CONFIG);
    if (!configJson) {
      return null;
    }
    return sanitizePersistedConfig(JSON.parse(configJson));
  } catch (error) {
    console.error('加载配置失败:', error);
    return null;
  }
};

/**
 * 保存窗口位置到本地存储
 */
export const saveWindowPositionToStorage = (
  position: WindowPosition
): void => {
  try {
    const safePosition = normalizeWindowPosition(position);
    if (!safePosition) return;
    const positionJson = JSON.stringify(safePosition);
    localStorage.setItem(STORAGE_KEYS.WINDOW_POSITION, positionJson);
  } catch (error) {
    console.error('保存窗口位置失败:', error);
  }
};

/**
 * 从本地存储加载窗口位置
 */
export const loadWindowPositionFromStorage = (): WindowPosition | null => {
  try {
    const positionJson = localStorage.getItem(STORAGE_KEYS.WINDOW_POSITION);
    if (!positionJson) {
      return null;
    }
    return normalizeWindowPosition(JSON.parse(positionJson)) ?? null;
  } catch (error) {
    console.error('加载窗口位置失败:', error);
    return null;
  }
};

/**
 * 清除所有本地存储数据
 */
export const clearStorage = (): void => {
  try {
    localStorage.removeItem(STORAGE_KEYS.CONFIG);
    localStorage.removeItem(STORAGE_KEYS.WINDOW_POSITION);
  } catch (error) {
    console.error('清除存储失败:', error);
  }
};

/**
 * 初始化 Store 持久化
 * 在应用启动时调用，加载保存的配置
 */
export const initializeStorePersistence = (): void => {
  try {
    // 加载用户配置
    const savedConfig = loadConfigFromStorage();
    if (savedConfig) {
      useAppStore.getState().updateConfig(savedConfig);
      // Rewrite legacy entries so dropped secrets are removed immediately,
      // even when the user does not change any setting this session.
      saveConfigToStorage(savedConfig);
    }

    // 加载窗口位置
    const savedPosition = loadWindowPositionFromStorage();
    if (savedPosition) {
      useAppStore.getState().setStatusWindowPosition(savedPosition);
    }

    // 订阅配置变化，自动保存
    let previousConfig = useAppStore.getState().config;
    useAppStore.subscribe((state) => {
      if (state.config !== previousConfig) {
        saveConfigToStorage(state.config);
        previousConfig = state.config;
      }
    });

    // 订阅窗口位置变化，自动保存
    let previousPosition = useAppStore.getState().statusWindowPosition;
    useAppStore.subscribe((state) => {
      if (state.statusWindowPosition !== previousPosition) {
        saveWindowPositionToStorage(state.statusWindowPosition);
        previousPosition = state.statusWindowPosition;
      }
    });
  } catch (error) {
    console.error('初始化持久化失败:', error);
  }
};

/**
 * 导出配置为 JSON 文件
 */
export const exportConfigToFile = (): void => {
  try {
    const config = useAppStore.getState().config;
    const configJson = JSON.stringify(sanitizePersistedConfig(config), null, 2);
    const blob = new Blob([configJson], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'mctier_config.json';
    link.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('导出配置失败:', error);
  }
};

/**
 * 从 JSON 文件导入配置
 */
export const importConfigFromFile = (file: File): Promise<void> => {
  return new Promise((resolve, reject) => {
    try {
      if (!file || typeof file.size !== 'number' || file.size > MAX_CONFIG_FILE_BYTES) {
        reject(new Error('配置文件过大'));
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const configJson = e.target?.result;
          if (typeof configJson !== 'string' || configJson.length > MAX_CONFIG_FILE_BYTES) {
            throw new Error('配置文件过大');
          }
          const config = sanitizePersistedConfig(JSON.parse(configJson));
          useAppStore.getState().updateConfig(config);
          saveConfigToStorage(config);
          resolve();
        } catch (error) {
          reject(new Error('配置文件格式错误'));
        }
      };
      reader.onerror = () => {
        reject(new Error('读取文件失败'));
      };
      reader.readAsText(file);
    } catch (error) {
      reject(error);
    }
  });
};
