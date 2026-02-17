import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';
import { Modal, Button, Spin } from 'antd';
import { open } from '@tauri-apps/plugin-shell';
import { useAppStore } from '../../stores';
import { webrtcClient } from '../../services';
import { PlayerIcon, MicIcon, SpeakerIcon, CloseCircleIcon, CollapseIcon, InfoIcon } from '../icons';
import './MiniWindow.css';

/**
 * 迷你窗口组件
 * 显示精简的大厅信息和语音控制
 */
export const MiniWindow: React.FC = () => {
  const {
    lobby,
    players,
    currentPlayerId,
    micEnabled,
    globalMuted,
    mutedPlayers,
    toggleGlobalMute,
    togglePlayerMute,
    config,
  } = useAppStore();

  const [collapsed, setCollapsed] = useState(false);
  const [opacity, setOpacity] = useState(config.opacity ?? 0.95);
  const [isLeaving, setIsLeaving] = useState(false);
  const [showConnectionHelp, setShowConnectionHelp] = useState(false);

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
      
      // 3. 更新前端状态返回主界面
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
        await appWindow.setSize(new LogicalSize(320, 56));
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
    } catch (error) {
      console.error('设置或保存窗口透明度失败:', error);
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

  return (
    <>
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

      <motion.div
        className={`mini-window ${collapsed ? 'collapsed' : ''}`}
        initial={{ scale: 0.95, y: -20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.95, y: -20 }}
        transition={{ 
          duration: 0.4,
          ease: [0.4, 0, 0.2, 1]
        }}
      >
        <div className="mini-window-header">
          <h3 className="mini-window-title">
            MCTier
            {collapsed && lobby && (
              <span className="mini-header-info"> - {lobby.name} ({players.length}人)</span>
            )}
          </h3>
          <div className="mini-window-controls">
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
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.3 }}
            >
              {lobby && (
                <motion.div
                  className="mini-lobby-info"
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1, duration: 0.3 }}
                >
                  <h4 className="mini-lobby-name">{lobby.name}</h4>
                  {lobby.virtualIp && (
                    <p className="mini-lobby-ip">虚拟IP: {lobby.virtualIp}</p>
                  )}
                  <motion.div
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    style={{ marginTop: '12px' }}
                  >
                    <Button
                      type="default"
                      icon={<InfoIcon size={16} />}
                      onClick={() => setShowConnectionHelp(true)}
                      block
                      style={{
                        borderColor: 'rgba(255, 193, 7, 0.5)',
                        color: '#ffc107',
                        background: 'rgba(255, 193, 7, 0.05)',
                      }}
                    >
                      无法联机？点击查看帮助
                    </Button>
                  </motion.div>
                </motion.div>
              )}

              <motion.div
                className="mini-players-section"
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15, duration: 0.3 }}
              >
                <h5 className="mini-section-title">
                  玩家列表 ({players.length})
                </h5>
                <div className="mini-player-list">
                  <AnimatePresence mode="popLayout">
                    {players.map((player) => {
                      // 判断是否是当前玩家
                      const isCurrentPlayer = player.id === currentPlayerId;
                      // 判断该玩家是否被静音（考虑全局静音和单独静音）
                      const isPlayerMuted = globalMuted || mutedPlayers.has(player.id);
                      
                      return (
                        <motion.div
                          key={player.id}
                          className="mini-player-item"
                          layout
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: 20 }}
                          transition={{ 
                            type: 'spring',
                            stiffness: 500,
                            damping: 30
                          }}
                        >
                          <div className="mini-player-info">
                            <PlayerIcon className="mini-player-icon" />
                            <span className="mini-player-name">
                              {player.name}
                              {isCurrentPlayer && ' (我)'}
                            </span>
                          </div>
                          <div className="mini-player-actions">
                            {/* 当前玩家不显示静音按钮 */}
                            {!isCurrentPlayer && (
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
                                  size={14}
                                />
                              </motion.button>
                            )}
                          </div>
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>
                </div>
              </motion.div>

              <motion.div
                className="mini-opacity-control"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.25, duration: 0.3 }}
              >
                <label className="mini-opacity-label">
                  透明度: {Math.round(opacity * 100)}%
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
                  title={globalMuted ? '取消全局静音' : '全局静音'}
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.95 }}
                >
                  <SpeakerIcon muted={globalMuted} size={24} />
                </motion.button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </>
  );
};
