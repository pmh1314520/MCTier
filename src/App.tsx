import { useEffect, useState } from 'react';
import { ConfigProvider, theme, App as AntdApp } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { ErrorBoundary, MainWindow, MiniWindow } from './components';
import { ScreenViewer } from './components/ScreenViewer/ScreenViewer';
import { VersionUpdateModal } from './components/VersionUpdateModal';
import { useAppStore, initializeStore } from './stores';
import { hotkeyManager, webrtcClient, audioService, fileShareService } from './services';
import { screenShareService } from './services/screenShare/ScreenShareService';
import { versionCheckService } from './services/version/VersionCheckService';
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
  const currentPlayerId = useAppStore((state) => state.currentPlayerId);
  const addChatMessage = useAppStore((state) => state.addChatMessage);

  // 版本更新状态
  const [showVersionModal, setShowVersionModal] = useState(false);
  const [versionInfo, setVersionInfo] = useState<{
    latestVersion: string;
    currentVersion: string;
    updateMessage: string[];
  } | null>(null);

  // 检测是否是屏幕查看窗口
  const isScreenViewerWindow = window.location.search.includes('screen-viewer=true');

  // 如果是屏幕查看窗口，直接渲染ScreenViewer组件
  if (isScreenViewerWindow) {
    // 从URL参数中获取shareId和playerName
    const urlParams = new URLSearchParams(window.location.search);
    const shareId = urlParams.get('shareId') || '';
    const playerName = urlParams.get('playerName') || '未知玩家';
    
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
        <AntdApp>
          <ScreenViewer shareId={shareId} playerName={playerName} />
        </AntdApp>
        </ConfigProvider>
      </ErrorBoundary>
    );
  }

  // 在组件挂载后显示窗口（优化启动体验）
  useEffect(() => {
    const showWindow = async () => {
      try {
        const appWindow = getCurrentWindow();
        await appWindow.show();
        console.log('✅ 窗口已显示');
      } catch (error) {
        console.error('❌ 显示窗口失败:', error);
      }
    };

    // 延迟一小段时间，确保UI已渲染
    const timer = setTimeout(() => {
      showWindow();
    }, 100);

    return () => clearTimeout(timer);
  }, []);

  // 检查版本更新（仅在首次打开时）
  useEffect(() => {
    const checkVersion = async () => {
      try {
        // 检查是否需要显示更新提示
        if (!versionCheckService.shouldShowUpdatePrompt()) {
          console.log('⏭️ [VersionCheck] 已显示过更新提示，跳过检查');
          return;
        }

        console.log('🔍 [VersionCheck] 开始检查版本更新...');
        
        // 获取最新版本信息
        const info = await versionCheckService.fetchLatestVersion();
        
        if (!info) {
          console.warn('⚠️ [VersionCheck] 获取版本信息失败');
          return;
        }

        if (info.hasUpdate && info.updateMessage) {
          console.log('🎉 [VersionCheck] 发现新版本:', info.latestVersion);
          
          // 格式化更新日志
          const formattedMessage = versionCheckService.formatUpdateMessage(info.updateMessage);
          
          // 设置版本信息并显示弹窗
          setVersionInfo({
            latestVersion: info.latestVersion,
            currentVersion: info.currentVersion,
            updateMessage: formattedMessage,
          });
          setShowVersionModal(true);
          
          // 标记已显示更新提示
          versionCheckService.markUpdatePromptShown();
        } else {
          console.log('✅ [VersionCheck] 当前已是最新版本');
          // 即使是最新版本，也标记已检查过，避免每次启动都检查
          versionCheckService.markUpdatePromptShown();
        }
      } catch (error) {
        console.error('❌ [VersionCheck] 版本检查失败:', error);
      }
    };

    // 延迟3秒后检查版本，避免影响应用启动速度
    const timer = setTimeout(() => {
      checkVersion();
    }, 3000);

    return () => clearTimeout(timer);
  }, []);

  // 监听应用状态变化，控制窗口置顶
  useEffect(() => {
    const handleWindowAlwaysOnTop = async () => {
      try {
        if (appState === 'in-lobby') {
          // 进入大厅时设置窗口置顶
          await invoke('set_always_on_top', { alwaysOnTop: true });
          console.log('✅ 窗口已设置为置顶');
        } else {
          // 退出大厅时取消窗口置顶
          await invoke('set_always_on_top', { alwaysOnTop: false });
          console.log('✅ 窗口已取消置顶');
        }
      } catch (error) {
        console.error('❌ 设置窗口置顶状态失败:', error);
      }
    };

    handleWindowAlwaysOnTop();
  }, [appState]);

  // 全局禁用右键菜单
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      return false;
    };

    // 在document上监听，确保所有元素都禁用右键菜单
    document.addEventListener('contextmenu', handleContextMenu);

    return () => {
      document.removeEventListener('contextmenu', handleContextMenu);
    };
  }, []);

  // 全局禁止双击全屏
  useEffect(() => {
    const handleDoubleClick = (e: MouseEvent) => {
      // 阻止双击事件的默认行为（防止全屏）
      e.preventDefault();
      e.stopPropagation();
      return false;
    };

    // 在document上监听，确保所有元素都禁止双击全屏
    document.addEventListener('dblclick', handleDoubleClick, true);

    return () => {
      document.removeEventListener('dblclick', handleDoubleClick, true);
    };
  }, []);

  // 全局快捷键：Shift+F1 打开日志文件
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      // 检测 Shift+F1
      if (e.shiftKey && e.key === 'F1') {
        e.preventDefault();
        console.log('🔑 检测到 Shift+F1 快捷键，打开日志文件...');
        
        try {
          await invoke('open_log_file');
          console.log('✅ 日志文件已打开');
        } catch (error) {
          console.error('❌ 打开日志文件失败:', error);
        }
      }
    };

    // 在document上监听键盘事件
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // 初始化应用
  useEffect(() => {
    let isCleaningUp = false; // 防止重复清理的标志
    
    const init = async () => {
      try {
        // 【新增】应用启动时检查并清理残留的虚拟网卡
        console.log('🔍 检查是否有残留的虚拟网卡...');
        try {
          await invoke('force_stop_easytier');
          console.log('✅ 虚拟网卡清理完成');
        } catch (error) {
          console.warn('⚠️ 清理虚拟网卡时出现警告（可能没有残留）:', error);
          // 不影响应用启动，继续执行
        }
        
        // 初始化状态管理（同步）
        initializeStore();

        // 生成玩家ID（在应用启动时就生成，而不是等到加入大厅）
        const timestamp = Date.now();
        const randomSuffix = Math.random().toString(36).substring(2, 11);
        const playerId = `player-${timestamp}-${randomSuffix}`;
        setCurrentPlayerId(playerId);
        console.log('应用启动时生成玩家ID:', playerId);

        // 监听窗口关闭事件
        const appWindow = getCurrentWindow();
        const unlistenClose = await appWindow.onCloseRequested(async () => {
          // 防止重复执行清理
          if (isCleaningUp) {
            console.log('⚠️ 清理已在进行中，跳过重复执行');
            return;
          }
          
          isCleaningUp = true;
          console.log('🚪 窗口即将关闭，开始清理资源...');
          
          try {
            // 清理WebRTC资源
            await webrtcClient.cleanup();
            console.log('✅ WebRTC资源已清理');
          } catch (error) {
            console.error('❌ 清理WebRTC资源失败:', error);
          }
          
          try {
            // 清理快捷键
            hotkeyManager.cleanup();
            console.log('✅ 快捷键已清理');
          } catch (error) {
            console.error('❌ 清理快捷键失败:', error);
          }
          
          console.log('✅ 资源清理完成，允许窗口关闭');
          
          // 尝试销毁窗口，如果失败则忽略错误
          try {
            await appWindow.destroy();
          } catch (error) {
            // 忽略ACL权限错误，窗口会自动关闭
            console.log('⚠️ 窗口销毁命令被ACL拒绝，但窗口会自动关闭');
          }
        });

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

        // 监听后端全局快捷键触发的全局静音状态变化事件
        const unlistenGlobalMuteToggled = await listen<boolean>('global-mute-toggled', (event) => {
          const newState = event.payload;
          const { toggleGlobalMute, globalMuted } = useAppStore.getState();
          // 只有当状态不同时才切换
          if (globalMuted !== newState) {
            toggleGlobalMute();
          }
          console.log('全局听筒状态已更新:', newState ? '静音' : '开启');
        });

        console.log('应用初始化完成');

        // 返回清理函数
        return () => {
          unlistenMicToggled();
          unlistenGlobalMuteToggled();
          unlistenClose();
        };
      } catch (error) {
        console.error('应用初始化失败:', error);
        return undefined;
      }
    };

    let cleanup: (() => void) | undefined;

    init().then((cleanupFn) => {
      cleanup = cleanupFn;
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

          // 在初始化之前先设置版本错误回调
          webrtcClient.onVersionError((currentVersion, minimumVersion, downloadUrl) => {
            console.log(`WebRTC: 版本错误 - 当前版本: ${currentVersion}, 最低要求: ${minimumVersion}`);
            
            // 设置版本错误信息到store，MiniWindow会检测并显示弹窗
            const { setVersionError } = useAppStore.getState();
            setVersionError({ currentVersion, minimumVersion, downloadUrl });
          });

          // 初始化WebRTC客户端
          // 所有节点都连接到 10.126.126.1:8445
          // 如果自己是 10.126.126.1，就连接到本地
          console.log('WebRTC初始化参数:');
          console.log('  - 当前玩家虚拟IP:', lobby.virtualIp);
          console.log('  - 大厅名称:', lobby.name);
          console.log('  - 将连接到: 10.126.126.1:8445（如果自己是 10.126.126.1 则连接本地）');

          await webrtcClient.initialize(playerId, playerName, lobby.name, lobby.password || '', lobby.virtualDomain, lobby.useDomain);

          // 初始化屏幕共享服务
          const ws = (webrtcClient as any).websocket; // 获取WebSocket实例
          if (ws) {
            screenShareService.initialize(playerId, playerName, ws);
            console.log('✅ 屏幕共享服务已初始化');
          }

          // 设置事件回调
          webrtcClient.onPlayerJoined((playerId, playerName, virtualIp, virtualDomain, useDomain) => {
            console.log(`WebRTC: 玩家加入 - ${playerName} (${playerId}), 虚拟IP: ${virtualIp || '未知'}, 虚拟域名: ${virtualDomain || '未设置'}, 使用域名: ${useDomain || false}`);
            addPlayer({
              id: playerId,
              name: playerName,
              virtualIp: virtualIp,
              virtualDomain: virtualDomain,
              useDomain: useDomain,
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

          webrtcClient.onChatMessage((playerId, playerName, content, timestamp) => {
            console.log(`WebRTC: 收到聊天消息 - ${playerName}: ${content}`);
            addChatMessage({
              id: `${playerId}-${timestamp}`,
              playerId,
              playerName,
              content,
              timestamp,
            });
            
            // 如果不是自己发的消息，且不在聊天室界面，播放新消息音效
            if (playerId !== currentPlayerId) {
              const isInChatRoom = (window as any).__isInChatRoom__ || false;
              console.log('收到新消息，当前是否在聊天室:', isInChatRoom);
              if (!isInChatRoom) {
                console.log('播放新消息音效...');
                audioService.play('newMessage').catch(err => {
                  console.error('播放新消息音效失败:', err);
                });
              }
            }
          });

          console.log('✅ WebRTC 初始化完成，玩家ID:', playerId);

          // 启动HTTP文件服务器
          try {
            console.log('🚀 正在启动HTTP文件服务器...');
            console.log('📍 虚拟IP:', lobby.virtualIp);
            await fileShareService.startServer(lobby.virtualIp);
            console.log('✅ HTTP文件服务器启动成功');
          } catch (error) {
            console.error('❌ 启动HTTP文件服务器失败:', error);
            // 不阻止加入大厅，只是文件共享功能不可用
          }
        } catch (error) {
          console.error('❌ WebRTC 初始化失败:', error);
        }
      };

      initWebRTC();
    }
    // 注意：不在这里添加cleanup，因为退出大厅时会在MiniWindow中手动调用cleanup
    // 这样可以确保cleanup在正确的时机执行，避免状态不一致
  }, [appState, lobby, addPlayer, removePlayer, updatePlayerStatus, setCurrentPlayerId, addChatMessage]);

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
        <AntdApp>
          <div className="app-container">
            {/* 根据应用状态显示不同的界面 */}
            {appState === 'in-lobby' && lobby ? <MiniWindow /> : <MainWindow />}
          </div>

          {/* 版本更新提示弹窗 */}
          {versionInfo && (
            <VersionUpdateModal
              visible={showVersionModal}
              latestVersion={versionInfo.latestVersion}
              currentVersion={versionInfo.currentVersion}
              updateMessage={versionInfo.updateMessage}
              onClose={() => setShowVersionModal(false)}
            />
          )}
        </AntdApp>
      </ConfigProvider>
    </ErrorBoundary>
  );
}

export default App;
