import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button, Modal, Switch, message, Tooltip } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { PasswordInput } from '../PasswordInput/PasswordInput';
import { useAppStore } from '../../stores';
import { screenShareService } from '../../services/screenShare/ScreenShareService';
import { ScreenShareIcon, InfoIcon } from '../icons';
import { useTranslation } from 'react-i18next';
import { tl } from '../../i18n';
import type { ScreenShare } from '../../types';
import './ScreenShareManager.css';

/**
 * 屏幕共享管理器组件
 * 完全独立管理屏幕共享状态，不依赖父组件
 */
export const ScreenShareManager: React.FC = () => {
  useTranslation();
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
  const videoRef = useRef<HTMLVideoElement>(null);
  const viewRequestGeneration = useRef(0);
  const activeView = useRef<string | null>(null);
  const [viewStatus, setViewStatus] = useState<'connecting' | 'playing' | 'error'>('connecting');
  const [viewError, setViewError] = useState('');
  useEffect(() => () => {
    ++viewRequestGeneration.current;
    if (activeView.current) screenShareService.stopViewingScreen(activeView.current);
  }, []);
  const [pendingStream, setPendingStream] = useState<MediaStream | null>(null);

  // ESC 关闭全屏观看时也必须通知共享服务释放 viewer 路由，否则共享者会
  // 一直认为该用户仍在观看，下一次打开可能被旧连接状态卡住。
  useEffect(() => {
    if (!viewingShareId) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      void handleStopViewing();
    };
    window.addEventListener('keydown', handleEscape, true);
    return () => window.removeEventListener('keydown', handleEscape, true);
  }, [viewingShareId]);

  // 组件挂载时检查是否有活跃的共享
  useEffect(() => {
    const checkActiveShare = () => {
      const shares = screenShareService.getActiveShares();
      const myShare = shares.find(share => share.playerId === currentPlayerId);
      if (myShare) {
        console.log('🔍 [ScreenShareManager] 检测到活跃的共享:', myShare.id);
        setMyShareId(myShare.id);
      }
      // 【修复】立即设置共享列表，不等待轮询
      setActiveShares(shares);
      console.log('📋 [ScreenShareManager] 立即加载共享列表:', shares.length, '个共享');
    };

    checkActiveShare();

    // 【修复】监听屏幕共享错误事件（例如密码错误）
    const handleScreenShareError = (event: any) => {
      const { error } = event.detail;
      console.error('❌ [ScreenShareManager] 屏幕共享错误:', error);
    };

    window.addEventListener('screen-share-error', handleScreenShareError);

    return () => {
      window.removeEventListener('screen-share-error', handleScreenShareError);
    };
  }, [currentPlayerId]);

  // 【关键修复】监听viewingShareId和pendingStream变化，自动播放视频
  useEffect(() => {
    if (viewingShareId && pendingStream && videoRef.current) {
      console.log('📺 [ScreenShareManager] useEffect: 检测到viewingShareId和pendingStream，开始播放视频');
      console.log('📺 [ScreenShareManager] viewingShareId:', viewingShareId);
      console.log('📺 [ScreenShareManager] 流信息:', {
        id: pendingStream.id,
        active: pendingStream.active,
        videoTracks: pendingStream.getVideoTracks().length,
        audioTracks: pendingStream.getAudioTracks().length
      });
      
      const playVideo = async () => {
        try {
          if (!videoRef.current) {
            console.error('❌ [ScreenShareManager] videoRef.current 为 null');
            return;
          }

          console.log('📺 [ScreenShareManager] 设置视频流到video元素');
          videoRef.current.srcObject = pendingStream;
          
          // 添加事件监听
          videoRef.current.onloadedmetadata = () => {
            console.log('📺 [ScreenShareManager] 视频元数据已加载');
            console.log('📺 [ScreenShareManager] 视频尺寸:', {
              videoWidth: videoRef.current?.videoWidth,
              videoHeight: videoRef.current?.videoHeight
            });
          };
          
          videoRef.current.onplay = () => {
            console.log('✅ [ScreenShareManager] 视频开始播放');
          };
          
          videoRef.current.onerror = (e) => {
            console.error('❌ [ScreenShareManager] 视频错误:', e);
          };
          
          console.log('📺 [ScreenShareManager] 调用video.play()...');
          await videoRef.current.play();
          console.log('✅ [ScreenShareManager] 视频播放成功');
          
          // 清空pendingStream，避免重复播放
          setPendingStream(null);
        } catch (playError: any) {
          // 忽略 AbortError，这是正常的中断行为
          if (playError.name === 'AbortError') {
            console.log('⚠️ [ScreenShareManager] 视频播放被中断（正常行为）');
          } else {
            console.error('❌ [ScreenShareManager] 视频播放失败:', playError);
            message.error(tl('视频播放失败', 'Video playback failed'));
          }
        }
      };

      playVideo();
    }
  }, [viewingShareId, pendingStream]);

  // 【修复】监听共享列表变化，如果正在查看的共享被移除，自动退出查看界面
  useEffect(() => {
    if (viewingShareId) {
      const share = activeShares.find(s => s.id === viewingShareId);
      if (!share) {
        console.log('⚠️ [ScreenShareManager] 正在查看的共享已停止，自动退出查看界面');
        message.info(tl('共享者已停止屏幕共享', 'The sharer stopped screen sharing'));
        handleStopViewing();
      }
    }
  }, [activeShares, viewingShareId]);

  // 轮询获取共享列表 - 缩短轮询间隔
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        // 从信令服务器获取共享列表
        const shares = screenShareService.getActiveShares();
        setActiveShares(shares);
      } catch (error) {
        console.error('获取共享列表失败:', error);
      }
    }, 1000); // 【修复】改为1秒轮询，避免过高频率导致时序抖动

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
      message.success(tl('屏幕共享已启动', 'Screen sharing started'));

      console.log('✅ 屏幕共享已启动:', shareId);
    } catch (error: any) {
      console.error('❌ 启动屏幕共享失败:', error);
      
      if (error.name === 'NotAllowedError') {
        message.error(tl('用户拒绝了屏幕共享权限', 'Screen share permission denied'));
      } else if (error.name === 'NotFoundError') {
        message.error(tl('未找到可共享的屏幕', 'No screen available to share'));
      } else {
        message.error(tl('启动屏幕共享失败', 'Failed to start screen sharing'));
      }
    }
  };

  // 停止共享 - 内部处理
  const handleStopSharingInternal = () => {
    if (myShareId) {
      console.log('🛑 [ScreenShareManager] 停止屏幕共享:', myShareId);
      if (viewingShareId === myShareId) void handleStopViewing();
      screenShareService.stopSharing(myShareId);
      setMyShareId(null);
      message.success(tl('屏幕共享已停止', 'Screen sharing stopped'));
    }
  };

  const openViewer = async (share: ScreenShare, viewingPassword?: string) => {
    const generation = ++viewRequestGeneration.current;
    activeView.current = share.id;
    setViewingShareId(share.id);
    setViewStatus('connecting');
    setViewError('');
    setPendingStream(null);
    try {
      const stream = share.playerId === currentPlayerId
        ? screenShareService.getLocalStream(share.id)
        : await screenShareService.requestViewScreen(share.id, viewingPassword);
      if (generation !== viewRequestGeneration.current) return;
      if (!stream) throw new Error(tl('屏幕采集尚未就绪', 'Screen capture is not ready'));
      setPendingStream(stream);
      setViewStatus('playing');
    } catch (error) {
      if (generation !== viewRequestGeneration.current) return;
      screenShareService.stopViewingScreen(share.id);
      setViewStatus('error');
      setViewError(error instanceof Error ? error.message : tl('连接失败，请重试', 'Connection failed, please retry'));
    }
  };

  const handleViewScreen = (share: ScreenShare) => {
    if (share.requirePassword && share.playerId !== currentPlayerId) {
      setSelectedShare(share);
      setShowPasswordModal(true);
      return;
    }
    void openViewer(share);
  };

  const handlePasswordSubmit = () => {
    if (!selectedShare || !passwordInput.trim()) return;
    const share = selectedShare;
    const viewingPassword = passwordInput;
    setShowPasswordModal(false);
    setSelectedShare(null);
    setPasswordInput('');
    void openViewer(share, viewingPassword);
  };

  // 停止查看屏幕
  const handleStopViewing = async () => {
    ++viewRequestGeneration.current;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    
    // 清理PeerConnection和远程流
    if (viewingShareId) {
      screenShareService.stopViewingScreen(viewingShareId);
    }
    
    setViewingShareId(null);
    activeView.current = null;
    setPendingStream(null);
    
    message.info(tl('已停止查看屏幕', 'Stopped viewing screen'));
  };

  return (
    <div className="screen-share-manager">
      {/* 全屏视频播放器 */}
      <AnimatePresence>
        {viewingShareId && (
          <motion.div
            className="fullscreen-viewer"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            <div className="viewer-controls-bar">
              <div className="viewer-info-text">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                  <line x1="8" y1="21" x2="16" y2="21" />
                  <line x1="12" y1="17" x2="12" y2="21" />
                </svg>
                <span>
                  {tl(
                    `${activeShares.find(s => s.id === viewingShareId)?.playerName || '未知玩家'} 的屏幕`,
                    `${activeShares.find(s => s.id === viewingShareId)?.playerName || 'Unknown Player'}'s screen`,
                  )}
                </span>
              </div>
              
              <motion.button
                className="stop-viewing-btn"
                onClick={handleStopViewing}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                title={tl('停止查看', 'Stop watching')}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </motion.button>
            </div>
            
            <video
              ref={videoRef}
              className="fullscreen-video"
              autoPlay
              playsInline
              muted
            />
            {viewStatus !== 'playing' && (
              <div className="viewer-status" role="status">
                {viewStatus === 'connecting' ? tl('正在连接屏幕…', 'Connecting to screen...') : viewError}
                {viewStatus === 'error' && <Button icon={<ReloadOutlined />} onClick={() => {
                  const share = activeShares.find(s => s.id === viewingShareId);
                  if (share) handleViewScreen(share);
                }}>{tl('重试', 'Retry')}</Button>}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* 共享列表 */}
      <div className="screen-share-list">
        {/* 提示信息 */}
        <div className="screen-share-hint">
          <InfoIcon size={14} />
          <span>{tl('同一个屏幕支持多人同时查看', 'The same screen can be viewed by multiple players')}</span>
        </div>
        
        {activeShares.length === 0 ? (
          <div className="empty-state">
            <ScreenShareIcon size={48} />
            <p>{tl('当前没有玩家共享屏幕', 'No one is sharing their screen')}</p>
            <p className="empty-hint">{tl('点击"开始共享"按钮分享你的屏幕', 'Click Start Sharing to share your screen')}</p>
          </div>
        ) : (
          <AnimatePresence mode="popLayout">
            {activeShares.map((share) => {
              const isMyShare = share.playerId === currentPlayerId;
              const isViewing = viewingShareId === share.id;
              const hasPassword = share.requirePassword && !isMyShare;
              const viewerCount = share.viewerCount ?? (share.viewerId ? 1 : 0);
              const isBeingViewed = viewerCount > 0;

              return (
                <motion.div
                  key={share.id}
                  className={`share-item ${isMyShare ? 'my-share' : ''} ${isViewing ? 'viewing' : ''} ${hasPassword ? 'has-password' : ''} ${isBeingViewed ? 'being-viewed' : ''}`}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  transition={{ duration: 0.3 }}
                >
                  <div className="share-item-content">
                    <div className="share-player-details">
                      <span className="share-player-name">
                        {share.playerName || tl('未知玩家', 'Unknown Player')}
                        {isMyShare && ` (${tl('我', 'Me')})`}
                      </span>
                      <span className="share-start-time">
                        {tl('创建时间', 'Created')}: {new Date(share.startTime).toLocaleTimeString()}
                      </span>
                      <span className={`viewer-info ${isBeingViewed ? 'active' : 'waiting'}`}>
                        {isBeingViewed
                          ? tl(`正在被 ${viewerCount} 人查看`, `${viewerCount} viewer${viewerCount === 1 ? '' : 's'} watching`)
                          : tl('等待玩家查看', 'Waiting for a viewer')}
                      </span>
                    </div>

                    <div className="share-badges">
                      {share.requirePassword && (
                        <Tooltip title={tl('需要密码', 'Password required')} placement="top">
                          <div className="password-badge">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <rect x="5" y="11" width="14" height="10" rx="2" ry="2" />
                              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                            </svg>
                          </div>
                        </Tooltip>
                      )}
                      {isBeingViewed && (
                        <Tooltip title={tl('正在被查看', 'Being viewed')} placement="top">
                          <div className="viewing-badge">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                              <circle cx="12" cy="12" r="3" />
                            </svg>
                          </div>
                        </Tooltip>
                      )}
                    </div>
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
                        <span>{tl('查看中', 'Viewing')}</span>
                      </>
                    ) : (
                      <>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                        <span>{tl('查看', 'View')}</span>
                      </>
                    )}
                  </motion.button>
                </motion.div>
              );
            })}
          </AnimatePresence>
        )}
      </div>

      {/* 底部控制栏 */}
      <div className="screen-share-bottom-bar">
        {!myShareId ? (
          <motion.button
            className="start-share-btn"
            onClick={() => setShowStartModal(true)}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            <ScreenShareIcon size={16} />
            <span>{tl('开始共享', 'Start Sharing')}</span>
          </motion.button>
        ) : (
          <motion.button
            className="stop-share-btn"
            onClick={handleStopSharingInternal}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="6" y="6" width="12" height="12" />
            </svg>
            <span>{tl('停止共享', 'Stop Sharing')}</span>
          </motion.button>
        )}
      </div>

      {/* 开始共享模态框 */}
      <Modal
        title={tl('开始屏幕共享', 'Start Screen Sharing')}
        open={showStartModal}
        onOk={handleStartSharingInternal}
        onCancel={() => {
          setShowStartModal(false);
          setPassword('');
          setRequirePassword(false);
        }}
        okText={tl('开始共享', 'Start Sharing')}
        cancelText={tl('取消', 'Cancel')}
        centered
      >
        <div className="start-share-modal-content">
          <div className="modal-option">
            <span>{tl('需要密码才能查看', 'Require a password to view')}</span>
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
              <PasswordInput
                placeholder={tl('设置查看密码', 'Set a viewing password')}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                maxLength={20}
              />
            </motion.div>
          )}

          <div className="modal-hint">
            <InfoIcon size={16} />
            <span>{tl('其他玩家将能够实时查看你的屏幕', 'Other players will be able to view your screen in real time')}</span>
          </div>
        </div>
      </Modal>

      {/* 密码验证模态框 */}
      <Modal
        title={tl('输入密码', 'Enter Password')}
        open={showPasswordModal}
        onOk={handlePasswordSubmit}
        onCancel={() => {
          setShowPasswordModal(false);
          setPasswordInput('');
          setSelectedShare(null);
        }}
        okText={tl('确认', 'Confirm')}
        cancelText={tl('取消', 'Cancel')}
        centered
      >
        <div className="password-modal-content">
          <p>{tl('该屏幕共享需要密码才能查看', 'This screen share requires a password to view')}</p>
          <PasswordInput
            placeholder={tl('请输入密码', 'Enter password')}
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

