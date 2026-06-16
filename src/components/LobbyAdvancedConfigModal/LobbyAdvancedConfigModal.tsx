import React, { useState, useEffect } from 'react';
import { Modal, Form, Switch, Collapse, InputNumber, Input, message, Spin } from 'antd';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import { tl } from '../../i18n';
import './LobbyAdvancedConfigModal.css';

const { Panel } = Collapse;

interface LobbyAdvancedConfigModalProps {
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export const LobbyAdvancedConfigModal: React.FC<LobbyAdvancedConfigModalProps> = ({
  visible,
  onClose,
  onSaved,
}) => {
  useTranslation();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [useGlobalConfig, setUseGlobalConfig] = useState(true);

  useEffect(() => {
    if (visible) {
      loadConfig();
    }
  }, [visible]);

  const loadConfig = async () => {
    setLoading(true);
    try {
      const config = await invoke<any>('get_lobby_easytier_advanced_config');
      console.log('加载的大厅高级配置:', config);
      setUseGlobalConfig(config.use_global_config ?? true);
      form.setFieldsValue(config);
    } catch (error) {
      console.error('加载大厅高级配置失败:', error);
      message.error(tl('加载配置失败', 'Failed to load configuration'));
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      const values = form.getFieldsValue(true);
      values.use_global_config = useGlobalConfig;
      
      console.log('保存大厅高级配置:', values);
      
      setSaving(true);
      await invoke('save_lobby_easytier_advanced_config', { configJson: values });
      message.success(tl('大厅高级配置已保存', 'Lobby advanced config saved'));
      onSaved();
      onClose();
    } catch (error) {
      console.error('保存大厅高级配置失败:', error);
      message.error(tl('保存配置失败', 'Failed to save configuration'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={visible}
      onCancel={onClose}
      footer={null}
      width={700}
      centered
      className="lobby-advanced-config-modal"
      destroyOnClose
    >
      <div className="lobby-advanced-config-content">
        <div className="lobby-advanced-config-header">
          <h2>{tl('大厅 EasyTier 高级配置', 'Lobby EasyTier Advanced Config')}</h2>
          <p>{tl('配置此大厅的 EasyTier 高级参数，可以覆盖全局配置', 'Configure EasyTier advanced parameters for this lobby; these override the global config')}</p>
        </div>

        <Spin spinning={loading}>
          <div className="use-global-config-switch">
            <span>{tl('使用全局配置', 'Use Global Config')}</span>
            <Switch
              checked={useGlobalConfig}
              onChange={(checked) => setUseGlobalConfig(checked)}
            />
          </div>

          {!useGlobalConfig && (
            <Form form={form} layout="vertical">
              <Collapse defaultActiveKey={['network']} className="lobby-advanced-collapse">
                {/* 网络模式 */}
                <Panel header={tl('网络模式', 'Network Mode')} key="network">
                  <Form.Item name="no_tun" label={tl('无 TUN 模式', 'No TUN Mode')} valuePropName="checked">
                    <Switch />
                  </Form.Item>
                  <Form.Item name="dhcp" label={tl('启用 DHCP', 'Enable DHCP')} valuePropName="checked">
                    <Switch />
                  </Form.Item>
                  <Form.Item name="ipv4" label={tl('手动指定 IPv4', 'Manual IPv4')}>
                    <Input placeholder="10.144.144.1/24" />
                  </Form.Item>
                </Panel>

                {/* 代理和转发 */}
                <Panel header={tl('代理和转发', 'Proxy & Forwarding')} key="proxy">
                  <Form.Item name="enable_socks5" label={tl('启用 SOCKS5 代理', 'Enable SOCKS5 Proxy')} valuePropName="checked">
                    <Switch />
                  </Form.Item>
                  <Form.Item name="socks5_port" label={tl('SOCKS5 端口', 'SOCKS5 Port')}>
                    <InputNumber min={1024} max={65535} placeholder="1080" style={{ width: '100%' }} />
                  </Form.Item>
                  <Form.Item name="proxy_forward_by_system" label={tl('系统转发', 'System Forwarding')} valuePropName="checked">
                    <Switch />
                  </Form.Item>
                  <Form.Item name="proxy_networks" label={tl('子网代理 CIDR 列表', 'Subnet Proxy CIDR List')}>
                    <Input.TextArea placeholder="192.168.1.0/24" rows={3} />
                  </Form.Item>
                </Panel>

                {/* 出口节点 */}
                <Panel header={tl('出口节点', 'Exit Node')} key="exit">
                  <Form.Item name="enable_as_exit_node" label={tl('作为出口节点', 'Act as Exit Node')} valuePropName="checked">
                    <Switch />
                  </Form.Item>
                  <Form.Item name="exit_nodes" label={tl('出口节点列表', 'Exit Node List')}>
                    <Input.TextArea placeholder="10.99.0.1" rows={3} />
                  </Form.Item>
                </Panel>

                {/* 性能优化 */}
                <Panel header={tl('性能优化', 'Performance')} key="performance">
                  <Form.Item name="multi_thread" label={tl('启用多线程', 'Enable Multithreading')} valuePropName="checked">
                    <Switch />
                  </Form.Item>
                  <Form.Item name="multi_thread_count" label={tl('线程数量', 'Thread Count')}>
                    <InputNumber min={2} max={16} placeholder="2" style={{ width: '100%' }} />
                  </Form.Item>
                  <Form.Item name="latency_first" label={tl('延迟优先模式', 'Latency-First Mode')} valuePropName="checked">
                    <Switch />
                  </Form.Item>
                  <Form.Item name="use_smoltcp" label={tl('启用 smoltcp', 'Enable smoltcp')} valuePropName="checked">
                    <Switch />
                  </Form.Item>
                </Panel>

                {/* 协议优化 */}
                <Panel header={tl('协议优化', 'Protocol Optimization')} key="protocol">
                  <Form.Item name="enable_kcp_proxy" label={tl('启用 KCP 代理', 'Enable KCP Proxy')} valuePropName="checked">
                    <Switch />
                  </Form.Item>
                  <Form.Item name="disable_kcp_input" label={tl('禁用 KCP 输入', 'Disable KCP Input')} valuePropName="checked">
                    <Switch />
                  </Form.Item>
                  <Form.Item name="enable_quic_proxy" label={tl('启用 QUIC 代理', 'Enable QUIC Proxy')} valuePropName="checked">
                    <Switch />
                  </Form.Item>
                  <Form.Item name="disable_quic_input" label={tl('禁用 QUIC 输入', 'Disable QUIC Input')} valuePropName="checked">
                    <Switch />
                  </Form.Item>
                  <Form.Item name="quic_listen_port" label={tl('QUIC 监听端口', 'QUIC Listen Port')}>
                    <InputNumber min={0} max={65535} placeholder={tl('0（随机）', '0 (random)')} style={{ width: '100%' }} />
                  </Form.Item>
                </Panel>

                {/* 加密和安全 */}
                <Panel header={tl('加密和安全', 'Encryption & Security')} key="security">
                  <Form.Item name="disable_encryption" label={tl('禁用加密', 'Disable Encryption')} valuePropName="checked">
                    <Switch />
                  </Form.Item>
                  <Form.Item name="encryption_algorithm" label={tl('加密算法', 'Encryption Algorithm')}>
                    <Input placeholder="aes-gcm" />
                  </Form.Item>
                </Panel>

                {/* 网络设备 */}
                <Panel header={tl('网络设备', 'Network Device')} key="device">
                  <Form.Item name="bind_device" label={tl('绑定物理设备', 'Bind Physical Device')} valuePropName="checked">
                    <Switch />
                  </Form.Item>
                  <Form.Item name="dev_name" label={tl('TUN 设备名称', 'TUN Device Name')}>
                    <Input placeholder="MCTier_Net" />
                  </Form.Item>
                  <Form.Item name="mtu" label={tl('MTU 大小', 'MTU Size')}>
                    <InputNumber min={1280} max={1500} placeholder="1380" style={{ width: '100%' }} />
                  </Form.Item>
                </Panel>

                {/* P2P 配置 */}
                <Panel header={tl('P2P 配置', 'P2P Config')} key="p2p">
                  <Form.Item name="p2p_only" label={tl('仅使用 P2P', 'P2P Only')} valuePropName="checked">
                    <Switch />
                  </Form.Item>
                  <Form.Item name="disable_p2p" label={tl('禁用 P2P', 'Disable P2P')} valuePropName="checked">
                    <Switch />
                  </Form.Item>
                  <Form.Item name="disable_udp_hole_punching" label={tl('禁用 UDP 打洞', 'Disable UDP Hole Punching')} valuePropName="checked">
                    <Switch />
                  </Form.Item>
                  <Form.Item name="disable_tcp_hole_punching" label={tl('禁用 TCP 打洞', 'Disable TCP Hole Punching')} valuePropName="checked">
                    <Switch />
                  </Form.Item>
                  <Form.Item name="disable_sym_hole_punching" label={tl('禁用对称 NAT 打洞', 'Disable Symmetric NAT Hole Punching')} valuePropName="checked">
                    <Switch />
                  </Form.Item>
                </Panel>

                {/* 中继配置 */}
                <Panel header={tl('中继配置', 'Relay Config')} key="relay">
                  <Form.Item name="relay_network_whitelist" label={tl('中继网络白名单', 'Relay Network Whitelist')}>
                    <Input.TextArea placeholder={tl('*（允许所有）', '* (allow all)')} rows={3} />
                  </Form.Item>
                  <Form.Item name="relay_all_peer_rpc" label={tl('转发所有对等节点 RPC', 'Relay All Peer RPC')} valuePropName="checked">
                    <Switch />
                  </Form.Item>
                  <Form.Item name="disable_relay_kcp" label={tl('禁用中继 KCP', 'Disable Relay KCP')} valuePropName="checked">
                    <Switch />
                  </Form.Item>
                  <Form.Item name="enable_relay_foreign_network_kcp" label={tl('启用中继外部网络 KCP', 'Enable Relay Foreign Network KCP')} valuePropName="checked">
                    <Switch />
                  </Form.Item>
                  <Form.Item name="foreign_relay_bps_limit" label={tl('外部网络流量限制（BPS）', 'Foreign Network Traffic Limit (BPS)')}>
                    <InputNumber min={0} placeholder={tl('0（无限制）', '0 (unlimited)')} style={{ width: '100%' }} />
                  </Form.Item>
                </Panel>

                {/* 路由配置 */}
                <Panel header={tl('路由配置', 'Route Config')} key="route">
                  <Form.Item name="manual_routes" label={tl('手动路由 CIDR', 'Manual Routes CIDR')}>
                    <Input.TextArea placeholder="10.0.0.0/8" rows={3} />
                  </Form.Item>
                </Panel>

                {/* 压缩 */}
                <Panel header={tl('压缩', 'Compression')} key="compression">
                  <Form.Item name="compression" label={tl('压缩算法', 'Compression Algorithm')}>
                    <Input placeholder="none" />
                  </Form.Item>
                </Panel>

                {/* 监听器配置 */}
                <Panel header={tl('监听器配置', 'Listener Config')} key="listener">
                  <Form.Item name="listeners" label={tl('监听器列表', 'Listener List')}>
                    <Input.TextArea placeholder="tcp://0.0.0.0:11010" rows={3} />
                  </Form.Item>
                  <Form.Item name="mapped_listeners" label={tl('映射的监听器（公网地址）', 'Mapped Listeners (Public Address)')}>
                    <Input.TextArea placeholder="tcp://1.2.3.4:11010" rows={3} />
                  </Form.Item>
                  <Form.Item name="no_listener" label={tl('不监听任何端口', 'No Listening Ports')} valuePropName="checked">
                    <Switch />
                  </Form.Item>
                  <Form.Item name="default_protocol" label={tl('默认协议', 'Default Protocol')}>
                    <Input placeholder="tcp" />
                  </Form.Item>
                </Panel>

                {/* DNS 配置 */}
                <Panel header={tl('DNS 配置', 'DNS Config')} key="dns">
                  <Form.Item name="accept_dns" label={tl('启用魔法 DNS', 'Enable Magic DNS')} valuePropName="checked">
                    <Switch />
                  </Form.Item>
                  <Form.Item name="tld_dns_zone" label={tl('顶级域名区域', 'TLD DNS Zone')}>
                    <Input placeholder="et.net" />
                  </Form.Item>
                </Panel>

                {/* 端口白名单 */}
                <Panel header={tl('端口白名单', 'Port Whitelist')} key="whitelist">
                  <Form.Item name="tcp_whitelist" label={tl('TCP 端口白名单', 'TCP Port Whitelist')}>
                    <Input.TextArea placeholder="80&#10;443&#10;8000-9000" rows={3} />
                  </Form.Item>
                  <Form.Item name="udp_whitelist" label={tl('UDP 端口白名单', 'UDP Port Whitelist')}>
                    <Input.TextArea placeholder="53&#10;123" rows={3} />
                  </Form.Item>
                </Panel>

                {/* IPv6 */}
                <Panel header="IPv6" key="ipv6">
                  <Form.Item name="disable_ipv6" label={tl('禁用 IPv6', 'Disable IPv6')} valuePropName="checked">
                    <Switch />
                  </Form.Item>
                  <Form.Item name="ipv6" label={tl('IPv6 地址', 'IPv6 Address')}>
                    <Input placeholder="fe80::1/64" />
                  </Form.Item>
                </Panel>

                {/* STUN 服务器 */}
                <Panel header={tl('STUN 服务器', 'STUN Servers')} key="stun">
                  <Form.Item name="stun_servers" label={tl('STUN 服务器列表', 'STUN Server List')}>
                    <Input.TextArea placeholder="stun://stun.l.google.com:19302" rows={3} />
                  </Form.Item>
                  <Form.Item name="stun_servers_v6" label={tl('IPv6 STUN 服务器列表', 'IPv6 STUN Server List')}>
                    <Input.TextArea placeholder="stun://[2001:4860:4860::8888]:19302" rows={3} />
                  </Form.Item>
                </Panel>

                {/* 私有模式 */}
                <Panel header={tl('私有模式', 'Private Mode')} key="private">
                  <Form.Item name="private_mode" label={tl('启用私有模式', 'Enable Private Mode')} valuePropName="checked">
                    <Switch />
                  </Form.Item>
                </Panel>
              </Collapse>
            </Form>
          )}

          {useGlobalConfig && (
            <div className="global-config-hint">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="rgba(126,211,33,0.8)">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
              </svg>
              <span>{tl('当前使用全局配置，您可以在 MCTier 设置中修改全局配置', 'Currently using the global config. You can change it in MCTier settings.')}</span>
            </div>
          )}
        </Spin>

        <div className="lobby-advanced-config-footer">
          <button
            className="lobby-advanced-config-btn lobby-advanced-config-btn-cancel"
            onClick={onClose}
            disabled={saving}
          >
            {tl('取消', 'Cancel')}
          </button>
          <button
            className="lobby-advanced-config-btn lobby-advanced-config-btn-save"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? tl('保存中...', 'Saving...') : tl('保存配置', 'Save Config')}
          </button>
        </div>
      </div>
    </Modal>
  );
};
