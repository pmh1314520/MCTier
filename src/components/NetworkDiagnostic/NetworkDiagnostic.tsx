import React, { useState, useEffect } from 'react';
import { Modal, Button, Alert, Spin, Typography } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined, LoadingOutlined } from '@ant-design/icons';
import { invoke } from '@tauri-apps/api/core';
import './NetworkDiagnostic.css';

const { Title, Paragraph, Text } = Typography;

interface NetworkDiagnosticProps {
  visible: boolean;
  onClose: () => void;
  virtualIp?: string;
}

interface DiagnosticResult {
  name: string;
  status: 'success' | 'error' | 'warning' | 'checking';
  message: string;
  solution?: string;
}

export const NetworkDiagnostic: React.FC<NetworkDiagnosticProps> = ({
  visible,
  onClose,
  virtualIp,
}) => {
  const [results, setResults] = useState<DiagnosticResult[]>([]);
  const [isChecking, setIsChecking] = useState(false);

  useEffect(() => {
    if (visible) {
      startDiagnostic();
    }
  }, [visible]);

  const startDiagnostic = async () => {
    setIsChecking(true);
    setResults([]);

    const checks: DiagnosticResult[] = [];

    // 1. 检查虚拟网卡
    checks.push({
      name: '虚拟网卡检查',
      status: 'checking',
      message: '正在检查虚拟网卡...',
    });
    setResults([...checks]);

    try {
      const hasVirtualAdapter = await invoke<boolean>('check_virtual_adapter');
      checks[0] = {
        name: '虚拟网卡检查',
        status: hasVirtualAdapter ? 'success' : 'error',
        message: hasVirtualAdapter
          ? '✓ 虚拟网卡已创建'
          : '✗ 虚拟网卡未找到',
        solution: hasVirtualAdapter
          ? undefined
          : '请确保以管理员权限运行软件，并检查 WinTun 驱动是否正常安装',
      };
    } catch (error) {
      checks[0] = {
        name: '虚拟网卡检查',
        status: 'error',
        message: '✗ 检查失败',
        solution: '无法检查虚拟网卡状态，请重启软件后重试',
      };
    }
    setResults([...checks]);

    // 2. 检查防火墙规则
    checks.push({
      name: '防火墙规则检查',
      status: 'checking',
      message: '正在检查防火墙规则...',
    });
    setResults([...checks]);

    try {
      const firewallOk = await invoke<boolean>('check_firewall_rules');
      checks[1] = {
        name: '防火墙规则检查',
        status: firewallOk ? 'success' : 'warning',
        message: firewallOk
          ? '✓ 防火墙规则正常'
          : '⚠ 防火墙可能阻止连接',
        solution: firewallOk
          ? undefined
          : '建议在 Windows 防火墙中允许 Minecraft 和 MCTier 的网络访问',
      };
    } catch (error) {
      checks[1] = {
        name: '防火墙规则检查',
        status: 'warning',
        message: '⚠ 无法检查防火墙',
        solution: '请手动检查 Windows 防火墙设置',
      };
    }
    setResults([...checks]);

    // 3. 检查网络连通性
    if (virtualIp) {
      checks.push({
        name: '网络连通性检查',
        status: 'checking',
        message: '正在检查网络连通性...',
      });
      setResults([...checks]);

      try {
        const canPing = await invoke<boolean>('ping_virtual_ip', { ip: virtualIp });
        checks[2] = {
          name: '网络连通性检查',
          status: canPing ? 'success' : 'error',
          message: canPing
            ? '✓ 虚拟网络连通正常'
            : '✗ 无法 ping 通虚拟 IP',
          solution: canPing
            ? undefined
            : '虚拟网络可能未正确建立，请尝试重新创建大厅',
        };
      } catch (error) {
        checks[2] = {
          name: '网络连通性检查',
          status: 'error',
          message: '✗ 连通性检查失败',
          solution: '请检查网络配置',
        };
      }
      setResults([...checks]);
    }

    // 4. 检查 UDP 端口
    checks.push({
      name: 'UDP 端口检查',
      status: 'checking',
      message: '正在检查 UDP 端口...',
    });
    setResults([...checks]);

    try {
      const udpOk = await invoke<boolean>('check_udp_port', { port: 11010 });
      const checkIndex = virtualIp ? 3 : 2;
      checks[checkIndex] = {
        name: 'UDP 端口检查',
        status: udpOk ? 'success' : 'warning',
        message: udpOk
          ? '✓ UDP 端口 11010 可用'
          : '⚠ UDP 端口可能被占用',
        solution: udpOk
          ? undefined
          : '请关闭其他可能占用 UDP 11010 端口的程序',
      };
    } catch (error) {
      const checkIndex = virtualIp ? 3 : 2;
      checks[checkIndex] = {
        name: 'UDP 端口检查',
        status: 'warning',
        message: '⚠ 无法检查端口状态',
      };
    }
    setResults([...checks]);

    setIsChecking(false);
  };

  return (
    <Modal
      open={visible}
      onCancel={onClose}
      footer={[
        <Button key="recheck" onClick={startDiagnostic} disabled={isChecking}>
          重新检查
        </Button>,
        <Button key="close" type="primary" onClick={onClose}>
          关闭
        </Button>,
      ]}
      width={600}
      className="network-diagnostic-modal"
    >
      <div className="diagnostic-content">
        <Title level={3} className="diagnostic-title">
          网络诊断
        </Title>

        <Paragraph className="diagnostic-desc">
          正在检查网络配置，帮助您解决 Minecraft 联机问题...
        </Paragraph>

        <div className="diagnostic-results">
          {results.map((result, index) => (
            <div key={index} className={`diagnostic-item diagnostic-${result.status}`}>
              <div className="diagnostic-item-header">
                {result.status === 'checking' && (
                  <Spin indicator={<LoadingOutlined spin />} />
                )}
                {result.status === 'success' && (
                  <CheckCircleOutlined className="icon-success" />
                )}
                {result.status === 'error' && (
                  <CloseCircleOutlined className="icon-error" />
                )}
                {result.status === 'warning' && (
                  <CloseCircleOutlined className="icon-warning" />
                )}
                <Text strong>{result.name}</Text>
              </div>
              <div className="diagnostic-item-message">{result.message}</div>
              {result.solution && (
                <Alert
                  message="解决方案"
                  description={result.solution}
                  type={result.status === 'error' ? 'error' : 'warning'}
                  showIcon
                  className="diagnostic-solution"
                />
              )}
            </div>
          ))}
        </div>

        {!isChecking && results.length > 0 && (
          <Alert
            message="诊断完成"
            description="如果问题仍未解决，请查看用户手册或联系技术支持"
            type="info"
            showIcon
            className="diagnostic-summary"
          />
        )}
      </div>
    </Modal>
  );
};
