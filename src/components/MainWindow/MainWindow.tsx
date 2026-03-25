import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button, Space, Typography, Modal } from 'antd';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-shell';
import { useAppStore } from '../../stores';
import { LobbyForm } from '../LobbyForm/LobbyForm';
import { AboutWindow } from '../AboutWindow/AboutWindow';
import { SettingsWindow } from '../SettingsWindow';
import { SettingsIcon } from '../icons';
import { useEscapeKey } from '../../hooks';
import './MainWindow.css';

const { Title, Paragraph } = Typography;

// 软件版本号
const APP_VERSION = '1.3.2';

/**
 * 主窗口组件
 * 显示创建/加入大厅的入口
 */
export const MainWindow: React.FC = () => {
  const [showForm, setShowForm] = useState(false);
  const [formMode, setFormMode] = useState<'create' | 'join'>('create');
  const [showAbout, setShowAbout] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  
  const versionError = useAppStore((state) => state.versionError);
  const setVersionError = useAppStore((state) => state.setVersionError);

  // ESC键返回 - 在表单或关于页面时返回主界面
  useEscapeKey(() => {
    if (showForm) {
      handleCloseForm();
    } else if (showAbout) {
      handleCloseAbout();
    } else if (showSettings) {
      handleCloseSettings();
    }
  }, showForm || showAbout || showSettings);

  // 组件加载时主动拉取自动大厅配置，仅应用启动后首次触发一次
  useEffect(() => {
    // 用全局标志确保整个应用生命周期内只触发一次，避免从大厅返回主界面时重复触发
    if ((window as any).__autoLobbyTriggered) return;
    const checkAutoLobby = async () => {
      try {
        const settings = await invoke<any>('get_settings');
        if (settings.autoLobbyEnabled && settings.lobbyName && settings.lobbyPassword && settings.playerName) {
          console.log('检测到自动大厅配置，自动创建大厅:', settings.lobbyName);
          (window as any).__autoLobbyTriggered = true;
          setFormMode('create');
          (window as any).__autoLobbyConfig = {
            lobbyName: settings.lobbyName,
            lobbyPassword: settings.lobbyPassword,
            playerName: settings.playerName,
            useDomain: settings.useDomain || false,
          };
          setShowForm(true);
        } else {
          // 未触发也标记，避免反复查询
          (window as any).__autoLobbyTriggered = true;
        }
      } catch (e) {
        console.error('检查自动大厅配置失败:', e);
      }
    };
    // 延迟500ms等待窗口完全渲染
    const timer = setTimeout(checkAutoLobby, 500);
    return () => clearTimeout(timer);
  }, []);

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
            let url = versionError.downloadUrl;
            if (!url.startsWith('http://') && !url.startsWith('https://')) {
              url = `https://${url}`;
            }
            await open(url);
          } catch (error) {
            console.error('打开官网失败:', error);
          }
          setVersionError(null);
        },
        onCancel: () => {
          console.log('用户关闭了版本错误弹窗');
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

  const handleShowSettings = () => {
    setShowSettings(true);
  };

  const handleCloseSettings = () => {
    setShowSettings(false);
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
      <AboutWindow onClose={handleCloseAbout} />
    );
  }

  if (showForm) {
    return (
      <LobbyForm mode={formMode} onClose={handleCloseForm} />
    );
  }

  return (
    <div className="main-window">
      {/* 拖拽区域 - 只在顶部 */}
      <div className="main-window-drag-area" data-tauri-drag-region>
        {/* 右上角设置按钮 */}
        <motion.button
          className="settings-button"
          onClick={handleShowSettings}
          whileHover={{ scale: 1.1, rotate: 30 }}
          whileTap={{ scale: 0.9 }}
          transition={{ type: 'spring', stiffness: 400, damping: 17 }}
          title="设置"
        >
          <SettingsIcon size={20} color="rgba(255, 255, 255, 0.7)" />
        </motion.button>
      </div>
      
      <motion.div
        className="main-window-content"
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
      >
        <motion.div
          className="main-window-logo"
          initial={{ scale: 0.8, opacity: 0, rotate: -10 }}
          animate={{ scale: 1, opacity: 1, rotate: 0 }}
          transition={{ delay: 0.1, duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
        >
          <img src="/MCTierIcon.png" alt="MCTier Logo" />
        </motion.div>

        <motion.div
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.2, duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
        >
          <Title level={1} className="main-window-title">
            MCTier
          </Title>
        </motion.div>

        <motion.div
          initial={{ y: -15, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.3, duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
        >
          <Paragraph className="main-window-subtitle">
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
              transition={{ duration: 0.08, ease: [0.4, 0, 0.2, 1] }}
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
              transition={{ duration: 0.08, ease: [0.4, 0, 0.2, 1] }}
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
              transition={{ duration: 0.08, ease: [0.4, 0, 0.2, 1] }}
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
              transition={{ duration: 0.08, ease: [0.4, 0, 0.2, 1] }}
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
        >
          v{APP_VERSION}
        </motion.div>
      </motion.div>

      {/* 设置界面 - 作为overlay覆盖在主界面上，避免透明闪烁 */}
      <AnimatePresence>
        {showSettings && (
          <motion.div
            key="settings-overlay"
            className="settings-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <SettingsWindow onClose={handleCloseSettings} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
