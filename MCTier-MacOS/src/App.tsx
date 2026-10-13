import { useEffect, useState } from 'react';
import { ConfigProvider, theme, App as AntdApp, Button, Modal, message } from 'antd';
import { FeedbackHost } from './components/FeedbackHost/FeedbackHost';
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
import { speakingDetector } from './services/voice/SpeakingDetector';
import { useStartupUpdates, startupVersionStage } from './services/version/startupUpdates';
import { DOWNLOAD_WEBSITE } from './services/version/versionPolicy';
import { parseLobbyInviteLink } from './services/lobby/lobbyInvite';
import { lobbySessionCoordinator } from './services/lobby/LobbySessionCoordinator';
import { recoverVirtualAddress, isVirtualIpConflict } from './services/lobby/virtualAddressRecovery';
import type { UserConfig } from './types';
import {
  THEME_CHANGED_EVENT,
  THEME_STORAGE_KEY,
  isThemePreference,
  readThemePreference,
  resolveTheme,
  type ThemePreference,
} from './theme/themePreference';
import { isSafeResourceId, sanitizeUntrustedText } from './security/trustBoundary';
import { useWindowLayout } from './hooks';
import { applyWindowLayout, currentWindowLayout } from './utils/windowLayout';
import { isMacOSPlatform } from './utils/platform';
import './App.css';
import { syncBuiltinEmojiItems } from './services/emoji/emojiLibrary';
import { NativeCapturePicker } from './components/NativeCapture/NativeCapture';
import { ScreenRecordingExitHandler } from './components/RoomTools/ScreenRecording';
import { startQuarkSupport } from './services/quarkSupport';
import { QuarkStartupPrompt } from './components/QuarkSupport/QuarkStartupPrompt';
import { DesktopComplianceGate } from './components/ComplianceGate/ComplianceGate';
import './components/ComplianceGate/ComplianceGate.css';

// 模块加载时同步写入形态标记，避免首帧缺少 macOS 安全区/内边距导致的布局跳动：
// data-platform 由这里判定，data-layout 先按当前窗口宽度落一个初值，
// 之后由 useWindowLayout 跟随窗口缩放实时更新。
if (typeof document !== 'undefined' && typeof navigator !== 'undefined') {
  document.documentElement.dataset.platform = isMacOSPlatform ? 'macos' : 'other';
  applyWindowLayout(currentWindowLayout());
}

function App() {
  useWindowLayout();
  const search = window.location.search;
  if (search.includes('danmaku=true')) return <DanmakuOverlay />;
  if (search.includes('gamehud=true')) return <GameHudOverlay />;
  if (search.includes('screen-viewer=true')) return <ScreenViewerWindow />;
  if (getCurrentWindow().label === 'main') return <DesktopComplianceGate><MainWindowApp /></DesktopComplianceGate>;
  return <MainWindowApp />;
}

function useLanguagePreference(): void {
  useEffect(() => {
    void invoke<{ language?: LanguagePreference }>('get_settings')
      .then((settings) => setLanguagePreference(settings.language ?? getLanguagePreference()))
      .catch((error) => console.error('读取语言设置失败:', error));
  }, []);
}

function useResolvedTheme(): ThemePreference {
  const [themePreference, setThemePreference] = useState<ThemePreference>(readThemePreference);
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches
  );
  const effectiveTheme = resolveTheme(themePreference, systemDark);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handleSystemTheme = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    const handlePreference = (event: Event) => {
      const preference = (event as CustomEvent<unknown>).detail;
      if (isThemePreference(preference)) setThemePreference(preference);
    };
    media.addEventListener('change', handleSystemTheme);
    window.addEventListener(THEME_CHANGED_EVENT, handlePreference);
    const handleStorage = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY && isThemePreference(event.newValue)) setThemePreference(event.newValue);
    };
    window.addEventListener('storage', handleStorage);
    return () => {
      media.removeEventListener('change', handleSystemTheme);
      window.removeEventListener(THEME_CHANGED_EVENT, handlePreference);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = effectiveTheme;
    document.documentElement.style.colorScheme = effectiveTheme;
  }, [effectiveTheme]);

  return effectiveTheme;
}

function ScreenViewerWindow() {
  useLanguagePreference();
  const effectiveTheme = useResolvedTheme();
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

function MainWindowApp() {
  const [quarkBlocking, setQuarkBlocking] = useState(true);
  useEffect(() => { if (getCurrentWindow().label === 'main') void startQuarkSupport(); }, []);
  useEffect(() => {
    void syncBuiltinEmojiItems().catch(error => console.warn('启动时准备内置表情失败，可在表情面板重试:', error));
  }, []);
  useLanguagePreference();
  const effectiveTheme = useResolvedTheme();
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

  const versionError = useAppStore((state) => state.versionError);
  const { checked: updateChecked, update: versionInfo, dismiss: dismissUpdate } = useStartupUpdates();
  const versionStage = startupVersionStage(!!versionError, updateChecked, !!versionInfo);

  useEffect(() => {
    const showHelp = () => setShowMicrophonePermissionHelp(true);
    window.addEventListener('mctier-microphone-permission-required', showHelp);
    return () => window.removeEventListener('mctier-microphone-permission-required', showHelp);
  }, []);

  // 全局快捷键注册失败（键位被系统或其它软件占用）时给出明确提示。否则用户在设置里
  // 改了键却按下无效，根本不知道是被占用了。macOS 常见于 Ctrl+ 组合被系统服务占用。
  useEffect(() => {
    type HotkeyFailure = { action: string; hotkey: string; error: string };
    const actionLabel: Record<string, string> = {
      mic: tl('麦克风开关', 'Toggle Microphone'),
      global_mute: tl('全局听筒', 'Toggle Speaker'),
      push_to_talk: tl('临时开麦', 'Push to Talk'),
      summon: tl('唤出窗口', 'Summon Window'),
    };
    let unlisten: (() => void) | undefined;
    void listen<HotkeyFailure[]>('hotkey-registration-failed', (event) => {
      const failures = event.payload || [];
      for (const f of failures) {
        const label = actionLabel[f.action] ?? f.action;
        message.warning(
          tl(
            `快捷键「${label}」(${f.hotkey}) 注册失败，可能已被系统或其它软件占用，请在设置中换一个键位`,
            `Hotkey for "${label}" (${f.hotkey}) failed to register — it may be taken by the system or another app. Pick another in Settings.`
          )
        );
      }
    }).then((off) => { unlisten = off; });
    return () => { if (unlisten) unlisten(); };
  }, []);

  // 同步系统托盘菜单文本到当前界面语言（启动时 + 语言切换时）
  useEffect(() => {
    const syncTray = async () => {
      try {
        await invoke('set_tray_menu_texts', {
          showText: tl('显示 MCTier', 'Show MCTier'),
          exitText: tl('退出 MCTier', 'Exit MCTier'),
          notificationTitle: tl('MCTier 正在后台运行', 'MCTier is running in the background'),
          // macOS 的托盘在菜单栏，窗口隐藏后 Dock 图标同样能唤回，文案按平台区分。
          notificationBody: isMacOSPlatform
            ? tl(
                'MCTier 已隐藏到菜单栏。点击菜单栏图标、Dock 图标或按 {shortcut} 可恢复窗口。',
                'MCTier is hidden in the menu bar. Click the menu bar icon, the Dock icon, or press {shortcut} to restore it.'
              )
            : tl(
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

  // macOS 应用菜单栏事件：后端把菜单点击转成 Tauri 事件，这里再转成 window
  // 事件交给 MainWindow 打开对应浮层；配置变更（菜单里勾选）则刷新前端配置。
  useEffect(() => {
    const unlisteners: Array<() => void> = [];
    const setup = async () => {
      unlisteners.push(
        await listen('menu-open-settings', () => {
          window.dispatchEvent(new CustomEvent('mctier-menu-settings'));
        })
      );
      unlisteners.push(
        await listen('menu-open-about', () => {
          window.dispatchEvent(new CustomEvent('mctier-menu-about'));
        })
      );
      unlisteners.push(
        await listen('menu-config-changed', async () => {
          try {
            const userConfig = await invoke<UserConfig>('get_config');
            useAppStore.getState().updateConfig(userConfig);
          } catch (error) {
            console.warn('菜单变更后刷新配置失败:', error);
          }
        })
      );
    };
    void setup();
    return () => {
      unlisteners.forEach((off) => off());
    };
  }, []);

  // macOS Dock 角标：按未读会话数更新 Dock 图标角标，隐藏到菜单栏时也能看到新消息。
  // 其它平台的命令是空操作，这里按平台跳过以免无谓的 IPC。
  const unreadConversationCount = useAppStore(
    (state) => Object.keys(state.unreadChatMessages).length
  );
  useEffect(() => {
    if (!isMacOSPlatform) return;
    void invoke('set_dock_badge', { count: unreadConversationCount }).catch((error) => {
      console.warn('更新 Dock 角标失败:', error);
    });
  }, [unreadConversationCount]);

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
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        e.stopPropagation();
        window.dispatchEvent(new Event('mctier-open-chat-search'));
        return;
      }
      if (!(e.shiftKey && e.key === 'F1')) return;
      e.preventDefault();
      try {
        await invoke('open_log_file');
      } catch (error) {
        console.error('❌ 打开日志文件失败:', error);
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
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

        // macOS 的原生交通灯/系统窗口事件由 Rust/Tauri 统一处理，避免 React
        // 再注册一个 close handler 与原生 CloseRequested 竞态。
        const isMacOS = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
        const unlistenClose = isMacOS
          ? () => {}
          : await getCurrentWindow().onCloseRequested(async () => {
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
    if ((appState === 'connecting' || appState === 'in-lobby') && lobby) {
      const initWebRTC = async () => {
        const sessionTicket =
          lobbySessionCoordinator.current() ?? lobbySessionCoordinator.begin();
        let handlingFailure = false;
        let recoveryLobby = lobby;
        const handleRegistrationFailure = async (error: unknown) => {
          if (handlingFailure || !lobbySessionCoordinator.isCurrent(sessionTicket)) return;
          handlingFailure = true;
          console.error('❌ WebRTC 初始化失败:', error);
          if (lobbySessionCoordinator.isCurrent(sessionTicket) && !useAppStore.getState().versionError) {
            let detail = error instanceof Error ? error.message : String(error);
            let stopped = false;
            // EasyTier starts before WebSocket registration. A failed registration
            // must release that session, not just the browser's WebRTC resources.
            try {
              await webrtcClient.cleanup();
              if (!lobbySessionCoordinator.isCurrent(sessionTicket)) return;
              await invoke('leave_lobby');
              stopped = true;
            } catch (cleanupError) {
              console.error('注册失败后清理组网会话失败:', cleanupError);
              detail += tl('；组网会话清理失败，请退出大厅后重试', '; Network cleanup failed; leave the lobby and retry');
            }
            if (!lobbySessionCoordinator.isCurrent(sessionTicket)) return;
            if (stopped && lobby.automaticVirtualIp && lobby.serverNode) {
              try {
                const store = useAppStore.getState();
                const replacement = await recoverVirtualAddress(recoveryLobby, detail, (addressAttempt) =>
                  invoke('join_lobby', {
                    name: lobby.name, password: lobby.password || '',
                    playerName: store.config.playerName, playerId: store.currentPlayerId,
                    serverNode: lobby.serverNode,
                    signalingServer: lobby.signalingServer || 'wss://mctier.pmhs.top/signaling',
                    useDomain: lobby.useDomain === true, addressAttempt,
                  }), () => lobbySessionCoordinator.isCurrent(sessionTicket));
                if (!lobbySessionCoordinator.isCurrent(sessionTicket)) return;
                if (replacement) {
                  store.setSignalingStatus('connecting');
                  store.setLobby(replacement);
                  return;
                }
              } catch (retryError) {
                detail = retryError instanceof Error ? retryError.message : String(retryError);
              }
            } else if (lobby.automaticVirtualIp === false && isVirtualIpConflict(detail)) {
              detail += tl('；请清空高级设置中的手动 IPv4 后重试', '; Clear the manual IPv4 in advanced settings and retry');
            }
            if (!lobbySessionCoordinator.isCurrent(sessionTicket)) return;
            useAppStore.getState().setSignalingStatus('failed', sanitizeUntrustedText(
              detail, 1024
            ));
          }
        };
        try {
          const { currentPlayerId: playerId } = useAppStore.getState();

          if (!playerId) {
            throw new Error(tl('玩家身份未就绪，无法注册大厅', 'Player identity is not ready'));
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
            const { setVersionError, clearLobby, setAppState } = useAppStore.getState();
            setVersionError({ currentVersion, minimumVersion, downloadUrl: DOWNLOAD_WEBSITE });

            // 清理前端大厅状态，否则 MiniWindow 仍在位、轮询定时器继续对已停止的后端发 RPC
            clearLobby();
            setAppState('idle');

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

          // Register observers before initialize(): it consumes register-success
          // and the first roster before resolving.
          webrtcClient.onSignalingStatus((status, error) => {
            if (lobbySessionCoordinator.isCurrent(sessionTicket)) {
              if (status === 'failed' && error) {
                void handleRegistrationFailure(new Error(error));
                return;
              }
              if (status === 'connected') recoveryLobby = { ...recoveryLobby, entryMode: 'auto', addressRecoveryStartedAt: undefined };
              useAppStore.getState().setSignalingStatus(status, error);
            }
          });
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
            const store = useAppStore.getState();
            store.setHostMuted(playerId, muted);
            if (muted && playerId === store.currentPlayerId) store.setMicEnabled(false);
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

          const signalingServer = lobby.signalingServer || 'wss://mctier.pmhs.top/signaling';
          await webrtcClient.initialize(
            playerId, playerName, lobby.name, lobby.password || '',
            undefined, lobby.useDomain, signalingServer, sessionTicket, lobby.entryMode ?? 'join'
          );
          lobbySessionCoordinator.assertCurrent(sessionTicket);

          if (useAppStore.getState().appState === 'connecting') {
            useAppStore.getState().setAppState('in-lobby');
          }

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
          await handleRegistrationFailure(error);
        }
      };

      initWebRTC();
    }
    // 注意：不在这里添加cleanup，因为退出大厅时会在MiniWindow中手动调用cleanup
    // 这样可以确保cleanup在正确的时机执行，避免状态不一致
  }, [appState === 'connecting' || appState === 'in-lobby', lobby, addPlayer, removePlayer, updatePlayerStatus, addChatMessage]);

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
          <FeedbackHost />
          <NativeCapturePicker />
          <ScreenRecordingExitHandler />
          <GlobalTooltip />
          <GlobalButtonTheme />
          <div className="app-container">
            {/* 根据应用状态显示不同的界面 */}
            {appState === 'in-lobby' && lobby ? <MiniWindow /> : <MainWindow startupReady={!quarkBlocking && versionStage === 'ready'} />}
          </div>

          {/* 版本更新提示弹窗 */}
          <QuarkStartupPrompt blocked={versionStage !== 'ready'} onBlockingChange={setQuarkBlocking} />
          {versionInfo && (
            <VersionUpdateModal
              visible={versionStage === 'optional'}
              latestVersion={versionInfo.latestVersion}
              currentVersion={versionInfo.currentVersion}
              updateMessage={versionInfo.updateMessage}
              onClose={dismissUpdate}
            />
          )}

          <Modal
            className="microphone-permission-modal"
            open={showMicrophonePermissionHelp}
            title={tl('无法使用麦克风', 'Microphone unavailable')}
            onCancel={() => setShowMicrophonePermissionHelp(false)}
            footer={
              <div className="microphone-permission-actions">
                <Button onClick={() => void invoke('open_microphone_privacy_settings')}>
                  {tl(
                    navigator.platform.includes('Mac') ? '打开 macOS 麦克风设置' : '打开 Windows 麦克风设置',
                    navigator.platform.includes('Mac') ? 'Open macOS Microphone Settings' : 'Open Windows microphone settings'
                  )}
                </Button>
                <Button type="primary" onClick={() => setShowMicrophonePermissionHelp(false)}>
                  {tl(
                    navigator.platform.includes('Mac') ? '我已授权，关闭' : '知道了',
                    navigator.platform.includes('Mac') ? "I've granted — close" : 'Got it'
                  )}
                </Button>
              </div>
            }
            centered
            width={460}
          >
            <p>
              {navigator.platform.includes('Mac')
                ? tl(
                    '请在系统设置 > 隐私与安全性 > 麦克风中允许 MCTier，然后返回应用重试。macOS 权限由系统管理，应用不会删除系统 WebView 数据。',
                    'Allow MCTier under System Settings > Privacy & Security > Microphone, then return and retry. macOS manages this permission and the app will not delete system WebView data.'
                  )
                : tl(
                    '请检查麦克风是否连接、是否被其它程序独占，以及 Windows 是否允许桌面应用访问麦克风。修复后重新点击开麦或录音即可，无需重置软件。',
                    'Check that your microphone is connected, is not exclusively used by another app, and Windows allows desktop apps to access it. Then try the microphone or recording again; no app reset is needed.'
                  )}
            </p>
            {navigator.platform.includes('Mac') && (
              <p style={{ opacity: 0.68, marginBottom: 0 }}>
                {tl(
                  '更改权限后可能需要重新启动应用或再次发起语音请求。',
                  'After changing the permission, restart the app or retry the voice request.'
                )}
              </p>
            )}
          </Modal>
        </AntdApp>
      </ConfigProvider>
    </ErrorBoundary>
  );
}

export default App;
