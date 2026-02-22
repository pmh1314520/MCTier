import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { getCurrentWindow } from '@tauri-apps/api/window';
import './ScreenViewer.css';

interface ScreenViewerProps {
  shareId: string;
  playerName: string;
}

export const ScreenViewer: React.FC<ScreenViewerProps> = ({ shareId, playerName }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    // 从全局状态获取媒体流
    const stream = (window as any).__screenShareStream__;
    
    if (stream && videoRef.current) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().then(() => {
        setIsLoading(false);
      }).catch((err) => {
        console.error('播放视频失败:', err);
        setError('播放视频失败');
        setIsLoading(false);
      });
    } else {
      setError('未找到屏幕共享流');
      setIsLoading(false);
    }

    return () => {
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };
  }, [shareId]);

  // 切换全屏
  const toggleFullscreen = async () => {
    const appWindow = getCurrentWindow();
    const isCurrentlyFullscreen = await appWindow.isFullscreen();
    
    if (isCurrentlyFullscreen) {
      await appWindow.setFullscreen(false);
      setIsFullscreen(false);
    } else {
      await appWindow.setFullscreen(true);
      setIsFullscreen(true);
    }
  };

  // 关闭窗口
  const handleClose = async () => {
    const appWindow = getCurrentWindow();
    await appWindow.close();
  };

  return (
    <div className="screen-viewer">
      {/* 顶部控制栏 */}
      <motion.div
        className="viewer-controls"
        initial={{ y: -100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.3 }}
      >
        <div className="viewer-info">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
          </svg>
          <span>{playerName} 的屏幕</span>
        </div>

        <div className="viewer-actions">
          <motion.button
            className="viewer-btn"
            onClick={toggleFullscreen}
            title={isFullscreen ? '退出全屏' : '全屏'}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
          >
            {isFullscreen ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
              </svg>
            )}
          </motion.button>

          <motion.button
            className="viewer-btn close-btn"
            onClick={handleClose}
            title="关闭"
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </motion.button>
        </div>
      </motion.div>

      {/* 视频显示区域 */}
      <div className="viewer-content">
        {isLoading && (
          <div className="viewer-loading">
            <div className="loading-spinner" />
            <p>正在加载屏幕...</p>
          </div>
        )}

        {error && (
          <div className="viewer-error">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <p>{error}</p>
          </div>
        )}

        <video
          ref={videoRef}
          className="viewer-video"
          autoPlay
          playsInline
          style={{ display: isLoading || error ? 'none' : 'block' }}
        />
      </div>
    </div>
  );
};
