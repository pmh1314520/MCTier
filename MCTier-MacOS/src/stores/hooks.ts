/**
 * Store 相关的自定义 Hooks
 * 提供便捷的状态访问和操作方法
 */

import { useCallback, useEffect } from 'react';
import { useAppStore } from './appStore';
import type { Player, Lobby, UserConfig } from '../types';

/**
 * 使用应用状态
 */
export const useAppState = () => {
  const appState = useAppStore((state) => state.appState);
  const setAppState = useAppStore((state) => state.setAppState);
  const errorMessage = useAppStore((state) => state.errorMessage);
  const setErrorMessage = useAppStore((state) => state.setErrorMessage);

  return {
    appState,
    setAppState,
    errorMessage,
    setErrorMessage,
    isIdle: appState === 'idle',
    isConnecting: appState === 'connecting',
    isInLobby: appState === 'in-lobby',
    isError: appState === 'error',
  };
};

/**
 * 使用大厅信息
 */
export const useLobby = () => {
  const lobby = useAppStore((state) => state.lobby);
  const setLobby = useAppStore((state) => state.setLobby);
  const clearLobby = useAppStore((state) => state.clearLobby);

  return {
    lobby,
    setLobby,
    clearLobby,
    hasLobby: lobby !== null,
  };
};

/**
 * 使用玩家列表
 */
export const usePlayers = () => {
  const players = useAppStore((state) => state.players);
  const addPlayer = useAppStore((state) => state.addPlayer);
  const removePlayer = useAppStore((state) => state.removePlayer);
  const updatePlayerStatus = useAppStore((state) => state.updatePlayerStatus);
  const clearPlayers = useAppStore((state) => state.clearPlayers);
  const getPlayerById = useAppStore((state) => state.getPlayerById);

  return {
    players,
    addPlayer,
    removePlayer,
    updatePlayerStatus,
    clearPlayers,
    getPlayerById,
    playerCount: players.length,
  };
};

/**
 * 使用语音状态
 */
export const useVoiceState = () => {
  const micEnabled = useAppStore((state) => state.micEnabled);
  const toggleMic = useAppStore((state) => state.toggleMic);
  const setMicEnabled = useAppStore((state) => state.setMicEnabled);
  const globalMuted = useAppStore((state) => state.globalMuted);
  const toggleGlobalMute = useAppStore((state) => state.toggleGlobalMute);
  const setGlobalMuted = useAppStore((state) => state.setGlobalMuted);

  return {
    micEnabled,
    toggleMic,
    setMicEnabled,
    globalMuted,
    toggleGlobalMute,
    setGlobalMuted,
  };
};

/**
 * 使用玩家静音状态
 */
export const usePlayerMute = () => {
  const mutedPlayers = useAppStore((state) => state.mutedPlayers);
  const togglePlayerMute = useAppStore((state) => state.togglePlayerMute);
  const mutePlayer = useAppStore((state) => state.mutePlayer);
  const unmutePlayer = useAppStore((state) => state.unmutePlayer);
  const isPlayerMuted = useAppStore((state) => state.isPlayerMuted);

  return {
    mutedPlayers,
    togglePlayerMute,
    mutePlayer,
    unmutePlayer,
    isPlayerMuted,
    mutedCount: mutedPlayers.size,
  };
};

/**
 * 使用 UI 状态
 */
export const useUIState = () => {
  const statusWindowCollapsed = useAppStore(
    (state) => state.statusWindowCollapsed
  );
  const toggleStatusWindowCollapsed = useAppStore(
    (state) => state.toggleStatusWindowCollapsed
  );
  const setStatusWindowCollapsed = useAppStore(
    (state) => state.setStatusWindowCollapsed
  );
  const statusWindowPosition = useAppStore(
    (state) => state.statusWindowPosition
  );
  const setStatusWindowPosition = useAppStore(
    (state) => state.setStatusWindowPosition
  );
  const mainWindowVisible = useAppStore((state) => state.mainWindowVisible);
  const setMainWindowVisible = useAppStore(
    (state) => state.setMainWindowVisible
  );

  return {
    statusWindowCollapsed,
    toggleStatusWindowCollapsed,
    setStatusWindowCollapsed,
    statusWindowPosition,
    setStatusWindowPosition,
    mainWindowVisible,
    setMainWindowVisible,
  };
};

/**
 * 使用配置
 */
export const useConfig = () => {
  const config = useAppStore((state) => state.config);
  const updateConfig = useAppStore((state) => state.updateConfig);
  const resetConfig = useAppStore((state) => state.resetConfig);

  return {
    config,
    updateConfig,
    resetConfig,
  };
};

/**
 * 使用特定玩家的信息
 * @param playerId 玩家 ID
 */
export const usePlayer = (playerId: string) => {
  const player = useAppStore((state) =>
    state.players.find((p) => p.id === playerId)
  );
  const updatePlayerStatus = useAppStore((state) => state.updatePlayerStatus);
  const isPlayerMuted = useAppStore((state) => state.isPlayerMuted);

  const updateStatus = useCallback(
    (status: Partial<Player>) => {
      updatePlayerStatus(playerId, status);
    },
    [playerId, updatePlayerStatus]
  );

  return {
    player,
    updateStatus,
    isMuted: isPlayerMuted(playerId),
    exists: player !== undefined,
  };
};

/**
 * 监听玩家列表变化
 * @param callback 回调函数
 */
export const usePlayersChange = (
  callback: (players: Player[]) => void
) => {
  const players = useAppStore((state) => state.players);

  useEffect(() => {
    callback(players);
  }, [players, callback]);
};

/**
 * 监听大厅变化
 * @param callback 回调函数
 */
export const useLobbyChange = (
  callback: (lobby: Lobby | null) => void
) => {
  const lobby = useAppStore((state) => state.lobby);

  useEffect(() => {
    callback(lobby);
  }, [lobby, callback]);
};

/**
 * 监听应用状态变化
 * @param callback 回调函数
 */
export const useAppStateChange = (
  callback: (appState: string) => void
) => {
  const appState = useAppStore((state) => state.appState);

  useEffect(() => {
    callback(appState);
  }, [appState, callback]);
};

/**
 * 监听配置变化
 * @param callback 回调函数
 */
export const useConfigChange = (
  callback: (config: UserConfig) => void
) => {
  const config = useAppStore((state) => state.config);

  useEffect(() => {
    callback(config);
  }, [config, callback]);
};

/**
 * 使用 Store 重置功能
 */
export const useStoreReset = () => {
  const reset = useAppStore((state) => state.reset);
  return { reset };
};
