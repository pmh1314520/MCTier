import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Button, Input, Select, message, Space, Typography, Modal } from 'antd';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import { tl } from '../../i18n';
import { CloseIcon } from '../icons';
import { useEscapeKey } from '../../hooks';
import './MinecraftConfig.css';

const { Title, Paragraph, Text } = Typography;
const { Option } = Select;

interface MinecraftConfigProps {
  onClose: () => void;
}

/**
 * Minecraft 配置组件
 * 用于配置 Minecraft 启动器以自动关闭正版验证
 */
export const MinecraftConfig: React.FC<MinecraftConfigProps> = ({ onClose }) => {
  useTranslation();
  const [launcherType, setLauncherType] = useState<string>('PCL');
  const [versionDir, setVersionDir] = useState<string>('');
  const [configuring, setConfiguring] = useState(false);
  const [agentArg, setAgentArg] = useState<string>('');

  // ESC键返回
  useEscapeKey(onClose);

  useEffect(() => {
    // 获取 Agent 参数
    loadAgentArgument();
  }, []);

  const loadAgentArgument = async () => {
    try {
      const arg = await invoke<string>('get_agent_argument');
      setAgentArg(arg);
    } catch (error) {
      console.error('获取 Agent 参数失败:', error);
    }
  };

  const handleDetectLauncher = async () => {
    if (!versionDir) {
      message.warning(tl('请先输入 Minecraft 版本目录', 'Please enter the Minecraft version directory first'));
      return;
    }

    try {
      const detected = await invoke<string | null>('detect_launcher_type', {
        minecraftDir: versionDir,
      });
      if (detected) {
        setLauncherType(detected);
        message.success(`${tl('检测到', 'Detected')} ${detected} ${tl('启动器', 'launcher')}`);
      } else {
        message.info(tl('未能自动检测启动器类型，请手动选择', 'Could not auto-detect the launcher type, please select manually'));
      }
    } catch (error) {
      console.error('检测启动器类型失败:', error);
      message.error(tl('检测失败', 'Detection failed'));
    }
  };

  const handleConfigure = async () => {
    if (!versionDir) {
      message.warning(tl('请先选择 Minecraft 版本目录', 'Please select the Minecraft version directory first'));
      return;
    }

    setConfiguring(true);
    try {
      const result = await invoke<string>('configure_minecraft_launcher', {
        launcherType,
        versionDir,
      });

      // 使用 Modal 显示详细的配置说明
      Modal.info({
        title: tl('配置说明', 'Configuration Notes'),
        width: 600,
        content: (
          <div style={{ whiteSpace: 'pre-wrap', lineHeight: '1.8' }}>
            {result}
          </div>
        ),
        okText: tl('我知道了', 'Got it'),
      });
    } catch (error) {
      console.error('配置失败:', error);
      message.error(`${tl('配置失败', 'Configuration failed')}: ${error}`);
    } finally {
      setConfiguring(false);
    }
  };

  const handleCopyAgentArg = () => {
    if (agentArg) {
      navigator.clipboard.writeText(agentArg);
      message.success(tl('已复制到剪贴板', 'Copied to clipboard'));
    }
  };

  return (
    <div className="minecraft-config">
      <div className="minecraft-config-header" data-tauri-drag-region>
        <Title level={4} data-tauri-drag-region>{tl('Minecraft 正版验证配置', 'Minecraft License Verification Config')}</Title>
        <button className="close-button" onClick={onClose}>
          <CloseIcon />
        </button>
      </div>

      <motion.div
        className="minecraft-config-content"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <Paragraph>
          {tl(
            '配置 Minecraft 启动器以自动关闭局域网服务器的正版验证，让离线账号的玩家也能加入你的局域网服务器。',
            'Configure the Minecraft launcher to automatically disable license verification for LAN servers, so offline-account players can join your LAN server.'
          )}
        </Paragraph>

        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <div className="config-item">
            <Text strong>{tl('启动器类型', 'Launcher Type')}</Text>
            <Select
              value={launcherType}
              onChange={setLauncherType}
              style={{ width: '100%', marginTop: 8 }}
              getPopupContainer={(trigger) => (trigger.parentElement as HTMLElement) || document.body}
            >
              <Option value="PCL">{tl('PCL / PCL2 启动器', 'PCL / PCL2 Launcher')}</Option>
              <Option value="HMCL">{tl('HMCL 启动器', 'HMCL Launcher')}</Option>
              <Option value="官方启动器">{tl('官方启动器', 'Official Launcher')}</Option>
            </Select>
          </div>

          <div className="config-item">
            <Text strong>{tl('Minecraft 版本目录', 'Minecraft Version Directory')}</Text>
            <Space direction="vertical" style={{ width: '100%', marginTop: 8 }}>
              <Input
                value={versionDir}
                onChange={(e) => setVersionDir(e.target.value)}
                placeholder={tl('输入 Minecraft 版本目录完整路径', 'Enter the full path of the Minecraft version directory')}
              />
              <Button 
                size="small" 
                onClick={handleDetectLauncher}
                disabled={!versionDir}
                style={{ width: '100%' }}
              >
                {tl('自动检测启动器类型', 'Auto-detect Launcher Type')}
              </Button>
            </Space>
            <Text type="secondary" style={{ fontSize: 12, marginTop: 4, display: 'block' }}>
              {tl('例如：C:\\Users\\用户名\\AppData\\Roaming\\.minecraft\\versions\\1.21.11', 'e.g. C:\\Users\\YourName\\AppData\\Roaming\\.minecraft\\versions\\1.21.11')}
            </Text>
          </div>

          <Button
            type="primary"
            block
            size="large"
            loading={configuring}
            onClick={handleConfigure}
            disabled={!versionDir}
          >
            {tl('自动配置', 'Auto Configure')}
          </Button>

          <div className="manual-config">
            <Text strong>{tl('手动配置', 'Manual Configuration')}</Text>
            <Paragraph type="secondary" style={{ fontSize: 12, marginTop: 8 }}>
              {tl('如果自动配置失败，请手动在启动器的 JVM 参数中添加以下内容：', 'If auto-configuration fails, manually add the following to the launcher JVM arguments:')}
            </Paragraph>
            <Space.Compact style={{ width: '100%' }}>
              <Input
                value={agentArg}
                readOnly
                style={{ fontFamily: 'monospace', fontSize: 11 }}
              />
              <Button onClick={handleCopyAgentArg}>{tl('复制', 'Copy')}</Button>
            </Space.Compact>
          </div>

          <div className="config-tips">
            <Text type="warning" style={{ fontSize: 12 }}>
              💡 {tl('提示：配置完成后需要重启 Minecraft 才能生效', 'Tip: Restart Minecraft after configuration for it to take effect')}
            </Text>
          </div>
        </Space>
      </motion.div>
    </div>
  );
};
