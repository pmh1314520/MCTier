import React, { useState, useEffect } from 'react';
import { Modal, Button, Alert, Spin, Typography } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined, LoadingOutlined } from '@ant-design/icons';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import { tl } from '../../i18n';
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
  useTranslation();
  const [results, setResults] = useState<DiagnosticResult[]>([]);
  const [isChecking, setIsChecking] = useState(false);
  // 诊断函数
  const runDiagnostic = async () => {
    setIsChecking(true);
    setResults([]);

    const checks: DiagnosticResult[] = [];

    // 1. 检查虚拟网卡
    checks.push({
      name: tl('虚拟网卡检查', 'Virtual Adapter Check'),
      status: 'checking',
      message: tl('正在检查虚拟网卡...', 'Checking virtual adapter...'),
    });
    setResults([...checks]);

    try {
      const hasVirtualAdapter = await invoke<boolean>('check_virtual_adapter');
      checks[0] = {
        name: tl('虚拟网卡检查', 'Virtual Adapter Check'),
        status: hasVirtualAdapter ? 'success' : 'error',
        message: hasVirtualAdapter ? tl('✓ 虚拟网卡已创建', '✓ Virtual adapter created') : tl('✗ 虚拟网卡未找到', '✗ Virtual adapter not found'),
        solution: hasVirtualAdapter
          ? undefined
          : tl('请检查 WinTun 驱动是否正常安装,或尝试重启软件', 'Please check whether the WinTun driver is installed correctly, or try restarting the app'),
      };
    } catch {
      checks[0] = {
        name: tl('虚拟网卡检查', 'Virtual Adapter Check'),
        status: 'error',
        message: tl('✗ 检查失败', '✗ Check failed'),
        solution: tl('无法检查虚拟网卡状态，请重启软件后重试', 'Unable to check the virtual adapter, please restart the app and retry'),
      };
    }
    setResults([...checks]);

    // 3. 检查网络连通性
    if (virtualIp) {
      checks.push({
        name: tl('网络连通性检查', 'Connectivity Check'),
        status: 'checking',
        message: tl('正在检查网络连通性...', 'Checking network connectivity...'),
      });
      setResults([...checks]);

      try {
        const canPing = await invoke<boolean>('ping_virtual_ip', { ip: virtualIp });
        checks[1] = {
          name: tl('网络连通性检查', 'Connectivity Check'),
          status: canPing ? 'success' : 'error',
          message: canPing ? tl('✓ 虚拟网络连通正常', '✓ Virtual network connectivity OK') : tl('✗ 无法 ping 通虚拟 IP', '✗ Cannot ping the virtual IP'),
          solution: canPing ? undefined : tl('虚拟网络可能未正确建立，请尝试重新创建大厅', 'The virtual network may not be established correctly, try recreating the lobby'),
        };
      } catch {
        checks[1] = {
          name: tl('网络连通性检查', 'Connectivity Check'),
          status: 'error',
          message: tl('✗ 连通性检查失败', '✗ Connectivity check failed'),
          solution: tl('请检查网络配置', 'Please check your network configuration'),
        };
      }
      setResults([...checks]);
    }

    // 4. 检查 UDP 端口
    checks.push({
      name: tl('UDP 端口检查', 'UDP Port Check'),
      status: 'checking',
      message: tl('正在检查 UDP 端口...', 'Checking UDP port...'),
    });
    setResults([...checks]);

    try {
      const udpOk = await invoke<boolean>('check_udp_port', { port: 11010 });
      const checkIndex = virtualIp ? 2 : 1;
      checks[checkIndex] = {
        name: tl('UDP 端口检查', 'UDP Port Check'),
        status: udpOk ? 'success' : 'warning',
        message: udpOk ? tl('✓ UDP 端口 11010 可用', '✓ UDP port 11010 available') : tl('⚠ UDP 端口可能被占用', '⚠ UDP port may be in use'),
        solution: udpOk ? undefined : tl('请关闭其他可能占用 UDP 11010 端口的程序', 'Please close other programs that may be using UDP port 11010'),
      };
    } catch {
      const checkIndex = virtualIp ? 2 : 1;
      checks[checkIndex] = {
        name: tl('UDP 端口检查', 'UDP Port Check'),
        status: 'warning',
        message: tl('⚠ 无法检查端口状态', '⚠ Unable to check the port status'),
      };
    }
    setResults([...checks]);

    // 5. 检测安全软件（被拦截是组网失败的常见原因）
    checks.push({
      name: tl('安全软件检测', 'Security Software Detection'),
      status: 'checking',
      message: tl('正在检测安全软件...', 'Detecting security software...'),
    });
    setResults([...checks]);

    const avIndex = checks.length - 1;
    try {
      const avList = await invoke<string[]>('detect_security_software');
      if (avList && avList.length > 0) {
        checks[avIndex] = {
          name: tl('安全软件检测', 'Security Software Detection'),
          status: 'warning',
          message: `${tl('⚠ 检测到安全软件：', '⚠ Security software detected: ')}${avList.join(tl('、', ', '))}`,
          solution: tl(`若大厅创建或加入失败，请检查安全软件是否隔离或删除 easytier-core.exe，并将 MCTier 加入${avList.join('、')}的信任/白名单。`, `If creating or joining a lobby fails, check whether easytier-core.exe was quarantined or deleted. Add MCTier to the trust/whitelist of ${avList.join(', ')}.`),
        };
      } else {
        checks[avIndex] = {
          name: tl('安全软件检测', 'Security Software Detection'),
          status: 'success',
          message: tl('✓ 未检测到常见安全软件', '✓ No common security software detected'),
        };
      }
    } catch {
      checks[avIndex] = {
        name: tl('安全软件检测', 'Security Software Detection'),
        status: 'warning',
        message: tl('⚠ 无法检测安全软件', '⚠ Unable to detect security software'),
        solution: tl('若组网失败，请尝试将 MCTier 加入杀毒软件白名单', 'If networking fails, try adding MCTier to your antivirus whitelist'),
      };
    }
    setResults([...checks]);

    setIsChecking(false);
  };

  // 当弹窗打开时自动运行诊断
  useEffect(() => {
    if (visible) {
      const timer = window.setTimeout(() => void runDiagnostic(), 0);
      return () => window.clearTimeout(timer);
    }
  }, [visible, virtualIp]);

  return (
    <Modal
      open={visible}
      onCancel={onClose}
      footer={[
        <Button key="recheck" onClick={() => void runDiagnostic()} disabled={isChecking}>
          {tl('重新检查', 'Recheck')}
        </Button>,
        <Button key="close" type="primary" onClick={onClose}>
          {tl('关闭', 'Close')}
        </Button>,
      ]}
      width={600}
      className="network-diagnostic-modal"
    >
      <div className="diagnostic-content">
        <Title level={3} className="diagnostic-title">
          {tl('网络诊断', 'Network Diagnostics')}
        </Title>

        <Paragraph className="diagnostic-desc">
          {tl('正在检查网络配置，帮助您解决 Minecraft 联机问题...', 'Checking network configuration to help resolve multiplayer issues...')}
        </Paragraph>

        <div className="diagnostic-results">
          {results.map((result, index) => (
            <div key={index} className={`diagnostic-item diagnostic-${result.status}`}>
              <div className="diagnostic-item-header">
                {result.status === 'checking' && <Spin indicator={<LoadingOutlined spin />} />}
                {result.status === 'success' && <CheckCircleOutlined className="icon-success" />}
                {result.status === 'error' && <CloseCircleOutlined className="icon-error" />}
                {result.status === 'warning' && <CloseCircleOutlined className="icon-warning" />}
                <Text strong>{result.name}</Text>
              </div>
              <div className="diagnostic-item-message">{result.message}</div>
              {result.solution && (
                <Alert
                  message={tl('解决方案', 'Solution')}
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
            message={tl('诊断完成', 'Diagnostics Complete')}
            description={tl('如果问题仍未解决，请查看用户手册或联系技术支持', 'If the issue persists, please check the user manual or contact support')}
            type="info"
            showIcon
            className="diagnostic-summary"
          />
        )}
      </div>
    </Modal>
  );
};
