/**
 * Store 选择器
 * 提供优化的状态选择函数，避免不必要的重渲染
 */

import type { AppStore } from './appStore';
import type { Player } from '../types';

/**
 * 选择应用是否处于空闲状态
 */
export const selectIsIdle = (state: AppStore): boolean =>
  state.appState === 'idle';

/**
 * 选择应用是否正在连接
 */
export const selectIsConnecting = (state: AppStore): boolean =>
  state.appState === 'connecting';

/**
 * 选择应用是否在大厅中
 */
export const selectIsInLobby = (state: AppStore): boolean =>
  state.appState === 'in-lobby';

/**
 * 选择应用是否处于错误状态
 */
export const selectIsError = (state: AppStore): boolean =>
  state.appState === 'error';

/**
 * 选择是否有大厅
 */
export const selectHasLobby = (state: AppStore): boolean =>
  state.lobby !== null;

/**
 * 选择大厅名称
 */
export const selectLobbyName = (state: AppStore): string | null =>
  state.lobby?.name ?? null;

/**
 * 选择大厅虚拟 IP
 */
export const selectLobbyVirtualIp = (state: AppStore): string | null =>
  state.lobby?.virtualIp ?? null;

/**
 * 选择玩家数量
 */
export const selectPlayerCount = (state: AppStore): number =>
  state.players.length;

/**
 * 选择在线玩家列表（麦克风开启的玩家）
 */
export const selectOnlinePlayers = (state: AppStore): Player[] =>
  state.players.filter((p) => p.micEnabled);

/**
 * 选择离线玩家列表（麦克风关闭的玩家）
 */
export const selectOfflinePlayers = (state: AppStore): Player[] =>
  state.players.filter((p) => !p.micEnabled);

/**
 * 选择被静音的玩家数量
 */
export const selectMutedPlayerCount = (state: AppStore): number =>
  state.mutedPlayers.size;

/**
 * 选择是否所有玩家都被静音
 */
export const selectAllPlayersMuted = (state: AppStore): boolean => {
  if (state.players.length === 0) return false;
  return state.players.every((p) => state.mutedPlayers.has(p.id));
};

/**
 * 选择是否有任何玩家被静音
 */
export const selectAnyPlayerMuted = (state: AppStore): boolean =>
  state.mutedPlayers.size > 0;

/**
 * 选择状态窗口是否展开
 */
export const selectStatusWindowExpanded = (state: AppStore): boolean =>
  !state.statusWindowCollapsed;

/**
 * 选择玩家名称配置
 */
export const selectPlayerName = (state: AppStore): string | undefined =>
  state.config.playerName;

/**
 * 选择首选服务器配置
 */
export const selectPreferredServer = (state: AppStore): string | undefined =>
  state.config.preferredServer;

/**
 * 选择麦克风快捷键配置
 */
export const selectMicHotkey = (state: AppStore): string | undefined =>
  state.config.micHotkey;

/**
 * 创建选择特定玩家的选择器
 */
export const createPlayerSelector = (playerId: string) => {
  return (state: AppStore): Player | undefined =>
    state.players.find((p) => p.id === playerId);
};

/**
 * 创建选择玩家是否被静音的选择器
 */
export const createPlayerMutedSelector = (playerId: string) => {
  return (state: AppStore): boolean => state.mutedPlayers.has(playerId);
};

/**
 * 选择玩家列表的 ID 数组（用于性能优化）
 */
export const selectPlayerIds = (state: AppStore): string[] =>
  state.players.map((p) => p.id);

/**
 * 选择是否可以开始游戏（有大厅且至少有一个玩家）
 */
export const selectCanStartGame = (state: AppStore): boolean =>
  state.lobby !== null && state.players.length > 0;

/**
 * 选择错误信息
 */
export const selectErrorMessage = (state: AppStore): string | null =>
  state.errorMessage;

/**
 * 选择是否有错误
 */
export const selectHasError = (state: AppStore): boolean =>
  state.errorMessage !== null;
