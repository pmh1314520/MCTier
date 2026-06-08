import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Modal, Form, Input, Switch, InputNumber, Select, message, Spin } from 'antd';
import { invoke } from '@tauri-apps/api/core';
import './ExitNodeAdvancedModal.css';

interface PortForwardRule {
  protocol: string;
  bind_addr: string;
  dst_addr: string;
}

interface ExitNodeAdvancedModalProps {
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export const ExitNodeAdvancedModal: React.FC<ExitNodeAdvancedModalProps> = ({
  visible,
  onClose,
  onSaved,
}) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  
  // 状态变量
  const [enableSocks5, setEnableSocks5] = useState(false);
  const [noTun, setNoTun] = useState(false);
  const [proxyForwardBySystem, setProxyForwardBySystem] = useState(false);
  const [bindDevice, setBindDevice] = useState(false);
  const [multiThread, setMultiThread] = useState(false);
  const [useSmoltcp, setUseSmoltcp] = useState(false);
  const [enableKcpProxy, setEnableKcpProxy] = useState(false);
  const [enableQuicProxy, setEnableQuicProxy] = useState(false);
  const [latencyFirst, setLatencyFirst] = useState(false);
  
  // 端口转发规则列表
  const [portForwardRules, setPortForwardRules] = useState<PortForwardRule[]>([]);

  // 加载当前配置
  useEffect(() => {
    if (visible) {
      loadConfig();
    }
  }, [visible]);

  const loadConfig = async () => {
    setLoading(true);
    try {
      const config = await invoke<any>('get_exit_node_advanced_config');
      
      console.log('📖 [ExitNodeAdvanced] 加载的配置:', config);
      
      // 设置状态
      setEnableSocks5(config.enableSocks5 || false);
      setNoTun(config.noTun || false);
      setProxyForwardBySystem(config.proxyForwardBySystem || false);
      setBindDevice(config.bindDevice || false);
      setMultiThread(config.multiThread || false);
      setUseSmoltcp(config.useSmoltcp || false);
      setEnableKcpProxy(config.enableKcpProxy || false);
      setEnableQuicProxy(config.enableQuicProxy || false);
      setLatencyFirst(config.latencyFirst || false);
      setPortForwardRules(config.portForwardRules || []);
      
      // 设置表单值
      form.setFieldsValue({
        socks5Port: config.socks5Port || 5678,
        multiThreadCount: config.multiThreadCount || 2,
      });
      
      console.log('✅ [ExitNodeAdvanced] 配置加载完成');
    } catch (error) {
      console.error('❌ [ExitNodeAdvanced] 加载配置失败:', error);
      message.error('加载配置失败');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      await form.validateFields();
      const values = form.getFieldsValue();
      
      console.log('📝 [ExitNodeAdvanced] 准备保存配置');
      console.log('  - 表单值:', values);
      console.log('  - enableSocks5:', enableSocks5);
      console.log('  - noTun:', noTun);
      console.log('  - portForwardRules:', portForwardRules);
      
      setSaving(true);
      
      await invoke('save_exit_node_advanced_config', {
        enableSocks5,
        socks5Port: values.socks5Port || null,
        portForwardRules: portForwardRules.length > 0 ? portForwardRules : null,
        noTun,
        proxyForwardBySystem,
        bindDevice,
        multiThread,
        multiThreadCount: values.multiThreadCount || null,
        useSmoltcp,
        enableKcpProxy,
        enableQuicProxy,
        latencyFirst,
      });
      
      console.log('✅ [ExitNodeAdvanced] 配置已保存');
      message.success('配置已保存');
      
      onSaved();
      onClose();
    } catch (error) {
      console.error('❌ [ExitNodeAdvanced] 保存配置失败:', error);
      message.error('保存配置失败');
    } finally {
      setSaving(false);
    }
  };

  // 添加端口转发规则
  const handleAddPortForwardRule = () => {
    setPortForwardRules([
      ...portForwardRules,
      { protocol: 'tcp', bind_addr: '0.0.0.0:5678', dst_addr: '10.2.2.1:5678' },
    ]);
  };

  // 删除端口转发规则
  const handleRemovePortForwardRule = (index: number) => {
    setPortForwardRules(portForwardRules.filter((_, i) => i !== index));
  };

  // 更新端口转发规则
  const handleUpdatePortForwardRule = (index: number, field: keyof PortForwardRule, value: string) => {
    const newRules = [...portForwardRules];
    newRules[index] = { ...newRules[index], [field]: value };
    setPortForwardRules(newRules);
  };

  return (
    <Modal
      open={visible}
      onCancel={onClose}
      footer={null}
      width={700}
      centered
      className="exit-node-advanced-modal"
      destroyOnClose
    >
      <div className="exit-node-advanced-content">
        <div className="exit-node-advanced-header">
          <h2>出口节点高级配置</h2>
          <p>配置 SOCKS5 代理、端口转发和其他高级功能</p>
        </div>

        <Spin spinning={loading}>
          <Form
            form={form}
            layout="vertical"
            className="exit-node-advanced-form"
          >
            {/* SOCKS5 代理 */}
            <div className="config-section">
              <h3>SOCKS5 代理</h3>
              <div className="config-toggle">
                <div className="toggle-info">
                  <span className="toggle-label">启用 SOCKS5 代理</span>
                  <span className="toggle-desc">开启后可以通过 SOCKS5 协议访问虚拟网络</span>
                </div>
                <Switch
                  checked={enableSocks5}
                  onChange={(v) => {
                    console.log('🔄 [ExitNodeAdvanced] enableSocks5 变化:', v);
                    setEnableSocks5(v);
                  }}
                />
              </div>

              <AnimatePresence>
                {enableSocks5 && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.3 }}
                    style={{ overflow: 'hidden' }}
                  >
                    <Form.Item
                      name="socks5Port"
                      label="SOCKS5 端口"
                      rules={[
                        { required: true, message: '请输入端口号' },
                        { type: 'number', min: 1024, max: 65535, message: '端口号必须在 1024-65535 之间' },
                      ]}
                    >
                      <InputNumber
                        style={{ width: '100%' }}
                        placeholder="例如：5678"
                        min={1024}
                        max={65535}
                      />
                    </Form.Item>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* 端口转发 */}
            <div className="config-section">
              <h3>端口转发</h3>
              <p className="section-desc">
                将本地端口转发到虚拟网络中的远程端口。例如：将出口节点的 SOCKS5 端口转发到本地。
              </p>
              
              <div className="port-forward-list">
                {portForwardRules.map((rule, index) => (
                  <div key={index} className="port-forward-rule">
                    <Select
                      value={rule.protocol}
                      onChange={(val) => handleUpdatePortForwardRule(index, 'protocol', val)}
                      className="protocol-select"
                      style={{ width: 92 }}
                      getPopupContainer={(t) => (t.parentElement as HTMLElement) || document.body}
                      options={[
                        { value: 'tcp', label: 'TCP' },
                        { value: 'udp', label: 'UDP' },
                      ]}
                    />
                    <Input
                      value={rule.bind_addr}
                      onChange={(e) => handleUpdatePortForwardRule(index, 'bind_addr', e.target.value)}
                      placeholder="本地地址（例如：0.0.0.0:5678）"
                      style={{ flex: 1 }}
                    />
                    <span className="arrow">→</span>
                    <Input
                      value={rule.dst_addr}
                      onChange={(e) => handleUpdatePortForwardRule(index, 'dst_addr', e.target.value)}
                      placeholder="目标地址（例如：10.2.2.1:5678）"
                      style={{ flex: 1 }}
                    />
                    <button
                      className="remove-rule-btn"
                      onClick={() => handleRemovePortForwardRule(index)}
                      title="删除规则"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
              
              <button
                className="add-rule-btn"
                onClick={handleAddPortForwardRule}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="12" y1="5" x2="12" y2="19"></line>
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
                <span>添加转发规则</span>
              </button>
            </div>

            {/* 高级选项 */}
            <div className="config-section">
              <h3>高级选项</h3>
              
              <div className="config-toggle">
                <div className="toggle-info">
                  <span className="toggle-label">无 TUN 模式</span>
                  <span className="toggle-desc">不创建虚拟网卡，仅通过子网代理访问节点</span>
                </div>
                <Switch checked={noTun} onChange={setNoTun} />
              </div>

              <div className="config-toggle">
                <div className="toggle-info">
                  <span className="toggle-label">系统转发</span>
                  <span className="toggle-desc">通过系统内核转发子网代理数据包</span>
                </div>
                <Switch checked={proxyForwardBySystem} onChange={setProxyForwardBySystem} />
              </div>

              <div className="config-toggle">
                <div className="toggle-info">
                  <span className="toggle-label">仅使用物理网卡</span>
                  <span className="toggle-desc">绑定物理设备避免路由问题</span>
                </div>
                <Switch checked={bindDevice} onChange={setBindDevice} />
              </div>

              <div className="config-toggle">
                <div className="toggle-info">
                  <span className="toggle-label">启用多线程</span>
                  <span className="toggle-desc">使用多线程运行时提升性能</span>
                </div>
                <Switch checked={multiThread} onChange={setMultiThread} />
              </div>

              <AnimatePresence>
                {multiThread && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.3 }}
                    style={{ overflow: 'hidden', marginLeft: '20px' }}
                  >
                    <Form.Item
                      name="multiThreadCount"
                      label="线程数量"
                      rules={[
                        { type: 'number', min: 2, message: '线程数量必须大于等于 2' },
                      ]}
                    >
                      <InputNumber
                        style={{ width: '100%' }}
                        placeholder="默认：2"
                        min={2}
                      />
                    </Form.Item>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="config-toggle">
                <div className="toggle-info">
                  <span className="toggle-label">启用 smoltcp</span>
                  <span className="toggle-desc">为子网代理和 KCP 代理启用 smoltcp 堆栈</span>
                </div>
                <Switch checked={useSmoltcp} onChange={setUseSmoltcp} />
              </div>

              <div className="config-toggle">
                <div className="toggle-info">
                  <span className="toggle-label">启用 KCP 代理</span>
                  <span className="toggle-desc">使用 KCP 代理 TCP 流，提高在 UDP 丢包网络上的性能</span>
                </div>
                <Switch checked={enableKcpProxy} onChange={setEnableKcpProxy} />
              </div>

              <div className="config-toggle">
                <div className="toggle-info">
                  <span className="toggle-label">启用 QUIC 代理</span>
                  <span className="toggle-desc">使用 QUIC 代理 TCP 流，提高在 UDP 丢包网络上的性能</span>
                </div>
                <Switch checked={enableQuicProxy} onChange={setEnableQuicProxy} />
              </div>

              <div className="config-toggle">
                <div className="toggle-info">
                  <span className="toggle-label">延迟优先模式</span>
                  <span className="toggle-desc">使用最低延迟路径转发流量</span>
                </div>
                <Switch checked={latencyFirst} onChange={setLatencyFirst} />
              </div>
            </div>
          </Form>
        </Spin>

        {/* 底部按钮 */}
        <div className="exit-node-advanced-footer">
          <button
            className="exit-node-advanced-btn exit-node-advanced-btn-cancel"
            onClick={onClose}
            disabled={saving}
          >
            取消
          </button>
          <button
            className="exit-node-advanced-btn exit-node-advanced-btn-save"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? '保存中...' : '保存配置'}
          </button>
        </div>
      </div>
    </Modal>
  );
};
