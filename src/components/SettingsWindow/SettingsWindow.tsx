import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Form, Input, Switch, message, Tooltip } from 'antd';
import { invoke } from '@tauri-apps/api/core';
import { useEscapeKey } from '../../hooks';
import { RestartConfirmModal } from '../RestartConfirmModal/RestartConfirmModal';
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
  const [pendingGpuValue, setPendingGpuValue] = useState(true);
  // 用ref保存完整设置，避免Switch切换时丢失输入框的已填数据
  const settingsRef = useRef<Record<string, any>>({});

  useEscapeKey(onClose, true);

  // 提取加载设置的逻辑为独立函数，方便重用
  const loadSettings = useCallback(async () => {
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
        privateEasytierServer: settings.privateEasytierServer ?? 'wss://mctiers.pmhs.top',
        privateSignalingServer: settings.privateSignalingServer ?? 'wss://mctier.pmhs.top/signaling',
        alwaysOnTop: aot,
        rememberWindowPosition: rwp,
        enableGpuRendering: egr,
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
        enableGpuRendering: true,
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
        usePrivateServer: merged.usePrivateServer ?? false,
        // 私有服务器配置：如果有值就保存，没有值就保存 null
        privateEasytierServer: merged.privateEasytierServer?.trim() || null,
        privateSignalingServer: merged.privateSignalingServer?.trim() || null,
        alwaysOnTop: merged.alwaysOnTop !== undefined ? merged.alwaysOnTop : true,
        rememberWindowPosition: merged.rememberWindowPosition !== undefined ? merged.rememberWindowPosition : false,
        enableGpuRendering: merged.enableGpuRendering !== undefined ? merged.enableGpuRendering : true,
      });
      console.log('设置已保存:', merged);
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
              <div className="settings-toggle-row">
                <div className="settings-toggle-info">
                  <span className="settings-toggle-label">启用 GPU 渲染</span>
                  <span className="settings-toggle-desc">关闭可降低 GPU 占用，但会禁用部分动画效果</span>
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
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1 }}>
                  <span className="settings-card-title">私有服务器</span>
                  <Tooltip 
                    title="MCTier 官网提供后端源码与私有化部署教学，您可以自行搭建私有服务器"
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

            <motion.div className="settings-card" variants={itemVariants}>
              <div className="settings-card-header">
                <div className="settings-card-icon settings-card-icon-cyan">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
                    <path d="M12 10h-2v2H9v-2H7V9h2V7h1v2h2v1z"/>
                  </svg>
                </div>
                <span className="settings-card-title">自定义 EasyTier 节点</span>
              </div>
              <div className="settings-card-desc">
                <div style={{ marginBottom: '8px' }}>
                  配置多个自定义 EasyTier 节点，实现高可用组网
                </div>
                <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', lineHeight: '1.6' }}>
                  • 创建/加入大厅时，MCTier 会自动将所有节点传递给 EasyTier<br />
                  • EasyTier 会自动选择延迟最低、质量最好的节点<br />
                  • 当节点离线或网络波动时，自动切换到其他健康节点<br />
                  • 支持多路径并行，提升连接稳定性和速度
                </div>
              </div>
              <CustomNodeManager />
            </motion.div>

            <motion.div className="settings-card" variants={itemVariants}>
              <div className="settings-card-header">
                <div className="settings-card-icon settings-card-icon-purple">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/>
                  </svg>
                </div>
                <span className="settings-card-title">配置管理</span>
              </div>
              <div className="settings-card-desc">
                导出或导入所有配置项，方便备份和迁移
              </div>
              <ConfigManager />
            </motion.div>

          </Form>
        </motion.div>
      </div>

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
            message.error('重启应用失败，请手动重启');
          }
        }}
        onCancel={() => {
          setShowRestartModal(false);
          message.info('设置已保存，下次启动时生效');
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
const DEFAULT_BUILTIN_NODE: EasyTierNode = {
  name: '默认备用节点',
  address: 'wss://qtet-public.070219.xyz'
};

const CustomNodeManager: React.FC = () => {
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
      setNodes([DEFAULT_BUILTIN_NODE, ...customNodes]);
    } catch (error) {
      console.error('加载节点列表失败:', error);
      message.error('加载节点列表失败');
      // 即使加载失败，也要显示默认节点
      setNodes([DEFAULT_BUILTIN_NODE]);
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
      const customNodesOnly = newNodes.filter(node => node.address !== DEFAULT_BUILTIN_NODE.address);
      
      await invoke('save_settings', {
        autoStartup: false,
        autoLobbyEnabled: false,
        lobbyName: null,
        lobbyPassword: null,
        playerName: null,
        useDomain: false,
        usePrivateServer: false,
        privateEasytierServer: null,
        privateSignalingServer: null,
        alwaysOnTop: null,
        rememberWindowPosition: null,
        customEasytierNodes: customNodesOnly,
        voiceVolume: null,
      });
      setNodes(newNodes);
      message.success('节点列表已保存');
    } catch (error) {
      console.error('保存节点列表失败:', error);
      message.error('保存节点列表失败');
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
      message.error('请输入节点名称');
      return;
    }
    if (!editForm.address.trim()) {
      message.error('请输入节点地址');
      return;
    }
    
    // 验证地址格式
    const addressPattern = /^(tcp|udp|ws|wss|txt):\/\/.+$/;
    if (!addressPattern.test(editForm.address.trim())) {
      message.error('节点地址格式错误，应以 tcp://、udp://、ws://、wss:// 或 txt:// 开头');
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
    // 检查是否是默认节点（索引0）
    if (index === 0) {
      message.warning('默认备用节点不可删除');
      return;
    }
    
    const newNodes = nodes.filter((_, i) => i !== index);
    await saveNodes(newNodes);
  };

  if (loading) {
    return <div style={{ padding: '16px', textAlign: 'center', color: 'rgba(255,255,255,0.6)' }}>加载中...</div>;
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
                  placeholder="节点名称"
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  maxLength={32}
                  style={{ marginBottom: '8px' }}
                />
                <Input
                  placeholder="节点地址 (例如: wss://example.com)"
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
                    保存
                  </motion.button>
                  <motion.button
                    className="node-btn node-btn-cancel"
                    onClick={handleCancel}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                  >
                    取消
                  </motion.button>
                </div>
              </div>
            ) : (
              // 显示模式
              <>
                <div className="node-info">
                  <div className="node-name">
                    {node.name}
                    {index === 0 && (
                      <span className="node-builtin-badge">内置</span>
                    )}
                  </div>
                  <div className="node-address">{node.address}</div>
                </div>
                <div className="node-actions">
                  {index !== 0 && (
                    <>
                      <motion.button
                        className="node-btn node-btn-edit"
                        onClick={() => handleEdit(index)}
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.9 }}
                        title="编辑"
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
                        title="删除"
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
                placeholder="节点名称"
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                maxLength={32}
                style={{ marginBottom: '8px' }}
              />
              <Input
                placeholder="节点地址 (例如: wss://example.com)"
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
                  保存
                </motion.button>
                <motion.button
                  className="node-btn node-btn-cancel"
                  onClick={handleCancel}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                >
                  取消
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
          <span>添加节点</span>
        </motion.button>
      )}
    </div>
  );
};

// 配置管理组件
const ConfigManager: React.FC = () => {
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);

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
        
        message.success('配置已导出成功');
      } catch (error) {
        console.error('导出配置失败:', error);
        message.error(`导出配置失败: ${error}`);
      } finally {
        setExporting(false);
      }
    } catch (error) {
      console.error('导出配置失败:', error);
      message.error(`导出配置失败: ${error}`);
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
        
        message.success('配置导入成功，设置已更新');
      } catch (error) {
        console.error('导入配置失败:', error);
        message.error(`导入配置失败: ${error}`);
      } finally {
        setImporting(false);
      }
    } catch (error) {
      console.error('导入配置失败:', error);
      message.error(`导入配置失败: ${error}`);
      setImporting(false);
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
              <span>导出中...</span>
            </>
          ) : (
            <>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
              <span>导出配置</span>
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
              <span>导入中...</span>
            </>
          ) : (
            <>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="17 8 12 3 7 8"></polyline>
                <line x1="12" y1="3" x2="12" y2="15"></line>
              </svg>
              <span>导入配置</span>
            </>
          )}
        </motion.button>
      </div>
    </div>
  );
};
