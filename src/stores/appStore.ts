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

/** 共享待办项（双端字段名一致） */
export interface TodoItem {
  id: string;
  text: string;
  done: boolean;
  assignee: string; // 被分配玩家名，空串=未分配
  creator: string; // 创建者名
  ts: number; // 时间戳（毫秒）
}

/** 白板笔画（双端字段名一致，坐标为 0~1 归一化） */
export interface WhiteboardStroke {
  op?: string; // "stroke"
  id: string;
  color: string;
  width: number;
  points: [number, number][];
}

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

  /** 每个玩家的独立音量设置 (playerId -> volume 0.0-1.0) */
  playerVolumes: Map<string, number>;
  /** 设置指定玩家的音量 */
  setPlayerVolume: (playerId: string, volume: number) => void;
  /** 获取指定玩家的音量 */
  getPlayerVolume: (playerId: string) => number;

  /** 全局静音状态 */
  globalMuted: boolean;
  /** 切换全局静音 */
  toggleGlobalMute: () => void;
  /** 设置全局静音 */
  setGlobalMuted: (muted: boolean) => void;

  /** 正在说话的玩家 ID 集合（含本机） */
  speakingPlayers: Set<string>;
  /** 设置某玩家的说话状态 */
  setPlayerSpeaking: (playerId: string, speaking: boolean) => void;

  // ==================== 房主/大厅管理 ====================
  /** 当前房主的玩家ID */
  hostId: string | null;
  /** 设置房主ID */
  setHostId: (id: string | null) => void;
  /** 人数上限（null = 不限） */
  maxPlayers: number | null;
  /** 设置人数上限 */
  setMaxPlayers: (max: number | null) => void;
  /** 当前大厅是否已发布到公开广场 */
  isPublicLobby: boolean;
  /** 设置公开状态 */
  setIsPublicLobby: (pub: boolean) => void;
  /** 被房主禁言的玩家ID集合 */
  hostMutedPlayers: Set<string>;
  /** 设置某玩家被房主禁言状态 */
  setHostMuted: (playerId: string, muted: boolean) => void;
  /** 重置房主禁言集合 */
  setHostMutedPlayers: (ids: string[]) => void;

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

  // ==================== 大厅公告 / 语音小队 ====================
  /** 大厅公告（房主设置，新人进入即见） */
  announcement: string;
  /** 设置大厅公告 */
  setAnnouncement: (text: string) => void;
  /** 我的语音小队（0=公共，1~4=小队） */
  myVoiceGroup: number;
  /** 设置我的语音小队 */
  setMyVoiceGroup: (group: number) => void;
  /** 各玩家语音小队 */
  playerVoiceGroups: Map<string, number>;
  /** 设置某玩家语音小队 */
  setPlayerVoiceGroup: (playerId: string, group: number) => void;
  /** 重算小队听音路由 */
  applyVoiceGroupRouting: () => void;

  // ==================== 协同功能：剪贴板 / 待办 / 白板 ====================
  /** 收到的共享剪贴板（用于弹窗展示） */
  incomingClipboard: { from: string; text: string; ts: number } | null;
  /** 设置收到的共享剪贴板 */
  setIncomingClipboard: (data: { from: string; text: string; ts: number } | null) => void;
  /** 共享待办列表 */
  todos: TodoItem[];
  /** 覆盖设置待办列表（来自远端同步或本地操作） */
  setTodos: (todos: TodoItem[]) => void;
  /** 白板笔画列表 */
  whiteboardStrokes: WhiteboardStroke[];
  /** 追加一笔白板笔画 */
  addWhiteboardStroke: (stroke: WhiteboardStroke) => void;
  /** 清空白板 */
  clearWhiteboard: () => void;

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
  pushToTalkHotkey: 'F2',
  windowPosition: undefined,
  audioDeviceId: undefined,
  autoStartup: false,
  autoLobby: {
    enabled: false,
    lobbyName: undefined,
    lobbyPassword: undefined,
    playerName: undefined,
    useDomain: false,
  },
  exitNodeConfig: {
    enableExitNode: false,
    enableAsExitNode: false,
    proxyCidrs: [],
    exitNodes: [],
  },
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
  speakingPlayers: new Set<string>(),
  playerVolumes: new Map<string, number>(), // 每个玩家的独立音量

  // 房主/大厅管理
  hostId: null,
  maxPlayers: null,
  isPublicLobby: false,
  hostMutedPlayers: new Set<string>(),

  // UI 状态
  statusWindowCollapsed: false,
  statusWindowPosition: defaultStatusWindowPosition,
  mainWindowVisible: true,
  miniMode: false,

  // 聊天室
  chatMessages: [],

  // 大厅公告 / 语音小队
  announcement: '',
  myVoiceGroup: 0,
  playerVoiceGroups: new Map<string, number>(),

  // 协同功能：剪贴板 / 待办 / 白板
  incomingClipboard: null as { from: string; text: string; ts: number } | null,
  todos: [] as TodoItem[],
  whiteboardStrokes: [] as WhiteboardStroke[],

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
          mutedPlayers: new Set<string>(), // 清空静音列表
          speakingPlayers: new Set<string>(), // 清空说话状态
          playerVolumes: new Map<string, number>(), // 清空玩家音量设置
          hostId: null, // 重置房主
          maxPlayers: null,
          isPublicLobby: false,
          hostMutedPlayers: new Set<string>(),
        }, false, 'clearLobby/resetVoiceState');
        set({ announcement: '', myVoiceGroup: 0, playerVoiceGroups: new Map<string, number>() }, false, 'clearLobby/resetAnnounce');
        set({ incomingClipboard: null, todos: [], whiteboardStrokes: [] }, false, 'clearLobby/resetCollab');
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
        // 清除玩家音量设置
        set({ playerVolumes: new Map() }, false, 'clearPlayers/clearVolumes');
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

      setPlayerSpeaking: (playerId: string, speaking: boolean) => {
        set(
          (state) => {
            const has = state.speakingPlayers.has(playerId);
            if (speaking === has) return state; // 无变化，避免多余渲染
            const next = new Set(state.speakingPlayers);
            if (speaking) next.add(playerId);
            else next.delete(playerId);
            return { speakingPlayers: next };
          },
          false,
          'setPlayerSpeaking'
        );
      },

      // ==================== 房主/大厅管理操作 ====================
      setHostId: (id: string | null) => set({ hostId: id }, false, 'setHostId'),
      setMaxPlayers: (max: number | null) => set({ maxPlayers: max }, false, 'setMaxPlayers'),
      setIsPublicLobby: (pub: boolean) => set({ isPublicLobby: pub }, false, 'setIsPublicLobby'),
      setHostMuted: (playerId: string, muted: boolean) => {
        set(
          (state) => {
            const next = new Set(state.hostMutedPlayers);
            if (muted) next.add(playerId);
            else next.delete(playerId);
            return { hostMutedPlayers: next };
          },
          false,
          'setHostMuted'
        );
      },
      setHostMutedPlayers: (ids: string[]) =>
        set({ hostMutedPlayers: new Set(ids) }, false, 'setHostMutedPlayers'),

      // ==================== 玩家音量操作 ====================
      setPlayerVolume: (playerId: string, volume: number) => {
        set(
          (state) => {
            const playerVolumes = new Map(state.playerVolumes);
            const clampedVolume = Math.max(0, Math.min(1, volume));
            playerVolumes.set(playerId, clampedVolume);
            
            // 同步到 WebRTC 客户端
            try {
              webrtcClient.setPlayerVolume(playerId, clampedVolume);
            } catch (error) {
              console.error('同步玩家音量到WebRTC失败:', error);
            }
            
            return { playerVolumes };
          },
          false,
          'setPlayerVolume'
        );
      },

      getPlayerVolume: (playerId: string) => {
        return get().playerVolumes.get(playerId) ?? 1.0; // 默认100%
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

      // ==================== 大厅公告 / 语音小队操作 ====================
      setAnnouncement: (text: string) => {
        set({ announcement: text }, false, 'setAnnouncement');
      },

      setMyVoiceGroup: (group: number) => {
        set((state) => {
          const playerVoiceGroups = new Map(state.playerVoiceGroups);
          const me = state.currentPlayerId;
          if (me) playerVoiceGroups.set(me, group);
          return { myVoiceGroup: group, playerVoiceGroups };
        }, false, 'setMyVoiceGroup');
        get().applyVoiceGroupRouting();
      },

      setPlayerVoiceGroup: (playerId: string, group: number) => {
        set((state) => {
          const playerVoiceGroups = new Map(state.playerVoiceGroups);
          playerVoiceGroups.set(playerId, group);
          return { playerVoiceGroups };
        }, false, 'setPlayerVoiceGroup');
        get().applyVoiceGroupRouting();
      },

      // 小队听音路由：公共(0)听所有人；小队只听同队，其余静音
      applyVoiceGroupRouting: () => {
        const st = get();
        const myGroup = st.myVoiceGroup;
        st.players.forEach((p) => {
          if (p.id === st.currentPlayerId) return;
          const theirGroup = st.playerVoiceGroups.get(p.id) ?? 0;
          const shouldHear = myGroup === 0 || theirGroup === myGroup;
          const target = shouldHear ? (st.playerVolumes.get(p.id) ?? 1.0) || 1.0 : 0;
          try { webrtcClient.setPlayerVolume(p.id, target); } catch { /* ignore */ }
        });
      },

      // ==================== 协同功能：剪贴板 / 待办 / 白板 ====================
      setIncomingClipboard: (data) => {
        set({ incomingClipboard: data }, false, 'setIncomingClipboard');
      },

      setTodos: (todos: TodoItem[]) => {
        set({ todos }, false, 'setTodos');
      },

      addWhiteboardStroke: (stroke: WhiteboardStroke) => {
        set((state) => ({ whiteboardStrokes: [...state.whiteboardStrokes, stroke] }), false, 'addWhiteboardStroke');
      },

      clearWhiteboard: () => {
        set({ whiteboardStrokes: [] }, false, 'clearWhiteboard');
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
            playerVolumes: new Map<string, number>(),
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
