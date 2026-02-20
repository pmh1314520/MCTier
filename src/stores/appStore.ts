/**
 * MCTier 应用程序状态管理 Store
 * 使用 Zustand 实现轻量级状态管理
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { webrtcClient } from '../services';
import type {
  AppState,
  Lobby,
  Player,
  UserConfig,
  WindowPosition,
  ChatMessage,
} from '../types';

/**
 * 应用程序 Store 接口定义
 */
interface AppStore {
  // ==================== 应用状态 ====================
  /** 当前应用状态 */
  appState: AppState;
  /** 设置应用状态 */
  setAppState: (state: AppState) => void;
  /** 错误信息 */
  errorMessage: string | null;
  /** 设置错误信息 */
  setErrorMessage: (message: string | null) => void;

  // ==================== 版本检查 ====================
  /** 版本错误信息 */
  versionError: { currentVersion: string; minimumVersion: string; downloadUrl: string } | null;
  /** 设置版本错误信息 */
  setVersionError: (error: { currentVersion: string; minimumVersion: string; downloadUrl: string } | null) => void;

  // ==================== 大厅信息 ====================
  /** 当前大厅信息 */
  lobby: Lobby | null;
  /** 设置大厅信息 */
  setLobby: (lobby: Lobby | null) => void;
  /** 清除大厅信息 */
  clearLobby: () => void;

  // ==================== 玩家列表管理 ====================
  /** 当前玩家ID */
  currentPlayerId: string | null;
  /** 设置当前玩家ID */
  setCurrentPlayerId: (playerId: string | null) => void;
  /** 玩家列表 */
  players: Player[];
  /** 添加玩家 */
  addPlayer: (player: Player) => void;
  /** 移除玩家 */
  removePlayer: (playerId: string) => void;
  /** 更新玩家状态 */
  updatePlayerStatus: (playerId: string, status: Partial<Player>) => void;
  /** 清除所有玩家 */
  clearPlayers: () => void;
  /** 根据 ID 获取玩家 */
  getPlayerById: (playerId: string) => Player | undefined;

  // ==================== 语音状态管理 ====================
  /** 本地麦克风是否开启 */
  micEnabled: boolean;
  /** 切换麦克风状态 */
  toggleMic: () => void;
  /** 设置麦克风状态 */
  setMicEnabled: (enabled: boolean) => void;

  /** 被静音的玩家 ID 集合 */
  mutedPlayers: Set<string>;
  /** 切换玩家静音状态 */
  togglePlayerMute: (playerId: string) => void;
  /** 静音指定玩家 */
  mutePlayer: (playerId: string) => void;
  /** 取消静音指定玩家 */
  unmutePlayer: (playerId: string) => void;
  /** 检查玩家是否被静音 */
  isPlayerMuted: (playerId: string) => boolean;

  /** 全局静音状态 */
  globalMuted: boolean;
  /** 切换全局静音 */
  toggleGlobalMute: () => void;
  /** 设置全局静音 */
  setGlobalMuted: (muted: boolean) => void;

  // ==================== UI 状态管理 ====================
  /** 状态窗口是否收起 */
  statusWindowCollapsed: boolean;
  /** 切换状态窗口收起状态 */
  toggleStatusWindowCollapsed: () => void;
  /** 设置状态窗口收起状态 */
  setStatusWindowCollapsed: (collapsed: boolean) => void;

  /** 状态窗口位置 */
  statusWindowPosition: WindowPosition;
  /** 设置状态窗口位置 */
  setStatusWindowPosition: (position: WindowPosition) => void;

  /** 主窗口是否可见 */
  mainWindowVisible: boolean;
  /** 设置主窗口可见性 */
  setMainWindowVisible: (visible: boolean) => void;

  /** 是否为迷你模式 */
  miniMode: boolean;
  /** 切换迷你模式 */
  toggleMiniMode: () => void;
  /** 设置迷你模式 */
  setMiniMode: (mini: boolean) => void;

  // ==================== 聊天室管理 ====================
  /** 聊天消息列表 */
  chatMessages: ChatMessage[];
  /** 添加聊天消息 */
  addChatMessage: (message: ChatMessage) => void;
  /** 清除聊天消息 */
  clearChatMessages: () => void;
  /** 获取最近N条消息 */
  getRecentMessages: (count: number) => ChatMessage[];

  // ==================== 配置管理 ====================
  /** 用户配置 */
  config: UserConfig;
  /** 更新配置 */
  updateConfig: (config: Partial<UserConfig>) => void;
  /** 重置配置为默认值 */
  resetConfig: () => void;

  // ==================== 全局操作 ====================
  /** 重置整个 Store 到初始状态 */
  reset: () => void;
}

/**
 * 默认配置
 */
const defaultConfig: UserConfig = {
  playerName: undefined,
  preferredServer: undefined,
  micHotkey: 'Ctrl+M',
  globalMuteHotkey: 'Ctrl+T',
  windowPosition: undefined,
  audioDeviceId: undefined,
};

/**
 * 默认状态窗口位置
 */
const defaultStatusWindowPosition: WindowPosition = {
  x: 20,
  y: 20,
  width: 300,
  height: 400,
};

/**
 * 初始状态
 */
const initialState = {
  // 应用状态
  appState: 'idle' as AppState,
  errorMessage: null,
  versionError: null,

  // 大厅信息
  lobby: null,

  // 玩家列表
  currentPlayerId: null,
  players: [],

  // 语音状态
  micEnabled: false, // 麦克风默认关闭（保护隐私）
  mutedPlayers: new Set<string>(),
  globalMuted: false,

  // UI 状态
  statusWindowCollapsed: false,
  statusWindowPosition: defaultStatusWindowPosition,
  mainWindowVisible: true,
  miniMode: false,

  // 聊天室
  chatMessages: [],

  // 配置
  config: defaultConfig,
};

/**
 * 创建应用程序 Store
 */
export const useAppStore = create<AppStore>()(
  devtools(
    (set, get) => ({
      ...initialState,

      // ==================== 应用状态操作 ====================
      setAppState: (state: AppState) => {
        set({ appState: state }, false, 'setAppState');
      },

      setErrorMessage: (message: string | null) => {
        set({ errorMessage: message }, false, 'setErrorMessage');
        if (message) {
          set({ appState: 'error' }, false, 'setAppState/error');
        }
      },

      setVersionError: (error: { currentVersion: string; minimumVersion: string; downloadUrl: string } | null) => {
        set({ versionError: error }, false, 'setVersionError');
      },

      // ==================== 大厅信息操作 ====================
      setLobby: (lobby: Lobby | null) => {
        set({ lobby }, false, 'setLobby');
        if (lobby) {
          set({ appState: 'in-lobby' }, false, 'setAppState/in-lobby');
        }
      },

      clearLobby: () => {
        set({ lobby: null }, false, 'clearLobby');
        // 清除大厅时也清除玩家列表
        get().clearPlayers();
        // 清除聊天消息
        get().clearChatMessages();
        // 重置语音状态为默认值
        set({ 
          micEnabled: false,  // 麦克风默认关闭
          globalMuted: false, // 全局静音默认关闭
          mutedPlayers: new Set<string>() // 清空静音列表
        }, false, 'clearLobby/resetVoiceState');
        console.log('✅ 语音状态已重置为默认值');
      },

      // ==================== 玩家列表操作 ====================
      setCurrentPlayerId: (playerId: string | null) => {
        set({ currentPlayerId: playerId }, false, 'setCurrentPlayerId');
      },

      addPlayer: (player: Player) => {
        set(
          (state) => {
            // 检查玩家是否已存在
            const exists = state.players.some((p) => p.id === player.id);
            if (exists) {
              console.warn(`玩家 ${player.id} 已存在，跳过添加`);
              return state;
            }
            return {
              players: [...state.players, player],
            };
          },
          false,
          'addPlayer'
        );
      },

      removePlayer: (playerId: string) => {
        set(
          (state) => ({
            players: state.players.filter((p) => p.id !== playerId),
          }),
          false,
          'removePlayer'
        );
        // 同时从静音列表中移除
        const mutedPlayers = new Set(get().mutedPlayers);
        mutedPlayers.delete(playerId);
        set({ mutedPlayers }, false, 'removePlayer/unmute');
      },

      updatePlayerStatus: (playerId: string, status: Partial<Player>) => {
        set(
          (state) => ({
            players: state.players.map((p) =>
              p.id === playerId ? { ...p, ...status } : p
            ),
          }),
          false,
          'updatePlayerStatus'
        );
      },

      clearPlayers: () => {
        set({ players: [] }, false, 'clearPlayers');
        // 清除静音列表
        set({ mutedPlayers: new Set() }, false, 'clearPlayers/clearMuted');
      },

      getPlayerById: (playerId: string) => {
        return get().players.find((p) => p.id === playerId);
      },

      // ==================== 语音状态操作 ====================
      toggleMic: () => {
        set(
          (state) => ({ micEnabled: !state.micEnabled }),
          false,
          'toggleMic'
        );
      },

      setMicEnabled: (enabled: boolean) => {
        set({ micEnabled: enabled }, false, 'setMicEnabled');
      },

      togglePlayerMute: (playerId: string) => {
        set(
          (state) => {
            const mutedPlayers = new Set(state.mutedPlayers);
            const willBeMuted = !mutedPlayers.has(playerId);
            
            if (willBeMuted) {
              mutedPlayers.add(playerId);
            } else {
              mutedPlayers.delete(playerId);
            }
            
            // 同步到 WebRTC 客户端
            try {
              if (willBeMuted) {
                webrtcClient.mutePlayer(playerId);
              } else {
                webrtcClient.unmutePlayer(playerId);
              }
            } catch (error) {
              console.error('同步静音状态到WebRTC失败:', error);
            }
            
            return { mutedPlayers };
          },
          false,
          'togglePlayerMute'
        );
      },

      mutePlayer: (playerId: string) => {
        set(
          (state) => {
            const mutedPlayers = new Set(state.mutedPlayers);
            mutedPlayers.add(playerId);
            
            // 同步到 WebRTC 客户端
            try {
              webrtcClient.mutePlayer(playerId);
            } catch (error) {
              console.error('同步静音状态到WebRTC失败:', error);
            }
            
            return { mutedPlayers };
          },
          false,
          'mutePlayer'
        );
      },

      unmutePlayer: (playerId: string) => {
        set(
          (state) => {
            const mutedPlayers = new Set(state.mutedPlayers);
            mutedPlayers.delete(playerId);
            
            // 同步到 WebRTC 客户端
            try {
              webrtcClient.unmutePlayer(playerId);
            } catch (error) {
              console.error('同步静音状态到WebRTC失败:', error);
            }
            
            return { mutedPlayers };
          },
          false,
          'unmutePlayer'
        );
      },

      isPlayerMuted: (playerId: string) => {
        return get().mutedPlayers.has(playerId);
      },

      toggleGlobalMute: () => {
        set(
          (state) => {
            const newGlobalMuted = !state.globalMuted;
            
            // 同步到 WebRTC 客户端
            try {
              if (newGlobalMuted) {
                webrtcClient.muteAllPlayers();
              } else {
                webrtcClient.unmuteAllPlayers();
              }
            } catch (error) {
              console.error('同步全局静音状态到WebRTC失败:', error);
            }
            
            return { globalMuted: newGlobalMuted };
          },
          false,
          'toggleGlobalMute'
        );
      },

      setGlobalMuted: (muted: boolean) => {
        // 同步到 WebRTC 客户端
        try {
          if (muted) {
            webrtcClient.muteAllPlayers();
          } else {
            webrtcClient.unmuteAllPlayers();
          }
        } catch (error) {
          console.error('同步全局静音状态到WebRTC失败:', error);
        }
        
        set({ globalMuted: muted }, false, 'setGlobalMuted');
      },

      // ==================== UI 状态操作 ====================
      toggleStatusWindowCollapsed: () => {
        set(
          (state) => ({
            statusWindowCollapsed: !state.statusWindowCollapsed,
          }),
          false,
          'toggleStatusWindowCollapsed'
        );
      },

      setStatusWindowCollapsed: (collapsed: boolean) => {
        set(
          { statusWindowCollapsed: collapsed },
          false,
          'setStatusWindowCollapsed'
        );
      },

      setStatusWindowPosition: (position: WindowPosition) => {
        set(
          { statusWindowPosition: position },
          false,
          'setStatusWindowPosition'
        );
      },

      setMainWindowVisible: (visible: boolean) => {
        set({ mainWindowVisible: visible }, false, 'setMainWindowVisible');
      },

      toggleMiniMode: () => {
        set(
          (state) => ({ miniMode: !state.miniMode }),
          false,
          'toggleMiniMode'
        );
      },

      setMiniMode: (mini: boolean) => {
        set({ miniMode: mini }, false, 'setMiniMode');
      },

      // ==================== 聊天室操作 ====================
      addChatMessage: (message: ChatMessage) => {
        set(
          (state) => ({
            chatMessages: [...state.chatMessages, message],
          }),
          false,
          'addChatMessage'
        );
      },

      clearChatMessages: () => {
        set({ chatMessages: [] }, false, 'clearChatMessages');
      },

      getRecentMessages: (count: number) => {
        const messages = get().chatMessages;
        return messages.slice(-count);
      },

      // ==================== 配置操作 ====================
      updateConfig: (config: Partial<UserConfig>) => {
        set(
          (state) => ({
            config: { ...state.config, ...config },
          }),
          false,
          'updateConfig'
        );
      },

      resetConfig: () => {
        set({ config: defaultConfig }, false, 'resetConfig');
      },

      // ==================== 全局操作 ====================
      reset: () => {
        set(
          {
            ...initialState,
            // 重新创建 Set 对象，避免引用问题
            mutedPlayers: new Set<string>(),
            // 确保语音状态重置为默认值
            micEnabled: false,
            globalMuted: false,
          },
          false,
          'reset'
        );
        console.log('✅ Store 已完全重置');
      },
    }),
    {
      name: 'MCTier-AppStore',
      enabled: import.meta.env.DEV,
    }
  )
);

/**
 * 导出 Store 类型，方便在其他地方使用
 */
export type { AppStore };
