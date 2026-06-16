import React, { useState, useEffect } from 'react';
import { Modal, Form, Input, Switch, InputNumber, Select, message, Spin } from 'antd';
import { invoke } from '@tauri-apps/api/core';
import { VoiceDevicePanel } from '../VoiceSettings/VoiceSettings';
import { useAppStore } from '../../stores';
import { p2pChatService } from '../../services/chat/P2PChatService';
import './LobbySettingsModal.css';

interface LobbySettingsModalProps {
  visible: boolean;
  onClose: () => void;
  currentLobby: {
    name: string;
    password: string;
    virtualIp: string;
  };
  onSettingsSaved: () => void;
}

export const LobbySettingsModal: React.FC<LobbySettingsModalProps> = ({
  visible,
  onClose,
  onSettingsSaved,
}) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [useGlobalConfig, setUseGlobalConfig] = useState(true);
  const myVoiceGroup = useAppStore((s) => s.myVoiceGroup);
  const setMyVoiceGroup = useAppStore((s) => s.setMyVoiceGroup);
  
  // 【关键修复】使用 ref 来存储最新的 useGlobalConfig 值，避免闭包问题
  const useGlobalConfigRef = React.useRef(useGlobalConfig);
  
  // 同步更新 ref
  React.useEffect(() => {
    useGlobalConfigRef.current = useGlobalConfig;
    console.log('🔄 [LobbySettings] useGlobalConfig 状态已更新为:', useGlobalConfig);
  }, [useGlobalConfig]);

  // 加载当前设置
  useEffect(() => {
    if (visible) {
      loadSettings();
    }
  }, [visible]);

  const loadSettings = async () => {
    setLoading(true);
    try {
      const config = await invoke<any>('get_lobby_easytier_advanced_config');
      console.log('📖 [LobbySettings] 加载的大厅高级配置:', JSON.stringify(config, null, 2));
      console.log('📖 [LobbySettings] use_global_config 字段值:', config.use_global_config);
      console.log('📖 [LobbySettings] dev_name 字段值:', config.dev_name);
      
      const useGlobal = config.use_global_config ?? true;
      console.log('📖 [LobbySettings] 将设置 useGlobalConfig 状态为:', useGlobal);
      setUseGlobalConfig(useGlobal);
      form.setFieldsValue(config);
    } catch (error) {
      console.error('❌ [LobbySettings] 加载设置失败:', error);
      message.error('加载设置失败');
    } finally {
      setLoading(false);
    }
  };
  
  const handleReset = async () => {
    try {
      console.log('🔄 [LobbySettings] 开始重置大厅配置');
      setLoading(true);
      
      // 清除大厅配置
      await invoke('clear_lobby_easytier_advanced_config');
      console.log('✅ [LobbySettings] 大厅配置已清除');
      
      // 重新加载配置（会加载默认配置）
      await loadSettings();
      
      message.success('大厅配置已重置为默认值');
    } catch (error) {
      console.error('❌ [LobbySettings] 重置配置失败:', error);
      message.error('重置配置失败');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      let configToSave: any;
      
      // 【关键修复】使用 ref 获取最新的状态值，避免闭包陷阱
      const currentUseGlobalConfig = useGlobalConfigRef.current;
      
      console.log('💾 [LobbySettings] 开始保存配置');
      console.log('💾 [LobbySettings] 当前 useGlobalConfig 状态（state）:', useGlobalConfig);
      console.log('💾 [LobbySettings] 当前 useGlobalConfig 状态（ref）:', currentUseGlobalConfig);
      
      if (currentUseGlobalConfig) {
        // 如果使用全局配置，从后端获取全局配置并保存
        console.log('📖 [LobbySettings] 使用全局配置，正在获取全局配置...');
        const globalConfig = await invoke<any>('get_global_easytier_advanced_config');
        configToSave = {
          ...globalConfig,
          use_global_config: true,
        };
        console.log('📝 [LobbySettings] 将保存全局配置到大厅配置:', JSON.stringify(configToSave, null, 2));
      } else {
        // 【关键修复】如果不使用全局配置，使用表单中的值，并确保 use_global_config 为 false
        const values = form.getFieldsValue(true);
        
        // 处理数组字段（将字符串转换为数组）
        const processArrayField = (field: any) => {
          if (!field) return [];
          if (Array.isArray(field)) return field;
          if (typeof field === 'string') {
            return field.split('\n').map(s => s.trim()).filter(s => s.length > 0);
          }
          return [];
        };
        
        configToSave = {
          ...values,
          use_global_config: false, // 【关键】确保使用大厅配置
          // 处理数组字段
          proxy_networks: processArrayField(values.proxy_networks),
          exit_nodes: processArrayField(values.exit_nodes),
          relay_network_whitelist: processArrayField(values.relay_network_whitelist),
          manual_routes: processArrayField(values.manual_routes),
          listeners: processArrayField(values.listeners),
          mapped_listeners: processArrayField(values.mapped_listeners),
          tcp_whitelist: processArrayField(values.tcp_whitelist),
          udp_whitelist: processArrayField(values.udp_whitelist),
          stun_servers: processArrayField(values.stun_servers),
          stun_servers_v6: processArrayField(values.stun_servers_v6),
          // 处理端口转发规则
          port_forward_rules: values.port_forward_rules || [],
        };
        console.log('📝 [LobbySettings] 将保存表单配置到大厅配置:', JSON.stringify(configToSave, null, 2));
        console.log('📝 [LobbySettings] use_global_config 字段值:', configToSave.use_global_config);
        console.log('📝 [LobbySettings] dev_name 字段值:', configToSave.dev_name);
      }
      
      setSaving(true);
      await invoke('save_lobby_easytier_advanced_config', { configJson: configToSave });
      
      console.log('✅ [LobbySettings] 配置已保存到后端');
      console.log('🔔 [LobbySettings] 准备调用 onSettingsSaved 回调');
      
      // 先通知父组件设置已保存（父组件会关闭弹窗并显示重新配置弹窗）
      onSettingsSaved();
      
      console.log('✅ [LobbySettings] onSettingsSaved 回调已调用');
    } catch (error) {
      console.error('❌ [LobbySettings] 保存设置失败:', error);
      message.error('保存设置失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={visible}
      onCancel={onClose}
      footer={null}
      width={500}
      centered
      className="lobby-settings-modal"
      destroyOnClose
    >
      <div className="lobby-settings-content">
        <div className="lobby-settings-header">
          <h2>大厅动态设置</h2>
          <p>修改设置后将自动重新加入大厅</p>
        </div>

        {/* 语音设备设置（麦克风 / 扬声器选择与试音） */}
        <div className="lobby-voice-section">
          <div className="lobby-voice-section-title">语音设备</div>
          <VoiceDevicePanel active={visible} />
        </div>
        <div className="lobby-voice-divider" />

        {/* 语音频道（小队语音）：选择后只与同频道成员通话 */}
        <div className="lobby-voice-section">
          <div className="lobby-voice-section-title">语音频道</div>
          <div className="lobby-vc-hint">
            选择一个语音频道后，你将<strong>只能听到同频道玩家的声音</strong>，也只有同频道的人能听到你的声音。
          </div>
          <div className="lobby-vc-chips">
            {[0, 1, 2, 3, 4, 5, 6].map((g) => (
              <button
                key={g}
                type="button"
                className={`lobby-vc-chip ${myVoiceGroup === g ? 'active' : ''}`}
                onClick={() => {
                  setMyVoiceGroup(g);
                  void p2pChatService.sendControlMessage('voicegroup', String(g));
                }}
              >
                {g === 0 ? '公共频道' : `${g} 队`}
              </button>
            ))}
          </div>
        </div>
        <div className="lobby-voice-divider" />

        <div className="lobby-config-section-head">
          <span className="lobby-config-section-title">EasyTier 网络配置</span>
          <span className="lobby-config-section-note">仅以下网络配置需要点底部「保存」，语音设备与频道选择即时生效</span>
        </div>
        <Spin spinning={loading}>
          <div className="use-global-config-switch">
            <span>使用全局配置</span>
            <Switch
              checked={useGlobalConfig}
              onChange={(checked) => {
                console.log('🔄 [LobbySettings] 用户切换"使用全局配置"开关:', checked);
                console.log('🔄 [LobbySettings] 切换前的状态:', useGlobalConfig);
                setUseGlobalConfig(checked);
                console.log('🔄 [LobbySettings] 已调用 setUseGlobalConfig，新值:', checked);
              }}
            />
          </div>

          {useGlobalConfig && (
            <div className="global-config-hint">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="rgba(126,211,33,0.8)">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
              </svg>
              <span>当前使用全局配置，您可以在 MCTier 设置中修改全局配置</span>
            </div>
          )}

          {!useGlobalConfig && (
            <Form 
              form={form} 
              layout="vertical" 
              className="lobby-settings-form"
              onValuesChange={() => {
                // 【关键修复】当用户修改任何字段时，自动关闭"使用全局配置"开关
                console.log('📝 [LobbySettings] 用户修改了表单字段，确保 use_global_config 为 false');
                if (useGlobalConfig) {
                  console.log('⚠️ [LobbySettings] 检测到 useGlobalConfig 为 true，自动关闭');
                  setUseGlobalConfig(false);
                }
              }}
            >
              {/* 网络模式 */}
              <div className="config-section-title">网络模式</div>
              <Form.Item name="no_tun" label="无 TUN 模式" valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="dhcp" label="启用 DHCP" valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="ipv4" label="手动指定 IPv4">
                <Input placeholder="10.144.144.1/24" />
              </Form.Item>

              {/* 代理和转发 */}
              <div className="config-section-title">代理和转发</div>
              <Form.Item name="enable_socks5" label="启用 SOCKS5 代理" valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="socks5_port" label="SOCKS5 端口">
                <InputNumber min={1024} max={65535} placeholder="1080" style={{ width: '100%' }} />
              </Form.Item>
              
              {/* 端口转发 */}
              <div style={{ marginTop: '16px', marginBottom: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ fontWeight: 500, fontSize: '13px' }}>端口转发规则</span>
                  <button
                    type="button"
                    onClick={() => {
                      const currentRules = form.getFieldValue('port_forward_rules') || [];
                      form.setFieldsValue({
                        port_forward_rules: [
                          ...currentRules,
                          { protocol: 'tcp', bind_addr: '0.0.0.0:5678', dst_addr: '10.126.126.1:5678' }
                        ]
                      });
                    }}
                    style={{
                      padding: '3px 10px',
                      background: 'rgba(126, 211, 33, 0.1)',
                      border: '1px solid rgba(126, 211, 33, 0.3)',
                      borderRadius: '4px',
                      color: 'rgba(126, 211, 33, 0.9)',
                      cursor: 'pointer',
                      fontSize: '11px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '3px'
                    }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="12" y1="5" x2="12" y2="19"></line>
                      <line x1="5" y1="12" x2="19" y2="12"></line>
                    </svg>
                    添加
                  </button>
                </div>
                <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '8px' }}>
                  将本地端口转发到虚拟网络中的远程端口
                </div>
              </div>
              
              <Form.List name="port_forward_rules">
                {(fields, { remove }) => (
                  <>
                    {fields.map((field) => (
                      <div key={field.key} style={{ 
                        marginBottom: '10px',
                        padding: '10px',
                        background: 'rgba(255,255,255,0.03)',
                        borderRadius: '6px',
                        border: '1px solid rgba(255,255,255,0.1)',
                        position: 'relative'
                      }}>
                        {/* 删除按钮 - 放在右上角 */}
                        <button
                          type="button"
                          onClick={() => remove(field.name)}
                          style={{
                            position: 'absolute',
                            top: '6px',
                            right: '6px',
                            padding: '3px 8px',
                            background: 'rgba(255, 77, 79, 0.1)',
                            border: '1px solid rgba(255, 77, 79, 0.3)',
                            borderRadius: '4px',
                            color: 'rgba(255, 77, 79, 0.9)',
                            cursor: 'pointer',
                            fontSize: '11px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '3px'
                          }}
                          title="删除规则"
                        >
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                          </svg>
                          删除
                        </button>
                        
                        {/* 协议选择 */}
                        <div style={{ marginBottom: '6px' }}>
                          <label style={{ display: 'block', marginBottom: '3px', fontSize: '11px', color: 'rgba(255,255,255,0.7)' }}>
                            协议类型
                          </label>
                          <Form.Item
                            {...field}
                            name={[field.name, 'protocol']}
                            style={{ marginBottom: 0 }}
                          >
                            <Select
                              size="small"
                              style={{ width: '100%' }}
                              getPopupContainer={(t) => (t.parentElement as HTMLElement) || document.body}
                              options={[
                                { value: 'tcp', label: 'TCP' },
                                { value: 'udp', label: 'UDP' },
                              ]}
                            />
                          </Form.Item>
                        </div>
                        
                        {/* 本地地址 */}
                        <div style={{ marginBottom: '6px' }}>
                          <label style={{ display: 'block', marginBottom: '3px', fontSize: '11px', color: 'rgba(255,255,255,0.7)' }}>
                            本地地址
                          </label>
                          <Form.Item
                            {...field}
                            name={[field.name, 'bind_addr']}
                            style={{ marginBottom: 0 }}
                          >
                            <Input placeholder="例如：0.0.0.0:5678" size="small" style={{ fontSize: '12px' }} />
                          </Form.Item>
                        </div>
                        
                        {/* 箭头指示 */}
                        <div style={{ 
                          display: 'flex', 
                          alignItems: 'center', 
                          justifyContent: 'center',
                          margin: '3px 0',
                          color: 'rgba(126, 211, 33, 0.6)',
                          fontSize: '14px'
                        }}>
                          ↓
                        </div>
                        
                        {/* 目标地址 */}
                        <div>
                          <label style={{ display: 'block', marginBottom: '3px', fontSize: '11px', color: 'rgba(255,255,255,0.7)' }}>
                            目标地址
                          </label>
                          <Form.Item
                            {...field}
                            name={[field.name, 'dst_addr']}
                            style={{ marginBottom: 0 }}
                          >
                            <Input placeholder="例如：10.126.126.1:5678" size="small" style={{ fontSize: '12px' }} />
                          </Form.Item>
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </Form.List>
              
              <Form.Item name="proxy_forward_by_system" label="系统转发" valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="proxy_networks" label="子网代理 CIDR 列表">
                <Input.TextArea placeholder="192.168.1.0/24" rows={2} />
              </Form.Item>

              {/* 出口节点 */}
              <div className="config-section-title">出口节点</div>
              <Form.Item name="enable_as_exit_node" label="作为出口节点" valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="exit_nodes" label="出口节点列表">
                <Input.TextArea placeholder="10.99.0.1" rows={2} />
              </Form.Item>

              {/* 性能优化 */}
              <div className="config-section-title">性能优化</div>
              <Form.Item name="multi_thread" label="启用多线程" valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="multi_thread_count" label="线程数量">
                <InputNumber min={2} max={16} placeholder="2" style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="latency_first" label="延迟优先模式" valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="use_smoltcp" label="启用 smoltcp" valuePropName="checked">
                <Switch />
              </Form.Item>

              {/* 协议优化 */}
              <div className="config-section-title">协议优化</div>
              <Form.Item name="enable_kcp_proxy" label="启用 KCP 代理" valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="disable_kcp_input" label="禁用 KCP 输入" valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="enable_quic_proxy" label="启用 QUIC 代理" valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="disable_quic_input" label="禁用 QUIC 输入" valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="quic_listen_port" label="QUIC 监听端口">
                <InputNumber min={0} max={65535} placeholder="0（随机）" style={{ width: '100%' }} />
              </Form.Item>

              {/* 加密和安全 */}
              <div className="config-section-title">加密和安全</div>
              <Form.Item name="disable_encryption" label="禁用加密" valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="encryption_algorithm" label="加密算法">
                <Input placeholder="aes-gcm" />
              </Form.Item>

              {/* 网络设备 */}
              <div className="config-section-title">网络设备</div>
              <Form.Item name="bind_device" label="绑定物理设备" valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="dev_name" label="TUN 设备名称">
                <Input placeholder="MCTier_Net" />
              </Form.Item>
              <Form.Item name="mtu" label="MTU 大小">
                <InputNumber min={1280} max={1500} placeholder="1380" style={{ width: '100%' }} />
              </Form.Item>

              {/* P2P 配置 */}
              <div className="config-section-title">P2P 配置</div>
              <Form.Item name="p2p_only" label="仅使用 P2P" valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="disable_p2p" label="禁用 P2P" valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="disable_udp_hole_punching" label="禁用 UDP 打洞" valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="disable_tcp_hole_punching" label="禁用 TCP 打洞" valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="disable_sym_hole_punching" label="禁用对称 NAT 打洞" valuePropName="checked">
                <Switch />
              </Form.Item>

              {/* 中继配置 */}
              <div className="config-section-title">中继配置</div>
              <Form.Item name="relay_network_whitelist" label="中继网络白名单">
                <Input.TextArea placeholder="*（允许所有）" rows={2} />
              </Form.Item>
              <Form.Item name="relay_all_peer_rpc" label="转发所有对等节点 RPC" valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="disable_relay_kcp" label="禁用中继 KCP" valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="enable_relay_foreign_network_kcp" label="启用中继外部网络 KCP" valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="foreign_relay_bps_limit" label="外部网络流量限制（BPS）">
                <InputNumber min={0} placeholder="0（无限制）" style={{ width: '100%' }} />
              </Form.Item>

              {/* 路由配置 */}
              <div className="config-section-title">路由配置</div>
              <Form.Item name="manual_routes" label="手动路由 CIDR">
                <Input.TextArea placeholder="10.0.0.0/8" rows={2} />
              </Form.Item>

              {/* 压缩 */}
              <div className="config-section-title">压缩</div>
              <Form.Item name="compression" label="压缩算法">
                <Input placeholder="none" />
              </Form.Item>

              {/* 监听器配置 */}
              <div className="config-section-title">监听器配置</div>
              <Form.Item name="listeners" label="监听器列表">
                <Input.TextArea placeholder="tcp://0.0.0.0:11010" rows={2} />
              </Form.Item>
              <Form.Item name="mapped_listeners" label="映射的监听器（公网地址）">
                <Input.TextArea placeholder="tcp://1.2.3.4:11010" rows={2} />
              </Form.Item>
              <Form.Item name="no_listener" label="不监听任何端口" valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="default_protocol" label="默认协议">
                <Input placeholder="tcp" />
              </Form.Item>

              {/* DNS 配置 */}
              <div className="config-section-title">DNS 配置</div>
              <Form.Item name="accept_dns" label="启用魔法 DNS" valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="tld_dns_zone" label="顶级域名区域">
                <Input placeholder="et.net" />
              </Form.Item>

              {/* 端口白名单 */}
              <div className="config-section-title">端口白名单</div>
              <Form.Item name="tcp_whitelist" label="TCP 端口白名单">
                <Input.TextArea placeholder="80&#10;443&#10;8000-9000" rows={2} />
              </Form.Item>
              <Form.Item name="udp_whitelist" label="UDP 端口白名单">
                <Input.TextArea placeholder="53&#10;123" rows={2} />
              </Form.Item>

              {/* IPv6 */}
              <div className="config-section-title">IPv6</div>
              <Form.Item name="disable_ipv6" label="禁用 IPv6" valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="ipv6" label="IPv6 地址">
                <Input placeholder="fe80::1/64" />
              </Form.Item>

              {/* STUN 服务器 */}
              <div className="config-section-title">STUN 服务器</div>
              <Form.Item name="stun_servers" label="STUN 服务器列表">
                <Input.TextArea placeholder="stun://stun.l.google.com:19302" rows={2} />
              </Form.Item>
              <Form.Item name="stun_servers_v6" label="IPv6 STUN 服务器列表">
                <Input.TextArea placeholder="stun://[2001:4860:4860::8888]:19302" rows={2} />
              </Form.Item>

              {/* 私有模式 */}
              <div className="config-section-title">私有模式</div>
              <Form.Item name="private_mode" label="启用私有模式" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Form>
          )}
        </Spin>

        {/* 底部按钮 */}
        <div className="lobby-settings-footer">
          <button
            className="lobby-settings-btn lobby-settings-btn-cancel"
            onClick={onClose}
            disabled={saving || loading}
          >
            取消
          </button>
          <button
            className="lobby-settings-btn lobby-settings-btn-reset"
            onClick={handleReset}
            disabled={saving || loading}
          >
            {loading ? '重置中...' : '重置'}
          </button>
          <button
            className="lobby-settings-btn lobby-settings-btn-save"
            onClick={handleSave}
            disabled={saving || loading}
          >
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </Modal>
  );
};
