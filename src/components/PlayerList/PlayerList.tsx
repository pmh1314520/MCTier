import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Tooltip, Empty, Slider } from 'antd';
import { MicrophoneIcon, VolumeIcon, PlayerIcon } from '../icons';
import { useAppStore } from '../../stores';
import { webrtcClient } from '../../services';
import './PlayerList.css';

/**
 * 玩家列表组件
 * 显示所有在线玩家及其状态
 */
export const PlayerList: React.FC = () => {
  const players = useAppStore((state) => state.players);
  const togglePlayerMute = useAppStore((state) => state.togglePlayerMute);
  const mutedPlayers = useAppStore((state) => state.mutedPlayers);
  const setPlayerVolume = useAppStore((state) => state.setPlayerVolume);
  const getPlayerVolume = useAppStore((state) => state.getPlayerVolume);
  
  // 用于控制音量滑块的显示
  const [expandedPlayerId, setExpandedPlayerId] = useState<string | null>(null);

  // 同步静音状态到WebRTC客户端
  useEffect(() => {
    try {
      // 对所有玩家应用静音状态
      players.forEach((player) => {
        if (mutedPlayers.has(player.id)) {
          webrtcClient.mutePlayer(player.id);
        } else {
          webrtcClient.unmutePlayer(player.id);
        }
      });
    } catch (error) {
      console.error('同步静音状态失败:', error);
    }
  }, [mutedPlayers, players]);

  // 处理静音切换
  const handleToggleMute = (playerId: string) => {
    try {
      togglePlayerMute(playerId);
    } catch (error) {
      console.error('切换玩家静音状态失败:', error);
    }
  };

  // 处理音量变化
  const handleVolumeChange = (playerId: string, volume: number) => {
    try {
      setPlayerVolume(playerId, volume / 100);
    } catch (error) {
      console.error('设置玩家音量失败:', error);
    }
  };

  // 切换音量控制显示
  const toggleVolumeControl = (playerId: string) => {
    setExpandedPlayerId(expandedPlayerId === playerId ? null : playerId);
  };

  if (players.length === 0) {
    return (
      <div className="player-list-empty">
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="暂无玩家"
          style={{ margin: 0 }}
        />
      </div>
    );
  }

  return (
    <div className="player-list">
      <AnimatePresence mode="popLayout">
        {players.map((player, index) => {
          const isMuted = mutedPlayers.has(player.id);
          const volume = Math.round(getPlayerVolume(player.id) * 100);
          const isExpanded = expandedPlayerId === player.id;

          return (
            <motion.div
              key={player.id}
              className="player-item"
              initial={{ opacity: 0, x: -30, scale: 0.9 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 30, scale: 0.9 }}
              transition={{
                duration: 0.3,
                delay: index * 0.05,
                ease: 'easeOut',
              }}
              layout
              whileHover={{ scale: 1.02 }}
            >
              {/* 玩家图标 */}
              <motion.div
                className="player-item-icon"
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: index * 0.05 + 0.1, type: 'spring', stiffness: 500 }}
              >
                <PlayerIcon online={true} size={20} />
              </motion.div>

              {/* 玩家信息 */}
              <div className="player-item-info">
                <div className="player-item-name">{player.name}</div>
                <div className="player-item-status">
                  {player.micEnabled ? (
                    <motion.span
                      className="player-status-badge active"
                      initial={{ scale: 0.8 }}
                      animate={{ scale: 1 }}
                      transition={{ type: 'spring', stiffness: 500 }}
                    >
                      <MicrophoneIcon enabled={true} size={12} />
                      <span>说话中</span>
                    </motion.span>
                  ) : (
                    <span className="player-status-badge">
                      <MicrophoneIcon enabled={false} size={12} />
                      <span>静音</span>
                    </span>
                  )}
                </div>
              </div>

              {/* 操作按钮 */}
              <div className="player-item-actions">
                {/* 音量控制按钮 */}
                <Tooltip title="调节音量">
                  <motion.div
                    className={`player-volume-toggle ${isExpanded ? 'active' : ''}`}
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={() => toggleVolumeControl(player.id)}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>
                    </svg>
                  </motion.div>
                </Tooltip>
              </div>

              {/* 音量滑块 - 展开时显示 */}
              <AnimatePresence>
                {isExpanded && (
                  <motion.div
                    className="player-volume-slider-container"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <div className="player-volume-slider-wrapper">
                      {/* 听筒图标 - 点击切换静音 */}
                      <Tooltip title={isMuted ? '取消静音' : '静音该玩家'}>
                        <motion.div
                          className="player-volume-icon-inline"
                          whileHover={{ scale: 1.1 }}
                          whileTap={{ scale: 0.9 }}
                          onClick={() => handleToggleMute(player.id)}
                        >
                          <VolumeIcon muted={isMuted} size={18} />
                        </motion.div>
                      </Tooltip>
                      <Slider
                        value={volume}
                        onChange={(value) => handleVolumeChange(player.id, value)}
                        disabled={isMuted}
                        tooltip={{ formatter: (value) => `${value}%` }}
                        className="player-volume-slider"
                      />
                      <span className="volume-value">{volume}%</span>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* 说话动画指示器 */}
              <AnimatePresence>
                {player.micEnabled && !isMuted && (
                  <motion.div
                    className="player-speaking-indicator"
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <div className="speaking-wave" />
                    <div className="speaking-wave" />
                    <div className="speaking-wave" />
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
};
