﻿import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';
import { Modal, Spin, Tooltip, QRCode, App as AntdApp } from 'antd';import { open } from '@tauri-apps/plugin-shell';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { useAppStore } from '../../stores';
import { webrtcClient } from '../../services';
import { audioService } from '../../services';
import { p2pChatService } from '../../services/chat/P2PChatService';
import { speakingDetector } from '../../services/voice/SpeakingDetector';
import { playerVolumeMemory } from '../../services/voice/playerVolumeMemory';
import { recentService } from '../../services/recent/recentService';
import { versionCheckService } from '../../services/version/VersionCheckService';
import { listen } from '@tauri-apps/api/event';
import type { ChatMessage } from '../../types';
import { PlayerIcon, MicIcon, SpeakerIcon, CloseCircleIcon, CollapseIcon, CloseIcon, WarningTriangleIcon, InfoIcon, ScreenShareIcon, CrownIcon, GlobeIcon } from '../icons';
import { ChatRoom } from '../ChatRoom/ChatRoom';
import { FileShareManagerNew } from '../FileShareManager/FileShareManagerNew';
import { ScreenShareManager } from '../ScreenShareManager/ScreenShareManager';
import { LobbySettingsModal } from '../LobbySettingsModal/LobbySettingsModal';
import { MinecraftWorldsModal } from '../MinecraftWorlds/MinecraftWorldsModal';
import { RoomTools } from '../RoomTools/RoomTools';
import { HostPanel } from '../HostPanel/HostPanel';
import './MiniWindow.css';

/**
 * 迷你窗口组件
 * 显示精简的大厅信息和语音控制
 */
export const MiniWindow: React.FC = () => {
  const {
    lobby,
    players,
    micEnabled,
    globalMuted,
    mutedPlayers,
    speakingPlayers,
    toggleGlobalMute,
    togglePlayerMute,
    config,
    versionError,
    chatMessages,
    currentPlayerId,
    addChatMessage,
    setPlayerVolume,
    getPlayerVolume,
    hostId,
    hostMutedPlayers,
    maxPlayers,
    announcement,
    setAnnouncement,
    myVoiceGroup,
    setMyVoiceGroup,
    playerVoiceGroups,
  } = useAppStore();

  const isHost = !!currentPlayerId && hostId === currentPlayerId;

  // 新玩家加入时，房主补发公告、各成员补发自己的语音小队，确保新人状态一致
  const prevPlayerCountRef = React.useRef(0);
  useEffect(() => {
    const count = players.length;
    if (count > prevPlayerCountRef.current && prevPlayerCountRef.current > 0) {
      const t = setTimeout(() => {
        if (isHost && announcement) void p2pChatService.sendControlMessage('announce', announcement);
        if (myVoiceGroup !== 0) void p2pChatService.sendControlMessage('voicegroup', String(myVoiceGroup));
      }, 1600);
      prevPlayerCountRef.current = count;
      return () => clearTimeout(t);
    }
    prevPlayerCountRef.current = count;
  }, [players.length, isHost, announcement, myVoiceGroup]);

  const { message, modal } = AntdApp.useApp();

  const [collapsed, setCollapsed] = useState(false);
  const [opacity, setOpacity] = useState(config.opacity ?? 0.95);
  const [isLeaving, setIsLeaving] = useState(false);
  const [showConnectionHelp, setShowConnectionHelp] = useState(false);
  const [currentView, setCurrentView] = useState<'lobby' | 'chat' | 'fileShare' | 'screenShare'>('lobby');
  const [chatOpenedWhenCollapsed, setChatOpenedWhenCollapsed] = useState(false); // 记录打开聊天室时窗口是否处于收起状态
  const [showLobbySettings, setShowLobbySettings] = useState(false); // 控制动态设置弹窗显示
  const [showMcWorlds, setShowMcWorlds] = useState(false); // 局域网世界发现弹窗
  const [showRoomTools, setShowRoomTools] = useState(false); // 房间小工具弹窗
  const [showQrModal, setShowQrModal] = useState(false); // 大厅二维码弹窗(供手机扫码加入)
  const [showHostPanel, setShowHostPanel] = useState(false); // 房主管理面板
  const [peerLatencies, setPeerLatencies] = useState<Record<string, number | null>>({}); // 各玩家虚拟IP->延迟ms
  const [isRejoining, setIsRejoining] = useState(false); // 控制重新加入大厅的加载提示
  
  // 跟踪上次查看聊天室时的消息数量（只计算其他人的消息）
  const [lastViewedOthersMessageCount, setLastViewedOthersMessageCount] = useState(0);
  
  // 计算其他人发送的消息数量
  const othersMessages = chatMessages.filter(msg => msg.playerId !== currentPlayerId);
  const othersMessageCount = othersMessages.length;
  
  // 计算未读消息数量（只计算其他人的消息）
  const unreadCount = Math.max(0, othersMessageCount - lastViewedOthersMessageCount);
  
  // 调试日志 - 详细打印未读消息统计
  useEffect(() => {
    console.log('📊 [MiniWindow] 未读消息统计:', {
      currentPlayerId,
      totalMessages: chatMessages.length,
      othersMessageCount,
      lastViewedOthersMessageCount,
      unreadCount,
      hasUnreadMessages: unreadCount > 0,
      currentView,
      collapsed,
    });
    
    // 打印最近的几条消息
    if (chatMessages.length > 0) {
      console.log('📝 [MiniWindow] 最近的消息:', chatMessages.slice(-3).map(m => ({
        id: m.id,
        playerId: m.playerId,
        playerName: m.playerName,
        content: m.content.substring(0, 20),
        timestamp: new Date(m.timestamp).toLocaleTimeString(),
      })));
    }
  }, [chatMessages.length, unreadCount, currentView, collapsed]);



  // 监听版本错误（不自动跳转，保持在大厅界面显示错误提示）
  useEffect(() => {
    if (versionError) {
      console.log('检测到版本错误，显示更新提示界面');
    }
  }, [versionError]);

  // 组件加载时从配置中读取透明度并设置（进入大厅）
  // 组件卸载时恢复完全不透明（退出大厅）
  useEffect(() => {
    const setupOpacity = async () => {
      try {
        // 从配置中获取透明度，如果没有则使用默认值0.95
        const initialOpacity = config.opacity ?? 0.95;
        setOpacity(initialOpacity);
        
        // 设置窗口透明度
        await invoke('set_window_opacity', { opacity: initialOpacity });
        console.log('进入大厅，透明度已设置为:', initialOpacity);
      } catch (error) {
        console.error('设置透明度失败:', error);
      }
    };

    setupOpacity();

    // 组件卸载时恢复完全不透明
    return () => {
      const restoreOpacity = async () => {
        try {
          await invoke('set_window_opacity', { opacity: 1.0 });
          console.log('退出大厅，透明度已恢复为完全不透明');
        } catch (error) {
          console.error('恢复透明度失败:', error);
        }
      };
      restoreOpacity();
    };
  }, [config.opacity]);

  // 进入大厅时取消全局静音（听筒默认开启）
  useEffect(() => {
    if (globalMuted) {
      console.log('进入大厅，自动开启听筒');
      toggleGlobalMute();
    }
  }, []); // 只在组件挂载时执行一次

  // 初始化P2P聊天服务 - 在大厅界面就启动，不需要打开聊天室
  // 【修复】移除players依赖，避免玩家列表更新时重复初始化
  useEffect(() => {
    if (!lobby || !currentPlayerId) {
      console.log('⚠️ 大厅或玩家ID未就绪，跳过P2P聊天服务初始化');
      return;
    }

    console.log('🚀 [MiniWindow] 初始化P2P聊天服务（仅初始化一次）');
    console.log('  - 当前玩家ID:', currentPlayerId);
    console.log('  - 自己的虚拟IP:', lobby.virtualIp);

    // 设置消息接收回调（只设置一次）
    p2pChatService.onMessage((message) => {
      console.log('📨 [MiniWindow] 收到P2P消息:', message);
      
      // 查找发送者名称
      let senderName = '未知玩家';
      if (message.playerId === currentPlayerId) {
        senderName = config.playerName || '我';
      } else {
        // 从当前的players列表中查找
        const currentPlayers = useAppStore.getState().players;
        const sender = currentPlayers.find(p => p.id === message.playerId);
        senderName = sender?.name || '未知玩家';
      }

      // 添加到消息列表
      const chatMessage: ChatMessage = {
        id: message.id,
        playerId: message.playerId,
        playerName: senderName,
        content: message.content,
        timestamp: message.timestamp,
        type: message.type,
        imageData: message.imageData,
      };
      
      addChatMessage(chatMessage);
      
      // 消息提示音逻辑（支持 @ 提及）：
      // - 自己发的消息：不响
      // - 消息中没有 @ 任何人：所有人都响（不在聊天室时）
      // - 消息 @ 了人：仅被 @ 的人（或 @所有人/@全体）响，其他人收到但不响
      if (message.playerId !== currentPlayerId) {
        const content = message.content || '';
        const myName = (config.playerName || '').trim();
        const mentionRegex = /@([^\s@]{1,20})/g;
        const mentioned: string[] = [];
        let m: RegExpExecArray | null;
        while ((m = mentionRegex.exec(content)) !== null) {
          mentioned.push(m[1]);
        }
        const hasMention = mentioned.length > 0;
        const mentionsEveryone = mentioned.some((n) => n === '所有人' || n === '全体' || n.toLowerCase() === 'all');
        const mentionsMe = !!myName && mentioned.some((n) => n === myName);
        // 是否应当触发提示音
        const shouldNotify = !hasMention || mentionsEveryone || mentionsMe;

        if (shouldNotify && !(window as any).__isInChatRoom__) {
          console.log('🔔 [MiniWindow] 触发新消息提示音', { hasMention, mentionsMe, mentionsEveryone });
          audioService.play('newMessage').catch((err) => {
            console.error('播放新消息提示音失败:', err);
          });
        } else {
          console.log('🔕 [MiniWindow] 不触发提示音（未被@或在聊天室）', { hasMention, mentionsMe, mentionsEveryone });
        }
      }
    });

    return () => {
      // 停止轮询
      p2pChatService.stopPolling();
      console.log('✅ [MiniWindow] 已停止P2P聊天服务轮询');
    };
  }, [lobby, currentPlayerId, config.playerName, addChatMessage]);

  // 【新增】单独监听玩家列表变化，动态更新SSE连接
  useEffect(() => {
    if (!lobby || !currentPlayerId || players.length === 0) {
      return;
    }

    // 获取所有玩家的虚拟IP（不包括自己）
    const playerIPs = players.map(p => p.virtualIp).filter(Boolean) as string[];
    
    console.log('🔄 [MiniWindow] 玩家列表变化，更新P2P聊天连接');
    console.log('  - 其他玩家IPs:', playerIPs);

    // 初始化P2P聊天服务（传入自己的虚拟IP用于过滤）
    p2pChatService.initialize(playerIPs, currentPlayerId, lobby.virtualIp);

    // 开始轮询消息
    p2pChatService.startPolling();
    // 同步聊天历史（新加入的玩家可补齐进房前的聊天记录；已收到的消息会按ID去重）
    void p2pChatService.syncHistory(playerIPs);
    // 记录一起联机过的玩家（最近玩家列表）
    try {
      recentService.recordPlayers(players.map(p => p.name).filter(Boolean));
    } catch (e) {
      console.warn('记录最近玩家失败（忽略）:', e);
    }

    // 恢复按玩家名记忆的音量（仅当 store 尚无该玩家音量设置时）
    try {
      const currentVolumes = useAppStore.getState().playerVolumes;
      players.forEach((p) => {
        if (!p.name || p.id === currentPlayerId) return;
        if (currentVolumes.has(p.id)) return;
        const remembered = playerVolumeMemory.get(p.name);
        if (typeof remembered === 'number' && remembered !== 1.0) {
          setPlayerVolume(p.id, remembered);
        }
      });
    } catch (e) {
      console.warn('恢复记忆音量失败（忽略）:', e);
    }
    console.log('✅ [MiniWindow] P2P聊天服务已更新连接');
  }, [players.length, lobby?.virtualIp, currentPlayerId]);

  // 【新增】周期性测量到各玩家的延迟，用于连接质量显示（每5秒一次）
  useEffect(() => {
    if (!lobby || players.length === 0) {
      setPeerLatencies({});
      return;
    }
    let cancelled = false;
    const measure = async () => {
      const ips = players.map(p => p.virtualIp).filter(Boolean) as string[];
      if (ips.length === 0) return;
      try {
        const results = await invoke<{ ip: string; latencyMs: number | null }[]>(
          'measure_peers_latency',
          { peerIps: ips }
        );
        if (cancelled) return;
        const map: Record<string, number | null> = {};
        results.forEach(r => { map[r.ip] = r.latencyMs; });
        setPeerLatencies(map);
      } catch (error) {
        console.warn('测量延迟失败（忽略）:', error);
      }
    };
    void measure();
    const timer = window.setInterval(() => void measure(), 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [players.length, lobby?.virtualIp]);

  // 监听ESC键返回大厅
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (currentView === 'chat') {
          setCurrentView('lobby');
          // 标记所有其他人的消息为已读
          setLastViewedOthersMessageCount(othersMessageCount);
        } else if (currentView === 'fileShare') {
          setCurrentView('lobby');
        } else if (currentView === 'screenShare') {
          setCurrentView('lobby');
        }
      }
    };

    // 监听来自ChatRoom的标记已读事件
    const handleMarkAsRead = () => {
      setLastViewedOthersMessageCount(othersMessageCount);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('markChatMessagesAsRead', handleMarkAsRead);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('markChatMessagesAsRead', handleMarkAsRead);
    };
  }, [currentView, othersMessageCount]);

  const handleToggleMic = async () => {
    try {
      // 若已被房主禁言，禁止开启麦克风（关闭则允许）
      if (currentPlayerId && hostMutedPlayers.has(currentPlayerId) && !micEnabled) {
        message.warning('你已被房主禁言，无法开启麦克风');
        return;
      }
      // 调用后端的toggle_mic命令
      await invoke<boolean>('toggle_mic');
      // 后端会发送mic-toggled事件，前端会自动更新UI
    } catch (error) {
      console.error('切换麦克风失败:', error);
    }
  };

  const handleToggleGlobalMute = async () => {
    try {
      console.log('切换全局静音状态...');
      toggleGlobalMute();
    } catch (error) {
      console.error('切换全局静音失败:', error);
    }
  };

  const handleMutePlayer = async (playerId: string) => {
    try {
      console.log('切换玩家静音状态:', playerId);
      togglePlayerMute(playerId);
    } catch (error) {
      console.error('切换玩家静音失败:', error);
    }
  };

  const handleLeaveLobby = async () => {
    try {
      console.log('🚪 开始退出大厅流程...');
      
      // 显示退出中的提示
      setIsLeaving(true);

      // 清理说话状态检测
      try { speakingDetector.clear(); } catch { /* ignore */ }
      
      // 先恢复窗口大小（如果是收起状态）
      if (collapsed) {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const { LogicalSize } = await import('@tauri-apps/api/dpi');
        const appWindow = getCurrentWindow();
        await appWindow.setSize(new LogicalSize(320, 520));
        console.log('窗口大小已恢复');
      }
      
      // 1. 先清理WebRTC客户端（关闭所有连接和WebSocket）
      console.log('正在清理WebRTC客户端...');
      await webrtcClient.cleanup();
      console.log('✅ WebRTC客户端已清理');
      
      // 2. 重置P2P聊天服务
      console.log('正在重置P2P聊天服务...');
      p2pChatService.reset();
      console.log('✅ P2P聊天服务已重置');
      
      // 等待一小段时间，确保WebSocket完全关闭
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // 2. 调用后端退出大厅（停止EasyTier和清理网络）
      console.log('正在调用后端退出大厅...');
      await invoke('leave_lobby');
      console.log('✅ 后端退出大厅成功');
      
      // 3. 停止HTTP文件服务器
      try {
        await invoke('stop_file_server');
        console.log('✅ HTTP文件服务器已停止');
      } catch (error) {
        console.error('❌ 停止HTTP文件服务器失败:', error);
        // 不中断流程
      }
      
      // 4. 更新前端状态返回主界面
      const { setAppState, clearLobby } = useAppStore.getState();
      clearLobby(); // 这会清理大厅、玩家列表和语音状态
      setAppState('idle');
      setIsLeaving(false);
      console.log('✅ 前端状态已清理，返回主界面');
    } catch (error) {
      console.error('❌ 退出大厅失败:', error);
      // 即使后端退出失败，也要清理前端状态并返回主界面
      try {
        await webrtcClient.cleanup();
      } catch (cleanupError) {
        console.error('❌ 清理WebRTC失败:', cleanupError);
      }
      
      const { setAppState, clearLobby } = useAppStore.getState();
      clearLobby(); // 这会清理大厅、玩家列表和语音状态
      setAppState('idle');
      setIsLeaving(false);
      console.log('⚠️ 已强制返回主界面');
    }
  };

  // 监听被房主踢出事件：提示并自动退出大厅
  useEffect(() => {
    const onKicked = (e: Event) => {
      const reason = (e as CustomEvent)?.detail?.reason || '你已被房主移出大厅';
      message.warning(reason);
      void handleLeaveLobby();
    };
    window.addEventListener('mctier-kicked', onKicked as EventListener);
    return () => window.removeEventListener('mctier-kicked', onKicked as EventListener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 本机被房主禁言时，自动关闭麦克风
  useEffect(() => {
    if (currentPlayerId && hostMutedPlayers.has(currentPlayerId) && micEnabled) {
      try {
        // 物理关闭后端麦克风（toggle_mic 当前为开 → 关），处理快捷键绕过的情况
        invoke('toggle_mic').catch(() => {});
        webrtcClient.setMicEnabled(false);
        useAppStore.getState().setMicEnabled(false);
        message.warning('你已被房主禁言，麦克风已关闭');
      } catch { /* ignore */ }
    }
  }, [hostMutedPlayers, currentPlayerId, micEnabled]);

  const handleToggleCollapse = async () => {
    try {
      console.log('收起按钮被点击，当前状态:', collapsed);
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const { LogicalSize } = await import('@tauri-apps/api/dpi');
      const appWindow = getCurrentWindow();
      
      if (!collapsed) {
        // 收起：缩小窗口到只显示标题栏
        console.log('正在收起窗口...');
        await appWindow.setSize(new LogicalSize(320, 50));
        console.log('窗口已收起');
      } else {
        // 展开：恢复窗口大小
        console.log('正在展开窗口...');
        await appWindow.setSize(new LogicalSize(320, 520));
        console.log('窗口已展开');
      }
      
      setCollapsed(!collapsed);
    } catch (error) {
      console.error('切换窗口大小失败:', error);
      console.error('错误详情:', error);
    }
  };

  const handleOpacityChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const newOpacity = parseFloat(e.target.value);
    setOpacity(newOpacity);
    
    try {
      // 调用后端设置真实的窗口透明度
      await invoke('set_window_opacity', { opacity: newOpacity });
      console.log('窗口透明度已更改为:', newOpacity);
      
      // 保存透明度到配置文件
      await invoke('save_opacity', { opacity: newOpacity });
      console.log('透明度已保存到配置文件');
      
      // 更新前端 store 中的配置
      const { updateConfig } = useAppStore.getState();
      updateConfig({ opacity: newOpacity });
      console.log('前端 store 中的透明度已更新');
    } catch (error) {
      console.error('设置或保存窗口透明度失败:', error);
    }
  };

  // 处理动态设置保存后重新加入大厅
  const handleLobbySettingsSaved = async () => {
    console.log('🎯 [MiniWindow] handleLobbySettingsSaved 被调用了！');
    console.log('🎯 [MiniWindow] lobby:', lobby);
    console.log('🎯 [MiniWindow] currentPlayerId:', currentPlayerId);
    
    if (!lobby || !currentPlayerId) {
      console.error('❌ [MiniWindow] 验证失败：lobby 或 currentPlayerId 无效');
      message.error('当前未在大厅中或玩家ID无效');
      return;
    }

    console.log('📢 [MiniWindow] 大厅设置已保存，准备重新加入大厅...');

    // 先关闭大厅设置弹窗
    console.log('🚪 [MiniWindow] 正在关闭大厅设置弹窗...');
    setShowLobbySettings(false);
    console.log('✅ [MiniWindow] 大厅设置弹窗已关闭');
    
    // 等待弹窗完全关闭
    console.log('⏳ [MiniWindow] 等待弹窗完全关闭（200ms）...');
    await new Promise(resolve => setTimeout(resolve, 200));
    console.log('✅ [MiniWindow] 等待完成');

    // 显示重新加入大厅的加载提示（使用自定义遮罩层，和退出大厅一样）
    console.log('🎨 [MiniWindow] 显示重新加入大厅的加载提示...');
    setIsRejoining(true);
    console.log('✅ [MiniWindow] 加载提示已显示');

    try {
      // 1. 先退出当前大厅（不清理前端状态）
      console.log('🚪 [MiniWindow] 正在退出当前大厅...');
      await invoke('leave_lobby');
      console.log('✅ [MiniWindow] 已退出当前大厅');

      // 等待足够的时间确保资源完全释放（包括进程退出、网卡清理等）
      // stop_easytier 需要：3秒等待进程退出 + 0.5秒清理网卡 + 0.5秒清理配置 = 至少4秒
      console.log('⏳ [MiniWindow] 等待资源完全释放（5秒）...');
      await new Promise(resolve => setTimeout(resolve, 5000));
      console.log('✅ [MiniWindow] 资源释放等待完成');

      // 2. 重新加载配置
      console.log('📖 [MiniWindow] 正在重新加载配置...');
      const settings = await invoke<any>('get_settings');
      console.log('✅ [MiniWindow] 已重新加载配置');

      // 3. 使用新配置重新加入大厅
      console.log('🔌 [MiniWindow] 正在使用新配置重新加入大厅...');
      const serverNode = (settings.usePrivateServer && settings.privateEasytierServer)
        ? settings.privateEasytierServer 
        : 'udp://us01.225284.xyz:11010';
      const signalingServer = (settings.usePrivateServer && settings.privateSignalingServer)
        ? settings.privateSignalingServer 
        : 'wss://mctier.pmhs.top/signaling';

      const useDomain = settings.useDomain || false;
      const virtualDomain = settings.virtualDomain || '';

      const newLobby = await invoke<any>('join_lobby', {
        name: lobby.name || '',
        password: lobby.password || '',
        playerName: config.playerName || '玩家',
        playerId: currentPlayerId,
        serverNode,
        signalingServer,
        useDomain: useDomain,
        virtualDomain: virtualDomain,
      });

      console.log('✅ [MiniWindow] 重新加入大厅成功:', newLobby);

      // 4. 更新前端状态
      const { setLobby } = useAppStore.getState();
      setLobby(newLobby);

      // 5. 重新初始化WebRTC
      console.log('🔄 [MiniWindow] 正在重新初始化WebRTC...');
      await webrtcClient.initialize(
        currentPlayerId,
        config.playerName || '玩家',
        lobby.name || '',
        lobby.password || '',
        virtualDomain,
        useDomain,
        signalingServer
      );
      console.log('✅ [MiniWindow] WebRTC重新初始化成功');

      // 关闭加载提示
      setIsRejoining(false);
      
      // 显示成功提示
      message.success('设置已应用，重新加入大厅成功');
    } catch (error) {
      console.error('❌ [MiniWindow] 重新加入大厅失败:', error);
      
      // 关闭加载提示
      setIsRejoining(false);
      
      message.error(`重新加入大厅失败: ${error}`);
      
      // 如果失败，返回主界面
      const { setAppState, clearLobby } = useAppStore.getState();
      clearLobby();
      setAppState('idle');
    }
  };

  // 处理玩家音量变化
  const handlePlayerVolumeChange = (playerId: string, volume: number) => {
    setPlayerVolume(playerId, volume);
    // 按玩家名记忆音量，下次联机自动恢复
    const p = players.find((pl) => pl.id === playerId);
    if (p?.name) {
      playerVolumeMemory.set(p.name, volume);
    }
    console.log(`玩家 ${playerId} 音量已设置为: ${Math.round(volume * 100)}%`);
  };

  // 打开聊天室（从聊天室按钮）
  const handleOpenChatRoom = () => {
    setCurrentView('chat');
    // 记录打开聊天室时窗口是否处于收起状态
    setChatOpenedWhenCollapsed(collapsed);
    // 设置全局标志：当前在聊天室界面
    (window as any).__isInChatRoom__ = true;
    // 标记所有其他人的消息为已读
    setLastViewedOthersMessageCount(othersMessageCount);
    console.log(`✅ 打开聊天室，窗口${collapsed ? '收起' : '展开'}状态`);
  };

  // 关闭聊天室，返回大厅界面
  const handleCloseChatRoom = async () => {
    setCurrentView('lobby');
    // 清除全局标志：离开聊天室界面
    (window as any).__isInChatRoom__ = false;
    // 标记所有其他人的消息为已读
    setLastViewedOthersMessageCount(othersMessageCount);
    
    // 如果打开聊天室时窗口是收起状态，关闭时自动收起
    if (chatOpenedWhenCollapsed) {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const { LogicalSize } = await import('@tauri-apps/api/dpi');
        const appWindow = getCurrentWindow();
        await appWindow.setSize(new LogicalSize(320, 50));
        setCollapsed(true);
        console.log('✅ 聊天室关闭，窗口已自动收起');
      } catch (error) {
        console.error('自动收起窗口失败:', error);
      }
      setChatOpenedWhenCollapsed(false); // 重置标记
    } else {
      console.log('✅ 聊天室关闭，窗口保持展开状态');
    }
  };

  // 处理新消息按钮点击
  const handleNewMessageClick = async () => {
    try {
      // 记录当前窗口是否处于收起状态
      const wasCollapsed = collapsed;
      
      // 如果窗口是收起状态，先展开窗口
      if (collapsed) {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const { LogicalSize } = await import('@tauri-apps/api/dpi');
        const appWindow = getCurrentWindow();
        await appWindow.setSize(new LogicalSize(320, 520));
        setCollapsed(false);
        console.log('窗口已展开');
      }
      
      // 切换到聊天室视图
      setCurrentView('chat');
      // 记录打开聊天室时窗口是否处于收起状态
      setChatOpenedWhenCollapsed(wasCollapsed);
      // 设置全局标志：当前在聊天室界面
      (window as any).__isInChatRoom__ = true;
      // 标记所有其他人的消息为已读
      setLastViewedOthersMessageCount(othersMessageCount);
      console.log(`✅ 从${wasCollapsed ? '迷你窗口' : '大厅界面'}打开聊天室并标记消息为已读`);
    } catch (error) {
      console.error('打开聊天室失败:', error);
    }
  };

  // 打开 mcwifipnp 模组页面
  const handleOpenModPage = async () => {
    try {
      await open('https://www.mcmod.cn/class/4498.html');
    } catch (error) {
      console.error('打开模组页面失败:', error);
    }
  };

  // 打开官网
  const handleOpenWebsite = async () => {
    if (!versionError) return;
    
    try {
      // 确保URL以https://开头
      let url = versionError.downloadUrl;
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = `https://${url}`;
        console.log('自动添加https://前缀:', url);
      }
      
      await open(url);
      console.log('已打开官网:', url);
      message.success('已在浏览器中打开官网');
    } catch (error) {
      console.error('打开官网失败:', error);
      message.error('打开官网失败，请手动复制链接');
    }
  };

  // 【#16】版本过低弹窗：客户端内一键更新
  const [versionUpdating, setVersionUpdating] = useState(false);
  const [versionUpdateProgress, setVersionUpdateProgress] = useState(0);
  useEffect(() => {
    if (!versionUpdating) return;
    let unlisten: (() => void) | undefined;
    listen<{ downloaded: number; total: number }>('update-download-progress', (e) => {
      const { downloaded, total } = e.payload;
      if (total > 0) setVersionUpdateProgress(Math.min(100, Math.round((downloaded / total) * 100)));
    }).then((fn) => { unlisten = fn; });
    return () => { if (unlisten) unlisten(); };
  }, [versionUpdating]);

  const handleInAppUpdate = async () => {
    if (versionUpdating) return;
    try {
      setVersionUpdating(true);
      setVersionUpdateProgress(0);
      message.loading({ content: '正在获取最新安装包…', key: 'mctier-update', duration: 0 });
      const url = await versionCheckService.fetchLatestInstallerUrl();
      if (!url) {
        message.destroy('mctier-update');
        message.warning('未找到可下载的安装包，将打开下载页面');
        await handleOpenWebsite();
        setVersionUpdating(false);
        return;
      }
      message.loading({ content: '正在下载并更新，请勿关闭软件…', key: 'mctier-update', duration: 0 });
      await invoke('download_and_run_installer', { url });
      message.destroy('mctier-update');
      message.success('下载完成，即将启动安装程序…');
    } catch (error) {
      console.error('客户端内更新失败:', error);
      message.destroy('mctier-update');
      message.error('更新失败，将打开下载页面');
      await handleOpenWebsite();
      setVersionUpdating(false);
    }
  };

  // 复制官网链接
  const handleCopyWebsiteUrl = async () => {
    if (!versionError) return;
    
    try {
      await writeText(versionError.downloadUrl);
      message.success('官网链接已复制到剪贴板');
      console.log('已复制官网链接:', versionError.downloadUrl);
    } catch (error) {
      console.error('复制链接失败:', error);
      message.error('复制失败，请手动复制');
    }
  };

  // 复制虚拟IP或虚拟域名
  const handleCopyVirtualIp = async () => {
    if (!lobby) return;
    
    try {
      // 根据useDomain决定复制IP还是域名
      const textToCopy = (lobby.useDomain && lobby.virtualDomain) ? lobby.virtualDomain : lobby.virtualIp;
      if (!textToCopy) {
        message.warning('虚拟地址尚未获取');
        return;
      }
      
      await writeText(textToCopy);
      const label = (lobby.useDomain && lobby.virtualDomain) ? '虚拟域名' : '虚拟IP';
      message.success(`${label}已复制`);
      console.log(`已复制${label}:`, textToCopy);
    } catch (error) {
      console.error('复制失败:', error);
      message.error('复制失败，请重试');
    }
  };

  // 复制大厅信息
  const handleCopyLobbyInfo = async () => {
    if (!lobby) return;
    
    try {
      // 新格式：
      // ———————— 邀请您加入大厅 ————————
      // 完整复制后打开 MCTier-加入大厅 界面（自动识别）
      // 大厅名称：XXX
      // 密码：XXX
      // —————— (https://mctier.pmhs.top) ——————
      const lobbyInfo = `——————— 邀请您加入大厅 ———————
完整复制后打开 MCTier-加入大厅 界面（自动识别）
大厅名称：${lobby.name}
密码：${lobby.password || ''}
————— https://mctier.pmhs.top —————`;
      
      await writeText(lobbyInfo);
      
      // 显示提示信息（轻量级 toast 反馈）
      message.success({
        content: '大厅信息已复制，发送给好友粘贴打开「加入大厅」即可自动识别',
        duration: 3,
      });
      
      console.log('已复制大厅信息:', lobbyInfo);
    } catch (error) {
      console.error('复制大厅信息失败:', error);
      message.error('复制失败，请重试');
    }
  };

  return (
    <>
      {/* 版本错误全屏提示 - 完全覆盖大厅界面 */}
      {versionError && (
        <motion.div
          className="version-error-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
        >
          <motion.div
            className="version-error-content"
            initial={{ scale: 0.9, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
          >
            {/* 警告图标 */}
            <motion.div
              className="version-error-icon-wrapper"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
            >
              <WarningTriangleIcon size={80} className="version-error-icon" />
            </motion.div>

            {/* 标题 */}
            <h2 className="version-error-title">版本过低，无法连接</h2>

            {/* 版本信息 */}
            <div className="version-error-info">
              <div className="version-info-row">
                <span className="version-label">当前版本</span>
                <span className="version-value current">{versionError.currentVersion}</span>
              </div>
              <div className="version-info-row">
                <span className="version-label">最低要求</span>
                <span className="version-value required">{versionError.minimumVersion}</span>
              </div>
            </div>

            {/* 提示信息 */}
            <div className="version-error-message">
              <p>客户端版本过低，服务器已拒绝连接</p>
              <p>请下载最新版本以继续使用 MCTier</p>
            </div>

            {/* 官网链接 */}
            <div className="version-error-url">
              <div className="url-label">官网下载地址</div>
              <div className="url-box">
                <span className="url-text">{versionError.downloadUrl}</span>
                <motion.button
                  className="url-copy-btn"
                  onClick={handleCopyWebsiteUrl}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  title="复制链接"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                  </svg>
                </motion.button>
              </div>
            </div>

            {/* 操作按钮 */}
            <div className="version-error-actions">
              <motion.button
                className="version-error-btn primary"
                onClick={handleInAppUpdate}
                whileHover={{ scale: versionUpdating ? 1 : 1.02 }}
                whileTap={{ scale: versionUpdating ? 1 : 0.98 }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '10px' }}>
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                <span>{versionUpdating ? `更新中 ${versionUpdateProgress}%` : '立即更新到最新版'}</span>
              </motion.button>
            </div>
          </motion.div>
        </motion.div>
      )}

      {/* 退出大厅加载提示 */}
      <Modal
        open={isLeaving}
        footer={null}
        closable={false}
        centered
        width={300}
        styles={{
          body: {
            padding: '32px',
            textAlign: 'center',
          },
        }}
      >
        <Spin size="large" />
        <div style={{ marginTop: '16px', fontSize: '16px', color: 'rgba(255,255,255,0.9)' }}>
          正在退出大厅...
        </div>
        <div style={{ marginTop: '8px', fontSize: '12px', color: 'rgba(255,255,255,0.6)' }}>
          正在清理网络连接和虚拟网卡
        </div>
      </Modal>

      {/* 重新加入大厅加载提示 */}
      <Modal
        open={isRejoining}
        footer={null}
        closable={false}
        centered
        width={400}
        styles={{
          body: {
            padding: '40px',
            textAlign: 'center',
          },
        }}
      >
        <Spin size="large" />
        <div style={{ marginTop: '20px', fontSize: '18px', color: 'rgba(255,255,255,0.95)', fontWeight: 600 }}>
          正在重载设置...
        </div>
        <div style={{ marginTop: '12px', fontSize: '14px', color: 'rgba(255,255,255,0.75)' }}>
          正在重新配置并加入...
        </div>
        <div style={{ marginTop: '8px', fontSize: '12px', color: 'rgba(255,255,255,0.5)' }}>
          请稍等，这可能需要几秒钟...
        </div>
      </Modal>

      {/* 联机帮助弹窗 */}
      <Modal
        title="MC联机帮助"
        open={showConnectionHelp}
        onCancel={() => setShowConnectionHelp(false)}
        footer={null}
        width={500}
      >
        <div style={{ lineHeight: '1.8' }}>
          <p style={{ marginBottom: '16px', fontWeight: 'bold', color: '#52c41a' }}>
            联机方式说明：
          </p>
          
          <div style={{ marginBottom: '12px' }}>
            <strong>1. 双方都是正版：</strong>
            <br />
            房主对局域网开放后，其他玩家在多人游戏中使用 <code style={{ background: 'rgba(255,255,255,0.1)', padding: '2px 6px', borderRadius: '4px' }}>房主虚拟IP:端口号</code> 加入
          </div>

          <div style={{ marginBottom: '12px' }}>
            <strong>2. 房主离线模式，加入者正版：</strong>
            <br />
            加入者在多人游戏中使用 <code style={{ background: 'rgba(255,255,255,0.1)', padding: '2px 6px', borderRadius: '4px' }}>房主虚拟IP:端口号</code> 加入
          </div>

          <div style={{ marginBottom: '12px' }}>
            <strong>3. 房主正版，加入者离线模式：</strong>
            <br />
            房主需要安装 <a onClick={handleOpenModPage} style={{ color: '#1890ff', cursor: 'pointer', textDecoration: 'underline' }}>mcwifipnp</a> 模组关闭正版验证
          </div>

          <div style={{ marginBottom: '16px' }}>
            <strong>4. 双方都是离线模式：</strong>
            <br />
            房主需要安装 <a onClick={handleOpenModPage} style={{ color: '#1890ff', cursor: 'pointer', textDecoration: 'underline' }}>mcwifipnp</a> 模组关闭正版验证
          </div>

          <div style={{ padding: '12px', background: 'rgba(255, 193, 7, 0.1)', borderRadius: '8px', borderLeft: '3px solid #ffc107' }}>
            <strong style={{ color: '#ffc107' }}>💡 提示：</strong>
            <br />
            虚拟IP显示在大厅信息中，端口号由房主在游戏内对局域网开放时显示
          </div>
        </div>
      </Modal>

      {/* 根据当前视图显示不同内容 */}
      <AnimatePresence mode="wait">
        {currentView === 'chat' ? (
          <motion.div
            key="chat"
            className="chat-room-view"
            initial={{ opacity: 1 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 1 }}
            transition={{ duration: 0 }}
          >
            <div className="chat-room-header">
              <h3 className="chat-room-title">聊天室</h3>
              <button
                className="back-button"
                onClick={handleCloseChatRoom}
                title="关闭聊天室 (ESC)"
              >
                <CloseIcon size={16} />
              </button>
            </div>
            <ChatRoom />
          </motion.div>
        ) : currentView === 'fileShare' ? (
          <motion.div
            key="fileShare"
            className="file-share-view"
            initial={{ opacity: 1 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 1 }}
            transition={{ duration: 0 }}
          >
            <div className="file-share-header">
              <div className="file-share-title-wrapper">
                <h3 className="file-share-title">文件夹共享</h3>
                <Tooltip 
                  title="将您电脑中的任何文件夹共享到当前大厅中，提供给同大厅内的其他玩家访问并下载。"
                  placement="bottom"
                >
                  <div className="file-share-info-icon">
                    <InfoIcon size={14} />
                  </div>
                </Tooltip>
              </div>
              <button
                className="back-button"
                onClick={() => setCurrentView('lobby')}
                title="返回大厅 (ESC)"
              >
                <CloseIcon size={16} />
              </button>
            </div>
            {(() => {
              console.log('🎨 [MiniWindow] 正在渲染FileShareManagerNew组件，currentView:', currentView);
              return <FileShareManagerNew />;
            })()}
          </motion.div>
        ) : currentView === 'screenShare' ? (
          <motion.div
            key="screenShare"
            className="screen-share-view"
            initial={{ opacity: 1 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 1 }}
            transition={{ duration: 0 }}
          >
            <div className="screen-share-header">
              <div className="screen-share-title-wrapper">
                <h3 className="screen-share-title">屏幕共享</h3>
                <Tooltip 
                  title="将您的屏幕实时共享给大厅内的其他玩家查看，支持密码保护。"
                  placement="bottom"
                >
                  <div className="screen-share-info-icon">
                    <InfoIcon size={14} />
                  </div>
                </Tooltip>
              </div>
              <div className="screen-share-controls">
                <button
                  className="back-button"
                  onClick={() => setCurrentView('lobby')}
                >
                  <Tooltip title="返回大厅 (ESC)" placement="bottom">
                    <CloseIcon size={16} />
                  </Tooltip>
                </button>
              </div>
            </div>
            <ScreenShareManager />
          </motion.div>
        ) : (
          <motion.div
            key="lobby"
            className={`mini-window ${collapsed ? 'collapsed' : ''}`}
            style={{
              background: `rgba(20, 20, 30, ${opacity})` // 动态设置背景透明度
            }}
            initial={{ opacity: 1 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 1 }}
            transition={{ duration: 0 }}
          >
        <div className="mini-window-header">
          <h3 className="mini-window-title">
            {collapsed && lobby ? (
              <>
                {lobby.name.length > 5 ? `${lobby.name.substring(0, 5)}...` : lobby.name} ({players.length + 1}{maxPlayers && maxPlayers > 0 ? `/${maxPlayers}` : ''})
              </>
            ) : (
              'MCTier'
            )}
          </h3>
          <div className="mini-window-controls">
            {/* 收起状态下显示麦克风和听筒按钮 */}
            {collapsed && (
              <>
                <motion.button
                  className={`mini-control-btn voice-btn ${micEnabled ? 'active' : 'muted'}`}
                  onClick={handleToggleMic}
                  title={micEnabled ? '关闭麦克风 (Ctrl+M)' : '开启麦克风 (Ctrl+M)'}
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.95 }}
                >
                  <MicIcon enabled={micEnabled} size={14} />
                </motion.button>
                <motion.button
                  className={`mini-control-btn voice-btn ${globalMuted ? 'muted' : 'active'}`}
                  onClick={handleToggleGlobalMute}
                  title={globalMuted ? '开启全局听筒 (Ctrl+T)' : '关闭全局听筒 (Ctrl+T)'}
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.95 }}
                >
                  <SpeakerIcon muted={globalMuted} size={14} />
                </motion.button>
                {/* 新消息按钮 - 有新消息时显示并闪烁 */}
                {unreadCount > 0 && (
                  <motion.button
                    className="mini-control-btn new-message-btn"
                    onClick={handleNewMessageClick}
                    title={`${unreadCount} 条新消息`}
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.95 }}
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    exit={{ scale: 0 }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                    </svg>
                  </motion.button>
                )}
              </>
            )}
            <motion.button
              className="mini-control-btn"
              onClick={handleToggleCollapse}
              title={collapsed ? '展开' : '收起'}
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.95 }}
            >
              <CollapseIcon collapsed={collapsed} size={16} />
            </motion.button>
            <motion.button
              className="mini-control-btn close-btn"
              onClick={() => {
                modal.confirm({
                  title: '退出大厅',
                  content: '确定要退出当前大厅吗？退出后将断开与好友的组网。',
                  okText: '退出',
                  okType: 'danger',
                  cancelText: '取消',
                  centered: true,
                  onOk: () => { void handleLeaveLobby(); },
                });
              }}
              title="返回主界面"
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.95 }}
            >
              <CloseCircleIcon size={16} />
            </motion.button>
          </div>
        </div>

        <AnimatePresence>
          {!collapsed && (
            <motion.div
              className="mini-window-content"
              initial={{ height: 0, opacity: 0, scale: 0.95 }}
              animate={{ height: 'auto', opacity: 1, scale: 1 }}
              exit={{ height: 0, opacity: 0, scale: 0.95 }}
              transition={{ 
                duration: 0.3, 
                ease: [0.4, 0, 0.2, 1],
                opacity: { duration: 0.2 }
              }}
            >
              {/* 大厅信息卡片 */}
              {lobby && (
                <motion.div
                  className="mini-lobby-card"
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1, duration: 0.3 }}
                >
                  <div className="lobby-card-header">
                    <h4 className="lobby-card-title">
                      {lobby.name.length > 12 ? `${lobby.name.substring(0, 12)}...` : lobby.name}
                    </h4>
                    <div className="lobby-card-actions">
                      <motion.button
                        className="lobby-card-action-btn"
                        onClick={() => setShowMcWorlds(true)}
                        title="局域网世界（扫描可加入的 Minecraft 世界）"
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.95 }}
                      >
                        <GlobeIcon size={16} color="#FFFFFF" />
                      </motion.button>
                      <motion.button
                        className="copy-lobby-btn"
                        onClick={handleCopyLobbyInfo}
                        title="复制大厅信息"
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.95 }}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                        </svg>
                      </motion.button>
                      <motion.button
                        className="copy-lobby-btn"
                        onClick={() => setShowQrModal(true)}
                        title="大厅二维码（手机 MCTier 扫码加入）"
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.95 }}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect x="3" y="3" width="7" height="7" rx="1"></rect>
                          <rect x="14" y="3" width="7" height="7" rx="1"></rect>
                          <rect x="3" y="14" width="7" height="7" rx="1"></rect>
                          <path d="M14 14h3v3h-3zM20 14v7M14 20h7"></path>
                        </svg>
                      </motion.button>
                    </div>
                  </div>
                  <div className="lobby-card-info">
                    <span className="lobby-info-label">
                      {lobby.useDomain && lobby.virtualDomain ? '您的虚拟域名:' : '您的虚拟IP:'}
                    </span>
                    <motion.button
                      className="virtual-ip-btn"
                      onClick={handleCopyVirtualIp}
                      title={lobby.useDomain && lobby.virtualDomain ? '点击复制虚拟域名' : '点击复制虚拟IP'}
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                    >
                      {lobby.useDomain && lobby.virtualDomain ? lobby.virtualDomain : lobby.virtualIp || '获取中...'}
                    </motion.button>
                    <motion.button
                      className="connection-help-link"
                      onClick={() => setShowConnectionHelp(true)}
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                    >
                      无法联机?
                    </motion.button>
                  </div>
                </motion.div>
              )}

              {/* 大厅公告 */}
              {(announcement || isHost) && (
                <div className="mini-announcement">
                  {announcement ? (
                    <div className="mini-announce-box">
                      <div className="mini-announce-head">
                        <span className="mini-announce-title">📢 大厅公告</span>
                        {isHost && (
                          <button className="mini-announce-edit" onClick={() => {
                            const v = window.prompt('设置大厅公告（留空清空）', announcement);
                            if (v !== null) {
                              setAnnouncement(v.trim());
                              void p2pChatService.sendControlMessage('announce', v.trim());
                            }
                          }}>编辑</button>
                        )}
                      </div>
                      <div className="mini-announce-text">{announcement}</div>
                    </div>
                  ) : (
                    <button className="mini-announce-set" onClick={() => {
                      const v = window.prompt('设置大厅公告（玩法规则/服务器地址等，新人进来即见）', '');
                      if (v !== null && v.trim()) {
                        setAnnouncement(v.trim());
                        void p2pChatService.sendControlMessage('announce', v.trim());
                      }
                    }}>+ 设置大厅公告</button>
                  )}
                </div>
              )}

              {/* 语音小队 */}
              <div className="mini-voicegroup">
                <span className="mini-vg-label">语音</span>
                {[0, 1, 2, 3, 4].map((g) => (
                  <button
                    key={g}
                    className={`mini-vg-chip ${myVoiceGroup === g ? 'active' : ''}`}
                    onClick={() => {
                      setMyVoiceGroup(g);
                      void p2pChatService.sendControlMessage('voicegroup', String(g));
                    }}
                  >
                    {g === 0 ? '公共' : `${g}队`}
                  </button>
                ))}
              </div>

              {/* 玩家列表 */}
              <motion.div
                className="mini-players-section"
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15, duration: 0.3 }}
              >
                <h5 className="mini-section-title">
                  玩家列表 ({players.length + 1}{maxPlayers && maxPlayers > 0 ? `/${maxPlayers}` : ''})
                </h5>
                <div className="mini-player-list">
                  {/* 先显示当前玩家 */}
                  <motion.div
                    className="mini-player-item"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ 
                      type: 'spring',
                      stiffness: 500,
                      damping: 30
                    }}
                  >
                    <div className="mini-player-info">
                      <div className={`player-avatar ${currentPlayerId && speakingPlayers.has(currentPlayerId) ? 'speaking' : ''}`}>
                        <PlayerIcon className="mini-player-icon" />
                      </div>
                      <div className="player-details">
                        <span className="mini-player-name">
                          {useAppStore.getState().config.playerName || '我'} (我)
                          {isHost && (
                            <CrownIcon size={13} style={{ marginLeft: 4, verticalAlign: 'middle' }} />
                          )}
                          {currentPlayerId && hostMutedPlayers.has(currentPlayerId) && (
                            <span style={{ color: '#ff7875', fontSize: 11, marginLeft: 6 }}>已禁言</span>
                          )}
                          {currentPlayerId && speakingPlayers.has(currentPlayerId) && (
                            <span style={{ color: '#52c41a', fontSize: 11, marginLeft: 6 }}>说话中</span>
                          )}
                          {myVoiceGroup !== 0 && (
                            <span className="mini-vg-badge">{myVoiceGroup}队</span>
                          )}
                        </span>
                        <motion.button
                          className="player-virtual-ip-btn"
                          onClick={handleCopyVirtualIp}
                          title={lobby?.useDomain && lobby?.virtualDomain ? '点击复制虚拟域名' : '点击复制虚拟IP'}
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                        >
                          {lobby?.useDomain && lobby?.virtualDomain 
                            ? `域名: ${lobby.virtualDomain}` 
                            : `IP: ${lobby?.virtualIp || '10.126.126.1'}`
                          }
                        </motion.button>
                      </div>
                    </div>
                  </motion.div>

                  {/* 显示其他玩家 */}
                  <AnimatePresence mode="popLayout">
                    {players.map((player) => {
                      // 判断该玩家是否被静音（考虑全局静音和单独静音）
                      const isPlayerMuted = globalMuted || mutedPlayers.has(player.id);
                      // 获取该玩家的音量设置
                      const playerVolume = getPlayerVolume(player.id);
                      
                      return (
                        <motion.div
                          key={player.id}
                          className="mini-player-item"
                          layout
                          initial={{ opacity: 0, x: -20, scale: 0.9 }}
                          animate={{ opacity: 1, x: 0, scale: 1 }}
                          exit={{ opacity: 0, x: 20, scale: 0.9 }}
                          transition={{ 
                            duration: 0.3,
                            ease: [0.4, 0, 0.2, 1]
                          }}
                        >
                          <div className="mini-player-info">
                            <div className={`player-avatar ${speakingPlayers.has(player.id) ? 'speaking' : ''}`}>
                              <PlayerIcon className="mini-player-icon" />
                            </div>
                            <div className="player-details">
                              <span className="mini-player-name">
                                {player.name}
                                {hostId === player.id && (
                                  <CrownIcon size={13} style={{ marginLeft: 4, verticalAlign: 'middle' }} />
                                )}
                                {hostMutedPlayers.has(player.id) && (
                                  <span style={{ color: '#ff7875', fontSize: 11, marginLeft: 6 }}>已禁言</span>
                                )}
                                {speakingPlayers.has(player.id) && (
                                  <span style={{ color: '#52c41a', fontSize: 11, marginLeft: 6 }}>说话中</span>
                                )}
                                {(playerVoiceGroups.get(player.id) ?? 0) !== 0 && (
                                  <span className="mini-vg-badge">{playerVoiceGroups.get(player.id)}队</span>
                                )}
                              </span>
                              <div className="player-ip-row">
                                <motion.button
                                  className="player-virtual-ip-btn"
                                  onClick={async () => {
                                    try {
                                      // 根据玩家的useDomain决定显示和复制什么
                                      const textToCopy = (player.useDomain && player.virtualDomain) 
                                        ? player.virtualDomain 
                                        : (player.virtualIp || lobby?.virtualIp || '10.126.126.1');
                                      await writeText(textToCopy);
                                      const label = (player.useDomain && player.virtualDomain) ? '虚拟域名' : '虚拟IP';
                                      message.success(`${label}已复制`);
                                    } catch (error) {
                                      console.error('复制失败:', error);
                                      message.error('复制失败，请重试');
                                    }
                                  }}
                                  title={(player.useDomain && player.virtualDomain) ? '点击复制虚拟域名' : '点击复制虚拟IP'}
                                  whileHover={{ scale: 1.02 }}
                                  whileTap={{ scale: 0.98 }}
                                >
                                  {(player.useDomain && player.virtualDomain)
                                    ? `域名: ${player.virtualDomain}` 
                                    : `IP: ${player.virtualIp || lobby?.virtualIp || '10.126.126.1'}`
                                  }
                                </motion.button>
                                {(() => {
                                  const lat = player.virtualIp ? peerLatencies[player.virtualIp] : undefined;
                                  if (lat === undefined) return null;
                                  const color = lat === null ? '#ff4d4f' : lat < 80 ? '#52c41a' : lat < 200 ? '#faad14' : '#ff7a45';
                                  const text = lat === null ? '离线' : `${lat}ms`;
                                  return (
                                    <span
                                      title={lat === null ? '无法连通该玩家' : `延迟 ${lat}ms`}
                                      style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, color, flexShrink: 0 }}
                                    >
                                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, display: 'inline-block' }} />
                                      {text}
                                    </span>
                                  );
                                })()}
                              </div>
                              {/* 玩家独立音量控制 */}
                              <div className="player-volume-control">
                                <SpeakerIcon muted={isPlayerMuted} size={12} />
                                <input
                                  type="range"
                                  min="0"
                                  max="1"
                                  step="0.05"
                                  value={playerVolume}
                                  onChange={(e) => handlePlayerVolumeChange(player.id, parseFloat(e.target.value))}
                                  className="player-volume-slider"
                                  title={`音量: ${Math.round(playerVolume * 100)}%`}
                                  disabled={isPlayerMuted}
                                />
                                <span className="player-volume-value">{Math.round(playerVolume * 100)}%</span>
                              </div>
                            </div>
                          </div>
                          <div className={`mini-player-actions ${isHost ? 'host-grid' : ''}`}>
                            {isHost && (
                              <motion.button
                                className="mini-action-btn"
                                onClick={() => {
                                  modal.confirm({
                                    title: '转让房主',
                                    content: `确定把房主转让给 ${player.name} 吗？`,
                                    okText: '转让',
                                    cancelText: '取消',
                                    centered: true,
                                    onOk: () => { webrtcClient.transferHost(player.id); },
                                  });
                                }}
                                title="转让房主"
                                whileHover={{ scale: 1.1 }}
                                whileTap={{ scale: 0.9 }}
                              >
                                <CrownIcon size={16} color="currentColor" />
                              </motion.button>
                            )}
                            {isHost && (
                              <motion.button
                                className="mini-action-btn kick-btn"
                                onClick={() => {
                                  modal.confirm({
                                    title: '踢出玩家',
                                    content: `确定把 ${player.name} 移出大厅吗？`,
                                    okText: '踢出',
                                    okButtonProps: { danger: true },
                                    cancelText: '取消',
                                    centered: true,
                                    onOk: () => { webrtcClient.kickPlayer(player.id); },
                                  });
                                }}
                                title="踢出大厅"
                                whileHover={{ scale: 1.1 }}
                                whileTap={{ scale: 0.9 }}
                              >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ff7875" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M18 6 6 18M6 6l12 12"></path>
                                </svg>
                              </motion.button>
                            )}
                            <motion.button
                              className={`mini-action-btn ${isPlayerMuted ? 'muted' : ''}`}
                              onClick={() => handleMutePlayer(player.id)}
                              title={isPlayerMuted ? '取消静音' : '静音此玩家'}
                              whileHover={{ scale: 1.1 }}
                              whileTap={{ scale: 0.9 }}
                            >
                              <SpeakerIcon muted={isPlayerMuted} size={16} />
                            </motion.button>
                            {isHost && (
                              <motion.button
                                className={`mini-action-btn ${hostMutedPlayers.has(player.id) ? 'muted' : ''}`}
                                onClick={() => {
                                  const muted = !hostMutedPlayers.has(player.id);
                                  webrtcClient.setPlayerMuted(player.id, muted);
                                }}
                                title={hostMutedPlayers.has(player.id) ? '解除禁言' : '禁言该玩家（房主）'}
                                whileHover={{ scale: 1.1 }}
                                whileTap={{ scale: 0.9 }}
                              >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                                  <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                                  <line x1="1" y1="1" x2="23" y2="23"></line>
                                </svg>
                              </motion.button>
                            )}
                          </div>
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>
                </div>
              </motion.div>

              {/* 透明度控制 */}
              <motion.div
                className="mini-opacity-control"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2, duration: 0.3 }}
              >
                <div className="mini-opacity-control-wrapper">
                  <label className="mini-opacity-label">
                    透明度
                  </label>
                  <input
                    type="range"
                    min="0.3"
                    max="1"
                    step="0.05"
                    value={opacity}
                    onChange={handleOpacityChange}
                    className="mini-opacity-slider"
                  />
                </div>
                <motion.button
                  className="mini-lobby-settings-btn"
                  onClick={() => setShowLobbySettings(true)}
                  title="大厅动态设置"
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.95 }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 15.5A3.5 3.5 0 0 1 8.5 12 3.5 3.5 0 0 1 12 8.5a3.5 3.5 0 0 1 3.5 3.5 3.5 3.5 0 0 1-3.5 3.5m7.43-2.92c.04-.34.07-.69.07-1.08s-.03-.74-.07-1.08l2.32-1.82c.21-.17.27-.46.13-.7l-2.2-3.81c-.13-.24-.41-.32-.65-.24l-2.74 1.1c-.57-.44-1.18-.81-1.86-1.09L14.05 2.1c-.04-.27-.28-.46-.55-.46h-3c-.28 0-.5.19-.55.46L9.5 4.86C8.82 5.14 8.2 5.5 7.64 5.95L4.9 4.85c-.24-.09-.52 0-.65.24L2.05 8.9c-.14.24-.08.53.13.7L4.5 11.5c-.04.34-.07.7-.07 1.08s.03.74.07 1.08L2.18 15.48c-.21.17-.27.46-.13.7l2.2 3.81c.13.24.41.32.65.24l2.74-1.1c.57.44 1.18.81 1.86 1.09l.45 2.76c.05.27.27.46.55.46h3c.28 0 .5-.19.55-.46l.45-2.76c.68-.28 1.3-.65 1.86-1.09l2.74 1.1c.24.09.52 0 .65-.24l2.2-3.81c.14-.24.08-.53-.13-.7l-2.32-1.9z" />
                  </svg>
                </motion.button>
                <motion.button
                  className="mini-lobby-settings-btn"
                  onClick={() => setShowRoomTools(true)}
                  title="房间小工具（掷骰子 / 倒计时 / 待办清单）"
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.95 }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="3"></rect>
                    <circle cx="8" cy="8" r="1.3" fill="currentColor"></circle>
                    <circle cx="16" cy="8" r="1.3" fill="currentColor"></circle>
                    <circle cx="12" cy="12" r="1.3" fill="currentColor"></circle>
                    <circle cx="8" cy="16" r="1.3" fill="currentColor"></circle>
                    <circle cx="16" cy="16" r="1.3" fill="currentColor"></circle>
                  </svg>
                </motion.button>
                {isHost && (
                  <motion.button
                    className="mini-lobby-settings-btn"
                    onClick={() => setShowHostPanel(true)}
                    title="房主管理（人数上限 / 公开广场）"
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.95 }}
                  >
                    <CrownIcon size={16} />
                  </motion.button>
                )}
              </motion.div>

              {/* 底部控制按钮 - 只有5个按钮 */}
              <motion.div
                className="mini-voice-controls"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.25, duration: 0.3 }}
              >
                <motion.button
                  className={`mini-voice-btn ${micEnabled ? 'active' : 'muted'}`}
                  onClick={handleToggleMic}
                  title={micEnabled ? '关闭麦克风 (Ctrl+M)' : '开启麦克风 (Ctrl+M)'}
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.95 }}
                >
                  <MicIcon enabled={micEnabled} size={24} />
                </motion.button>
                <motion.button
                  className={`mini-voice-btn ${globalMuted ? 'muted' : ''}`}
                  onClick={handleToggleGlobalMute}
                  title={globalMuted ? '开启全局听筒 (Ctrl+T)' : '关闭全局听筒 (Ctrl+T)'}
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.95 }}
                >
                  <SpeakerIcon muted={globalMuted} size={24} />
                </motion.button>
                <motion.button
                  className={`mini-voice-btn chat-btn ${unreadCount > 0 ? 'has-unread' : ''}`}
                  onClick={handleOpenChatRoom}
                  title="聊天室"
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.95 }}
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                  </svg>
                </motion.button>
                <motion.button
                  className="mini-voice-btn file-share-btn"
                  onClick={() => {
                    console.log('🖱️ [MiniWindow] 点击文件共享按钮，切换视图到fileShare');
                    setCurrentView('fileShare');
                  }}
                  title="文件夹共享"
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.95 }}
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  </svg>
                </motion.button>
                <motion.button
                  className="mini-voice-btn screen-share-btn"
                  onClick={() => {
                    console.log('🖱️ [MiniWindow] 点击屏幕共享按钮，切换视图到screenShare');
                    setCurrentView('screenShare');
                  }}
                  title="屏幕共享"
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.95 }}
                >
                  <ScreenShareIcon size={24} />
                </motion.button>
              </motion.div>

              {/* 快捷键提示已移除 */}
            </motion.div>
          )}
        </AnimatePresence>
        </motion.div>
        )}
      </AnimatePresence>

      {/* 大厅动态设置弹窗 */}
      {lobby && (
        <LobbySettingsModal
          visible={showLobbySettings}
          onClose={() => setShowLobbySettings(false)}
          currentLobby={{
            name: lobby.name || '',
            password: lobby.password || '',
            virtualIp: lobby.virtualIp || '',
          }}
          onSettingsSaved={handleLobbySettingsSaved}
        />
      )}

      {/* 局域网世界自动发现弹窗 */}
      <MinecraftWorldsModal
        visible={showMcWorlds}
        onClose={() => setShowMcWorlds(false)}
      />

      {/* 房间小工具弹窗 */}
      <RoomTools visible={showRoomTools} onClose={() => setShowRoomTools(false)} />

      {/* 房主管理面板 */}
      <HostPanel visible={showHostPanel} onClose={() => setShowHostPanel(false)} />

      {/* 大厅二维码弹窗：手机端 MCTier 扫码即可加入 */}
      <Modal
        open={showQrModal}
        onCancel={() => setShowQrModal(false)}
        footer={null}
        centered
        width={320}
        title="大厅二维码"
      >
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '8px 0' }}>
          <div style={{ color: 'rgba(255,255,255,0.65)', fontSize: 13 }}>手机用 MCTier 扫码即可加入本大厅</div>
          {lobby && (
            <QRCode
              value={`——————— 邀请您加入大厅 ———————\n大厅名称：${lobby.name}\n密码：${lobby.password || ''}\n————— https://mctier.pmhs.top —————`}
              size={220}
              errorLevel="M"
            />
          )}
          <div style={{ color: '#fff', fontWeight: 600 }}>{lobby?.name}</div>
        </div>
      </Modal>
    </>
  );
};
