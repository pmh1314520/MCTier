import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button, Tooltip } from 'antd';
import { useTranslation } from 'react-i18next';
import { tl } from '../../i18n';
import { ChevronIcon, CloseIcon } from '../icons';
import { PlayerList } from '../PlayerList/PlayerList';
import { VoiceControls } from '../VoiceControls/VoiceControls';
import { NetworkDiagnostic } from '../NetworkDiagnostic/NetworkDiagnostic';
import { useAppStore } from '../../stores';
import { audioService } from '../../services';
import './StatusWindow.css';

interface StatusWindowProps {
  onClose?: () => void;
}

/**
 * 悬浮状态窗口组件
 * PUBG 风格的游戏内状态显示
 */
export const StatusWindow: React.FC<StatusWindowProps> = ({ onClose }) => {
  useTranslation();
  const [collapsed, setCollapsed] = useState(false);
  const [position, setPosition] = useState({ x: 20, y: 20 });
  const [isDragging, setIsDragging] = useState(false);
  const [showDiagnostic, setShowDiagnostic] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number } | null>(null);

  const { lobby, players } = useAppStore();

  // 监听玩家数量变化，播放音效
  const prevPlayerCountRef = useRef(players.length);
  useEffect(() => {
    const prevCount = prevPlayerCountRef.current;
    const currentCount = players.length;
    
    if (currentCount > prevCount) {
      // 有玩家加入
      audioService.play('userJoined').catch(err => {
        console.error('播放用户加入音效失败:', err);
      });
    } else if (currentCount < prevCount) {
      // 有玩家离开
      audioService.play('userLeft').catch(err => {
        console.error('播放用户离开音效失败:', err);
      });
    }
    
    prevPlayerCountRef.current = currentCount;
  }, [players.length]);

  // 处理拖拽开始
  const handleMouseDown = (e: React.MouseEvent) => {
    // 检查是否点击的是按钮
    const target = e.target as HTMLElement;
    if (target.closest('button')) {
      return; // 如果点击的是按钮，不触发拖拽
    }
    
    setIsDragging(true);
    dragRef.current = {
      startX: e.clientX - position.x,
      startY: e.clientY - position.y,
    };
  };

  // 处理拖拽移动
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging || !dragRef.current) return;

      const newX = e.clientX - dragRef.current.startX;
      const newY = e.clientY - dragRef.current.startY;

      // 限制在窗口范围内
      const maxX = window.innerWidth - 320;
      const maxY = window.innerHeight - 400;

      setPosition({
        x: Math.max(0, Math.min(newX, maxX)),
        y: Math.max(0, Math.min(newY, maxY)),
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      dragRef.current = null;
    };

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  // 切换收起/展开
  const handleToggleCollapse = () => {
    setCollapsed(!collapsed);
  };

  // 处理关闭
  const handleClose = () => {
    if (onClose) {
      onClose();
    }
  };

  return (
    <motion.div
      className={`status-window ${collapsed ? 'collapsed' : ''} ${isDragging ? 'dragging' : ''}`}
      style={{
        position: 'fixed',
        left: position.x,
        top: position.y,
      }}
      initial={{ opacity: 0, scale: 0.8, y: -20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.8, y: -20 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
    >
      {/* 头部 */}
      <motion.div
        className="status-window-header"
        onMouseDown={handleMouseDown}
        style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
        whileHover={{ backgroundColor: 'rgba(17, 153, 142, 0.25)' }}
        transition={{ duration: 0.2 }}
      >
        <div className="status-window-header-left">
          <motion.div
            className="status-window-indicator"
            animate={{
              scale: [1, 1.2, 1],
              opacity: [1, 0.6, 1],
            }}
            transition={{
              duration: 2,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
          />
          <span className="status-window-title">
            {lobby?.name || tl('大厅', 'Lobby')}
          </span>
        </div>

        <div className="status-window-header-right">
          <motion.span
            className="status-window-player-count"
            key={players.length}
            initial={{ scale: 1.3 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 500, damping: 15 }}
          >
            {players.length} {tl('人', '')}
          </motion.span>

          <Tooltip title={collapsed ? tl('展开', 'Expand') : tl('收起', 'Collapse')}>
            <Button
              type="text"
              size="small"
              icon={<ChevronIcon direction={collapsed ? 'down' : 'up'} size={16} />}
              onClick={handleToggleCollapse}
              className="status-window-header-button"
            />
          </Tooltip>

          <Tooltip title={tl('退出大厅', 'Leave Lobby')}>
            <Button
              type="text"
              size="small"
              icon={<CloseIcon size={16} />}
              onClick={handleClose}
              className="status-window-header-button close-button"
            />
          </Tooltip>
        </div>
      </motion.div>

      {/* 内容区域 */}
      <AnimatePresence>
        {!collapsed && (
          <motion.div
            className="status-window-content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
          >
            {/* 语音控制 */}
            <motion.div
              className="status-window-section"
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1, duration: 0.2 }}
            >
              <VoiceControls />
            </motion.div>

            {/* 玩家列表 */}
            <motion.div
              className="status-window-section"
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15, duration: 0.2 }}
            >
              <div className="status-window-section-title">{tl('玩家列表', 'Players')}</div>
              <PlayerList />
            </motion.div>

            {/* 虚拟 IP 信息 */}
            {lobby?.virtualIp && (
              <motion.div
                className="status-window-section"
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2, duration: 0.2 }}
              >
                <div className="status-window-info">
                  <span className="status-window-info-label">{tl('虚拟 IP:', 'Virtual IP:')}</span>
                  <span className="status-window-info-value">
                    {lobby.virtualIp}
                  </span>
                </div>
                <Button
                  type="default"
                  size="small"
                  onClick={() => setShowDiagnostic(true)}
                  className="diagnostic-button"
                  style={{ marginTop: '8px', width: '100%' }}
                >
                  🔍 {tl('网络诊断', 'Network Diagnostics')}
                </Button>
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* 网络诊断弹窗 */}
      <NetworkDiagnostic
        visible={showDiagnostic}
        onClose={() => setShowDiagnostic(false)}
        virtualIp={lobby?.virtualIp}
      />
    </motion.div>
  );
};
