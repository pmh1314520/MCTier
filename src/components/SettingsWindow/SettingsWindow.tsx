import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Form, Input, Switch, message, Tooltip, App, Slider, Button } from 'antd';
import { invoke } from '@tauri-apps/api/core';
import { useEscapeKey } from '../../hooks';
import { RestartConfirmModal } from '../RestartConfirmModal/RestartConfirmModal';
import { GlobalAdvancedConfigPanel } from '../GlobalAdvancedConfigPanel/GlobalAdvancedConfigPanel';
import { StatsPanel } from '../StatsPanel/StatsPanel';
import { useTranslation } from 'react-i18next';
import { setLanguage, getLanguage, tl } from '../../i18n';
import { audioService, type SoundType } from '../../services/audio/AudioService';
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
  const [enableGpuRendering, setEnableGpuRendering] = useState(true);
  const [showRestartModal, setShowRestartModal] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const { t } = useTranslation();
  const [lang, setLang] = useState<'zh' | 'en'>(getLanguage());
  const [pendingGpuValue, setPendingGpuValue] = useState(true);
  // 用ref保存完整设置，避免Switch切换时丢失输入框的已填数据
  const settingsRef = useRef<Record<string, any>>({});

  useEscapeKey(onClose, true);

  // 提取加载设置的逻辑为独立函数，方便重用
  const loadSettings = useCallback(async () => {
    // 设置超时保护
    const timeoutId = setTimeout(() => {
      console.error('加载设置超时');
      message.error(tl('加载设置超时，请重试', 'Loading settings timed out, please retry'));
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
      const egr = settings.enableGpuRendering ?? true;
      setAutoStartup(as_);
      setAutoLobbyEnabled(al);
      setUseDomain(ud);
      setUsePrivateServer(ups);
      setAlwaysOnTop(aot);
      setRememberWindowPosition(rwp);
      setEnableGpuRendering(egr);
      settingsRef.current = {
        autoStartup: as_,
        autoLobbyEnabled: al,
        lobbyName: settings.lobbyName || '',
        lobbyPassword: settings.lobbyPassword || '',
        playerName: settings.playerName || '',
        useDomain: ud,
        usePrivateServer: ups,
        // 只在后端返回 null/undefined 时使用默认值
        privateEasytierServer: settings.privateEasytierServer ?? 'udp://us01.225284.xyz:11010',
        privateSignalingServer: settings.privateSignalingServer ?? 'wss://mctier.pmhs.top/signaling',
        alwaysOnTop: aot,
        rememberWindowPosition: rwp,
        enableGpuRendering: egr,
        // 出口节点配置
        enableExitNode: settings.enableExitNode || false,
        enableAsExitNode: settings.enableAsExitNode || false,
        proxyCidrs: settings.proxyCidrs || '',
        exitNodes: settings.exitNodes || '',
        subnetProxyCidrs: settings.subnetProxyCidrs || '',
      };
      form.setFieldsValue(settingsRef.current);
    } catch (e) {
      clearTimeout(timeoutId); // 清除超时定时器
      console.error('加载设置失败:', e);
      message.error({
        content: tl('加载设置失败，将使用默认配置', 'Failed to load settings, using defaults'),
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
        privateEasytierServer: 'udp://us01.225284.xyz:11010',
        privateSignalingServer: 'wss://mctier.pmhs.top/signaling',
        alwaysOnTop: true,
        rememberWindowPosition: false,
        enableGpuRendering: true,
        enableExitNode: false,
        enableAsExitNode: false,
        proxyCidrs: '',
        exitNodes: '',
        subnetProxyCidrs: '',
      };
      
      setAutoStartup(false);
      setAutoLobbyEnabled(false);
      setUseDomain(false);
      setUsePrivateServer(false);
      setAlwaysOnTop(true);
      setRememberWindowPosition(false);
      setEnableGpuRendering(true);
      settingsRef.current = defaultSettings;
      form.setFieldsValue(defaultSettings);
    } finally {
      setLoading(false);
    }
  }, [form]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  // 监听配置导入事件
  useEffect(() => {
    const handleConfigImported = () => {
      console.log('检测到配置导入，重新加载设置...');
      loadSettings();
    };

    window.addEventListener('configImported', handleConfigImported);
    return () => {
      window.removeEventListener('configImported', handleConfigImported);
    };
  }, [loadSettings]);

  // 保存时始终合并ref中的完整数据，避免因表单字段未显示而丢失数据
  const saveAll = useCallback(async (patch?: Record<string, any>) => {
    // 先更新 settingsRef，确保最新的值被保存
    const formValues = form.getFieldsValue(true); // 获取所有字段值，包括未渲染的
    const merged = { ...settingsRef.current, ...formValues, ...patch };
    settingsRef.current = merged;
    
    // 同步更新表单值
    if (patch) {
      Object.keys(patch).forEach(key => {
        form.setFieldValue(key, patch[key]);
      });
    }
    
    try {
      await invoke('save_settings', {
        autoStartup: merged.autoStartup ?? false,
        autoLobbyEnabled: merged.autoLobbyEnabled ?? false,
        lobbyName: merged.lobbyName || null,
        lobbyPassword: merged.lobbyPassword || null,
        playerName: merged.playerName || null,
        useDomain: merged.useDomain ?? false,
        virtualDomain: merged.virtualDomain || null,
        usePrivateServer: merged.usePrivateServer ?? false,
        // 私有服务器配置：如果有值就保存，没有值就保存 null
        privateEasytierServer: merged.privateEasytierServer?.trim() || null,
        privateSignalingServer: merged.privateSignalingServer?.trim() || null,
        alwaysOnTop: merged.alwaysOnTop !== undefined ? merged.alwaysOnTop : true,
        rememberWindowPosition: merged.rememberWindowPosition !== undefined ? merged.rememberWindowPosition : false,
        enableGpuRendering: merged.enableGpuRendering !== undefined ? merged.enableGpuRendering : true,
        // 出口节点配置
        enableExitNode: merged.enableExitNode !== undefined ? merged.enableExitNode : null,
        enableAsExitNode: merged.enableAsExitNode !== undefined ? merged.enableAsExitNode : null,
        proxyCidrs: merged.proxyCidrs?.trim() || null,
        exitNodes: merged.exitNodes?.trim() || null,
        subnetProxyCidrs: merged.subnetProxyCidrs?.trim() || null,
      });
      console.log('设置已保存:', merged);
      message.success(tl('已保存', 'Saved'), 1);
    } catch (e) {
      console.error('保存设置失败:', e);
      message.error(tl('保存失败', 'Save failed'));
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
              <span className="settings-title-text">{tl('设置', 'Settings')}</span>
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
                <span className="settings-card-title">{tl('应用启动', 'App Startup')}</span>
              </div>
              <div className="settings-toggle-row">
                <div className="settings-toggle-info">
                  <span className="settings-toggle-label">{tl('开机自启动', 'Launch on Startup')}</span>
                  <span className="settings-toggle-desc">{tl('MCTier 将在系统启动时自动运行', 'MCTier will run automatically when the system starts')}</span>
                </div>
                <Switch checked={autoStartup} onChange={handleAutoStartupChange} className="settings-switch" />
              </div>
              <div className="settings-toggle-row">
                <div className="settings-toggle-info">
                  <span className="settings-toggle-label">{tl('窗口置顶', 'Always on Top')}</span>
                  <span className="settings-toggle-desc">{tl('保持窗口始终显示在最前面', 'Keep the window always in front')}</span>
                </div>
                <Switch checked={alwaysOnTop} onChange={async (v) => {
                  setAlwaysOnTop(v);
                  form.setFieldValue('alwaysOnTop', v);
                  await saveAll({ alwaysOnTop: v });
                }} className="settings-switch" />
              </div>
              <div className="settings-toggle-row">
                <div className="settings-toggle-info">
                  <span className="settings-toggle-label">{tl('记住窗口位置', 'Remember Window Position')}</span>
                  <span className="settings-toggle-desc">{tl('启动时恢复上次关闭时的窗口位置', 'Restore the last window position on startup')}</span>
                </div>
                <Switch checked={rememberWindowPosition} onChange={async (v) => {
                  setRememberWindowPosition(v);
                  form.setFieldValue('rememberWindowPosition', v);
                  await saveAll({ rememberWindowPosition: v });
                }} className="settings-switch" />
              </div>
              <div className="settings-toggle-row">
                <div className="settings-toggle-info">
                  <span className="settings-toggle-label">{tl('启用 GPU 渲染', 'Enable GPU Rendering')}</span>
                  <span className="settings-toggle-desc">{tl('关闭可降低 GPU 占用，但会禁用部分动画效果', 'Disabling reduces GPU usage but turns off some animations')}</span>
                </div>
                <Switch checked={enableGpuRendering} onChange={async (v) => {
                  // 先保存设置
                  setEnableGpuRendering(v);
                  form.setFieldValue('enableGpuRendering', v);
                  await saveAll({ enableGpuRendering: v });
                  
                  // 保存待处理的值并显示重启弹窗
                  setPendingGpuValue(v);
                  setShowRestartModal(true);
                }} className="settings-switch" />
              </div>
            </motion.div>

            <motion.div className="settings-card" variants={itemVariants}>
              <div className="settings-card-header">
                <div className="settings-card-icon settings-card-icon-orange">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>
                  </svg>
                </div>
                <span className="settings-card-title">{tl('自动大厅', 'Auto Lobby')}</span>
              </div>
              <div className="settings-toggle-row">
                <div className="settings-toggle-info">
                  <span className="settings-toggle-label">{tl('启动时自动创建/加入大厅', 'Auto create/join lobby on startup')}</span>
                  <span className="settings-toggle-desc">{tl('MCTier 启动后自动进入指定大厅', 'MCTier automatically enters the specified lobby after launch')}</span>
                </div>
                <Switch checked={autoLobbyEnabled} onChange={handleAutoLobbyChange} className="settings-switch" />
              </div>
              <AnimatePresence>
                {autoLobbyEnabled && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.3 }} style={{ overflow: 'hidden' }}>
                    <div className="settings-sub-form">
                      <Form.Item name="lobbyName" label={tl('大厅名称', 'Lobby Name')}
                        rules={[
                          { required: true, message: tl('请输入大厅名称', 'Please enter a lobby name') },
                          { whitespace: true, message: tl('不能为空白字符', 'Cannot be only whitespace') },
                          { min: 4, max: 32, message: tl('长度为 4-32 个字符', 'Length must be 4-32 characters') },
                          { pattern: /^[\u4e00-\u9fa5a-zA-Z0-9_\-\s]+$/, message: tl('只能含中文、字母、数字、下划线、连字符和空格', 'Only Chinese, letters, digits, underscores, hyphens and spaces allowed') },
                        ]}>
                        <Input placeholder={tl('4-32 个字符', '4-32 characters')} maxLength={32} onBlur={handleFieldBlur} />
                      </Form.Item>
                      <Form.Item name="lobbyPassword" label={tl('大厅密码', 'Lobby Password')}
                        rules={[
                          { required: true, message: tl('请输入密码', 'Please enter a password') },
                          { min: 8, max: 32, message: tl('长度 8-32 个字符', 'Length must be 8-32 characters') },
                          { validator: (_, v) => { if (!v) return Promise.resolve(); if (!/[a-zA-Z]/.test(v)) return Promise.reject(new Error(tl('必须含字母', 'Must contain letters'))); if (!/[0-9]/.test(v)) return Promise.reject(new Error(tl('必须含数字', 'Must contain digits'))); return Promise.resolve(); } },
                        ]}>
                        <Input.Password placeholder={tl('8-32 个字符，含字母和数字', '8-32 characters with letters and digits')} maxLength={32} onBlur={handleFieldBlur} />
                      </Form.Item>
                      <Form.Item name="playerName" label={tl('玩家名称', 'Player Name')}
                        rules={[
                          { required: true, message: tl('请输入玩家名称', 'Please enter a player name') },
                          { min: 1, max: 8, message: tl('长度 1-8 个字', 'Length must be 1-8 characters') },
                        ]}>
                        <Input placeholder={tl('最多 8 个字', 'Up to 8 characters')} maxLength={8} onBlur={handleFieldBlur} />
                      </Form.Item>
                      <div className="settings-toggle-row settings-toggle-row-sub">
                        <div className="settings-toggle-info">
                          <span className="settings-toggle-label">{tl('使用虚拟域名', 'Use Virtual Domain')}</span>
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
                      <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.55)', marginTop: '4px', lineHeight: 1.7 }}>
                        {tl('说明：自动大厅会沿用与手动创建大厅相同的服务器。若已开启「使用私有服务器」，则使用你在私有服务器中配置的 EasyTier 节点与信令服务器；否则使用上次成功进入大厅的节点（默认为 MCTier 官方服务器）。', 'Note: Auto lobby uses the same server as manual lobby creation. If "Use private server" is enabled, it uses the EasyTier node and signaling server you configured; otherwise it uses the node from the last successful lobby (default: MCTier official server).')}
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
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1 }}>
                  <span className="settings-card-title">{tl('私有服务器', 'Private Server')}</span>
                  <Tooltip 
                    title={tl('MCTier 官网提供后端源码与私有化部署教学，您可以自行搭建私有服务器', 'The MCTier website provides backend source code and self-hosting tutorials so you can run your own server')}
                    placement="right"
                  >
                    <div className="settings-info-icon">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="12" y1="16" x2="12" y2="12"></line>
                        <line x1="12" y1="8" x2="12.01" y2="8"></line>
                      </svg>
                    </div>
                  </Tooltip>
                </div>
              </div>
              <div className="settings-toggle-row">
                <div className="settings-toggle-info">
                  <span className="settings-toggle-label">{tl('使用私有服务器', 'Use Private Server')}</span>
                  <span className="settings-toggle-desc">{tl('启用后可配置自己部署的服务器', 'Enable to configure your own deployed server')}</span>
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
                      <Form.Item name="privateEasytierServer" label={tl('EasyTier 节点服务器', 'EasyTier Node Server')}
                        rules={[
                          { required: true, message: tl('请输入 EasyTier 节点服务器地址', 'Please enter the EasyTier node server address') },
                          { pattern: /^(tcp|udp|ws|wss|txt):\/\/.+$/, message: tl('格式：tcp://、udp://、ws://、wss:// 或 txt:// 开头', 'Format: must start with tcp://, udp://, ws://, wss:// or txt://') },
                        ]}>
                        <Input placeholder="udp://us01.225284.xyz:11010" onBlur={handleFieldBlur} />
                      </Form.Item>
                      <Form.Item name="privateSignalingServer" label={tl('WebRTC 信令服务器', 'WebRTC Signaling Server')}
                        rules={[
                          { required: true, message: tl('请输入信令服务器地址', 'Please enter the signaling server address') },
                          { pattern: /^wss?:\/\/.+$/, message: tl('格式：ws://域名/path 或 wss://域名/path', 'Format: ws://host/path or wss://host/path') },
                        ]}>
                        <Input placeholder="wss://mctier.pmhs.top/signaling" onBlur={handleFieldBlur} />
                      </Form.Item>
                      <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.55)', marginTop: '-4px', marginBottom: '10px', lineHeight: 1.6 }}>
                        {tl('提示：MCTier 官网仅提供信令服务器源码', 'Note: The MCTier website only provides the signaling server source code')}
                      </div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                          type="button"
                          className="settings-action-btn settings-action-btn-green"
                          onClick={async () => {
                            try {
                              const { open } = await import('@tauri-apps/plugin-shell');
                              await open('https://mctier.pmhs.top');
                            } catch (e) {
                              console.error('打开官网失败:', e);
                              message.error(tl('打开官网失败', 'Failed to open the website'));
                            }
                          }}
                        >
                          {tl('前往 MCTier 官网', 'Go to MCTier Website')}
                        </button>
                        <button
                          type="button"
                          className="settings-action-btn settings-action-btn-reset"
                          onClick={async () => {
                            const defaults = {
                              privateEasytierServer: 'udp://us01.225284.xyz:11010',
                              privateSignalingServer: 'wss://mctier.pmhs.top/signaling',
                            };
                            form.setFieldsValue(defaults);
                            await saveAll(defaults);
                            message.success(tl('已重置为默认私有服务器地址', 'Reset to default private server address'));
                          }}
                        >
                          {tl('重置', 'Reset')}
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>

            <motion.div className="settings-card" variants={itemVariants}>
              <div className="settings-card-header">
                <div className="settings-card-icon settings-card-icon-cyan">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
                    <path d="M12 10h-2v2H9v-2H7V9h2V7h1v2h2v1z"/>
                  </svg>
                </div>
                <span className="settings-card-title">{tl('自定义 EasyTier 节点', 'Custom EasyTier Nodes')}</span>
              </div>
              <div className="settings-card-desc">
                {tl('添加备用节点，创建/加入大厅时可在下拉中选择', 'Add backup nodes to pick from when creating/joining a lobby')}
              </div>
              <CustomNodeManager />
            </motion.div>

            <motion.div className="settings-card" variants={itemVariants}>
              <div className="settings-card-header">
                <div className="settings-card-icon settings-card-icon-green">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 15.5A3.5 3.5 0 0 1 8.5 12 3.5 3.5 0 0 1 12 8.5a3.5 3.5 0 0 1 3.5 3.5 3.5 3.5 0 0 1-3.5 3.5m7.43-2.92c.04-.34.07-.69.07-1.08s-.03-.74-.07-1.08l2.32-1.82c.21-.17.27-.46.13-.70l-2.2-3.81c-.13-.24-.41-.32-.65-.24l-2.74 1.1c-.57-.44-1.18-.81-1.86-1.09L14.05 2.1c-.04-.27-.28-.46-.55-.46h-3c-.28 0-.5.19-.55.46L9.5 4.86C8.82 5.14 8.2 5.5 7.64 5.95L4.9 4.85c-.24-.09-.52 0-.65.24L2.05 8.9c-.14.24-.08.53.13.70L4.5 11.5c-.04.34-.07.7-.07 1.08s.03.74.07 1.08L2.18 15.48c-.21.17-.27.46-.13.70l2.2 3.81c.13.24.41.32.65.24l2.74-1.1c.57.44 1.18.81 1.86 1.09l.45 2.76c.05.27.27.46.55.46h3c.28 0 .5-.19.55-.46l.45-2.76c.68-.28 1.3-.65 1.86-1.09l2.74 1.1c.24.09.52 0 .65-.24l2.2-3.81c.14-.24.08-.53-.13-.70l-2.32-1.9z" />
                  </svg>
                </div>
                <span className="settings-card-title">{tl('全局 EasyTier 高级配置', 'Global EasyTier Advanced Config')}</span>
              </div>
              <div className="settings-card-desc">
                {tl('配置 EasyTier 的高级参数，这些配置将作为默认配置应用于所有大厅', 'Configure EasyTier advanced parameters; these apply as defaults to all lobbies')}
              </div>
              <GlobalAdvancedConfigPanel />
            </motion.div>

            <motion.div className="settings-card" variants={itemVariants}>
              <div className="settings-card-header">
                <div className="settings-card-icon settings-card-icon-purple">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M3 10v4a1 1 0 0 0 1 1h3l4 4V5L7 9H4a1 1 0 0 0-1 1zm13.5 2a4.5 4.5 0 0 0-2.5-4.03v8.06A4.5 4.5 0 0 0 16.5 12zM14 3.23v2.06a7 7 0 0 1 0 13.42v2.06a9 9 0 0 0 0-17.54z"/>
                  </svg>
                </div>
                <span className="settings-card-title">{tl('提示音', 'Sounds')}</span>
              </div>
              <div className="settings-card-desc">
                {tl('自定义各类提示音（可恢复默认）、调节音量与设置消息免打扰时段', 'Customize sounds (restorable to default), adjust volume and set Do Not Disturb hours')}
              </div>
              <SoundThemeManager />
            </motion.div>

            <motion.div className="settings-card" variants={itemVariants}>
              <div className="settings-card-header">
                <div className="settings-card-icon settings-card-icon-yellow">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12.87 15.07l-2.54-2.51.03-.03c1.74-1.94 2.98-4.17 3.71-6.53H17V4h-7V2H8v2H1v1.99h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/>
                  </svg>
                </div>
                <span className="settings-card-title">{t('settings.language')}</span>
              </div>
              <div className="settings-card-desc">
                {t('settings.languageDesc')}
              </div>
              <div className="settings-centered-control">
                <Button.Group>
                  <Button type={lang === 'zh' ? 'primary' : 'default'} onClick={() => { setLanguage('zh'); setLang('zh'); }}>简体中文</Button>
                  <Button type={lang === 'en' ? 'primary' : 'default'} onClick={() => { setLanguage('en'); setLang('en'); }}>English</Button>
                </Button.Group>
              </div>
            </motion.div>

            <motion.div className="settings-card" variants={itemVariants}>
              <div className="settings-card-header">
                <div className="settings-card-icon settings-card-icon-green">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M5 9.2h3V19H5V9.2zM10.6 5h3v14h-3V5zm5.6 8H19v6h-2.8v-6z"/>
                  </svg>
                </div>
                <span className="settings-card-title">{t('settings.dataStats')}</span>
              </div>
              <div className="settings-card-desc">
                {t('settings.dataStatsDesc')}
              </div>
              <div className="settings-centered-control">
                <Button onClick={() => setShowStats(true)}>{t('settings.viewStats')}</Button>
              </div>
            </motion.div>

            <motion.div className="settings-card" variants={itemVariants}>
              <div className="settings-card-header">
                <div className="settings-card-icon settings-card-icon-purple">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M19 12v7H5v-7H3v7c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-7h-2zm-6 .67l2.59-2.58L17 11.5l-5 5-5-5 1.41-1.41L11 12.67V3h2v9.67z"/>
                  </svg>
                </div>
                <span className="settings-card-title">{t('settings.configMgr')}</span>
              </div>
              <div className="settings-card-desc">
                {t('settings.configMgrDesc')}
              </div>
              <ConfigManager />
            </motion.div>

          </Form>
        </motion.div>
      </div>

      <StatsPanel visible={showStats} onClose={() => setShowStats(false)} />

      {/* 重启确认弹窗 */}
      <RestartConfirmModal
        visible={showRestartModal}
        enableGpu={pendingGpuValue}
        onConfirm={async () => {
          setShowRestartModal(false);
          try {
            await invoke('restart_app_with_gpu_settings', { enableGpu: pendingGpuValue });
          } catch (error) {
            console.error('重启应用失败:', error);
            message.error(tl('重启应用失败，请手动重启', 'Failed to restart the app, please restart manually'));
          }
        }}
        onCancel={() => {
          setShowRestartModal(false);
          message.info(tl('设置已保存，下次启动时生效', 'Settings saved, effective on next launch'));
        }}
      />
    </div>
  );
};

// 自定义节点管理组件
interface EasyTierNode {
  name: string;
  address: string;
}

// 默认内置节点（不可删除）
const DEFAULT_BUILTIN_NODES: EasyTierNode[] = [
  {
    name: 'MCTier 官方服务器',
    address: 'udp://us01.225284.xyz:11010'
  },
  {
    name: '海波节点',
    address: 'tcp://225284.xyz:11010'
  },
  {
    name: '唯爱节点',
    address: 'tcp://easytier.weiai.org.cn:11010'
  },
  {
    name: '明月清风节点',
    address: 'wss://public.456469.xyz'
  }
];

// 内置节点地址集合（用于过滤和删除保护判断）
const BUILTIN_NODE_ADDRESSES = DEFAULT_BUILTIN_NODES.map(node => node.address);

// 内置节点名称的英文显示映射（数据层保持中文作为稳定标识，仅渲染时翻译）
const BUILTIN_NODE_NAME_EN: Record<string, string> = {
  'MCTier 官方服务器': 'MCTier Official Server',
  '海波节点': 'Haibo Node',
  '唯爱节点': 'Weiai Node',
  '明月清风节点': 'Mingyue Qingfeng Node',
};
const displayNodeName = (name: string) =>
  BUILTIN_NODE_NAME_EN[name] ? tl(name, BUILTIN_NODE_NAME_EN[name]) : name;

// ==================== 提示音设置 ====================
const minutesToHHMM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

const SoundThemeManager: React.FC = () => {
  useTranslation();
  const { message: antdMessage } = App.useApp();
  const init = audioService.getSettings();
  const [volume, setVolume] = useState(init.volume);
  const [custom, setCustom] = useState(init.custom);
  const [dndEnabled, setDndEnabled] = useState(init.dndEnabled);
  const [mutedSounds, setMutedSounds] = useState<Record<string, boolean>>(() => ({
    newMessage: audioService.isSoundMuted('newMessage'),
    userJoined: audioService.isSoundMuted('userJoined'),
    userLeft: audioService.isSoundMuted('userLeft'),
  }));
  const [dndStart, setDndStart] = useState(init.dndStart);
  const [dndEnd, setDndEnd] = useState(init.dndEnd);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pickTarget, setPickTarget] = useState<SoundType | null>(null);

  const labels: Record<SoundType, string> = { newMessage: tl('新消息', 'New Message'), userJoined: tl('玩家加入', 'Player Joined'), userLeft: tl('玩家离开', 'Player Left') };

  const previewSound = async (target: SoundType) => {
    try {
      await audioService.play(target);
    } catch {
      antdMessage.error(tl('试听失败，请检查默认音效文件或自定义音频文件是否可用', 'Preview failed. Please check the sound file.'));
    }
  };

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const target = pickTarget;
    e.target.value = '';
    if (!file || !target) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      audioService.setCustomSound(target, dataUrl);
      setCustom({ ...audioService.getSettings().custom });
      antdMessage.success(`${tl('已设置', 'Set custom sound for')}「${labels[target]}」${tl('自定义提示音', '')}`);
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="snd-manager">
      <input ref={fileInputRef} type="file" accept="audio/*" style={{ display: 'none' }} onChange={onPickFile} />

      {/* 音量 */}
      <div className="snd-block">
        <div className="snd-block-title">
          <span>{tl('提示音量', 'Sound Volume')}</span>
          <span className="snd-vol-val">{Math.round(volume * 100)}%</span>
        </div>
        <Slider
          min={0} max={1} step={0.05} value={volume}
          onChange={(v) => { setVolume(v as number); audioService.setVolume(v as number); }}
          tooltip={{ formatter: (v) => `${Math.round((v ?? 0) * 100)}%` }}
        />
      </div>

      {/* 各事件提示音（每个音效独立禁音 + 自定义） */}
      <div className="snd-list">
        {(Object.keys(labels) as SoundType[]).map((t) => (
          <div className="snd-card" key={t}>
            <div className="snd-card-left">
              <span className="snd-card-name">{labels[t]}</span>
              <span className={`snd-card-tag ${custom[t] ? 'is-custom' : ''}`}>{custom[t] ? tl('自定义', 'Custom') : tl('默认音', 'Default')}</span>
            </div>
            <div className="snd-card-actions">
              <button className="snd-icon-btn" title={tl('试听', 'Preview')} onClick={() => void previewSound(t)}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
              </button>
              <button className="snd-text-btn" onClick={() => { setPickTarget(t); fileInputRef.current?.click(); }}>{tl('更换', 'Change')}</button>
              {custom[t] && (
                <button className="snd-text-btn snd-reset" title={tl('恢复为默认提示音', 'Restore default sound')} onClick={() => { audioService.resetSound(t); setCustom({ ...audioService.getSettings().custom }); antdMessage.success(tl('已恢复默认提示音', 'Default sound restored')); }}>{tl('恢复默认', 'Default')}</button>
              )}
              <Switch
                size="small"
                checked={!mutedSounds[t]}
                title={tl('开启=使用该提示音，关闭=不使用', 'On = use this sound, Off = mute')}
                onChange={(v) => { setMutedSounds((prev) => ({ ...prev, [t]: !v })); audioService.setSoundMuted(t, !v); }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* 免打扰 */}
      <div className="snd-block">
        <div className="snd-dnd-head">
          <div>
            <div className="snd-block-title-text">{tl('消息免打扰', 'Do Not Disturb')}</div>
            <div className="snd-block-desc">{tl('开启后，下方时段内不播放任何提示音', 'When enabled, no sounds play during the hours below')}</div>
          </div>
          <Switch checked={dndEnabled} onChange={(v) => { setDndEnabled(v); audioService.setDnd(v); }} />
        </div>
        {dndEnabled && (
          <div className="snd-dnd-times">
            <input type="time" value={minutesToHHMM(dndStart)} onChange={(e) => {
              const [h, m] = e.target.value.split(':').map(Number); const mins = h * 60 + m;
              setDndStart(mins); audioService.setDnd(true, mins, dndEnd);
            }} />
            <span className="snd-dnd-sep">{tl('至', 'to')}</span>
            <input type="time" value={minutesToHHMM(dndEnd)} onChange={(e) => {
              const [h, m] = e.target.value.split(':').map(Number); const mins = h * 60 + m;
              setDndEnd(mins); audioService.setDnd(true, dndStart, mins);
            }} />
          </div>
        )}
      </div>
    </div>
  );
};

const CustomNodeManager: React.FC = () => {
  useTranslation();
  const { modal } = App.useApp();
  const [nodes, setNodes] = useState<EasyTierNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<EasyTierNode>({ name: '', address: '' });

  // 提取加载节点列表的逻辑为独立函数
  const loadNodes = useCallback(async () => {
    try {
      const settings = await invoke<any>('get_settings');
      const customNodes = settings.customEasytierNodes || [];
      // 将默认节点添加到列表开头
      setNodes([...DEFAULT_BUILTIN_NODES, ...customNodes]);
    } catch (error) {
      console.error('加载节点列表失败:', error);
      message.error(tl('加载节点列表失败', 'Failed to load node list'));
      // 即使加载失败，也要显示默认节点
      setNodes([...DEFAULT_BUILTIN_NODES]);
    } finally {
      setLoading(false);
    }
  }, []);

  // 初始加载节点列表
  useEffect(() => {
    loadNodes();
  }, [loadNodes]);

  // 监听配置导入事件，重新加载节点列表
  useEffect(() => {
    const handleConfigImported = () => {
      console.log('检测到配置导入，重新加载自定义节点列表...');
      loadNodes();
    };

    window.addEventListener('configImported', handleConfigImported);
    return () => {
      window.removeEventListener('configImported', handleConfigImported);
    };
  }, [loadNodes]);

  // 保存节点列表（排除默认节点）
  const saveNodes = async (newNodes: EasyTierNode[]) => {
    try {
      // 过滤掉默认节点，只保存用户自定义的节点
      const customNodesOnly = newNodes.filter(node => !BUILTIN_NODE_ADDRESSES.includes(node.address));

      // 【修复】先读取当前设置，连同节点一起保存，避免把其它设置
      // （开机自启、自动加入、私有服务器、置顶等）覆盖成默认值
      const cur = await invoke<any>('get_settings').catch(() => ({} as any));

      await invoke('save_settings', {
        autoStartup: cur.autoStartup ?? false,
        autoLobbyEnabled: cur.autoLobbyEnabled ?? false,
        lobbyName: cur.lobbyName ?? null,
        lobbyPassword: cur.lobbyPassword ?? null,
        playerName: cur.playerName ?? null,
        useDomain: cur.useDomain ?? false,
        virtualDomain: cur.virtualDomain ?? null,
        usePrivateServer: cur.usePrivateServer ?? false,
        privateEasytierServer: cur.privateEasytierServer ?? null,
        privateSignalingServer: cur.privateSignalingServer ?? null,
        alwaysOnTop: cur.alwaysOnTop ?? null,
        rememberWindowPosition: cur.rememberWindowPosition ?? null,
        customEasytierNodes: customNodesOnly,
        voiceVolume: cur.voiceVolume ?? null,
        enableGpuRendering: cur.enableGpuRendering ?? null,
      });
      setNodes(newNodes);
      message.success(tl('节点列表已保存', 'Node list saved'));
    } catch (error) {
      console.error('保存节点列表失败:', error);
      message.error(tl('保存节点列表失败', 'Failed to save node list'));
    }
  };

  // 添加节点
  const handleAdd = () => {
    setEditingIndex(nodes.length);
    setEditForm({ name: '', address: '' });
  };

  // 编辑节点
  const handleEdit = (index: number) => {
    setEditingIndex(index);
    setEditForm({ ...nodes[index] });
  };

  // 保存编辑
  const handleSave = async () => {
    if (!editForm.name.trim()) {
      message.error(tl('请输入节点名称', 'Please enter a node name'));
      return;
    }
    if (!editForm.address.trim()) {
      message.error(tl('请输入节点地址', 'Please enter a node address'));
      return;
    }
    
    // 验证地址格式
    const addressPattern = /^(tcp|udp|ws|wss|txt):\/\/.+$/;
    if (!addressPattern.test(editForm.address.trim())) {
      message.error(tl('节点地址格式错误，应以 tcp://、udp://、ws://、wss:// 或 txt:// 开头', 'Invalid node address format; it must start with tcp://, udp://, ws://, wss:// or txt://'));
      return;
    }

    // 检查地址是否已存在（含内置节点与其它自定义节点，编辑自身时跳过）
    const normalizedAddr = editForm.address.trim();
    const duplicated = nodes.some(
      (n, i) => i !== editingIndex && n.address.trim() === normalizedAddr
    );
    if (duplicated) {
      message.warning(tl('该节点地址已存在，请勿重复添加', 'This node address already exists, do not add it again'));
      return;
    }

    const newNodes = [...nodes];
    if (editingIndex !== null) {
      if (editingIndex >= newNodes.length) {
        // 添加新节点
        newNodes.push(editForm);
      } else {
        // 更新现有节点
        newNodes[editingIndex] = editForm;
      }
      await saveNodes(newNodes);
      setEditingIndex(null);
      setEditForm({ name: '', address: '' });
    }
  };

  // 取消编辑
  const handleCancel = () => {
    setEditingIndex(null);
    setEditForm({ name: '', address: '' });
  };

  // 删除节点
  const handleDelete = async (index: number) => {
    // 检查是否是默认内置节点（不可删除）
    if (index < DEFAULT_BUILTIN_NODES.length) {
      message.warning(tl('默认备用节点不可删除', 'Default fallback nodes cannot be deleted'));
      return;
    }

    const target = nodes[index];
    modal.confirm({
      title: tl('删除自定义节点', 'Delete custom node'),
      content: tl(`确定要删除节点「${target?.name ?? ''}」吗？此操作不可恢复。`, `Delete node "${target?.name ?? ''}"? This cannot be undone.`),
      okText: tl('删除', 'Delete'),
      okType: 'danger',
      cancelText: tl('取消', 'Cancel'),
      centered: true,
      onOk: async () => {
        const newNodes = nodes.filter((_, i) => i !== index);
        await saveNodes(newNodes);
      },
    });
  };

  if (loading) {
    return <div style={{ padding: '16px', textAlign: 'center', color: 'rgba(255,255,255,0.6)' }}>{tl('加载中...', 'Loading...')}</div>;
  }

  return (
    <div className="custom-node-manager">
      {/* 节点列表 */}
      <div className="node-list">
        {nodes.map((node, index) => (
          <motion.div
            key={index}
            className="node-item"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
          >
            {editingIndex === index ? (
              // 编辑模式
              <div className="node-edit-form">
                <Input
                  placeholder={tl('节点名称', 'Node name')}
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  maxLength={32}
                  style={{ marginBottom: '8px' }}
                />
                <Input
                  placeholder={tl('节点地址 (例如: wss://example.com)', 'Node address (e.g. wss://example.com)')}
                  value={editForm.address}
                  onChange={(e) => setEditForm({ ...editForm, address: e.target.value })}
                  style={{ marginBottom: '8px' }}
                />
                <div className="node-edit-actions">
                  <motion.button
                    className="node-btn node-btn-save"
                    onClick={handleSave}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                  >
                    {tl('保存', 'Save')}
                  </motion.button>
                  <motion.button
                    className="node-btn node-btn-cancel"
                    onClick={handleCancel}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                  >
                    {tl('取消', 'Cancel')}
                  </motion.button>
                </div>
              </div>
            ) : (
              // 显示模式
              <>
                <div className="node-info">
                  <div className="node-name">
                    {displayNodeName(node.name)}
                    {index < DEFAULT_BUILTIN_NODES.length && (
                      <span className="node-builtin-badge">{tl('内置', 'Built-in')}</span>
                    )}
                  </div>
                  <div className="node-address">{node.address}</div>
                </div>
                <div className="node-actions">
                  {index >= DEFAULT_BUILTIN_NODES.length && (
                    <>
                      <motion.button
                        className="node-btn node-btn-edit"
                        onClick={() => handleEdit(index)}
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.9 }}
                        title={tl('编辑', 'Edit')}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
                        </svg>
                      </motion.button>
                      <motion.button
                        className="node-btn node-btn-delete"
                        onClick={() => handleDelete(index)}
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.9 }}
                        title={tl('删除', 'Delete')}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                        </svg>
                      </motion.button>
                    </>
                  )}
                </div>
              </>
            )}
          </motion.div>
        ))}

        {/* 添加新节点表单 */}
        {editingIndex === nodes.length && (
          <motion.div
            className="node-item"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="node-edit-form">
              <Input
                placeholder={tl('节点名称', 'Node name')}
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                maxLength={32}
                style={{ marginBottom: '8px' }}
              />
              <Input
                placeholder={tl('节点地址 (例如: wss://example.com)', 'Node address (e.g. wss://example.com)')}
                value={editForm.address}
                onChange={(e) => setEditForm({ ...editForm, address: e.target.value })}
                style={{ marginBottom: '8px' }}
              />
              <div className="node-edit-actions">
                <motion.button
                  className="node-btn node-btn-save"
                  onClick={handleSave}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                >
                  {tl('保存', 'Save')}
                </motion.button>
                <motion.button
                  className="node-btn node-btn-cancel"
                  onClick={handleCancel}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                >
                  {tl('取消', 'Cancel')}
                </motion.button>
              </div>
            </div>
          </motion.div>
        )}
      </div>

      {/* 添加按钮 */}
      {editingIndex === null && (
        <motion.button
          className="node-add-btn"
          onClick={handleAdd}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
          </svg>
          <span>{tl('添加节点', 'Add Node')}</span>
        </motion.button>
      )}
    </div>
  );
};

// 配置管理组件
const ConfigManager: React.FC = () => {
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [exportingLogs, setExportingLogs] = useState(false);

  // 导出配置
  const handleExport = async () => {
    try {
      setExporting(true);
      
      // 生成默认文件名
      const defaultFileName = `mctier_config_${new Date().toISOString().slice(0, 10)}.json`;
      
      // 直接调用文件选择对话框
      try {
        const filePath = await invoke<string | null>('select_save_location', {
          defaultName: defaultFileName
        });

        if (!filePath) {
          setExporting(false);
          return;
        }

        // 调用后端导出配置
        await invoke('export_config', { exportPath: filePath });
        
        message.success(tl('配置已导出成功', 'Config exported successfully'));
      } catch (error) {
        console.error('导出配置失败:', error);
        message.error(`${tl('导出配置失败', 'Failed to export config')}: ${error}`);
      } finally {
        setExporting(false);
      }
    } catch (error) {
      console.error('导出配置失败:', error);
      message.error(`${tl('导出配置失败', 'Failed to export config')}: ${error}`);
      setExporting(false);
    }
  };

  // 导入配置
  const handleImport = async () => {
    try {
      setImporting(true);
      
      // 直接调用文件选择对话框
      try {
        const filePath = await invoke<string | null>('select_file');

        if (!filePath) {
          setImporting(false);
          return;
        }

        // 调用后端导入配置
        await invoke('import_config', { importPath: filePath });
        
        // 触发配置导入事件，通知设置窗口重新加载
        window.dispatchEvent(new CustomEvent('configImported'));
        
        message.success(tl('配置导入成功，设置已更新', 'Config imported successfully, settings updated'));
      } catch (error) {
        console.error('导入配置失败:', error);
        message.error(`${tl('导入配置失败', 'Failed to import config')}: ${error}`);
      } finally {
        setImporting(false);
      }
    } catch (error) {
      console.error('导入配置失败:', error);
      message.error(`${tl('导入配置失败', 'Failed to import config')}: ${error}`);
      setImporting(false);
    }
  };

  // 一键导出日志（打包日志目录为 zip 到桌面）
  const handleExportLogs = async () => {
    try {
      setExportingLogs(true);
      const zipPath = await invoke<string>('export_logs');
      message.success(tl('日志已导出到桌面', 'Logs exported to the desktop'));
      // 打开所在文件夹，方便用户找到
      try {
        await invoke('open_file_location', { path: zipPath });
      } catch {
        // 忽略打开失败
      }
    } catch (error) {
      console.error('导出日志失败:', error);
      message.error(`${tl('导出日志失败', 'Failed to export logs')}: ${error}`);
    } finally {
      setExportingLogs(false);
    }
  };

  return (
    <div className="config-manager">
      <div className="config-manager-buttons">
        <motion.button
          className="config-btn config-btn-export"
          onClick={handleExport}
          disabled={exporting}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          {exporting ? (
            <>
              <span className="config-btn-spinner" />
              <span>{tl('导出中...', 'Exporting...')}</span>
            </>
          ) : (
            <>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
              <span>{tl('导出配置', 'Export Config')}</span>
            </>
          )}
        </motion.button>
        <motion.button
          className="config-btn config-btn-import"
          onClick={handleImport}
          disabled={importing}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          {importing ? (
            <>
              <span className="config-btn-spinner" />
              <span>{tl('导入中...', 'Importing...')}</span>
            </>
          ) : (
            <>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="17 8 12 3 7 8"></polyline>
                <line x1="12" y1="3" x2="12" y2="15"></line>
              </svg>
              <span>{tl('导入配置', 'Import Config')}</span>
            </>
          )}
        </motion.button>
        <motion.button
          className="config-btn config-btn-export"
          onClick={handleExportLogs}
          disabled={exportingLogs}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          title={tl('将运行日志打包为 zip 导出到桌面，方便反馈问题', 'Package runtime logs as a zip and export to the desktop for easy reporting')}
        >
          {exportingLogs ? (
            <>
              <span className="config-btn-spinner" />
              <span>{tl('导出中...', 'Exporting...')}</span>
            </>
          ) : (
            <>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
                <line x1="12" y1="18" x2="12" y2="12"></line>
                <polyline points="9 15 12 18 15 15"></polyline>
              </svg>
              <span>{tl('导出日志', 'Export Logs')}</span>
            </>
          )}
        </motion.button>
      </div>
    </div>
  );
};
