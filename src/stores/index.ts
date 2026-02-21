/**
 * MCTier 状态管理模块
 * 使用 Zustand 进行全局状态管理
 */

export { useAppStore } from './appStore';
export type { AppStore } from './appStore';

// 导出自定义 Hooks
export {
  useAppState,
  useLobby,
  usePlayers,
  useVoiceState,
  usePlayerMute,
  useUIState,
  useConfig,
  usePlayer,
  usePlayersChange,
  useLobbyChange,
  useAppStateChange,
  useConfigChange,
  useStoreReset,
} from './hooks';

// 导出选择器
export * from './selectors';

// 导出持久化工具
export {
  saveConfigToStorage,
  loadConfigFromStorage,
  saveWindowPositionToStorage,
  loadWindowPositionFromStorage,
  clearStorage,
  initializeStorePersistence,
  exportConfigToFile,
  importConfigFromFile,
} from './persistence';

// 导出初始化函数
export { initializeStore } from './initialize';

// 导出开发工具（仅在开发环境使用）
export {
  printStoreState,
  enableStoreLogging,
  getStoreStats,
  resetStoreForTesting,
  addTestPlayers,
  createTestLobby,
  exportStoreState,
  mountDevtools,
} from './devtools';
