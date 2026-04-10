import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Form, Input, Button, Select, Space, Typography, Modal, Switch, App as AntdApp } from 'antd';
import { invoke } from '@tauri-apps/api/core';
import { readText } from '@tauri-apps/plugin-clipboard-manager';
import { useAppStore } from '../../stores';
import type { Lobby, UserConfig } from '../../types';
import { WarningIcon, StarIcon, DiceIcon } from '../icons';
import { useEscapeKey } from '../../hooks';
import { FavoriteLobbyManager, type FavoriteLobby } from '../FavoriteLobbyManager/FavoriteLobbyManager';
import './LobbyForm.css';

const { Title } = Typography;
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
  customEasytierServer?: string;
  customSignalingServer?: string;
  useDomain: boolean;
}

// 官方 EasyTier 服务器节点（仅保留 CDN WebSockets）
const OFFICIAL_EASYTIER_SERVER = 'wss://mctiers.pmhs.top';

// 默认备用节点（与SettingsWindow中的定义保持一致）
const DEFAULT_BUILTIN_NODE = {
  name: '明月清风节点',
  address: 'wss://qtet-public.070219.xyz'
};

// 旧版官方节点（用于兼容历史配置，自动迁移到 WebSockets 节点）
const isLegacyOfficialServer = (server?: string) => {
  if (!server) return false;
  return (
    server === 'tcp://mctier.pmhs.top:11010' ||
    server === 'udp://mctier.pmhs.top:11010' ||
    server === 'wss://mctier.pmhs.top/signaling' ||
    server === 'ws://mctier.pmhs.top/signaling'
  );
};

// 自定义节点接口
interface CustomEasyTierNode {
  name: string;
  address: string;
}

// 获取服务器节点列表（包含官方节点、默认备用节点和自定义节点）
const getServerNodes = (customNodes: CustomEasyTierNode[]) => {
  const nodes = [
    { value: OFFICIAL_EASYTIER_SERVER, label: 'MCTier 官方服务器 (WebSockets)' },
    { value: DEFAULT_BUILTIN_NODE.address, label: `${DEFAULT_BUILTIN_NODE.name} (备用)` },
  ];
  
  // 添加自定义节点
  customNodes.forEach((node) => {
    nodes.push({
      value: node.address,
      label: `${node.name} (自定义)`,
    });
  });
  
  nodes.push({ value: 'custom', label: '临时自定义服务器地址' });
  
  return nodes;
};

// 随机生成大厅名称的词库
const LOBBY_NAME_ADJECTIVES = [
  '快乐', '欢乐', '神秘', '梦幻', '传奇', '史诗', '超级', '极限',
  '无敌', '王者', '至尊', '荣耀', '辉煌', '璀璨', '闪耀', '炫酷',
  '疯狂', '狂野', '激情', '热血', '勇敢', '无畏', '坚韧', '强大',
  '幸运', '吉祥', '福星', '瑞雪', '春风', '夏日', '秋月', '冬雪',
];

const LOBBY_NAME_NOUNS = [
  '冒险', '探险', '旅程', '征途', '远征', '奇遇', '传说', '神话',
  '世界', '王国', '帝国', '领域', '天堂', '乐园', '家园', '基地',
  '联盟', '公会', '战队', '军团', '部落', '氏族', '家族', '团队',
  '小队', '组织', '势力', '阵营', '派系', '集团', '协会', '社团',
];

/**
 * 生成随机大厅名称
 */
const generateRandomLobbyName = (): string => {
  const adjective = LOBBY_NAME_ADJECTIVES[Math.floor(Math.random() * LOBBY_NAME_ADJECTIVES.length)];
  const noun = LOBBY_NAME_NOUNS[Math.floor(Math.random() * LOBBY_NAME_NOUNS.length)];
  const number = Math.floor(Math.random() * 1000);
  return `${adjective}的${noun}${number}`;
};

/**
 * 生成随机密码
 * 包含大小写字母和数字，长度12位
 */
const generateRandomPassword = (): string => {
  const lowercase = 'abcdefghijklmnopqrstuvwxyz';
  const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const numbers = '0123456789';
  const allChars = lowercase + uppercase + numbers;
  
  let password = '';
  
  // 确保至少包含一个小写字母、一个大写字母和一个数字
  password += lowercase[Math.floor(Math.random() * lowercase.length)];
  password += uppercase[Math.floor(Math.random() * uppercase.length)];
  password += numbers[Math.floor(Math.random() * numbers.length)];
  
  // 填充剩余字符
  for (let i = 3; i < 12; i++) {
    password += allChars[Math.floor(Math.random() * allChars.length)];
  }
  
  // 打乱顺序
  return password.split('').sort(() => Math.random() - 0.5).join('');
};

/**
 * 大厅表单组件
 * 用于创建或加入大厅
 */
export const LobbyForm: React.FC<LobbyFormProps> = ({ mode, onClose }) => {
  const { message } = AntdApp.useApp();
  const { setAppState, setLobby, config } = useAppStore();
  const [form] = Form.useForm<LobbyFormValues>();
  const [loading, setLoading] = useState(false);
  const [showCustomServer, setShowCustomServer] = useState(config.preferredServer === 'custom');
  const [showFavoritesModal, setShowFavoritesModal] = useState(false);
  const [privateServerConfig, setPrivateServerConfig] = useState<{
    usePrivateServer: boolean;
    privateEasytierServer: string;
    privateSignalingServer: string;
  }>({
    usePrivateServer: false,
    privateEasytierServer: 'wss://mctiers.pmhs.top',
    privateSignalingServer: 'wss://mctier.pmhs.top/signaling',
  });
  // @ts-ignore - customNodes is used in useEffect to load custom nodes
  const [customNodes, setCustomNodes] = useState<CustomEasyTierNode[]>([]);
  const [serverNodes, setServerNodes] = useState(getServerNodes([]));
  
  // 滚动提示相关状态
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [showScrollHint, setShowScrollHint] = useState(false);
  const [canScroll, setCanScroll] = useState(false);
  
  // ESC键返回
  useEscapeKey(() => {
    if (!loading) {
      handleCancel();
    }
  });
  
  // 检查是否可以滚动
  useEffect(() => {
    const checkScroll = () => {
      if (scrollContainerRef.current) {
        const { scrollHeight, clientHeight } = scrollContainerRef.current;
        const hasScroll = scrollHeight > clientHeight;
        setCanScroll(hasScroll);
        setShowScrollHint(hasScroll);
      }
    };
    
    // 初始检查
    checkScroll();
    
    // 监听窗口大小变化
    window.addEventListener('resize', checkScroll);
    
    // 延迟检查，确保内容已渲染
    const timer = setTimeout(checkScroll, 500);
    
    return () => {
      window.removeEventListener('resize', checkScroll);
      clearTimeout(timer);
    };
  }, [showCustomServer, privateServerConfig.usePrivateServer]);
  
  // 监听滚动事件，滚动后隐藏提示
  useEffect(() => {
    const handleScroll = () => {
      if (scrollContainerRef.current) {
        const { scrollTop } = scrollContainerRef.current;
        if (scrollTop > 20) {
          setShowScrollHint(false);
        }
      }
    };
    
    const container = scrollContainerRef.current;
    if (container) {
      container.addEventListener('scroll', handleScroll);
      return () => container.removeEventListener('scroll', handleScroll);
    }
  }, []);
  
  // 一键随机生成大厅名称和密码
  const handleRandomGenerate = () => {
    const lobbyName = generateRandomLobbyName();
    const password = generateRandomPassword();
    
    form.setFieldsValue({
      lobbyName,
      password,
    });
    
    message.success('已随机生成大厅名称和密码');
  };

  // 处理选择常用大厅
  const handleSelectFavorite = (lobby: FavoriteLobby) => {
    form.setFieldsValue({
      lobbyName: lobby.name,
      password: lobby.password,
      playerName: lobby.playerName || config.playerName || '',
      useDomain: lobby.useDomain ?? false,
    });
  };

  const resolvedPreferredServer =
    config.preferredServer === 'custom'
      ? 'custom'
      : isLegacyOfficialServer(config.preferredServer)
        ? OFFICIAL_EASYTIER_SERVER
        : config.preferredServer === OFFICIAL_EASYTIER_SERVER
          ? OFFICIAL_EASYTIER_SERVER
          : OFFICIAL_EASYTIER_SERVER;

  const initialValues: Partial<LobbyFormValues> = {
    playerName: config.playerName || '',
    serverNode: resolvedPreferredServer,
    // 不设置 useDomain 的初始值，让 Switch 组件自己管理状态（默认为 false）
  };

  // 组件加载时尝试从剪贴板自动识别大厅信息
  useEffect(() => {
    const autoFillFromClipboard = async () => {
      // 只在加入大厅模式下自动识别
      if (mode !== 'join') return;
      
      await recognizeClipboard(true); // 传入 true 表示是自动识别，不显示"剪贴板为空"提示
    };

    autoFillFromClipboard();
  }, [form, mode]);

  // 加载私有服务器配置和自定义节点
  useEffect(() => {
    const loadPrivateServerConfig = async () => {
      try {
        const settings = await invoke<any>('get_settings');
        setPrivateServerConfig({
          usePrivateServer: settings.usePrivateServer || false,
          // 使用 ?? 运算符，只在 null/undefined 时使用默认值
          privateEasytierServer: settings.privateEasytierServer ?? 'wss://mctiers.pmhs.top',
          privateSignalingServer: settings.privateSignalingServer ?? 'wss://mctier.pmhs.top/signaling',
        });
        
        // 加载自定义节点
        const nodes = settings.customEasytierNodes || [];
        setCustomNodes(nodes);
        setServerNodes(getServerNodes(nodes));
        
        console.log('已加载私有服务器配置:', settings);
        console.log('已加载自定义节点:', nodes);
      } catch (error) {
        console.error('加载私有服务器配置失败:', error);
      }
    };

    loadPrivateServerConfig();
  }, []);

  // 检测自动大厅配置，自动填充并提交
  useEffect(() => {
    const autoConfig = (window as any).__autoLobbyConfig;
    // 没有配置或不是创建模式就跳过
    if (!autoConfig || mode !== 'create') return;
    // 立即清除，防止重复触发
    delete (window as any).__autoLobbyConfig;
    const { lobbyName, lobbyPassword, playerName, useDomain } = autoConfig;
    form.setFieldsValue({
      lobbyName,
      password: lobbyPassword,
      playerName,
      useDomain: useDomain || false,
      serverNode: resolvedPreferredServer,
    });
    setTimeout(() => {
      form.submit();
    }, 300);
  }, [form, mode, config.preferredServer]);
  
  // 从剪贴板识别大厅信息的函数
  const recognizeClipboard = async (isAuto = false) => {
    try {
      const clipboardText = await readText();
      if (!clipboardText) {
        // 只在手动识别时提示剪贴板为空
        if (!isAuto) {
          message.info('剪贴板为空');
        }
        return;
      }

      console.log('读取到剪贴板内容:', clipboardText);

      // 新格式：
      // ———————— 邀请您加入大厅 ————————
      // 完整复制后打开 MCTier-加入大厅 界面（自动识别）
      // 大厅名称：XXX
      // 密码：XXX
      // —————— (https://mctier.pmhs.top) ——————
      
      // 尝试匹配新格式（使用[\s\S]匹配包括换行符在内的所有字符）
      // 修改正则表达式，允许密码为空
      const lobbyNameMatch = clipboardText.match(/大厅名称：([^\r\n]+)/);
      const passwordMatch = clipboardText.match(/密码：([^\r\n]*)/); // 改为 * 允许0个或多个字符
      
      if (lobbyNameMatch && passwordMatch) {
        const lobbyName = lobbyNameMatch[1].trim();
        const password = passwordMatch[1].trim();
        
        console.log('匹配到大厅信息:', { lobbyName, password: password ? '***' : '(空)' });
        
        // 验证格式是否合理（大厅名称至少4个字符，密码至少8个字符）
        if (lobbyName.length >= 4 && password.length >= 8) {
          form.setFieldsValue({
            lobbyName,
            password,
          });
          message.success('已自动识别并填写大厅信息');
          console.log('自动填写大厅信息成功');
          return;
        } else {
          console.log('大厅信息格式不符合要求:', { 
            lobbyNameLength: lobbyName.length, 
            passwordLength: password.length 
          });
        }
      } else {
        console.log('未匹配到新格式的大厅信息');
      }
      
      // 兼容旧格式：大厅名称|密码
      const parts = clipboardText.split('|');
      if (parts.length === 2) {
        const [lobbyName, password] = parts;
        
        // 验证格式是否合理（简单验证）
        if (lobbyName.trim().length >= 4 && password.trim().length >= 8) {
          form.setFieldsValue({
            lobbyName: lobbyName.trim(),
            password: password.trim(),
          });
          message.success('已自动识别并填写大厅信息');
          console.log('自动填写大厅信息（旧格式）成功');
          return;
        }
      }
      
      // 如果没有匹配到任何格式，只在手动识别时提示
      if (!isAuto) {
        message.warning('剪贴板中没有识别到有效的大厅信息');
      }
    } catch (error) {
      // 静默失败，不影响用户体验
      console.log('无法读取剪贴板或格式不匹配:', error);
      // 只在手动识别时显示错误提示
      if (!isAuto) {
        message.error('读取剪贴板失败，请检查权限');
      }
    }
  };

  const handleSubmit = async (values: LobbyFormValues) => {
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
      let signalingServer = 'wss://mctier.pmhs.top/signaling'; // 默认官方信令服务器
      
      // 如果启用了私有服务器，使用私有服务器配置（不添加默认备用节点）
      if (privateServerConfig.usePrivateServer) {
        serverNode = privateServerConfig.privateEasytierServer;
        signalingServer = privateServerConfig.privateSignalingServer;
        console.log('使用私有服务器配置（不添加默认备用节点）');
        console.log('  EasyTier:', serverNode);
        console.log('  信令服务器:', signalingServer);
      } else if (values.serverNode === 'custom') {
        // 使用临时自定义服务器（不添加默认备用节点）
        if (!values.customEasytierServer?.trim()) {
          message.error('请输入 EasyTier 节点服务器地址');
          return;
        }
        if (!values.customSignalingServer?.trim()) {
          message.error('请输入信令服务器地址');
          return;
        }
        serverNode = values.customEasytierServer.trim();
        signalingServer = values.customSignalingServer.trim();
        console.log('使用临时自定义服务器（不添加默认备用节点）');
        console.log('  EasyTier:', serverNode);
        console.log('  信令服务器:', signalingServer);
      } else {
        // 使用官方服务器或自定义节点（单节点模式）
        serverNode = values.serverNode;
        console.log('使用单节点模式');
        console.log('  EasyTier节点:', serverNode);
        console.log('  信令服务器:', signalingServer);
      }

      const commandName = mode === 'create' ? 'create_lobby' : 'join_lobby';

      // 获取当前玩家ID，如果不存在则生成一个新的
      let { currentPlayerId } = useAppStore.getState();
      
      if (!currentPlayerId) {
        // 如果 playerId 不存在（可能是因为启动清理导致 Store 重置），生成一个新的
        const timestamp = Date.now();
        const randomSuffix = Math.random().toString(36).substring(2, 11);
        currentPlayerId = `player-${timestamp}-${randomSuffix}`;
        
        // 保存到 Store
        const { setCurrentPlayerId } = useAppStore.getState();
        setCurrentPlayerId(currentPlayerId);
        
        console.log('⚠️ playerId 不存在，已生成新的 ID:', currentPlayerId);
      }
      
      // 调用后端命令
      const lobby = await invoke<Lobby>(commandName, {
        name: values.lobbyName.trim(),
        password: values.password.trim(),
        playerName: values.playerName.trim(),
        playerId: currentPlayerId,
        serverNode: serverNode,
        signalingServer: signalingServer,
        useDomain: values.useDomain === true, // 明确转换为布尔值
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

      // 注意：HTTP文件服务器采用按需启动策略
      // 只在第一次添加共享文件夹时才启动，这里不需要检查或启动
      console.log('✅ 大厅创建/加入成功，HTTP文件服务器将在添加共享时按需启动');

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
        errorMessage.includes('740'); // Windows 错误代码 740 表示需要提升权限
      
      // 检查是否是版本过低错误
      const isVersionError = 
        errorMessage.includes('版本过低') ||
        errorMessage.includes('version') ||
        errorMessage.includes('更新');
      
      if (isPermissionError) {
        // 显示权限错误提示
        Modal.error({
          title: '权限不足',
          content: (
            <div>
              <p style={{ marginBottom: '12px' }}>
                MCTier 需要管理员权限来创建虚拟网卡。
              </p>
            </div>
          ),
          okText: '我知道了',
          centered: true,
        });
      } else if (isVersionError) {
        // 显示版本更新提示
        Modal.warning({
          title: '需要更新',
          content: (
            <div style={{ lineHeight: '1.8' }}>
              <p style={{ marginBottom: '12px', color: 'rgba(255,255,255,0.9)' }}>
                {errorMessage}
              </p>
              <p style={{ marginBottom: '8px', color: 'rgba(255,255,255,0.7)' }}>
                请访问 MCTier 官网下载最新版本
              </p>
            </div>
          ),
          okText: '前往官网',
          centered: true,
          onOk: async () => {
            try {
              const { open } = await import('@tauri-apps/plugin-shell');
              await open('https://mctier.pmhs.top');
            } catch (error) {
              console.error('打开官网失败:', error);
            }
          },
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
      {/* 顶部拖拽区域 */}
      <div className="lobby-form-drag-area" data-tauri-drag-region />
      
      <motion.div
        ref={scrollContainerRef}
        className="lobby-form-card"
        initial={{ opacity: 0, y: 30, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
      >
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.3 }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Title level={2} className="lobby-form-title">
              {mode === 'create' ? '创建大厅' : '加入大厅'}
            </Title>
            <div style={{ display: 'flex', gap: '8px' }}>
              {/* 常用信息列表按钮 */}
              <motion.button
                onClick={() => setShowFavoritesModal(true)}
                disabled={loading}
                title="常用大厅信息"
                style={{
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  borderRadius: '8px',
                  width: '36px',
                  height: '36px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  transition: 'all 0.3s ease',
                }}
                whileHover={{ 
                  scale: 1.1,
                  background: 'rgba(255, 255, 255, 0.1)',
                  borderColor: 'rgba(255, 255, 255, 0.4)',
                }}
                whileTap={{ scale: 0.95 }}
              >
                <StarIcon size={18} />
              </motion.button>
              
              {mode === 'create' ? (
                <motion.button
                  onClick={handleRandomGenerate}
                  disabled={loading}
                  title="随机生成大厅名称和密码"
                  style={{
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    borderRadius: '8px',
                    width: '36px',
                    height: '36px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    transition: 'all 0.3s ease',
                  }}
                  whileHover={{ 
                    scale: 1.1,
                    background: 'rgba(255, 255, 255, 0.1)',
                    borderColor: 'rgba(255, 255, 255, 0.4)',
                  }}
                  whileTap={{ scale: 0.95 }}
                >
                  <DiceIcon size={20} />
                </motion.button>
              ) : (
                <motion.button
                  onClick={() => recognizeClipboard(false)}
                  disabled={loading}
                  title="识别剪贴板中的大厅信息"
                  style={{
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    borderRadius: '8px',
                    width: '36px',
                    height: '36px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    transition: 'all 0.3s ease',
                  }}
                  whileHover={{ 
                    scale: 1.1,
                    background: 'rgba(255, 255, 255, 0.1)',
                    borderColor: 'rgba(255, 255, 255, 0.4)',
                  }}
                  whileTap={{ scale: 0.95 }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
                    <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
                    <line x1="9" y1="12" x2="15" y2="12" />
                    <line x1="9" y1="16" x2="15" y2="16" />
                  </svg>
                </motion.button>
              )}
            </div>
          </div>
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
                { min: 1, max: 8, message: '玩家名称长度为 1-8 个字' },
              ]}
            >
              <Input
                placeholder="输入你的玩家名称（最多8个字）"
                size="large"
                disabled={loading}
                maxLength={8}
              />
            </Form.Item>

            <Form.Item
              label="服务器节点"
              name="serverNode"
              rules={[{ required: true, message: '请选择服务器节点' }]}
              tooltip={privateServerConfig.usePrivateServer ? '已启用私有服务器，将使用设置中配置的服务器地址' : undefined}
            >
              <Select 
                size="large" 
                disabled={loading || privateServerConfig.usePrivateServer}
                onChange={(value) => setShowCustomServer(value === 'custom')}
              >
                {serverNodes.map((node) => (
                  <Option key={node.value} value={node.value}>
                    {node.label}
                  </Option>
                ))}
              </Select>
            </Form.Item>

            {showCustomServer && !privateServerConfig.usePrivateServer && (
              <>
                <Form.Item
                  label="临时 EasyTier 节点服务器"
                  name="customEasytierServer"
                  rules={[
                    { required: true, message: '请输入 EasyTier 节点服务器地址' },
                    { 
                      pattern: /^(tcp|udp|ws|wss|txt):\/\/.+$/,
                      message: '格式：tcp://、udp://、ws://、wss:// 或 txt:// 开头'
                    }
                  ]}
                >
                  <Input
                    placeholder="例如：wss://mctiers.pmhs.top 或 tcp://your-server.com:11010"
                    size="large"
                    disabled={loading}
                  />
                </Form.Item>
                <Form.Item
                  label="临时 WebRTC 信令服务器"
                  name="customSignalingServer"
                  rules={[
                    { required: true, message: '请输入信令服务器地址' },
                    { 
                      pattern: /^wss?:\/\/.+$/,
                      message: '格式：ws://域名/path 或 wss://域名/path'
                    }
                  ]}
                >
                  <Input
                    placeholder="例如：wss://mctier.pmhs.top/signaling"
                    size="large"
                    disabled={loading}
                  />
                </Form.Item>
              </>
            )}

            {privateServerConfig.usePrivateServer && (
              <div style={{
                padding: '12px',
                background: 'rgba(126, 211, 33, 0.1)',
                border: '1px solid rgba(126, 211, 33, 0.3)',
                borderRadius: '8px',
                marginBottom: '16px',
              }}>
                <div style={{ fontSize: '14px', color: 'rgba(126, 211, 33, 0.9)', marginBottom: '8px' }}>
                  ✓ 已启用私有服务器
                </div>
                <div style={{ fontSize: '12px', color: 'rgba(255, 255, 255, 0.6)' }}>
                  EasyTier: {privateServerConfig.privateEasytierServer}
                  <br />
                  信令服务器: {privateServerConfig.privateSignalingServer}
                </div>
              </div>
            )}

            <Form.Item
              label="使用虚拟域名"
              name="useDomain"
              valuePropName="checked"
              tooltip="开启后，您的虚拟IP将显示为域名格式，便于记忆与访问"
            >
              <Switch disabled={loading} />
            </Form.Item>

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
              <strong>网络环境：</strong>本软件使用纯 P2P 方式连接，为确保联机成功：
              <br />
              ✓ 推荐使用家庭 WiFi 网络
              <br />
              ✗ 不建议使用校园网、手机流量或热点
              <br />
              <br />
              <strong>虚拟域名：</strong>虚拟域名仅能用于访问网站使用，Minecraft 多人游戏不支持使用虚拟域名。加入 Minecraft 服务器时，请使用虚拟IP+端口号（例如：10.126.126.1:25565）
              <br />
              <br />
              <strong>代理工具：</strong>使用虚拟域名功能时，请务必关闭代理工具（如梯子、VPN等），否则域名解析将失效
            </div>
          </div>
        </motion.div>
      </motion.div>

      {/* 滚动提示 - 悬浮在底部 */}
      <AnimatePresence>
        {showScrollHint && canScroll && (
          <motion.div
            className="scroll-hint-floating"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ duration: 0.3 }}
          >
            <motion.div
              animate={{ y: [0, 6, 0] }}
              transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14M19 12l-7 7-7-7"/>
              </svg>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 常用大厅信息管理弹窗 */}
      <FavoriteLobbyManager
        visible={showFavoritesModal}
        onClose={() => setShowFavoritesModal(false)}
        onSelect={handleSelectFavorite}
      />
    </div>
  );
};
