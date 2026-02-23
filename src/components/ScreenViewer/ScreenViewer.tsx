import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import './ScreenViewer.css';

interface ScreenViewerProps {
  shareId: string;
  playerName: string;
}

export const ScreenViewer: React.FC<ScreenViewerProps> = ({ shareId, playerName }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    console.log('🎬 [ScreenViewer] 组件已挂载，shareId:', shareId);
    
    // 尝试从主窗口获取流（如果是从主窗口打开的）
    const mainWindowStream = (window.opener as any)?.__screenShareStream__;
    
    if (mainWindowStream) {
      console.log('✅ [ScreenViewer] 从window.opener获取到屏幕流');
      
      if (videoRef.current) {
        videoRef.current.srcObject = mainWindowStream;
        videoRef.current.play().then(() => {
          setIsLoading(false);
          console.log('✅ [ScreenViewer] 视频播放成功');
        }).catch((err) => {
          console.error('❌ [ScreenViewer] 播放视频失败:', err);
          setError('播放视频失败');
          setIsLoading(false);
        });
      }
      return;
    }

    // 如果window.opener不可用，尝试从全局变量获取
    let checkInterval: ReturnType<typeof setInterval> | undefined;
    let attempts = 0;
    const maxAttempts = 50; // 减少到5秒

    const checkForStream = () => {
      // 尝试从全局变量获取流
      const stream = (window as any).__screenShareStream__;
      
      if (stream) {
        console.log('✅ [ScreenViewer] 从全局变量获取到屏幕流');
        
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().then(() => {
            setIsLoading(false);
            console.log('✅ [ScreenViewer] 视频播放成功');
          }).catch((err) => {
            console.error('❌ [ScreenViewer] 播放视频失败:', err);
            setError('播放视频失败');
            setIsLoading(false);
          });
        }
        
        if (checkInterval) {
          clearInterval(checkInterval);
        }
      } else {
        attempts++;
        console.log(`⏳ [ScreenViewer] 等待屏幕流... (${attempts}/${maxAttempts})`);
        
        if (attempts >= maxAttempts) {
          console.error('❌ [ScreenViewer] 等待屏幕流超时');
          setError('未找到屏幕共享流');
          setIsLoading(false);
          if (checkInterval) {
            clearInterval(checkInterval);
          }
        }
      }
    };

    // 立即检查一次
    checkForStream();

    // 如果没有找到，开始轮询
    if (!(window as any).__screenShareStream__) {
      checkInterval = setInterval(checkForStream, 100);
    }

    return () => {
      if (checkInterval) {
        clearInterval(checkInterval);
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };
  }, [shareId]);

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
          <span>{playerName} 的屏幕</span>
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
              <path d="M12 8v5" strokeLinecap="round" />
              <circle cx="12" cy="16" r="0.8" fill="currentColor" stroke="none" />
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
