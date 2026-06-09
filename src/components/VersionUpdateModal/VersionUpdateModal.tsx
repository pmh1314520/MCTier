import React from 'react';
import { Modal } from 'antd';
import { motion } from 'framer-motion';
import { open } from '@tauri-apps/plugin-shell';
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
 */
export const VersionUpdateModal: React.FC<VersionUpdateModalProps> = ({
  visible,
  latestVersion,
  currentVersion,
  updateMessage,
  onClose,
}) => {
  // 打开下载页面
  const handleDownload = async () => {
    try {
      await open('https://gitee.com/peng-minghang/mctier/releases');
      onClose();
    } catch (error) {
      console.error('❌ 打开下载页面失败:', error);
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
      onCancel={onClose}
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

        {/* 操作按钮 */}
        <div className="version-update-actions">
          <motion.button
            className="version-update-btn later"
            onClick={onClose}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            稍后更新
          </motion.button>
          <motion.button
            className="version-update-btn download"
            onClick={handleDownload}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            <span>立即下载</span>
          </motion.button>
        </div>
      </div>
    </Modal>
  );
};
