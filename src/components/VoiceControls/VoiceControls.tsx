import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button, Tooltip, message } from 'antd';
import { MicrophoneIcon, VolumeIcon } from '../icons';
import { useAppStore } from '../../stores';
import { webrtcClient } from '../../services';
import './VoiceControls.css';

/**
 * 语音控制组件
 * 提供麦克风和全局静音控制
 */
export const VoiceControls: React.FC = () => {
  const micEnabled = useAppStore((state) => state.micEnabled);
  const globalMuted = useAppStore((state) => state.globalMuted);
  const toggleMic = useAppStore((state) => state.toggleMic);
  const toggleGlobalMute = useAppStore((state) => state.toggleGlobalMute);
  const mutedPlayers = useAppStore((state) => state.mutedPlayers);
  
  const [micLoading, setMicLoading] = useState(false);
  const [muteLoading, setMuteLoading] = useState(false);

  // 同步麦克风状态到WebRTC客户端
  useEffect(() => {
    const syncMicState = async () => {
      try {
        await webrtcClient.setMicEnabled(micEnabled);
      } catch (error) {
        console.error('同步麦克风状态失败:', error);
      }
    };
    
    syncMicState();
  }, [micEnabled]);

  // 同步全局静音状态到WebRTC客户端
  useEffect(() => {
    try {
      if (globalMuted) {
        webrtcClient.muteAllPlayers();
      } else {
        webrtcClient.unmuteAllPlayers();
        // 恢复之前被单独静音的玩家
        mutedPlayers.forEach((playerId) => {
          webrtcClient.mutePlayer(playerId);
        });
      }
    } catch (error) {
      console.error('同步全局静音状态失败:', error);
    }
  }, [globalMuted, mutedPlayers]);

  // 处理麦克风切换
  const handleToggleMic = async () => {
    try {
      setMicLoading(true);
      toggleMic();
      message.success(micEnabled ? '麦克风已关闭' : '麦克风已开启');
    } catch (error) {
      console.error('切换麦克风失败:', error);
      message.error('麦克风操作失败，请重试');
    } finally {
      setTimeout(() => setMicLoading(false), 300);
    }
  };

  // 处理全局静音切换
  const handleToggleGlobalMute = async () => {
    try {
      setMuteLoading(true);
      toggleGlobalMute();
      message.success(globalMuted ? '已取消全局静音' : '已开启全局静音');
    } catch (error) {
      console.error('切换全局静音失败:', error);
      message.error('静音操作失败，请重试');
    } finally {
      setTimeout(() => setMuteLoading(false), 300);
    }
  };

  return (
    <div className="voice-controls">
      {/* 麦克风控制 */}
      <motion.div
        className="voice-control-item"
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.3 }}
      >
        <Tooltip
          title={micEnabled ? '关闭麦克风 (Ctrl+M)' : '开启麦克风 (Ctrl+M)'}
          placement="top"
        >
          <motion.div
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 400, damping: 17 }}
          >
            <Button
              type={micEnabled ? 'primary' : 'default'}
              size="large"
              icon={<MicrophoneIcon enabled={micEnabled} size={20} />}
              onClick={handleToggleMic}
              loading={micLoading}
              className={`voice-control-button mic-button ${micEnabled ? 'active' : ''}`}
              block
            >
              <span className="voice-control-label">
                {micEnabled ? '麦克风开启' : '麦克风关闭'}
              </span>
            </Button>
          </motion.div>
        </Tooltip>

        {/* 麦克风活动指示器 */}
        <AnimatePresence>
          {micEnabled && (
            <motion.div
              className="voice-activity-indicator"
              initial={{ opacity: 0, scale: 0 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0 }}
              transition={{ duration: 0.2 }}
            >
              <div className="activity-bar" />
              <div className="activity-bar" />
              <div className="activity-bar" />
              <div className="activity-bar" />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* 全局静音控制 */}
      <motion.div
        className="voice-control-item"
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.3, delay: 0.1 }}
      >
        <Tooltip
          title={globalMuted ? '取消全局静音' : '全局静音所有玩家'}
          placement="top"
        >
          <motion.div
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 400, damping: 17 }}
          >
            <Button
              type={globalMuted ? 'primary' : 'default'}
              size="large"
              danger={globalMuted}
              icon={<VolumeIcon muted={globalMuted} size={20} />}
              onClick={handleToggleGlobalMute}
              loading={muteLoading}
              className={`voice-control-button mute-button ${globalMuted ? 'active' : ''}`}
              block
            >
              <span className="voice-control-label">
                {globalMuted ? '全局静音中' : '全局音量'}
              </span>
            </Button>
          </motion.div>
        </Tooltip>
      </motion.div>
    </div>
  );
};
