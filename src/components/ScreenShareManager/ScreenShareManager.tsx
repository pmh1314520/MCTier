import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Modal, Input, Switch, message, Tooltip } from 'antd';
import { invoke } from '@tauri-apps/api/core';
import { useAppStore } from '../../stores';
import { screenShareService } from '../../services/screenShare/ScreenShareService';
import { ScreenShareIcon, InfoIcon } from '../icons';
import type { ScreenShare } from '../../types';
import './ScreenShareManager.css';

interface ScreenShareManagerProps {
  isSharing: boolean;
  onStartSharing: () => void;
  onStopSharing: () => void;
}

export const ScreenShareManager: React.FC<ScreenShareManagerProps> = ({ 
  isSharing, 
  onStopSharing 
}) => {
  const { currentPlayerId } = useAppStore();
  const [activeShares, setActiveShares] = useState<ScreenShare[]>([]);
  const [myShareId, setMyShareId] = useState<string | null>(null);
  const [showStartModal, setShowStartModal] = useState(false);
  const [requirePassword, setRequirePassword] = useState(false);
  const [password, setPassword] = useState('');
  const [viewingShareId, setViewingShareId] = useState<string | null>(null);
  const [passwordInput, setPasswordInput] = useState('');
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [selectedShare, setSelectedShare] = useState<ScreenShare | null>(null);

  // 轮询获取共享列表
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        // 从信令服务器获取共享列表
        const shares = screenShareService.getActiveShares();
        setActiveShares(shares);
      } catch (error) {
        console.error('获取共享列表失败:', error);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  // 开始共享 - 内部处理
  const handleStartSharingInternal = async () => {
    try {
      console.log('🖥️ 开始屏幕共享...');

      const shareId = await screenShareService.startSharing(
        requirePassword,
        requirePassword ? password : undefined
      );

      setMyShareId(shareId);
      setShowStartModal(false);
      setPassword('');
      message.success('屏幕共享已启动');

      console.log('✅ 屏幕共享已启动:', shareId);
    } catch (error: any) {
      console.error('❌ 启动屏幕共享失败:', error);
      
      if (error.name === 'NotAllowedError') {
        message.error('用户拒绝了屏幕共享权限');
      } else if (error.name === 'NotFoundError') {
        message.error('未找到可共享的屏幕');
      } else {
        message.error('启动屏幕共享失败');
      }
    }
  };

  // 停止共享 - 内部处理
  const handleStopSharingInternal = () => {
    if (myShareId) {
      screenShareService.stopSharing(myShareId);
      setMyShareId(null);
      message.success('屏幕共享已停止');
    }
  };

  // 当父组件调用开始共享时，显示模态框
  useEffect(() => {
    if (isSharing && !myShareId) {
      setShowStartModal(true);
    } else if (!isSharing && myShareId) {
      // 父组件要求停止共享
      handleStopSharingInternal();
    }
  }, [isSharing, myShareId]);

  // 查看屏幕 - 使用独立窗口
  const handleViewScreen = async (share: ScreenShare) => {
    try {
      // 如果需要密码且不是自己的分享
      if (share.requirePassword && share.playerId !== currentPlayerId) {
        setSelectedShare(share);
        setShowPasswordModal(true);
        return;
      }

      console.log('👀 [ScreenShareManager] 开始查看屏幕:', share.id);
      console.log('👀 [ScreenShareManager] 共享者:', share.playerName);
      console.log('👀 [ScreenShareManager] 共享者ID:', share.playerId);

      // 先请求查看屏幕（建立WebRTC连接并获取流）
      const stream = await screenShareService.requestViewScreen(share.id);
      
      console.log('✅ [ScreenShareManager] 已获取屏幕流');
      console.log('📺 [ScreenShareManager] 流信息:', {
        id: stream.id,
        active: stream.active,
        tracks: stream.getTracks().map(t => ({
          kind: t.kind,
          enabled: t.enabled,
          readyState: t.readyState,
          label: t.label
        }))
      });

      // 打开独立窗口显示视频
      console.log('📺 [ScreenShareManager] 打开独立窗口显示视频');
      setViewingShareId(share.id);
      
      // 调用Tauri命令打开屏幕查看窗口
      await invoke('open_screen_viewer_window', {
        shareId: share.id,
        playerName: share.playerName
      });
      
      message.success(`正在查看 ${share.playerName} 的屏幕`);
      console.log('✅ [ScreenShareManager] 屏幕查看窗口已打开');
    } catch (error) {
      console.error('❌ [ScreenShareManager] 查看屏幕失败:', error);
      message.error('查看屏幕失败');
    }
  };

  // 验证密码并查看 - 使用独立窗口
  const handlePasswordSubmit = async () => {
    if (!selectedShare) return;

    if (!passwordInput.trim()) {
      message.warning('请输入密码');
      return;
    }

    try {
      console.log('👀 [ScreenShareManager] 验证密码后开始查看屏幕:', selectedShare.id);

      // 先请求查看屏幕（建立WebRTC连接并获取流）
      const stream = await screenShareService.requestViewScreen(selectedShare.id, passwordInput);
      
      console.log('✅ [ScreenShareManager] 已获取屏幕流');
      console.log('📺 [ScreenShareManager] 流信息:', {
        id: stream.id,
        active: stream.active,
        tracks: stream.getTracks().map(t => ({
          kind: t.kind,
          enabled: t.enabled,
          readyState: t.readyState,
          label: t.label
        }))
      });

      // 打开独立窗口显示视频
      console.log('📺 [ScreenShareManager] 打开独立窗口显示视频');
      setViewingShareId(selectedShare.id);
      setShowPasswordModal(false);
      setPasswordInput('');
      
      // 调用Tauri命令打开屏幕查看窗口
      await invoke('open_screen_viewer_window', {
        shareId: selectedShare.id,
        playerName: selectedShare.playerName
      });
      
      setSelectedShare(null);
      message.success(`正在查看 ${selectedShare.playerName} 的屏幕`);
      console.log('✅ [ScreenShareManager] 屏幕查看窗口已打开');
    } catch (error) {
      console.error('❌ [ScreenShareManager] 查看屏幕失败:', error);
      message.error('查看屏幕失败');
    }
  };

  return (
    <div className="screen-share-manager">
      {/* 共享列表 */}
      <div className="screen-share-list">
        {activeShares.length === 0 ? (
          <div className="empty-state">
            <ScreenShareIcon size={48} />
            <p>当前没有玩家共享屏幕</p>
            <p className="empty-hint">点击"开始共享"按钮分享你的屏幕</p>
          </div>
        ) : (
          <AnimatePresence mode="popLayout">
            {activeShares.map((share) => {
              const isMyShare = share.playerId === currentPlayerId;
              const isViewing = viewingShareId === share.id;
              const hasPassword = share.requirePassword && !isMyShare;

              return (
                <motion.div
                  key={share.id}
                  className={`share-item ${isMyShare ? 'my-share' : ''} ${isViewing ? 'viewing' : ''} ${hasPassword ? 'has-password' : ''}`}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  transition={{ duration: 0.3 }}
                >
                  <div className="share-item-content">
                    <div className="share-player-details">
                      <span className="share-player-name">
                        {share.playerName || '未知玩家'}
                        {isMyShare && ' (我)'}
                      </span>
                      <span className="share-start-time">
                        开始时间: {new Date(share.startTime).toLocaleTimeString()}
                      </span>
                    </div>

                    {share.requirePassword && !isMyShare && (
                      <Tooltip title="需要密码" placement="top">
                        <div className="password-badge">
                          🔒
                        </div>
                      </Tooltip>
                    )}
                  </div>

                  <motion.button
                    className="view-screen-btn"
                    onClick={() => handleViewScreen(share)}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    disabled={isViewing}
                  >
                    {isViewing ? (
                      <>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                        </svg>
                        <span>查看中</span>
                      </>
                    ) : (
                      <>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                        <span>查看</span>
                      </>
                    )}
                  </motion.button>
                </motion.div>
              );
            })}
          </AnimatePresence>
        )}
      </div>

      {/* 开始共享模态框 */}
      <Modal
        title="开始屏幕共享"
        open={showStartModal}
        onOk={handleStartSharingInternal}
        onCancel={() => {
          setShowStartModal(false);
          setPassword('');
          setRequirePassword(false);
          onStopSharing(); // 通知父组件取消
        }}
        okText="开始共享"
        cancelText="取消"
        centered
      >
        <div className="start-share-modal-content">
          <div className="modal-option">
            <span>需要密码才能查看</span>
            <Switch
              checked={requirePassword}
              onChange={setRequirePassword}
            />
          </div>

          {requirePassword && (
            <motion.div
              className="modal-password-input"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
            >
              <Input.Password
                placeholder="设置查看密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                maxLength={20}
              />
            </motion.div>
          )}

          <div className="modal-hint">
            <InfoIcon size={16} />
            <span>其他玩家将能够实时查看你的屏幕内容</span>
          </div>
        </div>
      </Modal>

      {/* 密码验证模态框 */}
      <Modal
        title="输入密码"
        open={showPasswordModal}
        onOk={handlePasswordSubmit}
        onCancel={() => {
          setShowPasswordModal(false);
          setPasswordInput('');
          setSelectedShare(null);
        }}
        okText="确认"
        cancelText="取消"
        centered
      >
        <div className="password-modal-content">
          <p>该屏幕共享需要密码才能查看</p>
          <Input.Password
            placeholder="请输入密码"
            value={passwordInput}
            onChange={(e) => setPasswordInput(e.target.value)}
            onPressEnter={handlePasswordSubmit}
            maxLength={20}
          />
        </div>
      </Modal>
    </div>
  );
};
