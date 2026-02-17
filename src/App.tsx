import { useEffect } from 'react';
import { ConfigProvider, theme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { ErrorBoundary, MainWindow, MiniWindow } from './components';
import { useAppStore, initializeStore } from './stores';
import { hotkeyManager, webrtcClient } from './services';
import type { UserConfig } from './types';
import './App.css';

function App() {
  const appState = useAppStore((state) => state.appState);
  const lobby = useAppStore((state) => state.lobby);
  const setMicEnabled = useAppStore((state) => state.setMicEnabled);
  const addPlayer = useAppStore((state) => state.addPlayer);
  const removePlayer = useAppStore((state) => state.removePlayer);
  const updatePlayerStatus = useAppStore((state) => state.updatePlayerStatus);
  const setCurrentPlayerId = useAppStore((state) => state.setCurrentPlayerId);

  // 初始化应用
  useEffect(() => {
    const init = async () => {
      try {
        // 初始化状态管理（同步）
        initializeStore();

        // 生成玩家ID（在应用启动时就生成，而不是等到加入大厅）
        const timestamp = Date.now();
        const randomSuffix = Math.random().toString(36).substring(2, 11);
        const playerId = `player-${timestamp}-${randomSuffix}`;
        setCurrentPlayerId(playerId);
        console.log('应用启动时生成玩家ID:', playerId);

        // 从后端加载用户配置
        try {
          const userConfig = await invoke<UserConfig>('get_config');
          console.log('已加载用户配置:', userConfig);

          // 更新前端store中的配置
          const { updateConfig } = useAppStore.getState();
          updateConfig(userConfig);
        } catch (error) {
          console.warn('加载用户配置失败，使用默认配置:', error);
        }

        // 初始化快捷键管理器
        await hotkeyManager.initialize();

        // 注意：不再注册前端快捷键，因为我们使用后端的全局快捷键
        // 后端的全局快捷键可以在任何情况下工作，即使窗口没有焦点

        // 监听后端全局快捷键触发的麦克风状态变化事件
        const unlistenMicToggled = await listen<boolean>('mic-toggled', (event) => {
          const newState = event.payload;
          setMicEnabled(newState);
          // 同步更新 WebRTC 客户端的麦克风状态
          webrtcClient.setMicEnabled(newState);
          console.log('麦克风状态已更新:', newState);
        });

        console.log('应用初始化完成');

        // 返回清理函数
        return unlistenMicToggled;
      } catch (error) {
        console.error('应用初始化失败:', error);
        return undefined;
      }
    };

    let cleanup: (() => void) | undefined;

    init().then((unlisten) => {
      cleanup = unlisten;
    });

    // 清理函数
    return () => {
      if (cleanup) {
        cleanup();
      }
      hotkeyManager.cleanup();
      webrtcClient.cleanup();
    };
  }, [setMicEnabled]);

  // 当进入大厅时初始化WebRTC
  useEffect(() => {
    if (appState === 'in-lobby' && lobby) {
      const initWebRTC = async () => {
        try {
          // 使用应用启动时生成的玩家ID，而不是重新生成
          const { currentPlayerId: playerId } = useAppStore.getState();

          if (!playerId) {
            console.error('玩家ID不存在，无法初始化WebRTC');
            return;
          }

          console.log('使用已存在的玩家ID初始化WebRTC:', playerId);

          // 获取玩家名称
          const playerName = useAppStore.getState().config.playerName || '未知玩家';
          console.log('使用玩家名称:', playerName);

          // 添加当前玩家到玩家列表
          addPlayer({
            id: playerId,
            name: playerName,
            micEnabled: false, // 麦克风默认关闭
            isMuted: false,
            joinedAt: new Date().toISOString(),
          });

          // 初始化WebRTC客户端
          // 所有节点都连接到 10.126.126.1:8445
          // 如果自己是 10.126.126.1，就连接到本地
          console.log('WebRTC初始化参数:');
          console.log('  - 当前玩家虚拟IP:', lobby.virtualIp);
          console.log('  - 将连接到: 10.126.126.1:8445（如果自己是 10.126.126.1 则连接本地）');

          await webrtcClient.initialize(playerId, playerName);

          // 设置事件回调
          webrtcClient.onPlayerJoined((playerId, playerName) => {
            console.log(`WebRTC: 玩家加入 - ${playerName} (${playerId})`);
            addPlayer({
              id: playerId,
              name: playerName,
              micEnabled: false,
              isMuted: false,
              joinedAt: new Date().toISOString(),
            });
          });

          webrtcClient.onPlayerLeft((playerId) => {
            console.log(`WebRTC: 玩家离开 - ${playerId}`);
            removePlayer(playerId);
          });

          webrtcClient.onStatusUpdate((playerId, micEnabled) => {
            console.log(`WebRTC: 状态更新 - ${playerId}, 麦克风: ${micEnabled}`);
            updatePlayerStatus(playerId, { micEnabled });
          });

          webrtcClient.onRemoteStream((playerId, _stream) => {
            console.log(`WebRTC: 接收到远程音频流 - ${playerId}`);
          });

          console.log('✅ WebRTC 初始化完成，玩家ID:', playerId);
        } catch (error) {
          console.error('❌ WebRTC 初始化失败:', error);
        }
      };

      initWebRTC();
    }
    // 注意：不在这里添加cleanup，因为退出大厅时会在MiniWindow中手动调用cleanup
    // 这样可以确保cleanup在正确的时机执行，避免状态不一致
  }, [appState, lobby, addPlayer, removePlayer, updatePlayerStatus, setCurrentPlayerId]);

  return (
    <ErrorBoundary>
      <ConfigProvider
        locale={zhCN}
        theme={{
          algorithm: theme.darkAlgorithm,
          token: {
            colorPrimary: '#4a5568',
            colorSuccess: '#52c41a',
            colorWarning: '#f59e0b',
            colorError: '#ef4444',
            borderRadius: 8,
            colorBgContainer: 'rgba(30, 30, 45, 0.95)',
            colorBorder: 'rgba(255, 255, 255, 0.1)',
            colorText: 'rgba(255, 255, 255, 0.9)',
            colorTextSecondary: 'rgba(255, 255, 255, 0.6)',
            fontFamily:
              '-apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif',
          },
        }}
      >
        <div className="app-container">
          {/* 根据应用状态显示不同的界面 */}
          {appState === 'in-lobby' && lobby ? <MiniWindow /> : <MainWindow />}
        </div>
      </ConfigProvider>
    </ErrorBoundary>
  );
}

export default App;
