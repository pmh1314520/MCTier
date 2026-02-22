import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Modal, Input, Switch, message } from 'antd';
import { invoke } from '@tauri-apps/api/core';
import { useAppStore } from '../../stores';
import { screenShareService } from '../../services/screenShare/ScreenShareService';
import { ScreenShareIcon, InfoIcon } from '../icons';
import type { ScreenShare } from '../../types';
import './ScreenShareManager.css';

export const ScreenShareManager: React.FC = () => {
  const { currentPlayerId } = useAppStore();
  const [activeShares, setActiveShares] = useState<ScreenShare[]>([]);
  const [myShareId, setMyShareId] = useState<string | null>(null);
  const [isSharing, setIsSharing] = useState(false);
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

  // 开始共享
  const handleStartSharing = async () => {
    try {
      console.log('🖥️ 开始屏幕共享...');
      setIsSharing(true);

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
      
      setIsSharing(false);
    }
  };

  // 停止共享
  const handleStopSharing = () => {
    if (myShareId) {
      screenShareService.stopSharing(myShareId);
      setMyShareId(null);
      setIsSharing(false);
      message.success('屏幕共享已停止');
    }
  };

  // 查看屏幕
  const handleViewScreen = async (share: ScreenShare) => {
    try {
      // 如果需要密码
      if (share.requirePassword && share.playerId !== currentPlayerId) {
        setSelectedShare(share);
        setShowPasswordModal(true);
        return;
      }

      await startViewing(share);
    } catch (error) {
      console.error('❌ 查看屏幕失败:', error);
      message.error('查看屏幕失败');
    }
  };

  // 开始查看（验证密码后）
  const startViewing = async (share: ScreenShare, pwd?: string) => {
    try {
      console.log('👀 开始查看屏幕:', share.id);

      // 请求查看屏幕
      await screenShareService.requestViewScreen(share.id, pwd);

      // 打开独立的查看窗口
      await invoke('open_screen_viewer_window', {
        shareId: share.id,
        playerName: share.playerName,
      });

      setViewingShareId(share.id);
      setShowPasswordModal(false);
      setPasswordInput('');
      message.success(`正在查看 ${share.playerName} 的屏幕`);

      console.log('✅ 屏幕查看窗口已打开');
    } catch (error) {
      console.error('❌ 查看屏幕失败:', error);
      message.error('查看屏幕失败');
    }
  };

  // 验证密码并查看
  const handlePasswordSubmit = () => {
    if (!selectedShare) return;

    if (!passwordInput.trim()) {
      message.warning('请输入密码');
      return;
    }

    startViewing(selectedShare, passwordInput);
  };

  return (
    <div className="screen-share-manager">
      {/* 顶部操作栏 */}
      <div className="screen-share-header">
        <div className="screen-share-title-wrapper">
          <h3 className="screen-share-title">屏幕共享</h3>
          <div className="screen-share-info-icon" title="查看和共享屏幕给大厅内的其他玩家">
            <InfoIcon size={14} />
          </div>
        </div>

        {!isSharing ? (
          <motion.button
            className="start-share-btn"
            onClick={() => setShowStartModal(true)}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            <ScreenShareIcon size={18} />
            <span>开始共享</span>
          </motion.button>
        ) : (
          <motion.button
            className="stop-share-btn"
            onClick={handleStopSharing}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="6" y="6" width="12" height="12" />
            </svg>
            <span>停止共享</span>
          </motion.button>
        )}
      </div>

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

              return (
                <motion.div
                  key={share.id}
                  className={`share-item ${isMyShare ? 'my-share' : ''} ${isViewing ? 'viewing' : ''}`}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  transition={{ duration: 0.3 }}
                >
                  <div className="share-item-header">
                    <div className="share-player-info">
                      <div className="share-player-avatar">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                          <circle cx="12" cy="7" r="4" />
                        </svg>
                      </div>
                      <div className="share-player-details">
                        <span className="share-player-name">
                          {share.playerName}
                          {isMyShare && ' (我)'}
                        </span>
                        <span className="share-start-time">
                          {new Date(share.startTime).toLocaleTimeString()}
                        </span>
                      </div>
                    </div>

                    {share.requirePassword && !isMyShare && (
                      <div className="password-badge" title="需要密码">
                        🔒
                      </div>
                    )}
                  </div>

                  {!isMyShare && (
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
                          <span>正在查看</span>
                        </>
                      ) : (
                        <>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                            <circle cx="12" cy="12" r="3" />
                          </svg>
                          <span>查看屏幕</span>
                        </>
                      )}
                    </motion.button>
                  )}
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
        onOk={handleStartSharing}
        onCancel={() => {
          setShowStartModal(false);
          setPassword('');
          setRequirePassword(false);
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
