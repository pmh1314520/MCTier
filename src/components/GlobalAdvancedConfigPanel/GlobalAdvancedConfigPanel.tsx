import React, { useState, useEffect } from 'react';
import { Collapse, Form, Input, Switch, InputNumber, message, Spin } from 'antd';
import { invoke } from '@tauri-apps/api/core';
import './GlobalAdvancedConfigPanel.css';

const { Panel } = Collapse;

export const GlobalAdvancedConfigPanel: React.FC = () => {
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
      message.error('加载配置失败');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      const values = form.getFieldsValue(true);
      console.log('保存全局高级配置:', values);
      
      await invoke('save_global_easytier_advanced_config', { configJson: values });
      message.success('全局高级配置已保存', 1);
    } catch (error) {
      console.error('保存全局高级配置失败:', error);
      message.error('保存配置失败');
    }
  };

  if (loading) {
    return (
      <div className="global-advanced-config-loading">
        <Spin tip="加载配置中..." />
      </div>
    );
  }

  return (
    <div className="global-advanced-config-panel">
      <div className="global-advanced-config-header">
        <h3>全局 EasyTier 高级配置</h3>
      </div>

      <Form form={form} layout="vertical" onValuesChange={handleSave}>
        <Collapse className="advanced-config-collapse">{/* 移除 defaultActiveKey，让所有面板默认收起 */}
          {/* 网络模式 */}
          <Panel header="网络模式" key="network">
            <Form.Item name="no_tun" label="无 TUN 模式" valuePropName="checked" tooltip="不创建虚拟网卡，仅使用代理模式">
              <Switch />
            </Form.Item>
            <Form.Item name="dhcp" label="启用 DHCP" valuePropName="checked" tooltip="自动分配虚拟 IP 地址">
              <Switch />
            </Form.Item>
            <Form.Item name="ipv4" label="手动指定 IPv4" tooltip="例如：10.144.144.1/24">
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
            
            {/* 端口转发 */}
            <div style={{ marginTop: '20px', marginBottom: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                <span style={{ fontWeight: 500, fontSize: '14px' }}>端口转发规则</span>
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
                  添加规则
                </button>
              </div>
              <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', marginBottom: '10px' }}>
                将本地端口转发到虚拟网络中的远程端口。例如：tcp://0.0.0.0:5678 → 10.126.126.1:5678
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
                        删除
                      </button>
                      
                      {/* 协议选择 */}
                      <div style={{ marginBottom: '8px' }}>
                        <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', color: 'rgba(255,255,255,0.7)' }}>
                          协议类型
                        </label>
                        <Form.Item
                          {...field}
                          name={[field.name, 'protocol']}
                          style={{ marginBottom: 0 }}
                        >
                          <div style={{ position: 'relative' }}>
                            <select style={{
                              width: '100%',
                              padding: '6px 30px 6px 10px',
                              background: 'rgba(30, 30, 40, 0.8)',
                              border: '1px solid rgba(126, 211, 33, 0.3)',
                              borderRadius: '8px',
                              color: '#fff',
                              fontSize: '13px',
                              cursor: 'pointer',
                              outline: 'none',
                              transition: 'all 0.2s',
                              appearance: 'none',
                              WebkitAppearance: 'none',
                              MozAppearance: 'none'
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.borderColor = 'rgba(126, 211, 33, 0.6)';
                              e.currentTarget.style.background = 'rgba(30, 30, 40, 0.95)';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.borderColor = 'rgba(126, 211, 33, 0.3)';
                              e.currentTarget.style.background = 'rgba(30, 30, 40, 0.8)';
                            }}>
                              <option value="tcp" style={{ background: '#1a1a24', color: '#fff', padding: '8px' }}>TCP</option>
                              <option value="udp" style={{ background: '#1a1a24', color: '#fff', padding: '8px' }}>UDP</option>
                            </select>
                            {/* 自定义下拉箭头 */}
                            <div style={{
                              position: 'absolute',
                              right: '10px',
                              top: '50%',
                              transform: 'translateY(-50%)',
                              pointerEvents: 'none',
                              color: 'rgba(126, 211, 33, 0.6)'
                            }}>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <polyline points="6 9 12 15 18 9"></polyline>
                              </svg>
                            </div>
                          </div>
                        </Form.Item>
                      </div>
                      
                      {/* 本地地址 */}
                      <div style={{ marginBottom: '8px' }}>
                        <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', color: 'rgba(255,255,255,0.7)' }}>
                          本地地址
                        </label>
                        <Form.Item
                          {...field}
                          name={[field.name, 'bind_addr']}
                          style={{ marginBottom: 0 }}
                        >
                          <Input placeholder="例如：0.0.0.0:5678" size="small" />
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
                          目标地址
                        </label>
                        <Form.Item
                          {...field}
                          name={[field.name, 'dst_addr']}
                          style={{ marginBottom: 0 }}
                        >
                          <Input placeholder="例如：10.126.126.1:5678" size="small" />
                        </Form.Item>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </Form.List>
            
            <Form.Item name="proxy_forward_by_system" label="系统转发" valuePropName="checked" tooltip="通过系统内核转发子网代理数据包">
              <Switch />
            </Form.Item>
            <Form.Item name="proxy_networks" label="子网代理 CIDR 列表" tooltip="每行一个 CIDR，例如：192.168.1.0/24">
              <Input.TextArea placeholder="192.168.1.0/24" rows={3} />
            </Form.Item>
          </Panel>

          {/* 出口节点 */}
          <Panel header="出口节点" key="exit">
            <Form.Item name="enable_as_exit_node" label="作为出口节点" valuePropName="checked" tooltip="允许其他节点通过本机访问网络">
              <Switch />
            </Form.Item>
            <Form.Item name="exit_nodes" label="出口节点列表" tooltip="每行一个虚拟 IP，例如：10.99.0.1">
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
            <Form.Item name="latency_first" label="延迟优先模式" valuePropName="checked" tooltip="优先使用低延迟路径">
              <Switch />
            </Form.Item>
            <Form.Item name="use_smoltcp" label="启用 smoltcp" valuePropName="checked" tooltip="使用 smoltcp 网络栈">
              <Switch />
            </Form.Item>
          </Panel>

          {/* 协议优化 */}
          <Panel header="协议优化" key="protocol">
            <Form.Item name="enable_kcp_proxy" label="启用 KCP 代理" valuePropName="checked" tooltip="使用 KCP 协议提升 UDP 性能">
              <Switch />
            </Form.Item>
            <Form.Item name="disable_kcp_input" label="禁用 KCP 输入" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item name="enable_quic_proxy" label="启用 QUIC 代理" valuePropName="checked" tooltip="使用 QUIC 协议提升性能">
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
            <Form.Item name="disable_encryption" label="禁用加密" valuePropName="checked" tooltip="警告：禁用加密会降低安全性">
              <Switch />
            </Form.Item>
            <Form.Item name="encryption_algorithm" label="加密算法" tooltip="支持：aes-gcm, aes-256-gcm, xor, chacha20">
              <Input placeholder="aes-gcm" />
            </Form.Item>
          </Panel>

          {/* 网络设备 */}
          <Panel header="网络设备" key="device">
            <Form.Item name="bind_device" label="绑定物理设备" valuePropName="checked" tooltip="绑定到物理网卡，避免路由问题">
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
            <Form.Item name="p2p_only" label="仅使用 P2P" valuePropName="checked" tooltip="只与已建立 P2P 连接的节点通信">
              <Switch />
            </Form.Item>
            <Form.Item name="disable_p2p" label="禁用 P2P" valuePropName="checked" tooltip="只通过中继节点转发数据">
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
            <Form.Item name="relay_network_whitelist" label="中继网络白名单" tooltip="每行一个网络名称，支持通配符">
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
            <Form.Item name="manual_routes" label="手动路由 CIDR" tooltip="每行一个 CIDR">
              <Input.TextArea placeholder="10.0.0.0/8" rows={3} />
            </Form.Item>
          </Panel>

          {/* 压缩 */}
          <Panel header="压缩" key="compression">
            <Form.Item name="compression" label="压缩算法" tooltip="支持：none, zstd">
              <Input placeholder="none" />
            </Form.Item>
          </Panel>

          {/* 监听器配置 */}
          <Panel header="监听器配置" key="listener">
            <Form.Item name="listeners" label="监听器列表" tooltip="每行一个监听地址，例如：tcp://0.0.0.0:11010">
              <Input.TextArea placeholder="tcp://0.0.0.0:11010" rows={3} />
            </Form.Item>
            <Form.Item name="mapped_listeners" label="映射的监听器（公网地址）" tooltip="每行一个公网地址">
              <Input.TextArea placeholder="tcp://1.2.3.4:11010" rows={3} />
            </Form.Item>
            <Form.Item name="no_listener" label="不监听任何端口" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item name="default_protocol" label="默认协议" tooltip="tcp, udp, wg, ws, wss">
              <Input placeholder="tcp" />
            </Form.Item>
          </Panel>

          {/* DNS 配置 */}
          <Panel header="DNS 配置" key="dns">
            <Form.Item name="accept_dns" label="启用魔法 DNS" valuePropName="checked" tooltip="使用域名访问其他节点">
              <Switch />
            </Form.Item>
            <Form.Item name="tld_dns_zone" label="顶级域名区域">
              <Input placeholder="et.net" />
            </Form.Item>
          </Panel>

          {/* 端口白名单 */}
          <Panel header="端口白名单" key="whitelist">
            <Form.Item name="tcp_whitelist" label="TCP 端口白名单" tooltip="每行一个端口或端口范围，例如：80 或 8000-9000">
              <Input.TextArea placeholder="80&#10;443&#10;8000-9000" rows={3} />
            </Form.Item>
            <Form.Item name="udp_whitelist" label="UDP 端口白名单" tooltip="每行一个端口或端口范围">
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
            <Form.Item name="stun_servers" label="STUN 服务器列表" tooltip="每行一个 STUN 服务器地址">
              <Input.TextArea placeholder="stun://stun.l.google.com:19302" rows={3} />
            </Form.Item>
            <Form.Item name="stun_servers_v6" label="IPv6 STUN 服务器列表" tooltip="每行一个 IPv6 STUN 服务器地址">
              <Input.TextArea placeholder="stun://[2001:4860:4860::8888]:19302" rows={3} />
            </Form.Item>
          </Panel>

          {/* 私有模式 */}
          <Panel header="私有模式" key="private">
            <Form.Item name="private_mode" label="启用私有模式" valuePropName="checked" tooltip="不允许其他网络的节点通过本节点中转">
              <Switch />
            </Form.Item>
          </Panel>
        </Collapse>
      </Form>
    </div>
  );
};
