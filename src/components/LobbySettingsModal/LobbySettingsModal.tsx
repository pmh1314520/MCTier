import React, { useState, useEffect } from 'react';
import { Modal, Form, Input, Switch, InputNumber, Select, message, Spin } from 'antd';
import { invoke } from '@tauri-apps/api/core';
import { VoiceDevicePanel } from '../VoiceSettings/VoiceSettings';
import { useAppStore } from '../../stores';
import { p2pChatService } from '../../services/chat/P2PChatService';
import { audioService } from '../../services/audio/AudioService';
import { useTranslation } from 'react-i18next';
import { tl } from '../../i18n';
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
  useTranslation();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [useGlobalConfig, setUseGlobalConfig] = useState(true);
  const [soundMuted, setSoundMuted] = useState<boolean>(() => audioService.getSettings().muted);
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
      message.error(tl('加载设置失败', 'Failed to load settings'));
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
      
      message.success(tl('大厅配置已重置为默认值', 'Lobby config reset to defaults'));
    } catch (error) {
      console.error('❌ [LobbySettings] 重置配置失败:', error);
      message.error(tl('重置配置失败', 'Failed to reset config'));
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
      message.error(tl('保存设置失败', 'Failed to save settings'));
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
          <h2>{tl('大厅动态设置', 'Lobby Settings')}</h2>
          <p>{tl('修改设置后将自动重新加入大厅', 'Changes will rejoin the lobby automatically')}</p>
        </div>

        {/* 语音设备设置（麦克风 / 扬声器选择与试音） */}
        <div className="lobby-voice-section">
          <div className="lobby-voice-section-title">{tl('语音设备', 'Audio Devices')}</div>
          <VoiceDevicePanel active={visible} />
        </div>
        <div className="lobby-voice-divider" />

        {/* 语音频道（小队语音）：选择后只与同频道成员通话 */}
        <div className="lobby-voice-section">
          <div className="lobby-voice-section-title">{tl('语音频道', 'Voice Channel')}</div>
          <div className="lobby-vc-hint">
            {tl('选择一个语音频道后，你将', 'After choosing a voice channel, you will ')}<strong>{tl('只能听到同频道玩家的声音', 'only hear players in the same channel')}</strong>{tl('，也只有同频道的人能听到你的声音。', ', and only they can hear you.')}
          </div>
          <div className="lobby-vc-chips">
            {[0, 1, 2, 3, 4, 5].map((g) => (
              <button
                key={g}
                type="button"
                className={`lobby-vc-chip ${myVoiceGroup === g ? 'active' : ''}`}
                onClick={() => {
                  setMyVoiceGroup(g);
                  void p2pChatService.sendControlMessage('voicegroup', String(g));
                }}
              >
                {g === 0 ? tl('公共频道', 'Public') : `${tl('', 'Team ')}${g}${tl(' 队', '')}`}
              </button>
            ))}
          </div>
        </div>
        <div className="lobby-voice-divider" />

        {/* 提示音 */}
        <div className="lobby-voice-section">
          <div className="lobby-voice-section-title">{tl('提示音', 'Sounds')}</div>
          <div className="use-global-config-switch">
            <span>{tl('提示音禁音', 'Mute sounds')}</span>
            <Switch
              checked={soundMuted}
              onChange={(checked) => {
                setSoundMuted(checked);
                audioService.setMuted(checked);
              }}
            />
          </div>
        </div>
        <div className="lobby-voice-divider" />

        <div className="lobby-config-box">
        <div className="lobby-config-section-head">
          <span className="lobby-config-section-title">{tl('EasyTier 网络配置', 'EasyTier Network Config')}</span>
          <span className="lobby-config-section-note">{tl('仅本区域配置需要点下方「保存」，语音设备与频道选择即时生效', 'Only this section needs Save below; audio device and channel changes apply instantly')}</span>
        </div>
        <Spin spinning={loading}>
          <div className="use-global-config-switch">
            <span>{tl('使用全局配置', 'Use global config')}</span>
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
              <span>{tl('当前使用全局配置，您可以在 MCTier 设置中修改全局配置', 'Using global config; edit it in MCTier Settings')}</span>
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
              <div className="config-section-title">{tl("网络模式", "Network Mode")}</div>
              <Form.Item name="no_tun" label={tl("无 TUN 模式", "No-TUN mode")} valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="dhcp" label={tl("启用 DHCP", "Enable DHCP")} valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="ipv4" label={tl("手动指定 IPv4", "Manual IPv4")}>
                <Input placeholder="10.144.144.1/24" />
              </Form.Item>

              {/* 代理和转发 */}
              <div className="config-section-title">{tl("代理和转发", "Proxy & Forwarding")}</div>
              <Form.Item name="enable_socks5" label={tl("启用 SOCKS5 代理", "Enable SOCKS5 proxy")} valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="socks5_port" label="SOCKS5 端口">
                <InputNumber min={1024} max={65535} placeholder="1080" style={{ width: '100%' }} />
              </Form.Item>
              
              {/* 端口转发 */}
              <div style={{ marginTop: '16px', marginBottom: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ fontWeight: 500, fontSize: '13px' }}>{tl('端口转发规则', 'Port forwarding rules')}</span>
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
                          title={tl('删除规则', 'Delete rule')}
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
              
              <Form.Item name="proxy_forward_by_system" label={tl("系统转发", "System forwarding")} valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="proxy_networks" label={tl("子网代理 CIDR 列表", "Subnet proxy CIDRs")}>
                <Input.TextArea placeholder="192.168.1.0/24" rows={2} />
              </Form.Item>

              {/* 出口节点 */}
              <div className="config-section-title">{tl("出口节点", "Exit Node")}</div>
              <Form.Item name="enable_as_exit_node" label={tl("作为出口节点", "As exit node")} valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="exit_nodes" label={tl("出口节点列表", "Exit node list")}>
                <Input.TextArea placeholder="10.99.0.1" rows={2} />
              </Form.Item>

              {/* 性能优化 */}
              <div className="config-section-title">{tl("性能优化", "Performance")}</div>
              <Form.Item name="multi_thread" label={tl("启用多线程", "Enable multithreading")} valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="multi_thread_count" label={tl("线程数量", "Thread count")}>
                <InputNumber min={2} max={16} placeholder="2" style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="latency_first" label={tl("延迟优先模式", "Latency-first mode")} valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="use_smoltcp" label={tl("启用 smoltcp", "Enable smoltcp")} valuePropName="checked">
                <Switch />
              </Form.Item>

              {/* 协议优化 */}
              <div className="config-section-title">{tl("协议优化", "Protocol")}</div>
              <Form.Item name="enable_kcp_proxy" label={tl("启用 KCP 代理", "Enable KCP proxy")} valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="disable_kcp_input" label={tl("禁用 KCP 输入", "Disable KCP input")} valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="enable_quic_proxy" label={tl("启用 QUIC 代理", "Enable QUIC proxy")} valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="disable_quic_input" label={tl("禁用 QUIC 输入", "Disable QUIC input")} valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="quic_listen_port" label="QUIC 监听端口">
                <InputNumber min={0} max={65535} placeholder="0（随机）" style={{ width: '100%' }} />
              </Form.Item>

              {/* 加密和安全 */}
              <div className="config-section-title">{tl("加密和安全", "Encryption & Security")}</div>
              <Form.Item name="disable_encryption" label={tl("禁用加密", "Disable encryption")} valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="encryption_algorithm" label={tl("加密算法", "Encryption algorithm")}>
                <Input placeholder="aes-gcm" />
              </Form.Item>

              {/* 网络设备 */}
              <div className="config-section-title">{tl("网络设备", "Network Device")}</div>
              <Form.Item name="bind_device" label={tl("绑定物理设备", "Bind physical device")} valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="dev_name" label="TUN 设备名称">
                <Input placeholder="MCTier_Net" />
              </Form.Item>
              <Form.Item name="mtu" label="MTU 大小">
                <InputNumber min={1280} max={1500} placeholder="1380" style={{ width: '100%' }} />
              </Form.Item>

              {/* P2P 配置 */}
              <div className="config-section-title">{tl("P2P 配置", "P2P")}</div>
              <Form.Item name="p2p_only" label={tl("仅使用 P2P", "P2P only")} valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="disable_p2p" label={tl("禁用 P2P", "Disable P2P")} valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="disable_udp_hole_punching" label={tl("禁用 UDP 打洞", "Disable UDP hole punching")} valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="disable_tcp_hole_punching" label={tl("禁用 TCP 打洞", "Disable TCP hole punching")} valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="disable_sym_hole_punching" label={tl("禁用对称 NAT 打洞", "Disable symmetric NAT hole punching")} valuePropName="checked">
                <Switch />
              </Form.Item>

              {/* 中继配置 */}
              <div className="config-section-title">{tl("中继配置", "Relay")}</div>
              <Form.Item name="relay_network_whitelist" label={tl("中继网络白名单", "Relay network whitelist")}>
                <Input.TextArea placeholder="*（允许所有）" rows={2} />
              </Form.Item>
              <Form.Item name="relay_all_peer_rpc" label={tl("转发所有对等节点 RPC", "Relay all peer RPC")} valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="disable_relay_kcp" label={tl("禁用中继 KCP", "Disable relay KCP")} valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="enable_relay_foreign_network_kcp" label={tl("启用中继外部网络 KCP", "Enable foreign-network relay KCP")} valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="foreign_relay_bps_limit" label={tl("外部网络流量限制（BPS）", "Foreign network rate limit (BPS)")}>
                <InputNumber min={0} placeholder="0（无限制）" style={{ width: '100%' }} />
              </Form.Item>

              {/* 路由配置 */}
              <div className="config-section-title">{tl("路由配置", "Routing")}</div>
              <Form.Item name="manual_routes" label={tl("手动路由 CIDR", "Manual route CIDRs")}>
                <Input.TextArea placeholder="10.0.0.0/8" rows={2} />
              </Form.Item>

              {/* 压缩 */}
              <div className="config-section-title">{tl("压缩", "Compression")}</div>
              <Form.Item name="compression" label={tl("压缩算法", "Compression algorithm")}>
                <Input placeholder="none" />
              </Form.Item>

              {/* 监听器配置 */}
              <div className="config-section-title">{tl("监听器配置", "Listeners")}</div>
              <Form.Item name="listeners" label={tl("监听器列表", "Listener list")}>
                <Input.TextArea placeholder="tcp://0.0.0.0:11010" rows={2} />
              </Form.Item>
              <Form.Item name="mapped_listeners" label={tl("映射的监听器（公网地址）", "Mapped listeners (public address)")}>
                <Input.TextArea placeholder="tcp://1.2.3.4:11010" rows={2} />
              </Form.Item>
              <Form.Item name="no_listener" label={tl("不监听任何端口", "No listeners")} valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="default_protocol" label={tl("默认协议", "Default protocol")}>
                <Input placeholder="tcp" />
              </Form.Item>

              {/* DNS 配置 */}
              <div className="config-section-title">{tl("DNS 配置", "DNS")}</div>
              <Form.Item name="accept_dns" label={tl("启用魔法 DNS", "Enable magic DNS")} valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="tld_dns_zone" label={tl("顶级域名区域", "TLD DNS zone")}>
                <Input placeholder="et.net" />
              </Form.Item>

              {/* 端口白名单 */}
              <div className="config-section-title">{tl("端口白名单", "Port Whitelist")}</div>
              <Form.Item name="tcp_whitelist" label={tl("TCP 端口白名单", "TCP port whitelist")}>
                <Input.TextArea placeholder="80&#10;443&#10;8000-9000" rows={2} />
              </Form.Item>
              <Form.Item name="udp_whitelist" label={tl("UDP 端口白名单", "UDP port whitelist")}>
                <Input.TextArea placeholder="53&#10;123" rows={2} />
              </Form.Item>

              {/* IPv6 */}
              <div className="config-section-title">{tl("IPv6", "IPv6")}</div>
              <Form.Item name="disable_ipv6" label={tl("禁用 IPv6", "Disable IPv6")} valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="ipv6" label={tl("IPv6 地址", "IPv6 address")}>
                <Input placeholder="fe80::1/64" />
              </Form.Item>

              {/* STUN 服务器 */}
              <div className="config-section-title">{tl("STUN 服务器", "STUN Servers")}</div>
              <Form.Item name="stun_servers" label={tl("STUN 服务器列表", "STUN server list")}>
                <Input.TextArea placeholder="stun://stun.l.google.com:19302" rows={2} />
              </Form.Item>
              <Form.Item name="stun_servers_v6" label={tl("IPv6 STUN 服务器列表", "IPv6 STUN server list")}>
                <Input.TextArea placeholder="stun://[2001:4860:4860::8888]:19302" rows={2} />
              </Form.Item>

              {/* 私有模式 */}
              <div className="config-section-title">{tl("私有模式", "Private Mode")}</div>
              <Form.Item name="private_mode" label={tl("启用私有模式", "Enable private mode")} valuePropName="checked">
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
            {tl('取消', 'Cancel')}
          </button>
          <button
            className="lobby-settings-btn lobby-settings-btn-reset"
            onClick={handleReset}
            disabled={saving || loading}
          >
            {loading ? tl('重置中...', 'Resetting...') : tl('重置', 'Reset')}
          </button>
          <button
            className="lobby-settings-btn lobby-settings-btn-save"
            onClick={handleSave}
            disabled={saving || loading}
          >
            {saving ? tl('保存中...', 'Saving...') : tl('保存', 'Save')}
          </button>
        </div>
        </div>
      </div>
    </Modal>
  );
};
