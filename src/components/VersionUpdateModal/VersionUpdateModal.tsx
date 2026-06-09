import React, { useState } from 'react';
import { Modal, App as AntdApp } from 'antd';
import { motion } from 'framer-motion';
import { open } from '@tauri-apps/plugin-shell';
import { updaterService } from '../../services/version/UpdaterService';
import './VersionUpdateModal.css';

interface VersionUpdateModalProps {
  visible: boolean;
  latestVersion: string;
  currentVersion: string;
  updateMessage: string[];
  onClose: () => void;
}

/**
 * 版本更新提示弹窗组件
 * 支持应用内一键下载并自动安装更新（Tauri updater）
 */
export const VersionUpdateModal: React.FC<VersionUpdateModalProps> = ({
  visible,
  latestVersion,
  currentVersion,
  updateMessage,
  onClose,
}) => {
  const { message } = AntdApp.useApp();
  const [updating, setUpdating] = useState(false);
  const [percent, setPercent] = useState(0);
  const [phase, setPhase] = useState<'idle' | 'downloading' | 'installing'>('idle');

  // 应用内一键更新：下载 → 安装 → 重启
  const handleUpdate = async () => {
    if (updating) return;
    setUpdating(true);
    setPhase('downloading');
    setPercent(0);
    try {
      await updaterService.downloadAndInstall((downloaded, total) => {
        if (total > 0) {
          const p = Math.min(100, Math.round((downloaded / total) * 100));
          setPercent(p);
          if (p >= 100) setPhase('installing');
        }
      });
      setPhase('installing');
      message.success('更新已下载完成，即将重启应用…');
      // 安装完成后重启应用
      setTimeout(() => {
        void updaterService.relaunchApp();
      }, 800);
    } catch (error) {
      console.error('❌ 自动更新失败:', error);
      message.error('自动更新失败，将为你打开下载页面');
      // 失败兜底：打开下载页面
      try {
        await open('https://gitee.com/peng-minghang/mctier/releases');
      } catch { /* ignore */ }
      setUpdating(false);
      setPhase('idle');
    }
  };

  return (
    <Modal
      title={
        <div className="version-update-modal-title">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          <span>发现新版本</span>
        </div>
      }
      open={visible}
      onCancel={updating ? undefined : onClose}
      maskClosable={!updating}
      closable={!updating}
      footer={null}
      centered
      width={420}
      className="version-update-modal"
    >
      <div className="version-update-content">
        {/* 版本信息 */}
        <div className="version-info-section">
          <div className="version-info-item">
            <span className="version-number current">v{currentVersion}</span>
          </div>
          <div className="version-arrow">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </div>
          <div className="version-info-item">
            <span className="version-number latest">v{latestVersion}</span>
          </div>
        </div>

        {/* 更新日志 */}
        <div className="update-log-section">
          <div className="update-log-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <polyline points="10 9 9 9 8 9" />
            </svg>
            <span>更新内容</span>
          </div>
          <div className="update-log-list">
            {updateMessage.map((item, index) => (
              <motion.div
                key={index}
                className="update-log-item"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.05, duration: 0.3 }}
              >
                <span className="update-log-bullet">•</span>
                <span className="update-log-text">{item}</span>
              </motion.div>
            ))}
          </div>
        </div>

        {/* 下载进度 */}
        {updating && (
          <div className="version-update-progress">
            <div className="version-update-progress-bar">
              <div
                className="version-update-progress-fill"
                style={{ width: `${percent}%` }}
              />
            </div>
            <div className="version-update-progress-text">
              {phase === 'installing' ? '正在安装，请稍候…' : `正在下载更新… ${percent}%`}
            </div>
          </div>
        )}

        {/* 操作按钮 */}
        <div className="version-update-actions">
          <motion.button
            className="version-update-btn later"
            onClick={onClose}
            disabled={updating}
            whileHover={updating ? undefined : { scale: 1.02 }}
            whileTap={updating ? undefined : { scale: 0.98 }}
          >
            稍后更新
          </motion.button>
          <motion.button
            className="version-update-btn download"
            onClick={handleUpdate}
            disabled={updating}
            whileHover={updating ? undefined : { scale: 1.02 }}
            whileTap={updating ? undefined : { scale: 0.98 }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            <span>{updating ? '更新中…' : '立即更新'}</span>
          </motion.button>
        </div>
      </div>
    </Modal>
  );
};
