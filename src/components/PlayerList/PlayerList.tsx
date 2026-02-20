import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button, Tooltip, Empty } from 'antd';
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
        {players.map((player, index) => (
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
              <Tooltip title={mutedPlayers.has(player.id) ? '取消静音' : '静音该玩家'}>
                <motion.div whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}>
                  <Button
                    type="text"
                    size="small"
                    icon={<VolumeIcon muted={mutedPlayers.has(player.id)} size={18} />}
                    onClick={() => handleToggleMute(player.id)}
                    className={`player-mute-button ${mutedPlayers.has(player.id) ? 'muted' : ''}`}
                  />
                </motion.div>
              </Tooltip>
            </div>

            {/* 说话动画指示器 */}
            <AnimatePresence>
              {player.micEnabled && !mutedPlayers.has(player.id) && (
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
        ))}
      </AnimatePresence>
    </div>
  );
};
