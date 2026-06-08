/**
 * 新手引导 / 连接向导
 * - 首次启动自动弹出，逐步检测运行环境，降低组网失败门槛
 * - 检测项：管理员权限、防火墙放行规则、安全软件拦截
 * - 提供一键修复：以管理员重启、自动添加防火墙规则
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Modal, Button, Steps, Spin, Alert, Typography, Space, message } from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  WarningOutlined,
  LoadingOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import { invoke } from '@tauri-apps/api/core';
import './OnboardingWizard.css';

const { Title, Paragraph, Text } = Typography;

const ONBOARDING_KEY = 'mctier_onboarding_done';

/** 标记是否已完成过引导（供外部判断首启） */
export function isOnboardingDone(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_KEY) === '1';
  } catch {
    return true;
  }
}

function markOnboardingDone(): void {
  try {
    localStorage.setItem(ONBOARDING_KEY, '1');
  } catch {
    /* ignore */
  }
}

interface OnboardingWizardProps {
  visible: boolean;
  onClose: () => void;
}

type CheckState = 'idle' | 'checking' | 'ok' | 'warn' | 'fail';

interface EnvChecks {
  admin: CheckState;
  firewall: CheckState;
  security: CheckState;
  securityList: string[];
}

export const OnboardingWizard: React.FC<OnboardingWizardProps> = ({ visible, onClose }) => {
  const [step, setStep] = useState(0);
  const [checks, setChecks] = useState<EnvChecks>({
    admin: 'idle',
    firewall: 'idle',
    security: 'idle',
    securityList: [],
  });
  const [fixing, setFixing] = useState(false);

  const runChecks = useCallback(async () => {
    setChecks({ admin: 'checking', firewall: 'checking', security: 'checking', securityList: [] });

    let admin: CheckState = 'warn';
    try {
      admin = (await invoke<boolean>('is_admin')) ? 'ok' : 'warn';
    } catch {
      admin = 'warn';
    }

    let firewall: CheckState = 'warn';
    try {
      firewall = (await invoke<boolean>('check_firewall_rules')) ? 'ok' : 'warn';
    } catch {
      firewall = 'warn';
    }

    let security: CheckState = 'ok';
    let securityList: string[] = [];
    try {
      securityList = (await invoke<string[]>('detect_security_software')) || [];
      security = securityList.length > 0 ? 'warn' : 'ok';
    } catch {
      security = 'warn';
    }

    setChecks({ admin, firewall, security, securityList });
  }, []);

  useEffect(() => {
    if (visible && step === 1) {
      void runChecks();
    }
  }, [visible, step, runChecks]);

  const handleAddFirewall = async () => {
    setFixing(true);
    try {
      const msg = await invoke<string>('add_firewall_rules');
      message.success(msg || '已添加防火墙放行规则');
      await runChecks();
    } catch (error) {
      message.error(`添加防火墙规则失败：${error}。可尝试以管理员身份重启后重试`);
    } finally {
      setFixing(false);
    }
  };

  const handleRestartAdmin = async () => {
    try {
      await invoke('restart_as_admin');
    } catch (error) {
      message.error(`以管理员身份重启失败：${error}`);
    }
  };

  const finish = () => {
    markOnboardingDone();
    onClose();
  };

  const stateIcon = (s: CheckState) => {
    if (s === 'checking') return <Spin indicator={<LoadingOutlined spin />} />;
    if (s === 'ok') return <CheckCircleOutlined style={{ color: '#52c41a' }} />;
    if (s === 'warn') return <WarningOutlined style={{ color: '#faad14' }} />;
    if (s === 'fail') return <CloseCircleOutlined style={{ color: '#ff4d4f' }} />;
    return null;
  };

  const checkRow = (icon: React.ReactNode, label: string, s: CheckState, desc: string) => (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: '10px 12px',
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 8,
      }}
    >
      <div style={{ fontSize: 18, marginTop: 2 }}>{stateIcon(s)}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600 }}>
          {icon} {label}
        </div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', marginTop: 2 }}>{desc}</div>
      </div>
    </div>
  );

  // 步骤 0：欢迎
  const welcomeStep = (
    <div className="onboarding-step">
      <Title level={5} style={{ marginTop: 0, marginBottom: 8 }}>欢迎使用 MCTier</Title>
      <Paragraph className="onboarding-text">
        MCTier 帮助你和好友快速建立虚拟局域网，畅玩 Minecraft 等局域网联机游戏，并自带语音、聊天与文件共享。
      </Paragraph>
      <Paragraph className="onboarding-text">
        为了让组网更顺畅，我们先用几秒钟检查一下运行环境。多数连接失败都源于权限不足、防火墙拦截或安全软件干扰。
      </Paragraph>
      <Alert
        type="info"
        showIcon
        message="建议以管理员身份运行 MCTier，可显著降低组网失败概率。"
      />
    </div>
  );

  // 步骤 1：环境检测
  const allChecking =
    checks.admin === 'checking' || checks.firewall === 'checking' || checks.security === 'checking';
  const hasWarning =
    checks.admin === 'warn' || checks.firewall === 'warn' || checks.security === 'warn';

  const envStep = (
    <div className="onboarding-step" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {checkRow(
        <SafetyCertificateOutlined />,
        '管理员权限',
        checks.admin,
        checks.admin === 'ok'
          ? '已以管理员身份运行，网络配置权限充足。'
          : '当前非管理员身份，创建虚拟网卡/写入 hosts 可能失败，建议以管理员重启。'
      )}
      {checkRow(
        <SafetyCertificateOutlined />,
        '防火墙放行',
        checks.firewall,
        checks.firewall === 'ok'
          ? '已检测到 MCTier 的防火墙放行规则。'
          : '未检测到放行规则，Windows 防火墙可能阻止联机，建议一键放行。'
      )}
      {checkRow(
        <SafetyCertificateOutlined />,
        '安全软件',
        checks.security,
        checks.security === 'ok'
          ? '未检测到常见安全软件拦截。'
          : `检测到：${checks.securityList.join('、') || '未知安全软件'}。请将 MCTier 加入信任/白名单。`
      )}

      <Space wrap style={{ marginTop: 4 }}>
        <Button onClick={() => void runChecks()} disabled={allChecking}>
          重新检测
        </Button>
        {checks.firewall !== 'ok' && (
          <Button type="primary" loading={fixing} disabled={allChecking} onClick={() => void handleAddFirewall()}>
            一键放行防火墙
          </Button>
        )}
        {checks.admin !== 'ok' && (
          <Button danger disabled={allChecking} onClick={() => void handleRestartAdmin()}>
            以管理员身份重启
          </Button>
        )}
      </Space>

      {!allChecking && hasWarning && (
        <Alert
          type="warning"
          showIcon
          message="部分项目需要注意"
          description="存在警告项不影响继续使用，但若组网失败，建议先处理上述提示。"
        />
      )}
      {!allChecking && !hasWarning && (
        <Alert type="success" showIcon message="环境检查通过" description="一切就绪，可以开始联机啦。" />
      )}
    </div>
  );

  // 步骤 2：完成
  const doneStep = (
    <div className="onboarding-step">
      <Title level={5} style={{ marginTop: 0, marginBottom: 8 }}>准备就绪</Title>
      <Paragraph className="onboarding-text" style={{ marginBottom: 6 }}>
        快速上手：
      </Paragraph>
      <ul className="onboarding-list">
        <li><Text strong>创建大厅</Text>：作为房主开新房间，把大厅名和密码告诉好友。</li>
        <li><Text strong>加入大厅</Text>：填入好友给的大厅名和密码即可进入同一局域网。</li>
        <li>进入大厅后，在 Minecraft 中开启"对局域网开放"，其他人即可看到你的世界。</li>
        <li>遇到连接问题时，可在大厅内打开"网络诊断"一键排查并修复。</li>
      </ul>
      <Alert type="info" showIcon message="随时可在「关于软件」中再次查看本引导。" />
    </div>
  );

  const steps = [welcomeStep, envStep, doneStep];

  const isLast = step === steps.length - 1;

  const footer = (
    <div className="onboarding-footer">
      <div className="onboarding-footer-left">
        {step > 0 && (
          <Button size="small" onClick={() => setStep((s) => Math.max(0, s - 1))}>
            上一步
          </Button>
        )}
      </div>
      <div className="onboarding-footer-right">
        <Button size="small" onClick={finish}>
          跳过引导
        </Button>
        {isLast ? (
          <Button size="small" type="primary" onClick={finish}>
            开始使用
          </Button>
        ) : (
          <Button
            size="small"
            type="primary"
            onClick={() => setStep((s) => Math.min(steps.length - 1, s + 1))}
          >
            下一步
          </Button>
        )}
      </div>
    </div>
  );

  return (
    <Modal
      title="新手引导"
      open={visible}
      onCancel={finish}
      footer={footer}
      width={400}
      centered
      maskClosable={false}
      className="onboarding-modal"
    >
      <Steps
        current={step}
        size="small"
        style={{ marginBottom: 14 }}
        items={[{ title: '欢迎' }, { title: '环境检测' }, { title: '开始使用' }]}
      />
      {steps[step]}
    </Modal>
  );
};
