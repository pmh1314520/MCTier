import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Form, Input, Switch, message } from 'antd';
import { invoke } from '@tauri-apps/api/core';
import { useEscapeKey } from '../../hooks';
import './SettingsWindow.css';

export const SettingsWindow: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(true);
  const [autoLobbyEnabled, setAutoLobbyEnabled] = useState(false);
  const [autoStartup, setAutoStartup] = useState(false);
  const [useDomain, setUseDomain] = useState(false);
  const [usePrivateServer, setUsePrivateServer] = useState(false);
  const [alwaysOnTop, setAlwaysOnTop] = useState(true);
  const [rememberWindowPosition, setRememberWindowPosition] = useState(false);
  // 用ref保存完整设置，避免Switch切换时丢失输入框的已填数据
  const settingsRef = useRef<Record<string, any>>({});

  useEscapeKey(onClose, true);

  useEffect(() => {
    const loadSettings = async () => {
      // 设置超时保护
      const timeoutId = setTimeout(() => {
        console.error('加载设置超时');
        message.error('加载设置超时，请重试');
        setLoading(false);
      }, 5000); // 5秒超时

      try {
        console.log('开始加载设置...');
        const settings = await invoke<any>('get_settings');
        console.log('设置加载成功:', settings);
        
        clearTimeout(timeoutId); // 清除超时定时器
        
        const as_ = settings.autoStartup || false;
        const al = settings.autoLobbyEnabled || false;
        const ud = settings.useDomain || false;
        const ups = settings.usePrivateServer || false;
        const aot = settings.alwaysOnTop ?? true;
        const rwp = settings.rememberWindowPosition ?? false;
        setAutoStartup(as_);
        setAutoLobbyEnabled(al);
        setUseDomain(ud);
        setUsePrivateServer(ups);
        setAlwaysOnTop(aot);
        setRememberWindowPosition(rwp);
        settingsRef.current = {
          autoStartup: as_,
          autoLobbyEnabled: al,
          lobbyName: settings.lobbyName || '',
          lobbyPassword: settings.lobbyPassword || '',
          playerName: settings.playerName || '',
          useDomain: ud,
          usePrivateServer: ups,
          // 只在后端返回 null/undefined 时使用默认值
          privateEasytierServer: settings.privateEasytierServer ?? 'wss://mctiers.pmhs.top',
          privateSignalingServer: settings.privateSignalingServer ?? 'wss://mctier.pmhs.top/signaling',
          alwaysOnTop: aot,
          rememberWindowPosition: rwp,
        };
        form.setFieldsValue(settingsRef.current);
      } catch (e) {
        clearTimeout(timeoutId); // 清除超时定时器
        console.error('加载设置失败:', e);
        message.error({
          content: '加载设置失败，将使用默认配置',
          duration: 3,
        });
        
        // 使用默认配置
        const defaultSettings = {
          autoStartup: false,
          autoLobbyEnabled: false,
          lobbyName: '',
          lobbyPassword: '',
          playerName: '',
          useDomain: false,
          usePrivateServer: false,
          privateEasytierServer: 'wss://mctiers.pmhs.top',
          privateSignalingServer: 'wss://mctier.pmhs.top/signaling',
          alwaysOnTop: true,
          rememberWindowPosition: false,
        };
        
        setAutoStartup(false);
        setAutoLobbyEnabled(false);
        setUseDomain(false);
        setUsePrivateServer(false);
        setAlwaysOnTop(true);
        setRememberWindowPosition(false);
        settingsRef.current = defaultSettings;
        form.setFieldsValue(defaultSettings);
      } finally {
        setLoading(false);
      }
    };
    loadSettings();
  }, [form]);

  // 保存时始终合并ref中的完整数据，避免因表单字段未显示而丢失数据
  const saveAll = useCallback(async (patch?: Record<string, any>) => {
    const formValues = form.getFieldsValue();
    const merged = { ...settingsRef.current, ...formValues, ...patch };
    settingsRef.current = merged;
    try {
      await invoke('save_settings', {
        autoStartup: merged.autoStartup ?? false,
        autoLobbyEnabled: merged.autoLobbyEnabled ?? false,
        lobbyName: merged.lobbyName || null,
        lobbyPassword: merged.lobbyPassword || null,
        playerName: merged.playerName || null,
        useDomain: merged.useDomain ?? false,
        usePrivateServer: merged.usePrivateServer ?? false,
        // 私有服务器配置：如果有值就保存，没有值就保存 null
        privateEasytierServer: merged.privateEasytierServer?.trim() || null,
        privateSignalingServer: merged.privateSignalingServer?.trim() || null,
        alwaysOnTop: merged.alwaysOnTop ?? true,
        rememberWindowPosition: merged.rememberWindowPosition ?? false,
      });
      message.success('已保存', 1);
    } catch (e) {
      console.error('保存设置失败:', e);
      message.error('保存失败');
    }
  }, [form]);

  const handleAutoStartupChange = async (v: boolean) => {
    setAutoStartup(v);
    form.setFieldValue('autoStartup', v);
    await saveAll({ autoStartup: v });
  };

  const handleAutoLobbyChange = async (v: boolean) => {
    setAutoLobbyEnabled(v);
    form.setFieldValue('autoLobbyEnabled', v);
    // 只更新enabled状态，保留ref里的lobbyName/lobbyPassword/playerName
    await saveAll({ autoLobbyEnabled: v });
  };

  const handleFieldBlur = async () => {
    // 如果启用了自动大厅，验证自动大厅字段
    if (autoLobbyEnabled) {
      try {
        await form.validateFields(['lobbyName', 'lobbyPassword', 'playerName']);
      } catch (_) {
        // 验证失败，不保存
        return;
      }
    }
    
    // 如果启用了私有服务器，验证私有服务器字段
    if (usePrivateServer) {
      try {
        await form.validateFields(['privateEasytierServer', 'privateSignalingServer']);
      } catch (_) {
        // 验证失败，不保存
        return;
      }
    }
    
    // 验证通过，保存所有设置
    await saveAll();
  };

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.07, delayChildren: 0.05 } },
  };
  const itemVariants = {
    hidden: { opacity: 0, y: 18 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.4, 0, 0.2, 1] } },
  };

  if (loading) {
    return (
      <div className="settings-window">
        <div className="settings-drag-area" data-tauri-drag-region />
        <div className="settings-loading"><span className="settings-btn-spinner" /></div>
      </div>
    );
  }

  return (
    <div className="settings-window">
      <div className="settings-drag-area" data-tauri-drag-region />
      <div className="settings-bg-orb settings-bg-orb-1" />
      <div className="settings-bg-orb settings-bg-orb-2" />
      <div className="settings-window-scroll">
        <motion.div className="settings-window-inner" variants={containerVariants} initial="hidden" animate="visible">
          <motion.div className="settings-header" variants={itemVariants}>
            <div className="settings-header-left">
              <div className="settings-header-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="rgba(126,211,33,0.95)">
                  <path d="M12 15.5A3.5 3.5 0 0 1 8.5 12 3.5 3.5 0 0 1 12 8.5a3.5 3.5 0 0 1 3.5 3.5 3.5 3.5 0 0 1-3.5 3.5m7.43-2.92c.04-.34.07-.69.07-1.08s-.03-.74-.07-1.08l2.32-1.82c.21-.17.27-.46.13-.7l-2.2-3.81c-.13-.24-.41-.32-.65-.24l-2.74 1.1c-.57-.44-1.18-.81-1.86-1.09L14.05 2.1c-.04-.27-.28-.46-.55-.46h-3c-.28 0-.5.19-.55.46L9.5 4.86C8.82 5.14 8.2 5.5 7.64 5.95L4.9 4.85c-.24-.09-.52 0-.65.24L2.05 8.9c-.14.24-.08.53.13.7L4.5 11.5c-.04.34-.07.7-.07 1.08s.03.74.07 1.08L2.18 15.48c-.21.17-.27.46-.13.7l2.2 3.81c.13.24.41.32.65.24l2.74-1.1c.57.44 1.18.81 1.86 1.09l.45 2.76c.05.27.27.46.55.46h3c.28 0 .5-.19.55-.46l.45-2.76c.68-.28 1.3-.65 1.86-1.09l2.74 1.1c.24.09.52 0 .65-.24l2.2-3.81c.14-.24.08-.53-.13-.7l-2.32-1.9z" />
                </svg>
              </div>
              <span className="settings-title-text">设置</span>
            </div>
            <motion.button className="settings-close-btn" onClick={onClose}
              whileHover={{ scale: 1.15, rotate: 90 }} whileTap={{ scale: 0.9 }}
              transition={{ type: 'spring', stiffness: 400, damping: 17 }}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="1" y1="1" x2="13" y2="13" />
                <line x1="13" y1="1" x2="1" y2="13" />
              </svg>
            </motion.button>
          </motion.div>

          <Form form={form} layout="vertical" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <motion.div className="settings-card" variants={itemVariants}>
              <div className="settings-card-header">
                <div className="settings-card-icon settings-card-icon-green">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M17 12h-5v5h5v-5zM16 1v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-1V1h-2zm3 18H5V8h14v11z"/>
                  </svg>
                </div>
                <span className="settings-card-title">应用启动</span>
              </div>
              <div className="settings-toggle-row">
                <div className="settings-toggle-info">
                  <span className="settings-toggle-label">开机自启动</span>
                  <span className="settings-toggle-desc">MCTier 将在系统启动时自动运行</span>
                </div>
                <Switch checked={autoStartup} onChange={handleAutoStartupChange} className="settings-switch" />
              </div>
              <div className="settings-toggle-row">
                <div className="settings-toggle-info">
                  <span className="settings-toggle-label">窗口置顶</span>
                  <span className="settings-toggle-desc">保持窗口始终显示在最前面</span>
                </div>
                <Switch checked={alwaysOnTop} onChange={async (v) => {
                  setAlwaysOnTop(v);
                  form.setFieldValue('alwaysOnTop', v);
                  await saveAll({ alwaysOnTop: v });
                }} className="settings-switch" />
              </div>
              <div className="settings-toggle-row">
                <div className="settings-toggle-info">
                  <span className="settings-toggle-label">记住窗口位置</span>
                  <span className="settings-toggle-desc">启动时恢复上次关闭时的窗口位置</span>
                </div>
                <Switch checked={rememberWindowPosition} onChange={async (v) => {
                  setRememberWindowPosition(v);
                  form.setFieldValue('rememberWindowPosition', v);
                  await saveAll({ rememberWindowPosition: v });
                }} className="settings-switch" />
              </div>
            </motion.div>

            <motion.div className="settings-card" variants={itemVariants}>
              <div className="settings-card-header">
                <div className="settings-card-icon settings-card-icon-brown">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>
                  </svg>
                </div>
                <span className="settings-card-title">自动大厅</span>
              </div>
              <div className="settings-toggle-row">
                <div className="settings-toggle-info">
                  <span className="settings-toggle-label">启动时自动创建/加入大厅</span>
                  <span className="settings-toggle-desc">MCTier 启动后自动进入指定大厅</span>
                </div>
                <Switch checked={autoLobbyEnabled} onChange={handleAutoLobbyChange} className="settings-switch" />
              </div>
              <AnimatePresence>
                {autoLobbyEnabled && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.3 }} style={{ overflow: 'hidden' }}>
                    <div className="settings-sub-form">
                      <Form.Item name="lobbyName" label="大厅名称"
                        rules={[
                          { required: true, message: '请输入大厅名称' },
                          { whitespace: true, message: '不能为空白字符' },
                          { min: 4, max: 32, message: '长度为 4-32 个字符' },
                          { pattern: /^[\u4e00-\u9fa5a-zA-Z0-9_\-\s]+$/, message: '只能含中文、字母、数字、下划线、连字符和空格' },
                        ]}>
                        <Input placeholder="4-32 个字符" maxLength={32} onBlur={handleFieldBlur} />
                      </Form.Item>
                      <Form.Item name="lobbyPassword" label="大厅密码"
                        rules={[
                          { required: true, message: '请输入密码' },
                          { min: 8, max: 32, message: '长度 8-32 个字符' },
                          { validator: (_, v) => { if (!v) return Promise.resolve(); if (!/[a-zA-Z]/.test(v)) return Promise.reject(new Error('必须含字母')); if (!/[0-9]/.test(v)) return Promise.reject(new Error('必须含数字')); return Promise.resolve(); } },
                        ]}>
                        <Input.Password placeholder="8-32 个字符，含字母和数字" maxLength={32} onBlur={handleFieldBlur} />
                      </Form.Item>
                      <Form.Item name="playerName" label="玩家名称"
                        rules={[
                          { required: true, message: '请输入玩家名称' },
                          { min: 1, max: 8, message: '长度 1-8 个字' },
                        ]}>
                        <Input placeholder="最多 8 个字" maxLength={8} onBlur={handleFieldBlur} />
                      </Form.Item>
                      <div className="settings-toggle-row settings-toggle-row-sub">
                        <div className="settings-toggle-info">
                          <span className="settings-toggle-label">使用虚拟域名</span>
                        </div>
                        <Switch
                          className="settings-switch"
                          checked={useDomain}
                          onChange={async (v) => {
                            setUseDomain(v);
                            form.setFieldValue('useDomain', v);
                            await saveAll({ useDomain: v });
                          }}
                        />
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>

            <motion.div className="settings-card" variants={itemVariants}>
              <div className="settings-card-header">
                <div className="settings-card-icon settings-card-icon-blue">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                  </svg>
                </div>
                <span className="settings-card-title">私有服务器</span>
              </div>
              <div className="settings-toggle-row">
                <div className="settings-toggle-info">
                  <span className="settings-toggle-label">使用私有服务器</span>
                  <span className="settings-toggle-desc">启用后可配置自己部署的服务器</span>
                </div>
                <Switch checked={usePrivateServer} onChange={async (v) => {
                  setUsePrivateServer(v);
                  form.setFieldValue('usePrivateServer', v);
                  await saveAll({ usePrivateServer: v });
                }} className="settings-switch" />
              </div>
              <AnimatePresence>
                {usePrivateServer && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.3 }} style={{ overflow: 'hidden' }}>
                    <div className="settings-sub-form">
                      <Form.Item name="privateEasytierServer" label="EasyTier 节点服务器"
                        rules={[
                          { required: true, message: '请输入 EasyTier 节点服务器地址' },
                          { pattern: /^(tcp|udp|ws|wss|txt):\/\/.+$/, message: '格式：tcp://、udp://、ws://、wss:// 或 txt:// 开头' },
                        ]}>
                        <Input placeholder="wss://mctiers.pmhs.top" onBlur={handleFieldBlur} />
                      </Form.Item>
                      <Form.Item name="privateSignalingServer" label="WebRTC 信令服务器"
                        rules={[
                          { required: true, message: '请输入信令服务器地址' },
                          { pattern: /^wss?:\/\/.+$/, message: '格式：ws://域名/path 或 wss://域名/path' },
                        ]}>
                        <Input placeholder="wss://mctier.pmhs.top/signaling" onBlur={handleFieldBlur} />
                      </Form.Item>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>

          </Form>
        </motion.div>
      </div>
    </div>
  );
};
