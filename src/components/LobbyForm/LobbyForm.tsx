import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Form, Input, Button, Select, Space, Typography, message, Modal } from 'antd';
import { invoke } from '@tauri-apps/api/core';
import { useAppStore } from '../../stores';
import type { Lobby, UserConfig } from '../../types';
import { WarningIcon } from '../icons';
import './LobbyForm.css';

const { Title, Text } = Typography;
const { Option } = Select;

interface LobbyFormProps {
  mode: 'create' | 'join';
  onClose: () => void;
}

interface LobbyFormValues {
  lobbyName: string;
  password: string;
  playerName: string;
  serverNode: string;
}

// 服务器节点列表
const SERVER_NODES = [
  { value: 'tcp://24.233.29.43:11010', label: 'MCTier 官方服务器 (TCP)' },
  { value: 'udp://24.233.29.43:11010', label: 'MCTier 官方服务器 (UDP)' },
  { value: 'ws://24.233.29.43:11011', label: 'MCTier 官方服务器 (WebSocket)' },
  { value: 'custom', label: '自定义服务器地址' },
];

/**
 * 大厅表单组件
 * 用于创建或加入大厅
 */
export const LobbyForm: React.FC<LobbyFormProps> = ({ mode, onClose }) => {
  const [form] = Form.useForm<LobbyFormValues>();
  const [loading, setLoading] = useState(false);
  const [showCustomServer, setShowCustomServer] = useState(false);
  const { setAppState, setLobby, config } = useAppStore();

  // 从配置中加载默认值
  const initialValues: Partial<LobbyFormValues> = {
    playerName: config.playerName || '',
    serverNode: config.preferredServer || SERVER_NODES[0].value,
  };

  const handleSubmit = async (values: LobbyFormValues & { customServerNode?: string }) => {
    try {
      setLoading(true);
      setAppState('connecting');

      // 验证输入
      if (!values.lobbyName?.trim()) {
        message.error('大厅名称不能为空');
        return;
      }
      if (!values.password?.trim()) {
        message.error('密码不能为空');
        return;
      }
      if (!values.playerName?.trim()) {
        message.error('玩家名称不能为空');
        return;
      }

      // 确定实际使用的服务器地址
      let serverNode = values.serverNode;
      if (values.serverNode === 'custom') {
        if (!values.customServerNode?.trim()) {
          message.error('请输入自定义服务器地址');
          return;
        }
        serverNode = values.customServerNode.trim();
      }

      const commandName = mode === 'create' ? 'create_lobby' : 'join_lobby';

      // 获取当前玩家ID
      const { currentPlayerId } = useAppStore.getState();
      
      // 调用后端命令
      const lobby = await invoke<Lobby>(commandName, {
        name: values.lobbyName.trim(),
        password: values.password.trim(),
        playerName: values.playerName.trim(),
        playerId: currentPlayerId,
        serverNode: serverNode,
      });

      // 保存玩家名称到前端store
      const { updateConfig } = useAppStore.getState();
      updateConfig({ playerName: values.playerName.trim() });
      
      // 保存玩家名称到后端配置文件
      try {
        const currentConfig = await invoke<UserConfig>('get_config');
        await invoke('update_config', {
          config: {
            ...currentConfig,
            playerName: values.playerName.trim(),
          },
        });
        console.log('玩家名称已保存到配置文件');
      } catch (error) {
        console.warn('保存玩家名称到配置文件失败:', error);
      }

      // 更新状态
      setLobby(lobby);
      setAppState('in-lobby');

      message.success(
        mode === 'create' ? '大厅创建成功！' : '成功加入大厅！'
      );

      // 关闭表单
      onClose();
    } catch (error) {
      console.error('操作失败:', error);
      console.error('错误详情:', JSON.stringify(error, null, 2));
      setAppState('error');

      // 提取详细的错误信息
      let errorMessage = '操作失败，请重试';
      
      if (typeof error === 'string') {
        errorMessage = error;
      } else if (error && typeof error === 'object') {
        // 尝试从不同的错误格式中提取消息
        if ('message' in error && typeof error.message === 'string') {
          errorMessage = error.message;
        } else if ('error' in error && typeof error.error === 'string') {
          errorMessage = error.error;
        } else {
          errorMessage = JSON.stringify(error);
        }
      }
      
      // 检查是否是权限相关的错误
      const isPermissionError = 
        errorMessage.includes('拒绝访问') ||
        errorMessage.includes('Access is denied') ||
        errorMessage.includes('权限') ||
        errorMessage.includes('permission') ||
        errorMessage.includes('administrator') ||
        errorMessage.includes('管理员') ||
        errorMessage.includes('740'); // Windows 错误代码 740 表示需要提升权限
      
      if (isPermissionError) {
        // 显示管理员权限提示
        Modal.error({
          title: '需要管理员权限',
          content: (
            <div>
              <p style={{ marginBottom: '12px' }}>
                MCTier 需要管理员权限来创建虚拟网卡。
              </p>
              <p style={{ marginBottom: '12px', fontWeight: 'bold', color: '#ff4d4f' }}>
                请以管理员身份运行 MCTier！
              </p>
              <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)' }}>
                右键点击 MCTier.exe，选择"以管理员身份运行"
              </p>
            </div>
          ),
          okText: '我知道了',
          centered: true,
        });
      } else {
        // 显示详细的错误信息
        message.error({
          content: (
            <div>
              <div style={{ fontWeight: 'bold', marginBottom: '8px' }}>
                {mode === 'create' ? '创建大厅失败' : '加入大厅失败'}
              </div>
              <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.7)' }}>
                {errorMessage}
              </div>
            </div>
          ),
          duration: 8,
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    setAppState('idle');
    onClose();
  };

  return (
    <div className="lobby-form-container">
      <motion.div
        className="lobby-form-card"
        initial={{ opacity: 0, y: 30, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
      >
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.3 }}
          data-tauri-drag-region
        >
          <Title level={2} className="lobby-form-title">
            {mode === 'create' ? '创建大厅' : '加入大厅'}
          </Title>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2, duration: 0.3 }}
        >
          <Form
            form={form}
            layout="vertical"
            onFinish={handleSubmit}
            initialValues={initialValues}
            className="lobby-form"
          >
            <Form.Item
              label="大厅名称"
              name="lobbyName"
              rules={[
                { required: true, message: '请输入大厅名称' },
                { whitespace: true, message: '大厅名称不能为空白字符' },
                { min: 4, max: 32, message: '大厅名称长度为 4-32 个字符' },
                {
                  pattern: /^[\u4e00-\u9fa5a-zA-Z0-9_\-\s]+$/,
                  message: '大厅名称只能包含中文、字母、数字、下划线、连字符和空格',
                },
                {
                  validator: (_, value) => {
                    if (!value) return Promise.resolve();
                    const hasAlphanumeric = /[a-zA-Z0-9\u4e00-\u9fa5]/.test(value);
                    if (!hasAlphanumeric) {
                      return Promise.reject(new Error('大厅名称必须包含至少一个字母或数字'));
                    }
                    return Promise.resolve();
                  },
                },
              ]}
            >
              <Input
                placeholder={
                  mode === 'create' ? '输入大厅名称（至少4个字符）' : '输入要加入的大厅名称'
                }
                size="large"
                disabled={loading}
              />
            </Form.Item>

            <Form.Item
              label="密码"
              name="password"
              rules={[
                { required: true, message: '请输入密码' },
                { whitespace: true, message: '密码不能为空白字符' },
                { min: 8, max: 32, message: '密码长度为 8-32 个字符' },
                {
                  validator: (_, value) => {
                    if (!value) return Promise.resolve();
                    const hasLetter = /[a-zA-Z]/.test(value);
                    const hasDigit = /[0-9]/.test(value);
                    if (!hasLetter) {
                      return Promise.reject(new Error('密码必须包含至少一个字母'));
                    }
                    if (!hasDigit) {
                      return Promise.reject(new Error('密码必须包含至少一个数字'));
                    }
                    return Promise.resolve();
                  },
                },
              ]}
            >
              <Input.Password
                placeholder="输入密码（至少8个字符，包含字母和数字）"
                size="large"
                disabled={loading}
              />
            </Form.Item>

            <Form.Item
              label="玩家名称"
              name="playerName"
              rules={[
                { required: true, message: '请输入玩家名称' },
                { whitespace: true, message: '玩家名称不能为空白字符' },
                { min: 1, max: 16, message: '玩家名称长度为 1-16 个字符' },
              ]}
            >
              <Input
                placeholder="输入你的玩家名称"
                size="large"
                disabled={loading}
              />
            </Form.Item>

            <Form.Item
              label="服务器节点"
              name="serverNode"
              rules={[{ required: true, message: '请选择服务器节点' }]}
            >
              <Select 
                size="large" 
                disabled={loading}
                onChange={(value) => setShowCustomServer(value === 'custom')}
              >
                {SERVER_NODES.map((node) => (
                  <Option key={node.value} value={node.value}>
                    {node.label}
                  </Option>
                ))}
              </Select>
            </Form.Item>

            {showCustomServer && (
              <Form.Item
                label="自定义服务器地址"
                name="customServerNode"
                rules={[
                  { required: true, message: '请输入自定义服务器地址' },
                  { 
                    pattern: /^(tcp|ws|wss):\/\/.+:\d+$/,
                    message: '请输入有效的服务器地址，格式：tcp://地址:端口 或 ws://地址:端口'
                  }
                ]}
              >
                <Input
                  placeholder="例如：tcp://192.168.1.100:11010"
                  size="large"
                  disabled={loading}
                />
              </Form.Item>
            )}

            <Form.Item className="lobby-form-actions">
              <Space size="middle" style={{ width: '100%' }}>
                <motion.div
                  style={{ flex: 1 }}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <Button
                    size="large"
                    onClick={handleCancel}
                    disabled={loading}
                    block
                  >
                    取消
                  </Button>
                </motion.div>
                <motion.div
                  style={{ flex: 1 }}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <Button
                    type="primary"
                    size="large"
                    htmlType="submit"
                    loading={loading}
                    block
                  >
                    {mode === 'create' ? '创建' : '加入'}
                  </Button>
                </motion.div>
              </Space>
            </Form.Item>
          </Form>
        </motion.div>

        <motion.div
          className="lobby-form-network-tip"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.3 }}
        >
          <WarningIcon size={20} className="network-tip-icon" />
          <div className="network-tip-content">
            <div className="network-tip-title">重要提示</div>
            <div className="network-tip-text">
              <strong>管理员权限：</strong>本软件需要管理员权限来创建虚拟网卡，这是实现 Minecraft 局域网联机的必要条件。请确保以管理员身份运行本软件。
              <br />
              <br />
              <strong>网络环境：</strong>本软件使用纯 P2P 方式连接，为确保联机成功：
              <br />
              ✓ 推荐使用家庭 WiFi 网络
              <br />
              ✗ 不建议使用校园网、手机流量或热点
            </div>
          </div>
        </motion.div>

        {mode === 'create' && (
          <motion.div
            className="lobby-form-tip"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5, duration: 0.3 }}
          >
            <Text type="secondary" style={{ fontSize: '12px' }}>
              提示：创建大厅后，其他玩家可以使用相同的大厅名称和密码加入。建议使用独特的大厅名称和强密码以降低冲突概率。
            </Text>
          </motion.div>
        )}
      </motion.div>
    </div>
  );
};
