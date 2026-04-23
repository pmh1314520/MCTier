import React, { useState, useEffect } from 'react';
import { Modal, Form, Switch, Collapse, InputNumber, Input, message, Spin } from 'antd';
import { invoke } from '@tauri-apps/api/core';
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
      message.error('加载配置失败');
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
      message.success('大厅高级配置已保存');
      onSaved();
      onClose();
    } catch (error) {
      console.error('保存大厅高级配置失败:', error);
      message.error('保存配置失败');
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
          <h2>大厅 EasyTier 高级配置</h2>
          <p>配置此大厅的 EasyTier 高级参数，可以覆盖全局配置</p>
        </div>

        <Spin spinning={loading}>
          <div className="use-global-config-switch">
            <span>使用全局配置</span>
            <Switch
              checked={useGlobalConfig}
              onChange={(checked) => setUseGlobalConfig(checked)}
            />
          </div>

          {!useGlobalConfig && (
            <Form form={form} layout="vertical">
              <Collapse defaultActiveKey={['network']} className="lobby-advanced-collapse">
                {/* 网络模式 */}
                <Panel header="网络模式" key="network">
                  <Form.Item name="no_tun" label="无 TUN 模式" valuePropName="checked">
                    <Switch />
                  </Form.Item>
                  <Form.Item name="dhcp" label="启用 DHCP" valuePropName="checked">
                    <Switch />
                  </Form.Item>
                  <Form.Item name="ipv4" label="手动指定 IPv4">
                    <Input placeholder="10.144.144.1/24" />
                  </Form.Item>
                </Panel>

                {/* 代理和转发 */}
                <Panel header="代理和转发" key="proxy">
                  <Form.Item name="enable_socks5" label="启用 SOCKS5 代理" valuePropName="checked">
                    <Switch />
                  </Form.Item>
                  <Form.Item name="socks5_port" label="SOCKS5 端口">
                    <InputNumber min={1024} max={65535} placeholder="1080" style={{ width: '100%' }} />
                  </Form.Item>
                  <Form.Item name="proxy_forward_by_system" label="系统转发" valuePropName="checked">
                    <Switch />
                  </Form.Item>
                  <Form.Item name="proxy_networks" label="子网代理 CIDR 列表">
                    <Input.TextArea placeholder="192.168.1.0/24" rows={3} />
                  </Form.Item>
                </Panel>

                {/* 出口节点 */}
                <Panel header="出口节点" key="exit">
                  <Form.Item name="enable_as_exit_node" label="作为出口节点" valuePropName="checked">
                    <Switch />
                  </Form.Item>
                  <Form.Item name="exit_nodes" label="出口节点列表">
                    <Input.TextArea placeholder="10.99.0.1" rows={3} />
                  </Form.Item>
                </Panel>

                {/* 性能优化 */}
                <Panel header="性能优化" key="performance">
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
                </Panel>

                {/* 协议优化 */}
                <Panel header="协议优化" key="protocol">
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
                </Panel>

                {/* 加密和安全 */}
                <Panel header="加密和安全" key="security">
                  <Form.Item name="disable_encryption" label="禁用加密" valuePropName="checked">
                    <Switch />
                  </Form.Item>
                  <Form.Item name="encryption_algorithm" label="加密算法">
                    <Input placeholder="aes-gcm" />
                  </Form.Item>
                </Panel>

                {/* 网络设备 */}
                <Panel header="网络设备" key="device">
                  <Form.Item name="bind_device" label="绑定物理设备" valuePropName="checked">
                    <Switch />
                  </Form.Item>
                  <Form.Item name="dev_name" label="TUN 设备名称">
                    <Input placeholder="MCTier_Net" />
                  </Form.Item>
                  <Form.Item name="mtu" label="MTU 大小">
                    <InputNumber min={1280} max={1500} placeholder="1380" style={{ width: '100%' }} />
                  </Form.Item>
                </Panel>

                {/* P2P 配置 */}
                <Panel header="P2P 配置" key="p2p">
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
                </Panel>

                {/* 中继配置 */}
                <Panel header="中继配置" key="relay">
                  <Form.Item name="relay_network_whitelist" label="中继网络白名单">
                    <Input.TextArea placeholder="*（允许所有）" rows={3} />
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
                </Panel>

                {/* 路由配置 */}
                <Panel header="路由配置" key="route">
                  <Form.Item name="manual_routes" label="手动路由 CIDR">
                    <Input.TextArea placeholder="10.0.0.0/8" rows={3} />
                  </Form.Item>
                </Panel>

                {/* 压缩 */}
                <Panel header="压缩" key="compression">
                  <Form.Item name="compression" label="压缩算法">
                    <Input placeholder="none" />
                  </Form.Item>
                </Panel>

                {/* 监听器配置 */}
                <Panel header="监听器配置" key="listener">
                  <Form.Item name="listeners" label="监听器列表">
                    <Input.TextArea placeholder="tcp://0.0.0.0:11010" rows={3} />
                  </Form.Item>
                  <Form.Item name="mapped_listeners" label="映射的监听器（公网地址）">
                    <Input.TextArea placeholder="tcp://1.2.3.4:11010" rows={3} />
                  </Form.Item>
                  <Form.Item name="no_listener" label="不监听任何端口" valuePropName="checked">
                    <Switch />
                  </Form.Item>
                  <Form.Item name="default_protocol" label="默认协议">
                    <Input placeholder="tcp" />
                  </Form.Item>
                </Panel>

                {/* DNS 配置 */}
                <Panel header="DNS 配置" key="dns">
                  <Form.Item name="accept_dns" label="启用魔法 DNS" valuePropName="checked">
                    <Switch />
                  </Form.Item>
                  <Form.Item name="tld_dns_zone" label="顶级域名区域">
                    <Input placeholder="et.net" />
                  </Form.Item>
                </Panel>

                {/* 端口白名单 */}
                <Panel header="端口白名单" key="whitelist">
                  <Form.Item name="tcp_whitelist" label="TCP 端口白名单">
                    <Input.TextArea placeholder="80&#10;443&#10;8000-9000" rows={3} />
                  </Form.Item>
                  <Form.Item name="udp_whitelist" label="UDP 端口白名单">
                    <Input.TextArea placeholder="53&#10;123" rows={3} />
                  </Form.Item>
                </Panel>

                {/* IPv6 */}
                <Panel header="IPv6" key="ipv6">
                  <Form.Item name="disable_ipv6" label="禁用 IPv6" valuePropName="checked">
                    <Switch />
                  </Form.Item>
                  <Form.Item name="ipv6" label="IPv6 地址">
                    <Input placeholder="fe80::1/64" />
                  </Form.Item>
                </Panel>

                {/* STUN 服务器 */}
                <Panel header="STUN 服务器" key="stun">
                  <Form.Item name="stun_servers" label="STUN 服务器列表">
                    <Input.TextArea placeholder="stun://stun.l.google.com:19302" rows={3} />
                  </Form.Item>
                  <Form.Item name="stun_servers_v6" label="IPv6 STUN 服务器列表">
                    <Input.TextArea placeholder="stun://[2001:4860:4860::8888]:19302" rows={3} />
                  </Form.Item>
                </Panel>

                {/* 私有模式 */}
                <Panel header="私有模式" key="private">
                  <Form.Item name="private_mode" label="启用私有模式" valuePropName="checked">
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
              <span>当前使用全局配置，您可以在 MCTier 设置中修改全局配置</span>
            </div>
          )}
        </Spin>

        <div className="lobby-advanced-config-footer">
          <button
            className="lobby-advanced-config-btn lobby-advanced-config-btn-cancel"
            onClick={onClose}
            disabled={saving}
          >
            取消
          </button>
          <button
            className="lobby-advanced-config-btn lobby-advanced-config-btn-save"
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
