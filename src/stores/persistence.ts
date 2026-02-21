/**
 * Store 持久化工具
 * 负责将配置保存到本地存储并在应用启动时恢复
 */

import { useAppStore } from './appStore';
import type { UserConfig, WindowPosition } from '../types';

/**
 * 本地存储键名
 */
const STORAGE_KEYS = {
  CONFIG: 'mctier_user_config',
  WINDOW_POSITION: 'mctier_window_position',
} as const;

/**
 * 保存用户配置到本地存储
 */
export const saveConfigToStorage = (config: UserConfig): void => {
  try {
    const configJson = JSON.stringify(config);
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
    return JSON.parse(configJson) as UserConfig;
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
    const positionJson = JSON.stringify(position);
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
    return JSON.parse(positionJson) as WindowPosition;
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
    const configJson = JSON.stringify(config, null, 2);
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
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const configJson = e.target?.result as string;
          const config = JSON.parse(configJson) as UserConfig;
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
