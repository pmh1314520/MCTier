import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Modal, Input, Switch, message, Tooltip } from 'antd';
import { getCurrentWindow, PhysicalSize } from '@tauri-apps/api/window';
import { useAppStore } from '../../stores';
import { screenShareService } from '../../services/screenShare/ScreenShareService';
import { ScreenShareIcon, InfoIcon } from '../icons';
import type { ScreenShare } from '../../types';
import './ScreenShareManager.css';

/**
 * 屏幕共享管理器组件
 * 完全独立管理屏幕共享状态，不依赖父组件
 */
export const ScreenShareManager: React.FC = () => {
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
  const [originalWindowSize, setOriginalWindowSize] = useState<{ width: number; height: number } | null>(null);
  const [pendingStream, setPendingStream] = useState<MediaStream | null>(null);

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
            message.error('视频播放失败');
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
        message.info('共享者已停止屏幕共享');
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
      console.log('🛑 [ScreenShareManager] 停止屏幕共享:', myShareId);
      screenShareService.stopSharing(myShareId);
      setMyShareId(null);
      message.success('屏幕共享已停止');
    }
  };

  // 查看屏幕 - 在当前窗口全屏显示
  const handleViewScreen = async (share: ScreenShare) => {
    try {
      // 如果需要密码，弹出密码输入框（包括自己的共享）
      if (share.requirePassword) {
        setSelectedShare(share);
        setShowPasswordModal(true);
        return;
      }

      console.log('👀 [ScreenShareManager] 开始查看屏幕:', share.id);
      console.log('👀 [ScreenShareManager] 共享者:', share.playerName);
      console.log('👀 [ScreenShareManager] 共享者ID:', share.playerId);
      console.log('👀 [ScreenShareManager] 是否是自己的共享:', share.playerId === currentPlayerId);
      console.log('👀 [ScreenShareManager] 共享信息:', {
        requirePassword: share.requirePassword,
        hasPassword: !!share.password,
        password: share.password ? '***' : undefined
      });

      // 【修复】先保存当前窗口大小，再请求查看屏幕
      try {
        const appWindow = getCurrentWindow();
        const currentSize = await appWindow.innerSize();
        setOriginalWindowSize({ width: currentSize.width, height: currentSize.height });
        console.log('💾 [ScreenShareManager] 已保存原始窗口大小:', { width: currentSize.width, height: currentSize.height });
        
        // 放大窗口到适合观看屏幕共享的尺寸
        await appWindow.setSize(new PhysicalSize(1280, 800));
        await appWindow.setResizable(true);
        console.log('✅ [ScreenShareManager] 窗口已放大并允许调整大小');
      } catch (error) {
        console.error('❌ [ScreenShareManager] 调整窗口大小失败:', error);
      }

      // 先请求查看屏幕（建立WebRTC连接并获取流）
      // 不需要密码的共享直接查看
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
      
      // 【关键修复】先设置pendingStream，再设置viewingShareId
      // 这样useEffect会在video元素渲染后自动播放
      setPendingStream(stream);
      setViewingShareId(share.id);
      
      message.success(`正在查看 ${share.playerName} 的屏幕`);
      console.log('✅ [ScreenShareManager] 已设置viewingShareId和pendingStream，等待useEffect播放视频');
    } catch (error) {
      console.error('❌ [ScreenShareManager] 查看屏幕失败:', error);
      message.error('查看屏幕失败');
    }
  };

  // 验证密码并查看 - 在当前窗口全屏显示
  const handlePasswordSubmit = async () => {
    if (!selectedShare) return;

    if (!passwordInput.trim()) {
      message.warning('请输入密码');
      return;
    }

    try {
      console.log('👀 [ScreenShareManager] 验证密码后开始查看屏幕:', selectedShare.id);
      console.log('🔐 [ScreenShareManager] 发送的密码:', passwordInput ? '***' : 'undefined');

      // 【关键修复】添加超时机制，如果30秒内没有响应，认为密码错误或服务器未响应
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error('等待响应超时，请检查密码是否正确或信令服务器是否正常'));
        }, 30000);
      });

      // 【关键修复】先请求查看屏幕（建立WebRTC连接并获取流），如果密码错误会抛出异常
      const stream = await Promise.race([
        screenShareService.requestViewScreen(selectedShare.id, passwordInput),
        timeoutPromise
      ]);
      
      console.log('✅ [ScreenShareManager] 密码验证成功，已获取屏幕流');
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

      // 密码验证成功后，关闭密码弹窗
      setShowPasswordModal(false);
      setPasswordInput('');
      
      // 保存selectedShare的引用，因为后面会清空它
      const shareToView = selectedShare;
      setSelectedShare(null);

      // 保存当前窗口大小
      try {
        const appWindow = getCurrentWindow();
        const currentSize = await appWindow.innerSize();
        setOriginalWindowSize({ width: currentSize.width, height: currentSize.height });
        console.log('💾 [ScreenShareManager] 已保存原始窗口大小:', { width: currentSize.width, height: currentSize.height });
        
        // 放大窗口到适合观看屏幕共享的尺寸
        await appWindow.setSize(new PhysicalSize(1280, 800));
        await appWindow.setResizable(true);
        console.log('✅ [ScreenShareManager] 窗口已放大并允许调整大小');
      } catch (error) {
        console.error('❌ [ScreenShareManager] 调整窗口大小失败:', error);
      }

      // 【关键修复】先设置pendingStream，再设置viewingShareId
      // 这样useEffect会在video元素渲染后自动播放
      setPendingStream(stream);
      setViewingShareId(shareToView.id);
      
      message.success(`正在查看 ${shareToView.playerName} 的屏幕`);
      console.log('✅ [ScreenShareManager] 已设置viewingShareId和pendingStream，等待useEffect播放视频');
    } catch (error: any) {
      console.error('❌ [ScreenShareManager] 查看屏幕失败:', error);
      
      // 【修复】显示具体的错误信息
      const errorMessage = error?.message || '查看屏幕失败';
      message.error(errorMessage);
      
      // 密码错误或其他错误，保持在密码输入界面
      console.log('⚠️ [ScreenShareManager] 保持在密码输入界面，等待用户重新输入');
      
      // 【重要】不要关闭密码输入框，让用户可以重新输入
      // setShowPasswordModal(false);
      // setPasswordInput('');
      // setSelectedShare(null);
    }
  };

  // 停止查看屏幕
  const handleStopViewing = async () => {
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    
    // 清理PeerConnection和远程流
    if (viewingShareId) {
      screenShareService.stopViewingScreen(viewingShareId);
    }
    
    setViewingShareId(null);
    setPendingStream(null);
    
    // 恢复原窗口大小，但保持允许调整大小
    if (originalWindowSize) {
      try {
        const appWindow = getCurrentWindow();
        await appWindow.setSize(new PhysicalSize(originalWindowSize.width, originalWindowSize.height));
        // 【修复】保持窗口可调整大小，不要禁止
        await appWindow.setResizable(true);
        console.log('✅ [ScreenShareManager] 窗口已恢复原大小，保持可调整');
      } catch (error) {
        console.error('❌ [ScreenShareManager] 恢复窗口大小失败:', error);
      }
      setOriginalWindowSize(null);
    }
    
    message.info('已停止查看屏幕');
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
                  {activeShares.find(s => s.id === viewingShareId)?.playerName || '未知玩家'} 的屏幕
                </span>
              </div>
              
              <motion.button
                className="stop-viewing-btn"
                onClick={handleStopViewing}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                title="停止查看"
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
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* 共享列表 */}
      <div className="screen-share-list">
        {/* 提示信息 */}
        <div className="screen-share-hint">
          <InfoIcon size={14} />
          <span>每个屏幕同时仅支持被一名玩家查看</span>
        </div>
        
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
              const isBeingViewed = !!share.viewerId; // 是否正在被查看

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
                        {share.playerName || '未知玩家'}
                        {isMyShare && ' (我)'}
                      </span>
                      <span className="share-start-time">
                        创建时间: {new Date(share.startTime).toLocaleTimeString()}
                      </span>
                      {isBeingViewed && (
                        <span className="viewer-info">
                          正在被 {share.viewerName} 查看
                        </span>
                      )}
                    </div>

                    <div className="share-badges">
                      {share.requirePassword && (
                        <Tooltip title="需要密码" placement="top">
                          <div className="password-badge">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <rect x="5" y="11" width="14" height="10" rx="2" ry="2" />
                              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                            </svg>
                          </div>
                        </Tooltip>
                      )}
                      {isBeingViewed && (
                        <Tooltip title="正在被查看" placement="top">
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
                    style={{ display: isBeingViewed ? 'none' : 'flex' }}
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
            <span>开始共享</span>
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
            <span>停止共享</span>
          </motion.button>
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
            <span>其他玩家将能够实时查看你的屏幕</span>
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

