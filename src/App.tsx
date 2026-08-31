import { useEffect, useState } from 'react';
import { ConfigProvider, theme, App as AntdApp, Button, Modal } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import enUS from 'antd/locale/en_US';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useTranslation } from 'react-i18next';
import {
  getLanguagePreference,
  tl,
  getLanguage,
  setLanguagePreference,
  type LanguagePreference,
} from './i18n';
import { ErrorBoundary, MainWindow, MiniWindow } from './components';
import { GlobalTooltip } from './components/GlobalTooltip/GlobalTooltip';
import { GlobalButtonTheme } from './components/GlobalTooltip/GlobalButtonTheme';
import { ScreenViewer } from './components/ScreenViewer/ScreenViewer';
import { DanmakuOverlay } from './components/Danmaku/DanmakuOverlay';
import { GameHudOverlay } from './components/GameHud/GameHudOverlay';
import { VersionUpdateModal } from './components/VersionUpdateModal';
import { useAppStore, initializeStore } from './stores';
import { hotkeyManager, webrtcClient, audioService, fileShareService } from './services';
import { screenShareService } from './services/screenShare/ScreenShareService';
import { speakingDetector } from './services/voice/SpeakingDetector';
import { versionCheckService } from './services/version/VersionCheckService';
import { DOWNLOAD_WEBSITE } from './services/version/versionPolicy';
import { parseLobbyInviteLink } from './services/lobby/lobbyInvite';
import { lobbySessionCoordinator } from './services/lobby/LobbySessionCoordinator';
import type { UserConfig } from './types';
import {
  THEME_CHANGED_EVENT,
  isThemePreference,
  readThemePreference,
  resolveTheme,
  type ThemePreference,
} from './theme/themePreference';
import { isSafeResourceId, sanitizeUntrustedText } from './security/trustBoundary';
import './App.css';

function App() {
  const { i18n } = useTranslation();
  const appState = useAppStore((state) => state.appState);
  const lobby = useAppStore((state) => state.lobby);
  const setMicEnabled = useAppStore((state) => state.setMicEnabled);
  const addPlayer = useAppStore((state) => state.addPlayer);
  const removePlayer = useAppStore((state) => state.removePlayer);
  const updatePlayerStatus = useAppStore((state) => state.updatePlayerStatus);
  const currentPlayerId = useAppStore((state) => state.currentPlayerId);
  const addChatMessage = useAppStore((state) => state.addChatMessage);
  const setPlayerSpeaking = useAppStore((state) => state.setPlayerSpeaking);
  const [showMicrophonePermissionHelp, setShowMicrophonePermissionHelp] = useState(false);
  const [themePreference, setThemePreference] = useState<ThemePreference>(readThemePreference);
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches
  );
  const effectiveTheme = resolveTheme(themePreference, systemDark);

  // 版本更新状态
  const [showVersionModal, setShowVersionModal] = useState(false);
  const [versionInfo, setVersionInfo] = useState<{
    latestVersion: string;
    currentVersion: string;
    updateMessage: string[];
  } | null>(null);

  useEffect(() => {
    void invoke<{ language?: LanguagePreference }>('get_settings')
      .then((settings) => setLanguagePreference(settings.language ?? getLanguagePreference()))
      .catch((error) => console.error('读取语言设置失败:', error));
  }, []);

  useEffect(() => {
    const showHelp = () => setShowMicrophonePermissionHelp(true);
    window.addEventListener('mctier-microphone-permission-required', showHelp);
    return () => window.removeEventListener('mctier-microphone-permission-required', showHelp);
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handleSystemTheme = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    const handlePreference = (event: Event) => {
      const preference = (event as CustomEvent<unknown>).detail;
      if (isThemePreference(preference)) setThemePreference(preference);
    };
    media.addEventListener('change', handleSystemTheme);
    window.addEventListener(THEME_CHANGED_EVENT, handlePreference);
    return () => {
      media.removeEventListener('change', handleSystemTheme);
      window.removeEventListener(THEME_CHANGED_EVENT, handlePreference);
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = effectiveTheme;
    document.documentElement.style.colorScheme = effectiveTheme;
  }, [effectiveTheme]);

  // 检测是否是屏幕查看窗口
  const isScreenViewerWindow = window.location.search.includes('screen-viewer=true');

  // 弹幕覆盖窗口：只渲染弹幕层（透明、置顶、穿透）
  const isDanmakuWindow = window.location.search.includes('danmaku=true');
  if (isDanmakuWindow) {
    return <DanmakuOverlay />;
  }

  // 游戏 HUD 浮层窗口：只渲染 HUD（透明、置顶、穿透）
  const isGameHudWindow = window.location.search.includes('gamehud=true');
  if (isGameHudWindow) {
    return <GameHudOverlay />;
  }

  // 如果是屏幕查看窗口，直接渲染ScreenViewer组件
  if (isScreenViewerWindow) {
    // 从URL参数中获取shareId和playerName
    const urlParams = new URLSearchParams(window.location.search);
    const rawShareId = urlParams.get('shareId');
    const shareId = isSafeResourceId(rawShareId) ? rawShareId : '';
    const playerName =
      sanitizeUntrustedText(urlParams.get('playerName'), 64).trim() ||
      tl('未知玩家', 'Unknown Player');

    return (
      <ErrorBoundary>
        <ConfigProvider
          locale={getLanguage() === 'en' ? enUS : zhCN}
          theme={{
            algorithm: effectiveTheme === 'dark' ? theme.darkAlgorithm : theme.defaultAlgorithm,
            token: {
              colorPrimary: '#52c41a',
              colorSuccess: '#52c41a',
              colorWarning: '#f59e0b',
              colorError: '#ef4444',
              borderRadius: 8,
              colorBgContainer: effectiveTheme === 'dark' ? 'rgba(30, 30, 45, 0.95)' : '#ffffff',
              colorBorder:
                effectiveTheme === 'dark' ? 'rgba(255, 255, 255, 0.1)' : 'rgba(24, 32, 43, 0.16)',
              colorText: effectiveTheme === 'dark' ? 'rgba(255, 255, 255, 0.9)' : '#18202b',
              colorTextSecondary:
                effectiveTheme === 'dark' ? 'rgba(255, 255, 255, 0.6)' : '#596574',
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

  // 同步系统托盘菜单文本到当前界面语言（启动时 + 语言切换时）
  useEffect(() => {
    const syncTray = async () => {
      try {
        await invoke('set_tray_menu_texts', {
          showText: tl('显示 MCTier', 'Show MCTier'),
          exitText: tl('退出 MCTier', 'Exit MCTier'),
          notificationTitle: tl('MCTier 正在后台运行', 'MCTier is running in the background'),
          notificationBody: tl(
            'MCTier 已最小化到系统托盘。点击右下角托盘图标或按 {shortcut} 可恢复窗口。',
            'MCTier has been minimized to the system tray. Click the tray icon or press {shortcut} to restore it.'
          ),
        });
      } catch (error) {
        console.error('同步托盘菜单语言失败:', error);
      }
    };
    void syncTray();
  }, [i18n.language]);

  // 在组件挂载后显示窗口（优化启动体验）
  useEffect(() => {
    const showWindow = async () => {
      try {
        const appWindow = getCurrentWindow();
        if (!(await appWindow.isVisible())) {
          return;
        }
        // 读取「启动后自动隐藏到系统托盘」配置：为真则保持隐藏，不再显示窗口
        let startMinimized = false;
        try {
          const settings = await invoke<{ startMinimized?: boolean }>('get_settings');
          startMinimized = settings?.startMinimized ?? false;
        } catch (e) {
          console.error('读取启动隐藏配置失败:', e);
        }
        if (!startMinimized && !(await appWindow.isVisible())) {
          return;
        }
        if (startMinimized) {
          await appWindow.hide();
          console.log('✅ 已根据配置启动后隐藏到系统托盘');
        } else {
          await appWindow.show();
          console.log('✅ 窗口已显示');
        }
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

        if (info.hasUpdate) {
          console.log('🎉 [VersionCheck] 发现新版本:', info.latestVersion);

          // 格式化更新日志
          const formattedMessage = info.updateMessage
            ? versionCheckService.formatUpdateMessage(info.updateMessage)
            : [];
          const updateMessage =
            formattedMessage.length > 0
              ? formattedMessage
              : [
                  tl(
                    '该版本未提供更新日志，请前往官网查看详情。',
                    'No release notes were provided for this version. Visit the website for details.'
                  ),
                ];

          // 设置版本信息并显示弹窗
          setVersionInfo({
            latestVersion: info.latestVersion,
            currentVersion: info.currentVersion,
            updateMessage,
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

  // 应用启动时应用窗口置顶配置（不再根据应用状态动态切换）
  // 窗口置顶状态完全由用户在设置中配置，应用于整个应用生命周期
  // 注意：lib.rs 中已经在应用启动时设置了初始置顶状态，这里不需要重复设置

  // 邀请 deep link：监听后端转发的 URL，解析并预填加入表单（仅填表，不自动连接）
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    const setup = async () => {
      unlisten = await listen<string>('deep-link-join', (event) => {
        try {
          const invite = parseLobbyInviteLink(String(event.payload || ''));
          if (!invite) return;
          (window as any).__deepLinkConfig = {
            lobbyName: invite.name,
            password: invite.password,
            serverNode: invite.serverNode,
            signalingServer: invite.signalingServer,
          };
          window.dispatchEvent(new CustomEvent('mctier-open-join'));
        } catch (e) {
          console.warn('解析 deep link 失败（忽略）:', e);
        }
      });
    };
    void setup();
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

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

  // 开发调试用快捷键：Shift+F1 打开日志文件（内部使用，不对外暴露、不提供自定义）
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      if (!(e.shiftKey && e.key === 'F1')) return;
      e.preventDefault();
      try {
        await invoke('open_log_file');
      } catch (error) {
        console.error('❌ 打开日志文件失败:', error);
      }
    };

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
        try {
          await invoke('clear_avatar_cache');
        } catch (error) {
          console.warn('清理头像缓存时出现警告，继续启动:', error);
        }

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

        // 监听窗口关闭事件
        const appWindow = getCurrentWindow();
        const unlistenClose = await appWindow.onCloseRequested(async () => {
          try {
            const settings = await invoke<{ closeToTray?: boolean }>('get_settings');
            if (settings.closeToTray) {
              console.log('主窗口关闭请求将由后端隐藏到系统托盘，保留通话与前端资源');
              return;
            }
          } catch (error) {
            console.warn('读取关闭到托盘设置失败，按正常退出流程清理资源:', error);
          }

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

          console.log('✅ 前端资源清理完成，等待后端完成退出');
        });

        // 从后端加载用户配置
        try {
          const userConfig = await invoke<UserConfig>('get_config');
          console.log('已加载用户配置');

          // 更新前端store中的配置
          const { updateConfig } = useAppStore.getState();
          updateConfig(userConfig);
        } catch (error) {
          console.warn('加载用户配置失败，使用默认配置:', error);
        }

        // 初始化快捷键管理器
        await hotkeyManager.initialize();

        // 注意：Ctrl+M、Ctrl+T 和 F2 都使用后端的全局快捷键
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
      webrtcClient.cleanup();
    };
  }, [setMicEnabled]);

  // 当进入大厅时初始化WebRTC
  useEffect(() => {
    if (appState === 'in-lobby' && lobby) {
      const initWebRTC = async () => {
        try {
          const sessionTicket =
            lobbySessionCoordinator.current() ?? lobbySessionCoordinator.begin();
          const { currentPlayerId: playerId } = useAppStore.getState();

          if (!playerId) {
            console.error('玩家ID不存在，无法初始化WebRTC');
            return;
          }

          console.log('使用已存在的玩家ID初始化WebRTC:', playerId);

          // 获取玩家名称
          const playerName =
            useAppStore.getState().config.playerName || tl('未知玩家', 'Unknown Player');
          console.log('已读取玩家身份');

          // 在初始化之前先设置版本错误回调
          webrtcClient.onVersionError((currentVersion, minimumVersion) => {
            console.log(
              `WebRTC: 版本错误 - 当前版本: ${currentVersion}, 最低要求: ${minimumVersion}`
            );

            // 设置版本错误信息到store，MiniWindow 会据此显示全屏强制更新提示
            const { setVersionError } = useAppStore.getState();
            setVersionError({ currentVersion, minimumVersion, downloadUrl: DOWNLOAD_WEBSITE });

            // 仅弹提示是不够的：EasyTier 是先于信令启动的，信令拒绝时虚拟网卡已经建好，
            // 而 EasyTier 组网本身不依赖信令，低版本客户端此时仍然连在同一个虚拟局域网里
            // （能 ping 通、能连 Minecraft），只是没有玩家列表和语音。
            // 因此必须主动拆掉组网，才能真正做到「低于最低版本无法组网」。
            // Android 端在同一条分支里调用 leaveLobby()，这里与其保持一致。
            void (async () => {
              try {
                await invoke('leave_lobby');
                console.log('✅ 版本过低：已停止 EasyTier 并退出大厅');
              } catch (error) {
                console.error('❌ 版本过低时退出大厅失败，改为强制停止虚拟网卡:', error);
                // 退出流程失败也不能把网留着，兜底强杀 EasyTier 进程并清理网卡。
                try {
                  await invoke('force_stop_easytier');
                  console.log('✅ 版本过低：已强制停止虚拟网卡');
                } catch (fallbackError) {
                  console.error('❌ 强制停止虚拟网卡也失败:', fallbackError);
                }
              }
              try {
                await invoke('stop_file_server');
              } catch {
                /* 未启动时忽略 */
              }
            })();
          });

          // 初始化WebRTC客户端
          // 从 lobby 对象中获取信令服务器地址，如果没有则使用默认值
          const signalingServer = lobby.signalingServer || 'wss://mctier.pmhs.top/signaling';
          console.log('已准备 WebRTC 连接参数');

          await webrtcClient.initialize(
            playerId,
            playerName,
            lobby.name,
            lobby.password || '',
            undefined,
            lobby.useDomain,
            signalingServer,
            sessionTicket
          );
          lobbySessionCoordinator.assertCurrent(sessionTicket);

          // 初始化屏幕共享服务
          const ws = (webrtcClient as any).websocket; // 获取WebSocket实例
          if (ws) {
            screenShareService.initialize(playerId, playerName, ws);
            console.log('✅ 屏幕共享服务已初始化');
          }

          // 设置事件回调
          webrtcClient.onPlayerJoined(
            (playerId, playerName, virtualIp, virtualDomain, useDomain) => {
              console.log(
                `WebRTC: 玩家加入 - ${playerName} (${playerId}), 虚拟IP: ${virtualIp || '未知'}, 虚拟域名: ${virtualDomain || '未设置'}, 使用域名: ${useDomain || false}`
              );
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
            }
          );

          webrtcClient.onPlayerLeft((playerId) => {
            console.log(`WebRTC: 玩家离开 - ${playerId}`);
            removePlayer(playerId);
            // 移除该玩家的说话检测
            speakingDetector.detach(playerId);
          });

          webrtcClient.onStatusUpdate((playerId, micEnabled) => {
            console.log(`WebRTC: 状态更新 - ${playerId}, 麦克风: ${micEnabled}`);
            updatePlayerStatus(playerId, { micEnabled });
          });

          // 说话状态检测：分析结果写入 store，用于 UI 高亮
          speakingDetector.setCallback((playerId, speaking) => {
            setPlayerSpeaking(playerId, speaking);
          });

          webrtcClient.onRemoteStream((playerId, stream) => {
            console.log(`WebRTC: 接收到远程音频流 - ${playerId}`);
            // 接入远程流做说话检测（只读分析，不影响播放）
            try {
              speakingDetector.attach(playerId, stream);
            } catch (e) {
              console.warn('说话检测接入失败:', e);
            }
          });

          // 本机麦克风流变化：开启时接入检测，关闭时移除并清除自身说话状态
          webrtcClient.onLocalStream((stream) => {
            const selfId = useAppStore.getState().currentPlayerId;
            if (!selfId) return;
            if (stream) {
              try {
                speakingDetector.attach(selfId, stream);
              } catch (e) {
                console.warn('本机说话检测接入失败:', e);
              }
            } else {
              speakingDetector.detach(selfId);
            }
          });

          webrtcClient.onChatMessage((playerId, playerName, content, timestamp) => {
            console.log('WebRTC: 收到聊天消息');
            addChatMessage({
              id: `${playerId}-${timestamp}`,
              playerId,
              playerName,
              content,
              timestamp,
            });

            // 如果不是自己发的消息，且不在聊天室界面，按 @ 提及规则播放新消息音效
            if (playerId !== currentPlayerId) {
              const isInChatRoom = (window as any).__isInChatRoom__ || false;
              const myName = (useAppStore.getState().config.playerName || '').trim();
              const mentionRegex = /@([^\s@]{1,20})/g;
              const mentioned: string[] = [];
              let mm: RegExpExecArray | null;
              while ((mm = mentionRegex.exec(content)) !== null) mentioned.push(mm[1]);
              const hasMention = mentioned.length > 0;
              const mentionsEveryone = mentioned.some(
                (n) => n === '所有人' || n === '全体' || n.toLowerCase() === 'all'
              );
              const mentionsMe = !!myName && mentioned.some((n) => n === myName);
              const shouldNotify = !hasMention || mentionsEveryone || mentionsMe;
              if (!isInChatRoom && shouldNotify) {
                console.log('播放新消息音效...');
                audioService.play('newMessage').catch((err) => {
                  console.error('播放新消息音效失败:', err);
                });
              }
            }
          });

          // ==================== 房主/大厅管理回调 ====================
          webrtcClient.onLobbyMeta((meta) => {
            const store = useAppStore.getState();
            if (meta.hostId !== undefined) store.setHostId(meta.hostId);
            if (meta.maxPlayers !== undefined) store.setMaxPlayers(meta.maxPlayers);
            if (meta.isPublic !== undefined) store.setIsPublicLobby(meta.isPublic);
            if (meta.mutedPlayers) store.setHostMutedPlayers(meta.mutedPlayers);
          });

          webrtcClient.onHostChanged((hostId) => {
            useAppStore.getState().setHostId(hostId);
            if (hostId === useAppStore.getState().currentPlayerId) {
              try {
                (window as any).__antdMessage?.success?.(
                  tl('你已成为房主', 'You are now the host')
                );
              } catch {
                /* ignore */
              }
            }
          });

          webrtcClient.onMuteChanged((playerId, muted) => {
            useAppStore.getState().setHostMuted(playerId, muted);
          });

          webrtcClient.onLobbyOptionsChanged((maxPlayers, isPublic) => {
            const store = useAppStore.getState();
            store.setMaxPlayers(maxPlayers);
            store.setIsPublicLobby(isPublic);
          });

          webrtcClient.onKicked((reason) => {
            // 被踢出：通知并触发退出大厅
            try {
              window.dispatchEvent(new CustomEvent('mctier-kicked', { detail: { reason } }));
            } catch {
              /* ignore */
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
  }, [appState, lobby, addPlayer, removePlayer, updatePlayerStatus, addChatMessage]);

  // 监听窗口位置变化并保存
  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const savePosition = async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const window = getCurrentWindow();
        const position = await window.outerPosition();
        const size = await window.outerSize();

        await invoke('save_window_position', {
          x: position.x,
          y: position.y,
          width: size.width,
          height: size.height,
        });
      } catch (error) {
        console.error('保存窗口位置失败:', error);
      }
    };

    const handleMove = () => {
      // 防抖：窗口移动停止 500ms 后再保存
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      timeoutId = setTimeout(savePosition, 500);
    };

    // 监听窗口移动事件
    let unlisten: (() => void) | null = null;
    const setupListener = async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const window = getCurrentWindow();
        unlisten = await window.onMoved(handleMove);
      } catch (error) {
        console.error('设置窗口移动监听失败:', error);
      }
    };

    setupListener();

    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  return (
    <ErrorBoundary>
      <ConfigProvider
        locale={getLanguage() === 'en' ? enUS : zhCN}
        theme={{
          algorithm: effectiveTheme === 'dark' ? theme.darkAlgorithm : theme.defaultAlgorithm,
          token: {
            colorPrimary: '#52c41a',
            colorSuccess: '#52c41a',
            colorWarning: '#f59e0b',
            colorError: '#ef4444',
            borderRadius: 8,
            colorBgContainer: effectiveTheme === 'dark' ? 'rgba(30, 30, 45, 0.95)' : '#ffffff',
            colorBorder:
              effectiveTheme === 'dark' ? 'rgba(255, 255, 255, 0.1)' : 'rgba(24, 32, 43, 0.16)',
            colorText: effectiveTheme === 'dark' ? 'rgba(255, 255, 255, 0.9)' : '#18202b',
            colorTextSecondary: effectiveTheme === 'dark' ? 'rgba(255, 255, 255, 0.6)' : '#596574',
            fontFamily:
              '-apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif',
          },
        }}
      >
        <AntdApp>
          <GlobalTooltip />
          <GlobalButtonTheme />
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

          <Modal
            className="microphone-permission-modal"
            open={showMicrophonePermissionHelp}
            title={tl('麦克风权限未授予', 'Microphone permission is not granted')}
            onCancel={() => setShowMicrophonePermissionHelp(false)}
            footer={
              <div className="microphone-permission-actions">
                <Button onClick={() => void invoke('open_microphone_privacy_settings')}>
                  {tl('打开 Windows 麦克风设置', 'Open Windows microphone settings')}
                </Button>
                <Button type="primary" onClick={() => void invoke('reset_microphone_permission')}>
                  {tl('一键重置并重启', 'Reset and restart')}
                </Button>
              </div>
            }
            centered
            width={460}
          >
            <p>
              {tl(
                '如果首次申请时选择了拒绝，WebView2 可能不会再次弹出授权窗口。可先检查 Windows 麦克风隐私设置；仍无法授权时，点击“一键重置并重启”，MCTier 会清理自身的 EBWebView 权限缓存并重新申请。',
                'If access was denied the first time, WebView2 may not show the prompt again. Check Windows microphone privacy settings first. If that does not help, reset and restart MCTier to clear its EBWebView permission cache and request access again.'
              )}
            </p>
            <p style={{ opacity: 0.68, marginBottom: 0 }}>
              {tl(
                '重置只会清理 MCTier 的 WebView2 浏览数据，不会删除大厅配置。',
                'The reset only clears MCTier WebView2 browsing data. Lobby settings are preserved.'
              )}
            </p>
          </Modal>
        </AntdApp>
      </ConfigProvider>
    </ErrorBoundary>
  );
}

export default App;
