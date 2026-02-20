import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Button, Space, Typography, Modal } from 'antd';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-shell';
import { useAppStore } from '../../stores';
import { LobbyForm } from '../LobbyForm/LobbyForm';
import { AboutWindow } from '../AboutWindow/AboutWindow';
import './MainWindow.css';

const { Title, Paragraph } = Typography;

// 软件版本号
const APP_VERSION = '1.1.0';

/**
 * 主窗口组件
 * 显示创建/加入大厅的入口
 */
export const MainWindow: React.FC = () => {
  const [showForm, setShowForm] = useState(false);
  const [formMode, setFormMode] = useState<'create' | 'join'>('create');
  const [showAbout, setShowAbout] = useState(false);
  
  const versionError = useAppStore((state) => state.versionError);
  const setVersionError = useAppStore((state) => state.setVersionError);

  // 监听版本错误并显示弹窗
  useEffect(() => {
    if (versionError) {
      console.log('MainWindow检测到版本错误，显示弹窗');
      
      Modal.warning({
        title: '版本过低',
        content: (
          <div style={{ lineHeight: '1.8' }}>
            <p style={{ marginBottom: '12px' }}>
              您的 MCTier 版本过低，无法连接到大厅。
            </p>
            <p style={{ marginBottom: '8px', color: 'rgba(255,255,255,0.8)' }}>
              当前版本: {versionError.currentVersion}
            </p>
            <p style={{ marginBottom: '12px', color: 'rgba(255,255,255,0.8)' }}>
              最低要求: {versionError.minimumVersion}
            </p>
            <p style={{ color: 'rgba(255,255,255,0.6)' }}>
              请前往官网下载最新版本
            </p>
          </div>
        ),
        okText: '前往官网',
        centered: true,
        onOk: async () => {
          console.log('用户点击了"前往官网"按钮');
          try {
            await open(versionError.downloadUrl);
          } catch (error) {
            console.error('打开官网失败:', error);
          }
          // 清除版本错误状态
          setVersionError(null);
        },
        onCancel: () => {
          console.log('用户关闭了版本错误弹窗');
          // 清除版本错误状态
          setVersionError(null);
        },
      });
    }
  }, [versionError, setVersionError]);

  const handleCreateLobby = () => {
    setFormMode('create');
    setShowForm(true);
  };

  const handleJoinLobby = () => {
    setFormMode('join');
    setShowForm(true);
  };

  const handleCloseForm = () => {
    setShowForm(false);
  };

  const handleShowAbout = () => {
    setShowAbout(true);
  };

  const handleCloseAbout = () => {
    setShowAbout(false);
  };



  const handleCloseApp = async () => {
    try {
      console.log('正在关闭应用...');
      await invoke('exit_app');
    } catch (error) {
      console.error('关闭应用失败:', error);
    }
  };

  if (showAbout) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
      >
        <AboutWindow onClose={handleCloseAbout} />
      </motion.div>
    );
  }

  if (showForm) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
      >
        <LobbyForm mode={formMode} onClose={handleCloseForm} />
      </motion.div>
    );
  }

  return (
    <div className="main-window" data-tauri-drag-region>
      <motion.div
        className="main-window-content"
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
      >
        <motion.div
          className="main-window-logo"
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.1, duration: 0.4, ease: 'easeOut' }}
          data-tauri-drag-region
        >
          <img src="/MCTierIcon.png" alt="MCTier Logo" data-tauri-drag-region />
        </motion.div>

        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.2, duration: 0.4, ease: 'easeOut' }}
          data-tauri-drag-region
        >
          <Title level={1} className="main-window-title" data-tauri-drag-region>
            MCTier
          </Title>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3, duration: 0.4 }}
          data-tauri-drag-region
        >
          <Paragraph className="main-window-subtitle" data-tauri-drag-region>
            Minecraft 虚拟局域网联机工具
          </Paragraph>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.4 }}
          style={{ marginBottom: '32px' }}
        >
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <motion.div
              whileHover={{ scale: 1.008 }}
              whileTap={{ scale: 0.96 }}
              transition={{ 
                duration: 0.08,
                ease: [0.4, 0, 0.2, 1]
              }}
            >
              <Button
                type="primary"
                size="large"
                block
                onClick={handleCreateLobby}
                className="main-window-button create-button"
              >
                创建大厅
              </Button>
            </motion.div>

            <motion.div
              whileHover={{ scale: 1.008 }}
              whileTap={{ scale: 0.96 }}
              transition={{ 
                duration: 0.08,
                ease: [0.4, 0, 0.2, 1]
              }}
            >
              <Button
                size="large"
                block
                onClick={handleJoinLobby}
                className="main-window-button join-button"
              >
                加入大厅
              </Button>
            </motion.div>

            <motion.div
              whileHover={{ scale: 1.008 }}
              whileTap={{ scale: 0.96 }}
              transition={{ 
                duration: 0.08,
                ease: [0.4, 0, 0.2, 1]
              }}
            >
              <Button
                size="large"
                block
                onClick={handleShowAbout}
                className="main-window-button about-button"
              >
                关于软件
              </Button>
            </motion.div>

            <motion.div
              whileHover={{ scale: 1.008 }}
              whileTap={{ scale: 0.96 }}
              transition={{ 
                duration: 0.08,
                ease: [0.4, 0, 0.2, 1]
              }}
            >
              <Button
                size="large"
                block
                onClick={handleCloseApp}
                className="main-window-button close-app-button"
              >
                退出软件
              </Button>
            </motion.div>
          </Space>
        </motion.div>

        <motion.div
          className="main-window-version"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6, duration: 0.4 }}
          data-tauri-drag-region
        >
          v{APP_VERSION}
        </motion.div>
      </motion.div>
    </div>
  );
};
