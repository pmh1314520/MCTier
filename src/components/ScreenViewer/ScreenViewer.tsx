import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { useTranslation } from 'react-i18next';
import { tl } from '../../i18n';
import { screenShareService } from '../../services/screenShare/ScreenShareService';
import './ScreenViewer.css';

interface ScreenViewerProps {
  shareId: string;
  playerName: string;
}

export const ScreenViewer: React.FC<ScreenViewerProps> = ({ shareId, playerName }) => {
  useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    console.log('🎬 [ScreenViewer] 组件已挂载，shareId:', shareId);
    
    let checkInterval: ReturnType<typeof setInterval> | undefined;
    let attempts = 0;
    const maxAttempts = 100; // 10秒超时

    const checkForStream = async () => {
      attempts++;
      
      try {
        console.log(`⏳ [ScreenViewer] 尝试从服务获取流... (${attempts}/${maxAttempts})`);
        
        // 从screenShareService获取流
        const stream = screenShareService.getRemoteStream(shareId);
        
        if (stream && stream.active) {
          console.log('✅ [ScreenViewer] 从服务获取到屏幕流');
          
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            await videoRef.current.play();
            setIsLoading(false);
            console.log('✅ [ScreenViewer] 视频播放成功');
            
            if (checkInterval) {
              clearInterval(checkInterval);
            }
            return;
          }
        }
        
        // 如果超时
        if (attempts >= maxAttempts) {
          console.error('❌ [ScreenViewer] 等待屏幕流超时');
          setError(tl('无法获取屏幕共享流，请重试', 'Unable to get the screen share stream, please retry'));
          setIsLoading(false);
          if (checkInterval) {
            clearInterval(checkInterval);
          }
        }
      } catch (err) {
        console.error('❌ [ScreenViewer] 获取流时出错:', err);
        
        if (attempts >= maxAttempts) {
          setError(tl('获取屏幕共享流失败', 'Failed to get the screen share stream'));
          setIsLoading(false);
          if (checkInterval) {
            clearInterval(checkInterval);
          }
        }
      }
    };

    // 立即检查一次
    checkForStream();

    // 开始轮询
    checkInterval = setInterval(checkForStream, 100);

    return () => {
      if (checkInterval) {
        clearInterval(checkInterval);
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };
  }, [shareId]);

  // 添加关闭窗口的处理
  const handleClose = async () => {
    const currentWindow = getCurrentWebviewWindow();
    await currentWindow.close();
  };

  return (
    <div className="screen-viewer">
      {/* 顶部信息栏 */}
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
          <span>{playerName} {tl('的屏幕', '\'s Screen')}</span>
        </div>
        
        <button className="close-viewer-btn" onClick={handleClose} title={tl('关闭', 'Close')}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </motion.div>

      {/* 视频显示区域 */}
      <div className="viewer-content">
        {isLoading && (
          <div className="viewer-loading">
            <div className="loading-spinner" />
            <p>{tl('正在加载屏幕...', 'Loading screen...')}</p>
          </div>
        )}

        {error && (
          <div className="viewer-error">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v5" strokeLinecap="round" />
              <circle cx="12" cy="16" r="0.8" fill="currentColor" stroke="none" />
            </svg>
            <p>{error}</p>
            <button className="retry-btn" onClick={handleClose}>
              {tl('关闭窗口', 'Close Window')}
            </button>
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


