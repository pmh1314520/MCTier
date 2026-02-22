﻿import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';
import { Modal, Spin, message, Tooltip } from 'antd';
import { open } from '@tauri-apps/plugin-shell';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { useAppStore } from '../../stores';
import { webrtcClient, fileShareService } from '../../services';
import { PlayerIcon, MicIcon, SpeakerIcon, CloseCircleIcon, CollapseIcon, CloseIcon, WarningTriangleIcon, InfoIcon } from '../icons';
import { ChatRoom } from '../ChatRoom/ChatRoom';
import { FileShareManager } from '../FileShareManager/FileShareManager';
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
    toggleGlobalMute,
    togglePlayerMute,
    config,
    versionError,
  } = useAppStore();

  const [collapsed, setCollapsed] = useState(false);
  const [opacity, setOpacity] = useState(config.opacity ?? 0.95);
  const [isLeaving, setIsLeaving] = useState(false);
  const [showConnectionHelp, setShowConnectionHelp] = useState(false);
  const [currentView, setCurrentView] = useState<'lobby' | 'chat' | 'fileShare'>('lobby');
  const [chatOpenedWhenCollapsed, setChatOpenedWhenCollapsed] = useState(false); // 记录打开聊天室时窗口是否处于收起状态
  const { chatMessages, currentPlayerId } = useAppStore();
  
  // 跟踪上次查看聊天室时的消息数量（只计算其他人的消息）
  const [lastViewedOthersMessageCount, setLastViewedOthersMessageCount] = useState(0);
  
  // 计算其他人发送的消息数量
  const othersMessages = chatMessages.filter(msg => msg.playerId !== currentPlayerId);
  const othersMessageCount = othersMessages.length;
  
  // 计算未读消息数量（只计算其他人的消息）
  const unreadCount = Math.max(0, othersMessageCount - lastViewedOthersMessageCount);

  // 后台轮询远程共享
  const [remoteSharesCount, setRemoteSharesCount] = useState(0);

  // 后台加载远程共享
  useEffect(() => {
    const loadRemoteShares = async () => {
      try {
        // 获取当前玩家的虚拟IP
        const currentPlayerIp = lobby?.virtualIp;
        
        let totalShares = 0;
        
        // 1. 先加载自己的共享
        if (currentPlayerIp) {
          try {
            const shares = await fileShareService.getRemoteShares(currentPlayerIp);
            totalShares += shares.length;
          } catch (error) {
            console.error('获取自己的共享失败:', error);
          }
        }
        
        // 2. 再加载其他玩家的共享
        for (const player of players) {
          if (player.virtualIp) {
            try {
              const shares = await fileShareService.getRemoteShares(player.virtualIp);
              totalShares += shares.length;
            } catch (error) {
              console.error(`获取 ${player.name} 的共享失败:`, error);
            }
          }
        }
        
        setRemoteSharesCount(totalShares);
      } catch (error) {
        console.error('加载远程共享失败:', error);
      }
    };

    // 立即执行一次
    loadRemoteShares();

    // 每3秒轮询一次
    const interval = setInterval(loadRemoteShares, 3000);

    return () => clearInterval(interval);
  }, [players]); // 依赖players，当玩家列表变化时重新加载

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
      await open(versionError.downloadUrl);
      console.log('已打开官网:', versionError.downloadUrl);
      message.success('已在浏览器中打开官网');
    } catch (error) {
      console.error('打开官网失败:', error);
      message.error('打开官网失败，请手动复制链接');
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
      
      // 显示提示信息
      Modal.success({
        title: '大厅信息已复制',
        content: (
          <div style={{ lineHeight: '1.8' }}>
            <p style={{ marginBottom: '12px' }}>
              大厅信息已复制到剪贴板！
            </p>
            <p style={{ marginBottom: '8px', color: 'rgba(255,255,255,0.8)' }}>
              📋 将复制的内容分享给好友
            </p>
            <p style={{ marginBottom: '8px', color: 'rgba(255,255,255,0.8)' }}>
              👥 好友打开 MCTier 点击"加入大厅"
            </p>
            <p style={{ color: 'rgba(255,255,255,0.8)' }}>
              ✨ 软件会自动识别并填写大厅信息
            </p>
          </div>
        ),
        okText: '我知道了',
        centered: true,
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
                onClick={handleOpenWebsite}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '10px' }}>
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                  <polyline points="15 3 21 3 21 9"></polyline>
                  <line x1="10" y1="14" x2="21" y2="3"></line>
                </svg>
                <span>前往官网下载</span>
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

      {/* 联机帮助弹窗 */}
      <Modal
        title="联机帮助"
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
            <FileShareManager />
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
                {lobby.name.length > 5 ? `${lobby.name.substring(0, 5)}...` : lobby.name} ({players.length + 1}人)
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
              onClick={handleLeaveLobby}
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

              {/* 玩家列表 */}
              <motion.div
                className="mini-players-section"
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15, duration: 0.3 }}
              >
                <h5 className="mini-section-title">
                  玩家列表 ({players.length + 1})
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
                      <div className="player-avatar">
                        <PlayerIcon className="mini-player-icon" />
                      </div>
                      <div className="player-details">
                        <span className="mini-player-name">
                          {useAppStore.getState().config.playerName || '我'} (我)
                        </span>
                        <motion.button
                          className="player-virtual-ip-btn"
                          onClick={handleCopyVirtualIp}
                          title={lobby?.useDomain && lobby?.virtualDomain ? '点击复制虚拟域名' : '点击复制虚拟IP'}
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                        >
                          {lobby?.useDomain && lobby?.virtualDomain 
                            ? `虚拟域名: ${lobby.virtualDomain}` 
                            : `虚拟IP: ${lobby?.virtualIp || '10.126.126.1'}`
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
                            <div className="player-avatar">
                              <PlayerIcon className="mini-player-icon" />
                            </div>
                            <div className="player-details">
                              <span className="mini-player-name">
                                {player.name}
                              </span>
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
                                  ? `虚拟域名: ${player.virtualDomain}` 
                                  : `虚拟IP: ${player.virtualIp || lobby?.virtualIp || '10.126.126.1'}`
                                }
                              </motion.button>
                            </div>
                          </div>
                          <div className="mini-player-actions">
                            <motion.button
                              className={`mini-action-btn ${
                                isPlayerMuted ? 'muted' : ''
                              }`}
                              onClick={() => handleMutePlayer(player.id)}
                              title={
                                isPlayerMuted
                                  ? '取消静音'
                                  : '静音此玩家'
                              }
                              whileHover={{ scale: 1.1 }}
                              whileTap={{ scale: 0.9 }}
                            >
                              <SpeakerIcon 
                                muted={isPlayerMuted} 
                                size={16}
                              />
                            </motion.button>
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
                transition={{ delay: 0.25, duration: 0.3 }}
              >
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
              </motion.div>

              {/* 底部控制按钮 - 只有3个按钮 */}
              <motion.div
                className="mini-voice-controls"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.35, duration: 0.3 }}
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
                  onClick={() => setCurrentView('fileShare')}
                  title={remoteSharesCount > 0 ? `文件夹共享 (${remoteSharesCount}个可用)` : "文件夹共享"}
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.95 }}
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  </svg>
                  {remoteSharesCount > 0 && (
                    <span className="share-count-badge">{remoteSharesCount}</span>
                  )}
                </motion.button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
        </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};
