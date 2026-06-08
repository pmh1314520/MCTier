import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Button, Input, Select, message, Space, Typography, Modal } from 'antd';
import { invoke } from '@tauri-apps/api/core';
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
      message.warning('请先输入 Minecraft 版本目录');
      return;
    }

    try {
      const detected = await invoke<string | null>('detect_launcher_type', {
        minecraftDir: versionDir,
      });
      if (detected) {
        setLauncherType(detected);
        message.success(`检测到 ${detected} 启动器`);
      } else {
        message.info('未能自动检测启动器类型，请手动选择');
      }
    } catch (error) {
      console.error('检测启动器类型失败:', error);
      message.error('检测失败');
    }
  };

  const handleConfigure = async () => {
    if (!versionDir) {
      message.warning('请先选择 Minecraft 版本目录');
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
        title: '配置说明',
        width: 600,
        content: (
          <div style={{ whiteSpace: 'pre-wrap', lineHeight: '1.8' }}>
            {result}
          </div>
        ),
        okText: '我知道了',
      });
    } catch (error) {
      console.error('配置失败:', error);
      message.error(`配置失败: ${error}`);
    } finally {
      setConfiguring(false);
    }
  };

  const handleCopyAgentArg = () => {
    if (agentArg) {
      navigator.clipboard.writeText(agentArg);
      message.success('已复制到剪贴板');
    }
  };

  return (
    <div className="minecraft-config">
      <div className="minecraft-config-header" data-tauri-drag-region>
        <Title level={4} data-tauri-drag-region>Minecraft 正版验证配置</Title>
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
          配置 Minecraft 启动器以自动关闭局域网服务器的正版验证，让离线账号的玩家也能加入你的局域网服务器。
        </Paragraph>

        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <div className="config-item">
            <Text strong>启动器类型</Text>
            <Select
              value={launcherType}
              onChange={setLauncherType}
              style={{ width: '100%', marginTop: 8 }}
              getPopupContainer={(trigger) => (trigger.parentElement as HTMLElement) || document.body}
            >
              <Option value="PCL">PCL / PCL2 启动器</Option>
              <Option value="HMCL">HMCL 启动器</Option>
              <Option value="官方启动器">官方启动器</Option>
            </Select>
          </div>

          <div className="config-item">
            <Text strong>Minecraft 版本目录</Text>
            <Space direction="vertical" style={{ width: '100%', marginTop: 8 }}>
              <Input
                value={versionDir}
                onChange={(e) => setVersionDir(e.target.value)}
                placeholder="输入 Minecraft 版本目录完整路径"
              />
              <Button 
                size="small" 
                onClick={handleDetectLauncher}
                disabled={!versionDir}
                style={{ width: '100%' }}
              >
                自动检测启动器类型
              </Button>
            </Space>
            <Text type="secondary" style={{ fontSize: 12, marginTop: 4, display: 'block' }}>
              例如：C:\Users\用户名\AppData\Roaming\.minecraft\versions\1.21.11
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
            自动配置
          </Button>

          <div className="manual-config">
            <Text strong>手动配置</Text>
            <Paragraph type="secondary" style={{ fontSize: 12, marginTop: 8 }}>
              如果自动配置失败，请手动在启动器的 JVM 参数中添加以下内容：
            </Paragraph>
            <Space.Compact style={{ width: '100%' }}>
              <Input
                value={agentArg}
                readOnly
                style={{ fontFamily: 'monospace', fontSize: 11 }}
              />
              <Button onClick={handleCopyAgentArg}>复制</Button>
            </Space.Compact>
          </div>

          <div className="config-tips">
            <Text type="warning" style={{ fontSize: 12 }}>
              💡 提示：配置完成后需要重启 Minecraft 才能生效
            </Text>
          </div>
        </Space>
      </motion.div>
    </div>
  );
};
