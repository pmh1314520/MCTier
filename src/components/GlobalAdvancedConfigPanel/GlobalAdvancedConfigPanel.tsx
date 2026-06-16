import React, { useState, useEffect } from 'react';
import { Collapse, Form, Input, Switch, InputNumber, Select, message, Spin } from 'antd';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import { tl } from '../../i18n';
import './GlobalAdvancedConfigPanel.css';

const { Panel } = Collapse;

export const GlobalAdvancedConfigPanel: React.FC = () => {
  useTranslation();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    setLoading(true);
    try {
      const config = await invoke<any>('get_global_easytier_advanced_config');
      console.log('加载的全局高级配置:', config);
      form.setFieldsValue(config);
    } catch (error) {
      console.error('加载全局高级配置失败:', error);
      message.error(tl('加载配置失败', 'Failed to load configuration'));
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      const values = form.getFieldsValue(true);
      console.log('保存全局高级配置:', values);
      
      await invoke('save_global_easytier_advanced_config', { configJson: values });
      message.success(tl('全局高级配置已保存', 'Global advanced config saved'), 1);
    } catch (error) {
      console.error('保存全局高级配置失败:', error);
      message.error(tl('保存配置失败', 'Failed to save configuration'));
    }
  };

  if (loading) {
    return (
      <div className="global-advanced-config-loading">
        <Spin tip={tl('加载配置中...', 'Loading config...')} />
      </div>
    );
  }

  return (
    <div className="global-advanced-config-panel">
      <div className="global-advanced-config-header">
        <h3>{tl('全局 EasyTier 高级配置', 'Global EasyTier Advanced Config')}</h3>
      </div>

      <Form form={form} layout="vertical" onValuesChange={handleSave}>
        <Collapse className="advanced-config-collapse">{/* 移除 defaultActiveKey，让所有面板默认收起 */}
          {/* 网络模式 */}
          <Panel header={tl('网络模式', 'Network Mode')} key="network">
            <Form.Item name="no_tun" label={tl('无 TUN 模式', 'No TUN Mode')} valuePropName="checked" tooltip={tl('不创建虚拟网卡，仅使用代理模式', 'Do not create a virtual adapter; use proxy mode only')}>
              <Switch />
            </Form.Item>
            <Form.Item name="dhcp" label={tl('启用 DHCP', 'Enable DHCP')} valuePropName="checked" tooltip={tl('自动分配虚拟 IP 地址', 'Automatically assign a virtual IP address')}>
              <Switch />
            </Form.Item>
            <Form.Item name="ipv4" label={tl('手动指定 IPv4', 'Manual IPv4')} tooltip={tl('例如：10.144.144.1/24', 'e.g. 10.144.144.1/24')}>
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
            
            {/* 端口转发 */}
            <div style={{ marginTop: '20px', marginBottom: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                <span style={{ fontWeight: 500, fontSize: '14px' }}>{tl('端口转发规则', 'Port Forwarding Rules')}</span>
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
                    padding: '4px 12px',
                    background: 'rgba(126, 211, 33, 0.1)',
                    border: '1px solid rgba(126, 211, 33, 0.3)',
                    borderRadius: '4px',
                    color: 'rgba(126, 211, 33, 0.9)',
                    cursor: 'pointer',
                    fontSize: '12px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="12" y1="5" x2="12" y2="19"></line>
                    <line x1="5" y1="12" x2="19" y2="12"></line>
                  </svg>
                  {tl('添加规则', 'Add Rule')}
                </button>
              </div>
              <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', marginBottom: '10px' }}>
                {tl('将本地端口转发到虚拟网络中的远程端口。例如：tcp://0.0.0.0:5678 → 10.126.126.1:5678', 'Forward a local port to a remote port in the virtual network. e.g. tcp://0.0.0.0:5678 → 10.126.126.1:5678')}
              </div>
            </div>
            
            <Form.List name="port_forward_rules">
              {(fields, { remove }) => (
                <>
                  {fields.map((field) => (
                    <div key={field.key} style={{ 
                      marginBottom: '12px',
                      padding: '12px',
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
                          top: '8px',
                          right: '8px',
                          padding: '4px 8px',
                          background: 'rgba(255, 77, 79, 0.1)',
                          border: '1px solid rgba(255, 77, 79, 0.3)',
                          borderRadius: '4px',
                          color: 'rgba(255, 77, 79, 0.9)',
                          cursor: 'pointer',
                          fontSize: '12px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px'
                        }}
                        title="删除规则"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <line x1="18" y1="6" x2="6" y2="18"></line>
                          <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                        {tl('删除', 'Delete')}
                      </button>
                      
                      {/* 协议选择 */}
                      <div style={{ marginBottom: '8px' }}>
                        <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', color: 'rgba(255,255,255,0.7)' }}>
                          {tl('协议类型', 'Protocol Type')}
                        </label>
                        <Form.Item
                          {...field}
                          name={[field.name, 'protocol']}
                          style={{ marginBottom: 0 }}
                        >
                          <Select
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
                      <div style={{ marginBottom: '8px' }}>
                        <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', color: 'rgba(255,255,255,0.7)' }}>
                          {tl('本地地址', 'Local Address')}
                        </label>
                        <Form.Item
                          {...field}
                          name={[field.name, 'bind_addr']}
                          style={{ marginBottom: 0 }}
                        >
                          <Input placeholder={tl('例如：0.0.0.0:5678', 'e.g. 0.0.0.0:5678')} size="small" />
                        </Form.Item>
                      </div>
                      
                      {/* 箭头指示 */}
                      <div style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'center',
                        margin: '4px 0',
                        color: 'rgba(126, 211, 33, 0.6)',
                        fontSize: '16px'
                      }}>
                        ↓
                      </div>
                      
                      {/* 目标地址 */}
                      <div>
                        <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', color: 'rgba(255,255,255,0.7)' }}>
                          {tl('目标地址', 'Target Address')}
                        </label>
                        <Form.Item
                          {...field}
                          name={[field.name, 'dst_addr']}
                          style={{ marginBottom: 0 }}
                        >
                          <Input placeholder={tl('例如：10.126.126.1:5678', 'e.g. 10.126.126.1:5678')} size="small" />
                        </Form.Item>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </Form.List>
            
            <Form.Item name="proxy_forward_by_system" label={tl('系统转发', 'System Forwarding')} valuePropName="checked" tooltip={tl('通过系统内核转发子网代理数据包', 'Forward subnet proxy packets through the system kernel')}>
              <Switch />
            </Form.Item>
            <Form.Item name="proxy_networks" label={tl('子网代理 CIDR 列表', 'Subnet Proxy CIDR List')} tooltip={tl('每行一个 CIDR，例如：192.168.1.0/24', 'One CIDR per line, e.g. 192.168.1.0/24')}>
              <Input.TextArea placeholder="192.168.1.0/24" rows={3} />
            </Form.Item>
          </Panel>

          {/* 出口节点 */}
          <Panel header={tl('出口节点', 'Exit Node')} key="exit">
            <Form.Item name="enable_as_exit_node" label={tl('作为出口节点', 'Act as Exit Node')} valuePropName="checked" tooltip={tl('允许其他节点通过本机访问网络', 'Allow other nodes to access the network through this machine')}>
              <Switch />
            </Form.Item>
            <Form.Item name="exit_nodes" label={tl('出口节点列表', 'Exit Node List')} tooltip={tl('每行一个虚拟 IP，例如：10.99.0.1', 'One virtual IP per line, e.g. 10.99.0.1')}>
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
            <Form.Item name="latency_first" label={tl('延迟优先模式', 'Latency-First Mode')} valuePropName="checked" tooltip={tl('优先使用低延迟路径', 'Prefer low-latency paths')}>
              <Switch />
            </Form.Item>
            <Form.Item name="use_smoltcp" label={tl('启用 smoltcp', 'Enable smoltcp')} valuePropName="checked" tooltip={tl('使用 smoltcp 网络栈', 'Use the smoltcp network stack')}>
              <Switch />
            </Form.Item>
          </Panel>

          {/* 协议优化 */}
          <Panel header={tl('协议优化', 'Protocol Optimization')} key="protocol">
            <Form.Item name="enable_kcp_proxy" label={tl('启用 KCP 代理', 'Enable KCP Proxy')} valuePropName="checked" tooltip={tl('使用 KCP 协议提升 UDP 性能', 'Use the KCP protocol to improve UDP performance')}>
              <Switch />
            </Form.Item>
            <Form.Item name="disable_kcp_input" label={tl('禁用 KCP 输入', 'Disable KCP Input')} valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item name="enable_quic_proxy" label={tl('启用 QUIC 代理', 'Enable QUIC Proxy')} valuePropName="checked" tooltip={tl('使用 QUIC 协议提升性能', 'Use the QUIC protocol to improve performance')}>
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
            <Form.Item name="disable_encryption" label={tl('禁用加密', 'Disable Encryption')} valuePropName="checked" tooltip={tl('警告：禁用加密会降低安全性', 'Warning: disabling encryption reduces security')}>
              <Switch />
            </Form.Item>
            <Form.Item name="encryption_algorithm" label={tl('加密算法', 'Encryption Algorithm')} tooltip={tl('支持：aes-gcm, aes-256-gcm, xor, chacha20', 'Supported: aes-gcm, aes-256-gcm, xor, chacha20')}>
              <Input placeholder="aes-gcm" />
            </Form.Item>
          </Panel>

          {/* 网络设备 */}
          <Panel header={tl('网络设备', 'Network Device')} key="device">
            <Form.Item name="bind_device" label={tl('绑定物理设备', 'Bind Physical Device')} valuePropName="checked" tooltip={tl('绑定到物理网卡，避免路由问题', 'Bind to the physical adapter to avoid routing issues')}>
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
            <Form.Item name="p2p_only" label={tl('仅使用 P2P', 'P2P Only')} valuePropName="checked" tooltip={tl('只与已建立 P2P 连接的节点通信', 'Communicate only with nodes that have an established P2P connection')}>
              <Switch />
            </Form.Item>
            <Form.Item name="disable_p2p" label={tl('禁用 P2P', 'Disable P2P')} valuePropName="checked" tooltip={tl('只通过中继节点转发数据', 'Forward data only through relay nodes')}>
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
            <Form.Item name="relay_network_whitelist" label={tl('中继网络白名单', 'Relay Network Whitelist')} tooltip={tl('每行一个网络名称，支持通配符', 'One network name per line, wildcards supported')}>
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
            <Form.Item name="manual_routes" label={tl('手动路由 CIDR', 'Manual Routes CIDR')} tooltip={tl('每行一个 CIDR', 'One CIDR per line')}>
              <Input.TextArea placeholder="10.0.0.0/8" rows={3} />
            </Form.Item>
          </Panel>

          {/* 压缩 */}
          <Panel header={tl('压缩', 'Compression')} key="compression">
            <Form.Item name="compression" label={tl('压缩算法', 'Compression Algorithm')} tooltip={tl('支持：none, zstd', 'Supported: none, zstd')}>
              <Input placeholder="none" />
            </Form.Item>
          </Panel>

          {/* 监听器配置 */}
          <Panel header={tl('监听器配置', 'Listener Config')} key="listener">
            <Form.Item name="listeners" label={tl('监听器列表', 'Listener List')} tooltip={tl('每行一个监听地址，例如：tcp://0.0.0.0:11010', 'One listen address per line, e.g. tcp://0.0.0.0:11010')}>
              <Input.TextArea placeholder="tcp://0.0.0.0:11010" rows={3} />
            </Form.Item>
            <Form.Item name="mapped_listeners" label={tl('映射的监听器（公网地址）', 'Mapped Listeners (Public Address)')} tooltip={tl('每行一个公网地址', 'One public address per line')}>
              <Input.TextArea placeholder="tcp://1.2.3.4:11010" rows={3} />
            </Form.Item>
            <Form.Item name="no_listener" label={tl('不监听任何端口', 'No Listening Ports')} valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item name="default_protocol" label={tl('默认协议', 'Default Protocol')} tooltip="tcp, udp, wg, ws, wss">
              <Input placeholder="tcp" />
            </Form.Item>
          </Panel>

          {/* DNS 配置 */}
          <Panel header={tl('DNS 配置', 'DNS Config')} key="dns">
            <Form.Item name="accept_dns" label={tl('启用魔法 DNS', 'Enable Magic DNS')} valuePropName="checked" tooltip={tl('使用域名访问其他节点', 'Use domain names to access other nodes')}>
              <Switch />
            </Form.Item>
            <Form.Item name="tld_dns_zone" label={tl('顶级域名区域', 'TLD DNS Zone')}>
              <Input placeholder="et.net" />
            </Form.Item>
          </Panel>

          {/* 端口白名单 */}
          <Panel header={tl('端口白名单', 'Port Whitelist')} key="whitelist">
            <Form.Item name="tcp_whitelist" label={tl('TCP 端口白名单', 'TCP Port Whitelist')} tooltip={tl('每行一个端口或端口范围，例如：80 或 8000-9000', 'One port or range per line, e.g. 80 or 8000-9000')}>
              <Input.TextArea placeholder="80&#10;443&#10;8000-9000" rows={3} />
            </Form.Item>
            <Form.Item name="udp_whitelist" label={tl('UDP 端口白名单', 'UDP Port Whitelist')} tooltip={tl('每行一个端口或端口范围', 'One port or range per line')}>
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
            <Form.Item name="stun_servers" label={tl('STUN 服务器列表', 'STUN Server List')} tooltip={tl('每行一个 STUN 服务器地址', 'One STUN server address per line')}>
              <Input.TextArea placeholder="stun://stun.l.google.com:19302" rows={3} />
            </Form.Item>
            <Form.Item name="stun_servers_v6" label={tl('IPv6 STUN 服务器列表', 'IPv6 STUN Server List')} tooltip={tl('每行一个 IPv6 STUN 服务器地址', 'One IPv6 STUN server address per line')}>
              <Input.TextArea placeholder="stun://[2001:4860:4860::8888]:19302" rows={3} />
            </Form.Item>
          </Panel>

          {/* 私有模式 */}
          <Panel header={tl('私有模式', 'Private Mode')} key="private">
            <Form.Item name="private_mode" label={tl('启用私有模式', 'Enable Private Mode')} valuePropName="checked" tooltip={tl('不允许其他网络的节点通过本节点中转', 'Do not allow nodes from other networks to relay through this node')}>
              <Switch />
            </Form.Item>
          </Panel>
        </Collapse>
      </Form>
    </div>
  );
};
