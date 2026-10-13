/**
 * Store 开发工具
 * 提供调试和监控功能
 */

import { useAppStore } from './appStore';

/**
 * 打印当前 Store 状态
 */
export const printStoreState = (): void => {
  const state = useAppStore.getState();
  const safeLobby = state.lobby ? { ...state.lobby, password: state.lobby.password ? '[redacted]' : undefined } : null;
  const safeConfig = {
    ...state.config,
    autoLobby: state.config.autoLobby
      ? { ...state.config.autoLobby, lobbyPassword: state.config.autoLobby.lobbyPassword ? '[redacted]' : undefined }
      : state.config.autoLobby,
  };
  console.group('📊 MCTier Store 状态');
  console.log('应用状态:', state.appState);
  console.log('错误信息:', state.errorMessage);
  console.log('大厅信息:', safeLobby);
  console.log('玩家列表:', state.players);
  console.log('麦克风状态:', state.micEnabled);
  console.log('静音玩家:', Array.from(state.mutedPlayers));
  console.log('全局静音:', state.globalMuted);
  console.log('状态窗口收起:', state.statusWindowCollapsed);
  console.log('状态窗口位置:', state.statusWindowPosition);
  console.log('主窗口可见:', state.mainWindowVisible);
  console.log('用户配置:', safeConfig);
  console.groupEnd();
};

/**
 * 监听 Store 变化并打印日志
 */
export const enableStoreLogging = (): (() => void) => {
  let previousState = useAppStore.getState();

  const unsubscribe = useAppStore.subscribe((state) => {
    const changes: string[] = [];

    // 检测变化
    if (state.appState !== previousState.appState) {
      changes.push(`应用状态: ${previousState.appState} → ${state.appState}`);
    }
    if (state.lobby !== previousState.lobby) {
      changes.push(
        `大厅: ${previousState.lobby?.name ?? '无'} → ${state.lobby?.name ?? '无'}`
      );
    }
    if (state.players.length !== previousState.players.length) {
      changes.push(
        `玩家数量: ${previousState.players.length} → ${state.players.length}`
      );
    }
    if (state.micEnabled !== previousState.micEnabled) {
      changes.push(`麦克风: ${previousState.micEnabled} → ${state.micEnabled}`);
    }
    if (state.globalMuted !== previousState.globalMuted) {
      changes.push(
        `全局静音: ${previousState.globalMuted} → ${state.globalMuted}`
      );
    }

    if (changes.length > 0) {
      console.group('🔄 Store 状态变化');
      changes.forEach((change) => console.log(change));
      console.groupEnd();
    }

    previousState = state;
  });

  console.log('✅ Store 日志已启用');
  return unsubscribe;
};

/**
 * 获取 Store 统计信息
 */
export const getStoreStats = () => {
  const state = useAppStore.getState();
  return {
    playerCount: state.players.length,
    mutedPlayerCount: state.mutedPlayers.size,
    hasLobby: state.lobby !== null,
    isInLobby: state.appState === 'in-lobby',
    micEnabled: state.micEnabled,
    globalMuted: state.globalMuted,
    statusWindowCollapsed: state.statusWindowCollapsed,
  };
};

/**
 * 重置 Store 到初始状态（用于测试）
 */
export const resetStoreForTesting = (): void => {
  useAppStore.getState().reset();
  console.log('🔄 Store 已重置到初始状态');
};

/**
 * 模拟添加测试玩家
 */
export const addTestPlayers = (count: number = 3): void => {
  const { addPlayer } = useAppStore.getState();
  for (let i = 1; i <= count; i++) {
    addPlayer({
      id: `test-player-${i}`,
      name: `测试玩家${i}`,
      micEnabled: i % 2 === 0,
      isMuted: false,
      joinedAt: new Date().toISOString(),
    });
  }
  console.log(`✅ 已添加 ${count} 个测试玩家`);
};

/**
 * 模拟创建测试大厅
 */
export const createTestLobby = (): void => {
  const { setLobby } = useAppStore.getState();
  setLobby({
    id: 'test-lobby-1',
    name: '测试大厅',
    createdAt: new Date().toISOString(),
    virtualIp: '10.144.0.1',
    creatorVirtualIp: '10.144.0.1',
  });
  console.log('✅ 已创建测试大厅');
};

/**
 * 导出 Store 状态为 JSON
 */
export const exportStoreState = (): string => {
  const state = useAppStore.getState();
  const safeLobby = state.lobby ? { ...state.lobby, password: state.lobby.password ? '[redacted]' : undefined } : null;
  const safeConfig = {
    ...state.config,
    autoLobby: state.config.autoLobby
      ? { ...state.config.autoLobby, lobbyPassword: state.config.autoLobby.lobbyPassword ? '[redacted]' : undefined }
      : state.config.autoLobby,
  };
  return JSON.stringify(
    {
      appState: state.appState,
      errorMessage: state.errorMessage,
      lobby: safeLobby,
      players: state.players,
      micEnabled: state.micEnabled,
      mutedPlayers: Array.from(state.mutedPlayers),
      globalMuted: state.globalMuted,
      statusWindowCollapsed: state.statusWindowCollapsed,
      statusWindowPosition: state.statusWindowPosition,
      mainWindowVisible: state.mainWindowVisible,
      config: safeConfig,
    },
    null,
    2
  );
};

/**
 * 在开发环境下将调试工具挂载到 window 对象
 */
export const mountDevtools = (): void => {
  if (import.meta.env.DEV) {
    (window as any).MCTierDevtools = {
      printState: printStoreState,
      enableLogging: enableStoreLogging,
      getStats: getStoreStats,
      reset: resetStoreForTesting,
      addTestPlayers,
      createTestLobby,
      exportState: exportStoreState,
      store: useAppStore,
    };
    console.log(
      '🛠️ MCTier 开发工具已挂载到 window.MCTierDevtools'
    );
  }
};
