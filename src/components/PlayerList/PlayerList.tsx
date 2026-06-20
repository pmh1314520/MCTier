import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Tooltip, Empty, Slider } from 'antd';
import { useTranslation } from 'react-i18next';
import { tl } from '../../i18n';
import { MicrophoneIcon, VolumeIcon } from '../icons';
import { useAppStore } from '../../stores';
import './PlayerList.css';

/**
 * 玩家列表组件
 * 显示所有在线玩家及其状态
 */
export const PlayerList: React.FC = () => {
  useTranslation();
  const players = useAppStore((state) => state.players);
  const togglePlayerMute = useAppStore((state) => state.togglePlayerMute);
  const mutedPlayers = useAppStore((state) => state.mutedPlayers);
  const setPlayerVolume = useAppStore((state) => state.setPlayerVolume);
  const getPlayerVolume = useAppStore((state) => state.getPlayerVolume);
  const applyVoiceGroupRouting = useAppStore((state) => state.applyVoiceGroupRouting);
  const speakingPlayers = useAppStore((state) => state.speakingPlayers);
  const myVoiceGroup = useAppStore((state) => state.myVoiceGroup);
  const playerVoiceGroups = useAppStore((state) => state.playerVoiceGroups);

  // 用于控制音量滑块的显示
  const [expandedPlayerId, setExpandedPlayerId] = useState<string | null>(null);

  // 统一应用静音、音量和语音频道路由，避免 UI 组件直接 unmute 打穿频道隔离。
  useEffect(() => {
    try {
      applyVoiceGroupRouting();
    } catch (error) {
      console.error('同步音频路由失败:', error);
    }
  }, [applyVoiceGroupRouting, mutedPlayers, players]);

  const handleToggleMute = (playerId: string) => {
    try {
      togglePlayerMute(playerId);
    } catch (error) {
      console.error('切换玩家静音状态失败:', error);
    }
  };

  const handleVolumeChange = (playerId: string, volume: number) => {
    try {
      setPlayerVolume(playerId, volume / 100);
    } catch (error) {
      console.error('设置玩家音量失败:', error);
    }
  };

  const toggleVolumeControl = (playerId: string) => {
    setExpandedPlayerId(expandedPlayerId === playerId ? null : playerId);
  };

  const getInitial = (name: string) => (Array.from((name || '?').trim())[0] || '?').toUpperCase();

  if (players.length === 0) {
    return (
      <div className="player-list-empty">
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={tl('暂无玩家', 'No players')}
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
          const isSameVoiceGroup = (playerVoiceGroups.get(player.id) ?? 0) === myVoiceGroup;
          const isSpeaking = speakingPlayers.has(player.id) && isSameVoiceGroup;

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
              <motion.div
                className="player-item-icon"
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: index * 0.05 + 0.1, type: 'spring', stiffness: 500 }}
              >
                <span className="player-initial">{getInitial(player.name)}</span>
              </motion.div>

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
                    </motion.span>
                  ) : (
                    <span className="player-status-badge">
                      <MicrophoneIcon enabled={false} size={12} />
                      <span>{tl('静音', 'Muted')}</span>
                    </span>
                  )}
                </div>
              </div>

              <div className="player-item-actions">
                <Tooltip title={tl('调节音量', 'Adjust volume')}>
                  <motion.div
                    className={`player-volume-toggle ${isExpanded ? 'active' : ''}`}
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={() => toggleVolumeControl(player.id)}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" />
                    </svg>
                  </motion.div>
                </Tooltip>
              </div>

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
                      <Tooltip title={isMuted ? tl('取消静音', 'Unmute') : tl('静音该玩家', 'Mute this player')}>
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

              <AnimatePresence>
                {isSpeaking && !isMuted && (
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
