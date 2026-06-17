import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button, Tooltip, message, Slider } from 'antd';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import { tl } from '../../i18n';
import { MicrophoneIcon, VolumeIcon } from '../icons';
import { useAppStore } from '../../stores';
import { webrtcClient } from '../../services';
import './VoiceControls.css';

/**
 * 语音控制组件
 * 提供麦克风和全局静音控制
 */
export const VoiceControls: React.FC = () => {
  useTranslation();
  const micEnabled = useAppStore((state) => state.micEnabled);
  const globalMuted = useAppStore((state) => state.globalMuted);
  const toggleMic = useAppStore((state) => state.toggleMic);
  const toggleGlobalMute = useAppStore((state) => state.toggleGlobalMute);
  const mutedPlayers = useAppStore((state) => state.mutedPlayers);
  const applyVoiceGroupRouting = useAppStore((state) => state.applyVoiceGroupRouting);
  
  const [micLoading, setMicLoading] = useState(false);
  const [muteLoading, setMuteLoading] = useState(false);
  const [volume, setVolume] = useState(100); // 音量百分比 (0-100)
  const [volumeLoading, setVolumeLoading] = useState(true);
  
  // 使用固定的快捷键提示
  const micHotkey = 'Ctrl+M';
  const globalMuteHotkey = 'Ctrl+T';

  // 加载音量设置
  useEffect(() => {
    const loadVolume = async () => {
      try {
        const settings = await invoke<any>('get_settings');
        const savedVolume = settings.voiceVolume ?? 1.0;
        setVolume(Math.round(savedVolume * 100));
        // 应用音量到 WebRTC 客户端
        webrtcClient.setVolume(savedVolume);
      } catch (error) {
        console.error('加载音量设置失败:', error);
      } finally {
        setVolumeLoading(false);
      }
    };
    loadVolume();
  }, []);

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
      applyVoiceGroupRouting();
    } catch (error) {
      console.error('同步全局静音状态失败:', error);
    }
  }, [applyVoiceGroupRouting, globalMuted, mutedPlayers]);

  // 处理麦克风切换
  const handleToggleMic = async () => {
    try {
      setMicLoading(true);
      toggleMic();
      message.success(micEnabled ? tl('麦克风已关闭', 'Microphone off') : tl('麦克风已开启', 'Microphone on'));
    } catch (error) {
      console.error('切换麦克风失败:', error);
      message.error(tl('麦克风操作失败，请重试', 'Microphone operation failed, please retry'));
    } finally {
      setTimeout(() => setMicLoading(false), 300);
    }
  };

  // 处理全局静音切换
  const handleToggleGlobalMute = async () => {
    try {
      setMuteLoading(true);
      toggleGlobalMute();
      message.success(globalMuted ? tl('已取消全局静音', 'Global mute disabled') : tl('已开启全局静音', 'Global mute enabled'));
    } catch (error) {
      console.error('切换全局静音失败:', error);
      message.error(tl('静音操作失败，请重试', 'Mute operation failed, please retry'));
    } finally {
      setTimeout(() => setMuteLoading(false), 300);
    }
  };

  // 处理音量变化
  const handleVolumeChange = async (value: number) => {
    setVolume(value);
    const volumeValue = value / 100;
    
    // 应用音量到 WebRTC 客户端
    webrtcClient.setVolume(volumeValue);
    
    // 保存音量设置
    try {
      await invoke('save_voice_volume', { volume: volumeValue });
    } catch (error) {
      console.error('保存音量设置失败:', error);
    }
  };

  return (
    <div className="voice-controls">
      {/* 音量控制滑块 */}
      {!volumeLoading && (
        <motion.div
          className="voice-control-item volume-slider-container"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <div className="volume-slider-label">
            <VolumeIcon muted={volume === 0} size={16} />
            <span>{tl('音量', 'Volume')}: {volume}%</span>
          </div>
          <Slider
            min={0}
            max={100}
            value={volume}
            onChange={handleVolumeChange}
            tooltip={{ formatter: (value) => `${value}%` }}
            className="volume-slider"
          />
        </motion.div>
      )}

      {/* 麦克风控制 */}
      <motion.div
        className="voice-control-item"
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.3 }}
      >
        <Tooltip
          title={micEnabled ? `${tl('关闭麦克风', 'Turn off microphone')} (${micHotkey})` : `${tl('开启麦克风', 'Turn on microphone')} (${micHotkey})`}
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
                {micEnabled ? tl('麦克风开启', 'Mic On') : tl('麦克风关闭', 'Mic Off')}
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
          title={globalMuted ? `${tl('取消全局静音', 'Disable global mute')} (${globalMuteHotkey})` : `${tl('全局静音所有玩家', 'Mute all players')} (${globalMuteHotkey})`}
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
                {globalMuted ? tl('全局静音中', 'Muted') : tl('全局音量', 'Global Volume')}
              </span>
            </Button>
          </motion.div>
        </Tooltip>
      </motion.div>
    </div>
  );
};
