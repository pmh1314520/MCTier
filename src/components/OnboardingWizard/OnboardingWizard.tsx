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
import { useTranslation } from 'react-i18next';
import { tl } from '../../i18n';
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
  useTranslation();
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
      message.success(msg || tl('已添加防火墙放行规则', 'Firewall rules added'));
      await runChecks();
    } catch (error) {
      message.error(`${tl('添加防火墙规则失败：', 'Failed to add firewall rules: ')}${error}${tl('。可尝试以管理员身份重启后重试', '. Try restarting as administrator.')}`);
    } finally {
      setFixing(false);
    }
  };

  const handleRestartAdmin = async () => {
    try {
      await invoke('restart_as_admin');
    } catch (error) {
      message.error(`${tl('以管理员身份重启失败：', 'Failed to restart as administrator: ')}${error}`);
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
      <Title level={5} style={{ marginTop: 0, marginBottom: 8 }}>{tl('欢迎使用 MCTier', 'Welcome to MCTier')}</Title>
      <Paragraph className="onboarding-text">
        {tl('MCTier 帮助你和好友快速建立虚拟局域网，畅玩 Minecraft 等局域网联机游戏，并自带语音、聊天与文件共享。', 'MCTier helps you and your friends quickly build a virtual LAN to play Minecraft and other LAN games, with built-in voice, chat and file sharing.')}
      </Paragraph>
      <Paragraph className="onboarding-text">
        {tl('为了让组网更顺畅，我们先用几秒钟检查一下运行环境。多数连接失败都源于权限不足、防火墙拦截或安全软件干扰。', 'For smoother networking, let us spend a few seconds checking your environment. Most connection failures come from insufficient permissions, firewall blocking or security software interference.')}
      </Paragraph>
      <Alert
        type="info"
        showIcon
        message={tl('建议以管理员身份运行 MCTier，可显著降低组网失败概率。', 'Running MCTier as administrator greatly reduces networking failures.')}
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
        tl('管理员权限', 'Administrator'),
        checks.admin,
        checks.admin === 'ok'
          ? tl('已以管理员身份运行，网络配置权限充足。', 'Running as administrator with sufficient network permissions.')
          : tl('当前非管理员身份，创建虚拟网卡/写入 hosts 可能失败，建议以管理员重启。', 'Not running as administrator; creating the virtual adapter or writing hosts may fail. Restart as administrator.')
      )}
      {checkRow(
        <SafetyCertificateOutlined />,
        tl('防火墙放行', 'Firewall'),
        checks.firewall,
        checks.firewall === 'ok'
          ? tl('已检测到 MCTier 的防火墙放行规则。', 'MCTier firewall rules detected.')
          : tl('未检测到放行规则，Windows 防火墙可能阻止联机，建议一键放行。', 'No firewall rules found; Windows Firewall may block connections. Add them with one click.')
      )}
      {checkRow(
        <SafetyCertificateOutlined />,
        tl('安全软件', 'Security software'),
        checks.security,
        checks.security === 'ok'
          ? tl('未检测到常见安全软件拦截。', 'No common security software interference detected.')
          : `${tl('检测到：', 'Detected: ')}${checks.securityList.join('、') || tl('未知安全软件', 'unknown security software')}${tl('。请将 MCTier 加入信任/白名单。', '. Please add MCTier to your trust/whitelist.')}`
      )}

      <Space wrap style={{ marginTop: 4 }}>
        <Button onClick={() => void runChecks()} disabled={allChecking}>
          {tl('重新检测', 'Re-check')}
        </Button>
        {checks.firewall !== 'ok' && (
          <Button type="primary" loading={fixing} disabled={allChecking} onClick={() => void handleAddFirewall()}>
            {tl('一键放行防火墙', 'Allow through firewall')}
          </Button>
        )}
        {checks.admin !== 'ok' && (
          <Button danger disabled={allChecking} onClick={() => void handleRestartAdmin()}>
            {tl('以管理员身份重启', 'Restart as admin')}
          </Button>
        )}
      </Space>

      {!allChecking && hasWarning && (
        <Alert
          type="warning"
          showIcon
          message={tl('部分项目需要注意', 'Some items need attention')}
          description={tl('存在警告项不影响继续使用，但若组网失败，建议先处理上述提示。', 'Warnings do not block usage, but if networking fails, address them first.')}
        />
      )}
      {!allChecking && !hasWarning && (
        <Alert type="success" showIcon message={tl('环境检查通过', 'Environment check passed')} description={tl('一切就绪，可以开始联机啦。', 'All set, you can start playing.')} />
      )}
    </div>
  );

  // 步骤 2：完成
  const doneStep = (
    <div className="onboarding-step">
      <Title level={5} style={{ marginTop: 0, marginBottom: 8 }}>{tl('准备就绪', 'Ready')}</Title>
      <Paragraph className="onboarding-text" style={{ marginBottom: 6 }}>
        {tl('快速上手：', 'Quick start:')}
      </Paragraph>
      <ul className="onboarding-list">
        <li><Text strong>{tl('创建大厅', 'Create Lobby')}</Text>{tl('：作为房主开新房间，把大厅名和密码告诉好友。', ': open a room as host and share the lobby name and password.')}</li>
        <li><Text strong>{tl('加入大厅', 'Join Lobby')}</Text>{tl('：填入好友给的大厅名和密码即可进入同一局域网。', ': enter the lobby name and password from a friend to join the same LAN.')}</li>
        <li>{tl('进入大厅后，在 Minecraft 中开启"对局域网开放"，其他人即可看到你的世界。', 'After joining, use Open to LAN in Minecraft so others can see your world.')}</li>
        <li>{tl('遇到连接问题时，可在大厅内打开"网络诊断"一键排查并修复。', 'If you have connection issues, open Network Diagnostics in the lobby to fix them.')}</li>
      </ul>
      <Alert type="info" showIcon message={tl('随时可在「关于软件」中再次查看本引导。', 'You can view this guide again in About anytime.')} />
    </div>
  );

  const steps = [welcomeStep, envStep, doneStep];

  const isLast = step === steps.length - 1;

  const footer = (
    <div className="onboarding-footer">
      <div className="onboarding-footer-left">
        {step > 0 && (
          <Button size="small" onClick={() => setStep((s) => Math.max(0, s - 1))}>
            {tl('上一步', 'Back')}
          </Button>
        )}
      </div>
      <div className="onboarding-footer-right">
        <Button size="small" onClick={finish}>
          {tl('跳过引导', 'Skip')}
        </Button>
        {isLast ? (
          <Button size="small" type="primary" onClick={finish}>
            {tl('开始使用', 'Get Started')}
          </Button>
        ) : (
          <Button
            size="small"
            type="primary"
            onClick={() => setStep((s) => Math.min(steps.length - 1, s + 1))}
          >
            {tl('下一步', 'Next')}
          </Button>
        )}
      </div>
    </div>
  );

  return (
    <Modal
      title={tl('新手引导', 'Getting Started')}
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
        items={[{ title: tl('欢迎', 'Welcome') }, { title: tl('环境检测', 'Environment') }, { title: tl('开始使用', 'Start') }]}
      />
      {steps[step]}
    </Modal>
  );
};
