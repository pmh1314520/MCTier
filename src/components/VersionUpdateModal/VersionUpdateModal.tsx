import React, { useEffect, useState } from 'react';
import { Modal, message } from 'antd';
import { motion } from 'framer-motion';
import { open } from '@tauri-apps/plugin-shell';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { versionCheckService } from '../../services/version/VersionCheckService';
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
  const [updating, setUpdating] = useState(false);
  const [progress, setProgress] = useState(0);

  // 监听下载进度事件
  useEffect(() => {
    if (!updating) return;
    let unlisten: (() => void) | undefined;
    listen<{ downloaded: number; total: number }>('update-download-progress', (e) => {
      const { downloaded, total } = e.payload;
      if (total > 0) {
        setProgress(Math.min(100, Math.round((downloaded / total) * 100)));
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      if (unlisten) unlisten();
    };
  }, [updating]);

  // 客户端内一键更新：下载最新安装包并运行
  const handleDownload = async () => {
    if (updating) return;
    try {
      setUpdating(true);
      setProgress(0);
      message.loading({ content: '正在获取最新安装包…', key: 'mctier-update', duration: 0 });

      const url = await versionCheckService.fetchLatestInstallerUrl();
      if (!url) {
        message.destroy('mctier-update');
        message.warning('未找到可下载的安装包，将打开下载页面');
        await open('https://gitee.com/peng-minghang/mctier/releases');
        setUpdating(false);
        onClose();
        return;
      }

      message.loading({ content: '正在下载并更新，请勿关闭软件…', key: 'mctier-update', duration: 0 });
      // 下载完成后后端会自动运行安装包并退出应用
      await invoke('download_and_run_installer', { url });
      message.destroy('mctier-update');
      message.success('下载完成，即将启动安装程序…');
    } catch (error) {
      console.error('❌ 客户端内更新失败:', error);
      message.destroy('mctier-update');
      message.error('更新失败，将打开下载页面');
      try {
        await open('https://gitee.com/peng-minghang/mctier/releases');
      } catch (_) {
        // ignore
      }
      setUpdating(false);
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
            disabled={updating}
            whileHover={{ scale: updating ? 1 : 1.02 }}
            whileTap={{ scale: updating ? 1 : 0.98 }}
          >
            稍后更新
          </motion.button>
          <motion.button
            className="version-update-btn download"
            onClick={handleDownload}
            disabled={updating}
            whileHover={{ scale: updating ? 1 : 1.02 }}
            whileTap={{ scale: updating ? 1 : 0.98 }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            <span>{updating ? `更新中 ${progress}%` : '立即更新'}</span>
          </motion.button>
        </div>
      </div>
    </Modal>
  );
};
