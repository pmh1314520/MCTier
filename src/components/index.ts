/**
 * MCTier 前端组件模块
 * 统一导出所有 UI 组件
 */

// 图标组件
export * from './icons';

// 主窗口组件
export { MainWindow } from './MainWindow/MainWindow';

// 大厅表单组件
export { LobbyForm } from './LobbyForm/LobbyForm';

// 状态窗口组件
export { StatusWindow } from './StatusWindow/StatusWindow';

// 玩家列表组件
export { PlayerList } from './PlayerList/PlayerList';

// 语音控制组件
export { VoiceControls } from './VoiceControls/VoiceControls';

// 错误边界组件
export { ErrorBoundary } from './ErrorBoundary/ErrorBoundary';

// 迷你窗口组件
export { MiniWindow } from './MiniWindow/MiniWindow';

// 关于窗口组件
export { AboutWindow } from './AboutWindow/AboutWindow';

// 历史记录输入框组件
export { HistoryInput } from './HistoryInput/HistoryInput';
export { HistoryPasswordInput } from './HistoryInput/HistoryPasswordInput';

// 常用大厅信息管理组件
export { FavoriteLobbyManager } from './FavoriteLobbyManager/FavoriteLobbyManager';
export type { FavoriteLobby } from './FavoriteLobbyManager/FavoriteLobbyManager';

// 文件共享管理组件
export { FileShareManager } from './FileShareManager';
