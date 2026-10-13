/**
 * 新手引导 / 连接向导
 * - 首次启动自动弹出，逐步检测运行环境，降低组网失败门槛
 * - 提醒用户检查安全软件是否隔离或删除 EasyTier 内核
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Modal, Button, Steps, Spin, Alert, Typography, Space } from 'antd';
import {
  CheckCircleOutlined,
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

type CheckState = 'idle' | 'checking' | 'ok' | 'warn';

interface EnvChecks {
  security: CheckState;
  securityList: string[];
}

export const OnboardingWizard: React.FC<OnboardingWizardProps> = ({ visible, onClose }) => {
  useTranslation();
  const [step, setStep] = useState(0);
  const [checks, setChecks] = useState<EnvChecks>({
    security: 'idle',
    securityList: [],
  });

  const runChecks = useCallback(async () => {
    setChecks({ security: 'checking', securityList: [] });

    let security: CheckState = 'ok';
    let securityList: string[] = [];
    try {
      securityList = (await invoke<string[]>('detect_security_software')) || [];
      security = securityList.length > 0 ? 'warn' : 'ok';
    } catch {
      security = 'warn';
    }

    setChecks({ security, securityList });
  }, []);

  useEffect(() => {
    if (visible && step === 1) {
      const timer = window.setTimeout(() => void runChecks(), 0);
      return () => window.clearTimeout(timer);
    }
  }, [visible, step, runChecks]);

  const finish = () => {
    markOnboardingDone();
    onClose();
  };

  const stateIcon = (s: CheckState) => {
    if (s === 'checking') return <Spin indicator={<LoadingOutlined spin />} />;
    if (s === 'ok') return <CheckCircleOutlined style={{ color: '#52c41a' }} />;
    if (s === 'warn') return <WarningOutlined style={{ color: '#faad14' }} />;
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
        <div style={{ fontSize: 12, color: 'var(--mct-text-secondary, #aab0bc)', marginTop: 2 }}>{desc}</div>
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
        {tl('接下来检查常见安全软件。若创建或加入大厅失败，请优先查看安全软件的隔离区，确认 EasyTier 内核没有被误删。', 'Next, check for common security software. If creating or joining a lobby fails, first check its quarantine for the EasyTier core.')}
      </Paragraph>
    </div>
  );

  // 步骤 1：环境检测
  const allChecking = checks.security === 'checking';

  const envStep = (
    <div className="onboarding-step" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Alert
        className="onboarding-security-notice"
        type="warning"
        showIcon
        message={tl('大厅创建或加入失败？先检查 EasyTier 是否被误删', 'Cannot create or join a lobby? Check whether EasyTier was removed')}
        description={tl('安全软件可能将 easytier-core.exe 误判并隔离或删除。请先查看隔离区或拦截记录，确认来自官方 MCTier 安装包后恢复该文件，并将 MCTier 安装目录加入信任列表，再重试。下方检测到安全软件不代表软件已被拦截，可以直接继续使用。', 'Security software may quarantine or delete easytier-core.exe. Check its quarantine or blocking history, restore the file after confirming it came from the official MCTier package, and trust the MCTier installation folder before retrying. Detecting security software below does not mean it has blocked MCTier; you can continue.')}
      />
      {checkRow(
        <SafetyCertificateOutlined />,
        tl('安全软件', 'Security software'),
        checks.security,
        checks.security === 'ok'
          ? tl('未检测到常见安全软件；若无法组网，仍可检查系统安全软件的隔离记录。', 'No common security software detected. If networking fails, also check your system security quarantine.')
          : tl(
              `检测到：${checks.securityList.join('、') || '检测暂不可用'}。仅表示检测结果，不代表 MCTier 已被拦截。`,
              `Detected: ${checks.securityList.join(', ') || 'check unavailable'}. This does not mean MCTier has been blocked.`,
            )
      )}

      <Space wrap style={{ marginTop: 4 }}>
        <Button onClick={() => void runChecks()} disabled={allChecking}>
          {tl('重新检测', 'Re-check')}
        </Button>
      </Space>
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
