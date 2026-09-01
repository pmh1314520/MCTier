import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Form, Input, Button, Space, Typography, Modal, Switch, App as AntdApp } from 'antd';
import { PasswordInput } from '../PasswordInput/PasswordInput';
import { invoke } from '@tauri-apps/api/core';
import { readText } from '@tauri-apps/plugin-clipboard-manager';
import { useAppStore } from '../../stores';
import type { Lobby, UserConfig } from '../../types';
import { WarningIcon, StarIcon, DiceIcon, ChevronIcon, CheckIcon } from '../icons';
import { useEscapeKey } from '../../hooks';
import {
  FavoriteLobbyManager,
  type FavoriteLobby,
} from '../FavoriteLobbyManager/FavoriteLobbyManager';
import { RecentManager } from '../RecentManager/RecentManager';
import { recentService, type RecentLobby } from '../../services/recent/recentService';
import { statsService } from '../../services/stats/statsService';
import { PublicPlaza } from '../PublicPlaza/PublicPlaza';
import type { PublicLobby } from '../../services/lobby/publicLobbies';
import { parseLobbyInviteText, type LobbyInvite } from '../../services/lobby/lobbyInvite';
import {
  lobbySessionCoordinator,
  type LobbySessionTicket,
} from '../../services/lobby/LobbySessionCoordinator';
import { prepareSignalingIdentity } from '../../services/signaling/signalingIdentity';
import { useTranslation } from 'react-i18next';
import { tl, getLanguage } from '../../i18n';
import { isSafeServerNode, isSafeSignalingServer } from '../../security/trustBoundary';
import './LobbyForm.css';

const { Title } = Typography;

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

interface ServerNodeOption {
  value: string;
  label: string;
}

interface ServerNodeSelectProps {
  value?: string;
  options: ServerNodeOption[];
  disabled?: boolean;
  ariaLabel: string;
  onChange?: (value: string) => void;
}

const ServerNodeSelect: React.FC<ServerNodeSelectProps> = ({
  value,
  options,
  disabled = false,
  ariaLabel,
  onChange,
}) => {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [placement, setPlacement] = useState<'top' | 'bottom'>('bottom');
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxId = React.useId();
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value)
  );
  const selectedOption = options[selectedIndex];

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnWindowBlur = () => setOpen(false);
    document.addEventListener('pointerdown', closeOnOutsidePointer, true);
    window.addEventListener('blur', closeOnWindowBlur);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer, true);
      window.removeEventListener('blur', closeOnWindowBlur);
    };
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const openMenu = () => {
    if (disabled || options.length === 0) return;
    const triggerRect = triggerRef.current?.getBoundingClientRect();
    const cardRect = rootRef.current?.closest('.lobby-form-card')?.getBoundingClientRect();
    if (triggerRect && cardRect) {
      const estimatedMenuHeight = Math.min(options.length * 42 + 12, 276);
      const spaceBelow = cardRect.bottom - triggerRect.bottom;
      const spaceAbove = triggerRect.top - cardRect.top;
      setPlacement(spaceBelow < estimatedMenuHeight && spaceAbove > spaceBelow ? 'top' : 'bottom');
    }
    setActiveIndex(selectedIndex);
    setOpen(true);
  };

  const selectOption = (index: number) => {
    const option = options[index];
    if (!option) return;
    onChange?.(option.value);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const moveActive = (direction: 1 | -1) => {
    if (!open) {
      openMenu();
      return;
    }
    setActiveIndex((current) => (current + direction + options.length) % options.length);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveActive(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveActive(-1);
    } else if (event.key === 'Home' && open) {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === 'End' && open) {
      event.preventDefault();
      setActiveIndex(options.length - 1);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (open) selectOption(activeIndex);
      else openMenu();
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    } else if (event.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <div ref={rootRef} className={`mct-node-select${open ? ' is-open' : ''}`}>
      <button
        ref={triggerRef}
        type="button"
        className="mct-node-select-trigger"
        disabled={disabled}
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={open ? `${listboxId}-option-${activeIndex}` : undefined}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={handleKeyDown}
      >
        <span className="mct-node-select-value">{selectedOption?.label || ariaLabel}</span>
        <ChevronIcon
          direction={open ? 'up' : 'down'}
          size={16}
          className="mct-node-select-chevron"
        />
      </button>

      {open && (
        <div
          id={listboxId}
          className={`mct-node-select-menu is-${placement}`}
          role="listbox"
          aria-label={ariaLabel}
        >
          {options.map((option, index) => {
            const selected = option.value === value;
            const active = index === activeIndex;
            return (
              <button
                id={`${listboxId}-option-${index}`}
                key={option.value}
                type="button"
                className={`mct-node-select-option${selected ? ' is-selected' : ''}${active ? ' is-active' : ''}`}
                role="option"
                aria-selected={selected}
                tabIndex={-1}
                onPointerEnter={() => setActiveIndex(index)}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => selectOption(index)}
              >
                <span>{option.label}</span>
                <span className="mct-node-select-check" aria-hidden="true">
                  {selected && <CheckIcon size={16} />}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

// 内置 EasyTier 公共节点
const HAIBO_US_EASYTIER_SERVER = 'udp://us01.225284.xyz:11010';
const DEFAULT_EASYTIER_SERVER = HAIBO_US_EASYTIER_SERVER;
const REMOVED_QINGYUN_NODE = 'wss://mctiers.pmhs.top';

// 旧版官方节点（用于兼容历史配置，自动迁移到 WebSockets 节点）
const isLegacyOfficialServer = (server?: string) => {
  if (!server) return false;
  return (
    server === 'tcp://mctier.pmhs.top:11010' ||
    server === 'udp://mctier.pmhs.top:11010' ||
    server === 'wss://test.pmhs.top' ||
    server === 'ws://test.pmhs.top' ||
    server === 'wss://public.456469.xyz'
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
    { value: HAIBO_US_EASYTIER_SERVER, label: tl('海波美国节点', 'Haibo US Node') },
    { value: 'tcp://225284.xyz:11010', label: tl('海波中国大陆节点', 'Haibo Mainland China Node') },
    { value: 'tcp://easytier.weiai.org.cn:11010', label: tl('唯爱厦门节点', 'Weiai Xiamen Node') },
  ];
  const knownAddresses = new Set(nodes.map((node) => node.value));

  // 添加自定义节点
  customNodes.forEach((node) => {
    const name = typeof node?.name === 'string' ? node.name.trim() : '';
    const address = typeof node?.address === 'string' ? node.address.trim() : '';
    if (
      !name ||
      !address ||
      !isSafeServerNode(address) ||
      knownAddresses.has(address) ||
      address === 'custom'
    )
      return;
    knownAddresses.add(address);
    nodes.push({
      value: address,
      label: `${name} ${tl('(自定义)', '(custom)')}`,
    });
  });

  nodes.push({ value: 'custom', label: tl('临时自定义服务器地址', 'Temporary custom server') });

  return nodes;
};

// 随机生成大厅名称的词库
const LOBBY_NAME_ADJECTIVES = [
  '快乐',
  '欢乐',
  '神秘',
  '梦幻',
  '传奇',
  '史诗',
  '超级',
  '极限',
  '无敌',
  '王者',
  '至尊',
  '荣耀',
  '辉煌',
  '璀璨',
  '闪耀',
  '炫酷',
  '疯狂',
  '狂野',
  '激情',
  '热血',
  '勇敢',
  '无畏',
  '坚韧',
  '强大',
  '幸运',
  '吉祥',
  '福星',
  '瑞雪',
  '春风',
  '夏日',
  '秋月',
  '冬雪',
];

const LOBBY_NAME_NOUNS = [
  '冒险',
  '探险',
  '旅程',
  '征途',
  '远征',
  '奇遇',
  '传说',
  '神话',
  '世界',
  '王国',
  '帝国',
  '领域',
  '天堂',
  '乐园',
  '家园',
  '基地',
  '联盟',
  '公会',
  '战队',
  '军团',
  '部落',
  '氏族',
  '家族',
  '团队',
  '小队',
  '组织',
  '势力',
  '阵营',
  '派系',
  '集团',
  '协会',
  '社团',
];

// 英文随机大厅名词库（英文模式使用）
const LOBBY_NAME_ADJECTIVES_EN = [
  'Happy',
  'Joyful',
  'Mystic',
  'Dreamy',
  'Legendary',
  'Epic',
  'Super',
  'Extreme',
  'Invincible',
  'Royal',
  'Supreme',
  'Glorious',
  'Brilliant',
  'Shining',
  'Radiant',
  'Cool',
  'Crazy',
  'Wild',
  'Passionate',
  'Fiery',
  'Brave',
  'Fearless',
  'Tough',
  'Mighty',
  'Lucky',
  'Auspicious',
  'Stellar',
  'Snowy',
  'Spring',
  'Summer',
  'Autumn',
  'Winter',
];

const LOBBY_NAME_NOUNS_EN = [
  'Adventure',
  'Expedition',
  'Journey',
  'Quest',
  'Voyage',
  'Odyssey',
  'Legend',
  'Myth',
  'World',
  'Kingdom',
  'Empire',
  'Realm',
  'Paradise',
  'Haven',
  'Homeland',
  'Base',
  'Alliance',
  'Guild',
  'Squad',
  'Legion',
  'Tribe',
  'Clan',
  'Family',
  'Team',
  'Crew',
  'Order',
  'Faction',
  'Camp',
  'Party',
  'Group',
  'Society',
  'Club',
];

/**
 * 生成随机大厅名称
 */
const generateRandomLobbyName = (): string => {
  const number = Math.floor(Math.random() * 1000);
  if (getLanguage() === 'en') {
    const adjective =
      LOBBY_NAME_ADJECTIVES_EN[Math.floor(Math.random() * LOBBY_NAME_ADJECTIVES_EN.length)];
    const noun = LOBBY_NAME_NOUNS_EN[Math.floor(Math.random() * LOBBY_NAME_NOUNS_EN.length)];
    return `${adjective}${noun}${number}`;
  }
  const adjective = LOBBY_NAME_ADJECTIVES[Math.floor(Math.random() * LOBBY_NAME_ADJECTIVES.length)];
  const noun = LOBBY_NAME_NOUNS[Math.floor(Math.random() * LOBBY_NAME_NOUNS.length)];
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
  const randomBytes = new Uint32Array(12);
  crypto.getRandomValues(randomBytes);
  const pick = (alphabet: string, index: number): string =>
    alphabet[randomBytes[index] % alphabet.length];
  const chars = [pick(lowercase, 0), pick(uppercase, 1), pick(numbers, 2)];
  for (let i = 3; i < randomBytes.length; i += 1) chars.push(pick(allChars, i));
  // Fisher-Yates with fresh CSPRNG words avoids the biased sort comparator.
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomBytes[i] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
};

/**
 * 大厅表单组件
 * 用于创建或加入大厅
 */
export const LobbyForm: React.FC<LobbyFormProps> = ({ mode, onClose }) => {
  const { i18n } = useTranslation();
  const { message } = AntdApp.useApp();
  const { setAppState, setLobby, config } = useAppStore();
  const [form] = Form.useForm<LobbyFormValues>();
  const [loading, setLoading] = useState(false);
  const preferredServerSaveGeneration = useRef(0);
  const [showCustomServer, setShowCustomServer] = useState(config.preferredServer === 'custom');
  const [showFavoritesModal, setShowFavoritesModal] = useState(false);
  const [showRecentModal, setShowRecentModal] = useState(false);
  const [showPublicPlaza, setShowPublicPlaza] = useState(false);
  const [privateServerConfig, setPrivateServerConfig] = useState<{
    usePrivateServer: boolean;
    privateEasytierServer: string;
    privateSignalingServer: string;
  }>({
    usePrivateServer: false,
    privateEasytierServer: 'udp://us01.225284.xyz:11010',
    privateSignalingServer: 'wss://test.pmhs.top',
  });
  // @ts-ignore - customNodes is used in useEffect to load custom nodes
  const [customNodes, setCustomNodes] = useState<CustomEasyTierNode[]>([]);
  const [serverNodes, setServerNodes] = useState(getServerNodes([]));
  const [temporaryServerNode, setTemporaryServerNode] = useState<string>();
  const [temporarySignalingServer, setTemporarySignalingServer] = useState<string>();
  const selectedServerNode = Form.useWatch('serverNode', form);
  const selectedCustomServer = Form.useWatch('customEasytierServer', form);
  const selectedCustomSignaling = Form.useWatch('customSignalingServer', form);
  const unlistedSelectedNode =
    selectedServerNode &&
    selectedServerNode !== 'custom' &&
    !serverNodes.some((node) => node.value === selectedServerNode)
      ? selectedServerNode
      : undefined;
  const extraServerNode = temporaryServerNode || unlistedSelectedNode;
  const availableServerNodes = extraServerNode
    ? [
        {
          value: extraServerNode,
          label: temporaryServerNode
            ? tl('本大厅指定节点（临时）', 'Lobby-specified node (temporary)')
            : tl('上次选择的节点（临时保留）', 'Previously selected node (temporarily kept)'),
        },
        ...serverNodes,
      ]
    : serverNodes;
  const favoriteServerNode =
    temporaryServerNode ||
    (privateServerConfig.usePrivateServer
      ? privateServerConfig.privateEasytierServer
      : selectedServerNode === 'custom'
        ? selectedCustomServer
        : selectedServerNode);
  const favoriteSignalingServer =
    temporarySignalingServer ||
    (privateServerConfig.usePrivateServer
      ? privateServerConfig.privateSignalingServer
      : selectedServerNode === 'custom'
        ? selectedCustomSignaling
        : undefined);
  // 节点延迟测试结果：value -> 延迟(ms) | null(不可达) | 'testing'(测速中)
  const [nodeLatencies, setNodeLatencies] = useState<Record<string, number | null | 'testing'>>({});
  const [testingNodes, setTestingNodes] = useState(false);

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

  // 语言切换时重算服务器节点下拉的标签
  useEffect(() => {
    setServerNodes(getServerNodes(customNodes));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i18n.language, customNodes]);

  // 一键随机生成大厅名称和密码
  const handleRandomGenerate = () => {
    const lobbyName = generateRandomLobbyName();
    const password = generateRandomPassword();

    form.setFieldsValue({
      lobbyName,
      password,
    });

    message.success(tl('已随机生成大厅名称和密码', 'Random lobby name and password generated'));
  };

  const applyImportedLobby = (
    invite: LobbyInvite & { playerName?: string; useDomain?: boolean }
  ) => {
    const rawServerNode = invite.serverNode?.trim() || undefined;
    const legacyCustomSentinel = rawServerNode === 'custom';
    const serverNode = legacyCustomSentinel
      ? undefined
      : rawServerNode && isSafeServerNode(rawServerNode)
        ? rawServerNode
        : undefined;
    const rawSignalingServer = invite.signalingServer?.trim() || undefined;
    const signalingServer =
      rawSignalingServer && isSafeSignalingServer(rawSignalingServer)
        ? rawSignalingServer
        : undefined;
    setTemporaryServerNode(serverNode);
    setTemporarySignalingServer(serverNode ? signalingServer : undefined);
    setShowCustomServer(legacyCustomSentinel ? true : false);
    form.setFieldsValue({
      lobbyName: invite.name,
      password: invite.password,
      playerName: invite.playerName || config.playerName || '',
      useDomain: invite.useDomain ?? false,
      ...(legacyCustomSentinel ? { serverNode: 'custom' } : serverNode ? { serverNode } : {}),
    });
  };

  // 处理选择常用大厅
  const handleSelectFavorite = (lobby: FavoriteLobby) => {
    applyImportedLobby({
      name: lobby.name,
      password: '',
      playerName: lobby.playerName,
      useDomain: lobby.useDomain,
      serverNode: lobby.serverNode,
      signalingServer: lobby.signalingServer,
    });
  };

  // 处理选择最近大厅（快速重进）
  const handleSelectRecent = (lobby: RecentLobby) => {
    applyImportedLobby({
      name: lobby.name,
      password: '',
      playerName: lobby.playerName,
      useDomain: lobby.useDomain,
      serverNode: lobby.serverNode,
      signalingServer: lobby.signalingServer,
    });
  };

  // 从公开广场加入：公开大厅必须无密码，直接填入空密码。
  const handleSelectPublic = (lobby: PublicLobby) => {
    const hostNode = (lobby.serverNode || '').trim();
    applyImportedLobby({
      name: lobby.lobbyName,
      password: '',
      serverNode: hostNode || undefined,
      signalingServer: hostNode ? 'wss://test.pmhs.top' : undefined,
    });
    message.info(
      hostNode
        ? tl(
            '已填入公开大厅信息并同步房主节点，点击加入即可',
            'Public lobby info filled and host node synced, click Join'
          )
        : tl('已填入公开大厅信息，点击加入即可', 'Public lobby info filled, click Join')
    );
  };

  // 解析上次成功使用的首选节点（#10 记住上次成功进入大厅的节点）
  const resolvedPreferredServer = (() => {
    const pref = config.preferredServer;
    if (!pref) return DEFAULT_EASYTIER_SERVER;
    if (pref === 'custom') return 'custom';
    // 旧版官方节点地址自动迁移到当前官方节点
    if (isLegacyOfficialServer(pref) || pref === REMOVED_QINGYUN_NODE)
      return DEFAULT_EASYTIER_SERVER;
    // 直接使用上次成功连上的节点地址（官方/备用/自定义节点）
    return isSafeServerNode(pref) ? pref : DEFAULT_EASYTIER_SERVER;
  })();

  const initialValues: Partial<LobbyFormValues> = {
    playerName: config.playerName || '',
    serverNode: resolvedPreferredServer,
    // 不设置 useDomain 的初始值，让 Switch 组件自己管理状态（默认为 false）
  };

  const handleServerNodeChange = (value: string) => {
    setTemporaryServerNode(undefined);
    setTemporarySignalingServer(undefined);
    setShowCustomServer(value === 'custom');
    useAppStore.getState().updateConfig({ preferredServer: value });

    const generation = ++preferredServerSaveGeneration.current;
    void (async () => {
      try {
        const currentConfig = await invoke<UserConfig>('get_config');
        if (preferredServerSaveGeneration.current !== generation) return;
        await invoke('update_config', {
          config: { ...currentConfig, preferredServer: value },
        });
      } catch (error) {
        console.warn('保存首选节点失败:', error);
      }
    })();
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
          privateEasytierServer: isSafeServerNode(settings.privateEasytierServer)
            ? settings.privateEasytierServer
            : 'udp://us01.225284.xyz:11010',
          privateSignalingServer: isSafeSignalingServer(settings.privateSignalingServer)
            ? settings.privateSignalingServer
            : 'wss://test.pmhs.top',
        });

        // 加载自定义节点
        const nodes = Array.isArray(settings.customEasytierNodes)
          ? settings.customEasytierNodes.filter((node: unknown): node is CustomEasyTierNode => {
              if (!node || typeof node !== 'object') return false;
              const candidate = node as Partial<CustomEasyTierNode>;
              return typeof candidate.name === 'string' && typeof candidate.address === 'string';
            })
          : [];
        setCustomNodes(nodes);
        setServerNodes(getServerNodes(nodes));

        console.log('已加载私有服务器配置和自定义节点');
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

  // 检测邀请 deep link 预填（仅填表，不自动提交）
  useEffect(() => {
    const apply = () => {
      const dl = (window as any).__deepLinkConfig;
      if (!dl) return;
      delete (window as any).__deepLinkConfig;
      applyImportedLobby({
        name: dl.lobbyName ?? '',
        password: dl.password ?? '',
        serverNode: dl.serverNode,
        signalingServer: dl.signalingServer,
      });
    };
    apply();
    const onDeepLink = () => apply();
    window.addEventListener('mctier-deep-link', onDeepLink as EventListener);
    return () => window.removeEventListener('mctier-deep-link', onDeepLink as EventListener);
  }, [form, config.playerName]);

  // 从剪贴板识别大厅信息的函数
  const recognizeClipboard = async (isAuto = false) => {
    try {
      const clipboardText = await readText();
      if (!clipboardText) {
        // 只在手动识别时提示剪贴板为空
        if (!isAuto) {
          message.info(tl('剪贴板为空', 'Clipboard is empty'));
        }
        return;
      }

      const invite = parseLobbyInviteText(clipboardText);
      if (
        invite &&
        invite.name.length >= 4 &&
        (invite.password.length === 0 || invite.password.length >= 8)
      ) {
        applyImportedLobby(invite);
        message.success(
          invite.serverNode
            ? tl(
                '已识别大厅信息并同步本次连接节点',
                'Lobby info and its connection node were detected'
              )
            : tl('已自动识别并填写大厅信息', 'Lobby info auto-detected and filled')
        );
        return;
      }

      // 如果没有匹配到任何格式，只在手动识别时提示
      if (!isAuto) {
        message.warning(
          tl('剪贴板中没有识别到有效的大厅信息', 'No valid lobby info found in clipboard')
        );
      }
    } catch (error) {
      // 静默失败，不影响用户体验
      console.log('无法读取剪贴板或格式不匹配:', error);
      // 只在手动识别时显示错误提示
      if (!isAuto) {
        message.error(
          tl('读取剪贴板失败，请检查权限', 'Failed to read clipboard, check permissions')
        );
      }
    }
  };

  // 测试所有内置节点的延迟，并自动选中延迟最低的可达节点
  const handleTestNodes = async () => {
    if (testingNodes || privateServerConfig.usePrivateServer) return;
    // 待测节点：内置/自定义节点（排除"临时自定义"占位项）
    const candidates = serverNodes.filter((n) => n.value !== 'custom');
    if (candidates.length === 0) return;

    setTestingNodes(true);
    // 全部标记为测速中
    setNodeLatencies(() => {
      const init: Record<string, number | null | 'testing'> = {};
      candidates.forEach((n) => {
        init[n.value] = 'testing';
      });
      return init;
    });

    try {
      const results = await Promise.all(
        candidates.map(async (n) => {
          try {
            const r = await invoke<{
              address: string;
              reachable: boolean;
              latency_ms: number | null;
            }>('test_node_latency', { address: n.value });
            return { value: n.value, latency: r.reachable ? (r.latency_ms ?? null) : null };
          } catch {
            return { value: n.value, latency: null };
          }
        })
      );

      const map: Record<string, number | null | 'testing'> = {};
      results.forEach((r) => {
        map[r.value] = r.latency;
      });
      setNodeLatencies(map);

      // 自动选中延迟最低的可达节点
      const reachable = results
        .filter((r) => typeof r.latency === 'number')
        .sort((a, b) => (a.latency as number) - (b.latency as number));
      if (reachable.length > 0) {
        const best = reachable[0];
        form.setFieldsValue({ serverNode: best.value });
        handleServerNodeChange(best.value);
        const bestLabel = candidates.find((n) => n.value === best.value)?.label ?? best.value;
        message.success(
          tl(
            `已自动选择延迟最低的节点：${bestLabel}（${best.latency}ms）`,
            `Auto-selected the lowest-latency node: ${bestLabel} (${best.latency}ms)`
          )
        );
      } else {
        message.warning(
          tl(
            '所有节点均不可达，请检查网络或稍后重试',
            'All nodes unreachable, check your network or retry later'
          )
        );
      }
    } finally {
      setTestingNodes(false);
    }
  };

  const handleSubmit = async (values: LobbyFormValues, overrideNode?: string) => {
    // 记录本次实际尝试的节点选择，便于失败时提供「换节点重试」
    const failedNodeValue = overrideNode ?? values.serverNode;
    let sessionTicket: LobbySessionTicket | null = null;
    try {
      setLoading(true);
      setAppState('connecting');

      // 验证输入
      if (!values.lobbyName?.trim()) {
        message.error(tl('大厅名称不能为空', 'Lobby name cannot be empty'));
        return;
      }
      if (!values.playerName?.trim()) {
        message.error(tl('玩家名称不能为空', 'Player name cannot be empty'));
        return;
      }

      // 确定实际使用的服务器地址
      let serverNode = values.serverNode;
      let signalingServer = 'wss://test.pmhs.top'; // 默认官方信令服务器
      const usingImportedEndpoint = Boolean(
        temporaryServerNode && values.serverNode === temporaryServerNode && !overrideNode
      );

      if (overrideNode) {
        // 一键换节点重试：强制使用指定的内置节点（官方信令服务器）
        serverNode = overrideNode;
        signalingServer = 'wss://test.pmhs.top';
        console.log('========================================');
        console.log('🔁 一键换节点重试，使用节点:', serverNode);
        console.log('========================================');
      } else if (usingImportedEndpoint && temporaryServerNode) {
        serverNode = temporaryServerNode;
        signalingServer = temporarySignalingServer || 'wss://test.pmhs.top';
        console.log('使用大厅邀请指定的临时连接节点:', serverNode);
      } else if (privateServerConfig.usePrivateServer) {
        // 如果启用了私有服务器，使用私有服务器配置（不添加默认备用节点）
        serverNode = privateServerConfig.privateEasytierServer;
        signalingServer = privateServerConfig.privateSignalingServer;
        console.log('========================================');
        console.log('✅ 使用私有服务器配置（不添加默认备用节点）');
        console.log('  EasyTier 节点服务器:', serverNode);
        console.log('  信令服务器:', signalingServer);
        console.log('========================================');
      } else if (values.serverNode === 'custom') {
        // 使用临时自定义服务器（不添加默认备用节点）
        if (!values.customEasytierServer?.trim()) {
          message.error(
            tl('请输入 EasyTier 节点服务器地址', 'Enter the EasyTier node server address')
          );
          return;
        }
        if (!values.customSignalingServer?.trim()) {
          message.error(tl('请输入信令服务器地址', 'Enter the signaling server address'));
          return;
        }
        serverNode = values.customEasytierServer.trim();
        signalingServer = values.customSignalingServer.trim();
        console.log('========================================');
        console.log('✅ 使用临时自定义服务器（不添加默认备用节点）');
        console.log('  EasyTier 节点服务器:', serverNode);
        console.log('  信令服务器:', signalingServer);
        console.log('========================================');
      } else {
        // 使用官方服务器或自定义节点（单节点模式）
        serverNode = values.serverNode;
        console.log('========================================');
        console.log('✅ 使用单节点模式');
        console.log('  EasyTier 节点服务器:', serverNode);
        console.log('  信令服务器:', signalingServer);
        console.log('========================================');
      }

      if (
        !isSafeServerNode(serverNode) ||
        serverNode === 'custom' ||
        !isSafeSignalingServer(signalingServer)
      ) {
        message.error(
          tl('服务器地址无效，请检查后重试', 'Invalid server address. Check it and retry.')
        );
        return;
      }

      const commandName = mode === 'create' ? 'create_lobby' : 'join_lobby';
      sessionTicket = lobbySessionCoordinator.begin();

      // 记录本次实际使用的节点地址，供公开广场发布时同步给加入者
      try {
        localStorage.setItem('mctier_current_node', serverNode);
        localStorage.setItem('mctier_current_signaling_server', signalingServer);
      } catch {
        /* ignore */
      }

      const identity = await prepareSignalingIdentity();
      lobbySessionCoordinator.assertCurrent(sessionTicket);
      const currentPlayerId = identity.clientId;
      useAppStore.getState().setCurrentPlayerId(currentPlayerId);

      console.log('准备调用后端命令:', commandName);
      console.log('连接参数已通过前端校验');

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
      if (!lobbySessionCoordinator.isCurrent(sessionTicket)) {
        try {
          await invoke('leave_lobby');
        } catch {
          await invoke('force_stop_easytier').catch(() => undefined);
        }
        return;
      }

      console.log('✅ 后端命令调用成功，已收到大厅信息:', {
        hasLobby: !!lobby,
        lobbyName: lobby?.name,
        hasPassword: !!lobby?.password,
      });

      // 保存玩家名称到前端store
      const { updateConfig } = useAppStore.getState();
      updateConfig({ playerName: values.playerName.trim() });

      // 【新增】把本次成功连上的节点记为下次默认首选节点
      // 仅在非私有服务器场景下记录（私有服务器是独立设置，不覆盖）
      // - 临时自定义节点记为 'custom' 哨兵值，保持与现有逻辑一致
      // - 其它情况记录实际节点地址（含一键换节点重试时使用的节点）
      const preferredToSave: string | undefined =
        privateServerConfig.usePrivateServer || usingImportedEndpoint
          ? undefined
          : (overrideNode ?? values.serverNode);
      if (preferredToSave) {
        updateConfig({ preferredServer: preferredToSave });
      }

      // 保存玩家名称（及首选节点）到后端配置文件
      try {
        const currentConfig = await invoke<UserConfig>('get_config');
        await invoke('update_config', {
          config: {
            ...currentConfig,
            playerName: values.playerName.trim(),
            ...(preferredToSave ? { preferredServer: preferredToSave } : {}),
          },
        });
        console.log(
          '玩家名称已保存到配置文件',
          preferredToSave ? `，首选节点: ${preferredToSave}` : ''
        );
      } catch (error) {
        console.warn('保存玩家名称到配置文件失败:', error);
      }

      // 注意：HTTP文件服务器采用按需启动策略
      // 只在第一次添加共享文件夹时才启动，这里不需要检查或启动
      console.log('✅ 大厅创建/加入成功，HTTP文件服务器将在添加共享时按需启动');

      // 更新状态
      setLobby({ ...lobby, serverNode, signalingServer });
      setAppState('in-lobby');

      // 记录到"最近大厅"，便于下次快速重进
      try {
        recentService.recordLobby({
          name: values.lobbyName.trim(),
          playerName: values.playerName.trim(),
          useDomain: values.useDomain === true,
          serverNode,
          signalingServer,
        });
      } catch (e) {
        console.warn('记录最近大厅失败（忽略）:', e);
      }

      // 数据统计：记录会话开始与身份（房主/成员）
      try {
        statsService.startSession(mode === 'create');
      } catch (e) {
        console.warn('记录统计会话失败（忽略）:', e);
      }

      message.success(
        mode === 'create'
          ? tl('大厅创建成功！', 'Lobby created!')
          : tl('成功加入大厅！', 'Joined the lobby!')
      );

      // 关闭表单
      onClose();
    } catch (error) {
      if (
        sessionTicket?.signal.aborted ||
        (error instanceof DOMException && error.name === 'AbortError')
      ) {
        return;
      }
      if (sessionTicket) lobbySessionCoordinator.cancel(sessionTicket);
      console.error('操作失败:', error);
      console.error('错误详情:', JSON.stringify(error, null, 2));
      setAppState('error');

      // 提取详细的错误信息
      let errorMessage = tl('操作失败，请重试', 'Operation failed, please retry');

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
          title: tl('权限不足', 'Insufficient permissions'),
          content: (
            <div>
              <p style={{ marginBottom: '12px' }}>
                {tl(
                  'MCTier 需要管理员权限来创建虚拟网卡。',
                  'MCTier needs administrator rights to create the virtual adapter.'
                )}
              </p>
            </div>
          ),
          okText: tl('我知道了', 'Got it'),
          centered: true,
        });
      } else if (isVersionError) {
        // 显示版本更新提示
        Modal.warning({
          title: tl('需要更新', 'Update required'),
          content: (
            <div style={{ lineHeight: '1.8' }}>
              <p style={{ marginBottom: '12px', color: 'rgba(255,255,255,0.9)' }}>{errorMessage}</p>
              <p style={{ marginBottom: '8px', color: 'rgba(255,255,255,0.7)' }}>
                {tl(
                  '请访问 MCTier 官网下载最新版本',
                  'Please visit the MCTier website to download the latest version'
                )}
              </p>
            </div>
          ),
          okText: tl('前往官网', 'Go to Website'),
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
        // 网络/进程类错误：若当前不是私有服务器、也不是临时自定义节点，
        // 则提供「一键切换到其它内置节点并重试」的按钮
        const canSwitchNode = !privateServerConfig.usePrivateServer && failedNodeValue !== 'custom';
        const candidateNodes = serverNodes.filter(
          (n) => n.value !== 'custom' && n.value !== failedNodeValue
        );

        if (canSwitchNode && candidateNodes.length > 0) {
          const guidance = (
            <div
              style={{
                fontSize: '12px',
                color: 'rgba(255,255,255,0.55)',
                lineHeight: '1.7',
                marginTop: '8px',
              }}
            >
              {tl(
                '当前节点连接失败，可点击下方按钮换一个节点重试，或：',
                'This node failed to connect. Click a button below to try another node, or:'
              )}
              <br />
              {tl('1. 以管理员身份运行 MCTier', '1. Run MCTier as administrator')}
              <br />
              {tl(
                '2. 将 MCTier 加入杀毒软件 / 防火墙白名单',
                '2. Add MCTier to your antivirus / firewall whitelist'
              )}
              <br />
              {tl(
                '3. 改用家庭 WiFi，避免校园网、手机流量或热点',
                '3. Use home WiFi; avoid campus networks, mobile data or hotspots'
              )}
            </div>
          );

          Modal.error({
            title:
              mode === 'create'
                ? tl('创建大厅失败', 'Failed to create lobby')
                : tl('加入大厅失败', 'Failed to join lobby'),
            centered: true,
            okText: tl('关闭', 'Close'),
            content: (
              <div>
                <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.85)' }}>
                  {errorMessage}
                </div>
                {guidance}
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                    marginTop: '14px',
                  }}
                >
                  {candidateNodes.map((node) => (
                    <Button
                      key={node.value}
                      type="primary"
                      block
                      onClick={() => {
                        Modal.destroyAll();
                        // 同步下拉框显示，并以该节点重试
                        form.setFieldsValue({ serverNode: node.value });
                        handleServerNodeChange(node.value);
                        const latestValues = {
                          ...form.getFieldsValue(),
                          serverNode: node.value,
                        } as LobbyFormValues;
                        handleSubmit(latestValues, node.value);
                      }}
                    >
                      {tl('切换到', 'Switch to')}「{node.label}」{tl('并重试', 'and retry')}
                    </Button>
                  ))}
                </div>
              </div>
            ),
          });
        } else {
          // 私有服务器 / 临时自定义节点：仅展示错误与通用引导
          message.error({
            content: (
              <div>
                <div style={{ fontWeight: 'bold', marginBottom: '8px' }}>
                  {mode === 'create'
                    ? tl('创建大厅失败', 'Failed to create lobby')
                    : tl('加入大厅失败', 'Failed to join lobby')}
                </div>
                <div
                  style={{ fontSize: '12px', color: 'rgba(255,255,255,0.7)', marginBottom: '8px' }}
                >
                  {errorMessage}
                </div>
                <div
                  style={{ fontSize: '12px', color: 'rgba(255,255,255,0.55)', lineHeight: '1.7' }}
                >
                  {tl('可尝试：', 'You can try:')}
                  <br />
                  {tl(
                    '1. 以管理员身份运行 MCTier（创建虚拟网卡需要管理员权限）',
                    '1. Run MCTier as administrator (creating the virtual adapter needs admin rights)'
                  )}
                  <br />
                  {tl(
                    '2. 将 MCTier 加入杀毒软件 / 防火墙白名单后重试',
                    '2. Add MCTier to your antivirus / firewall whitelist and retry'
                  )}
                  <br />
                  {tl(
                    '3. 检查私有服务器 / 自定义节点地址是否正确、可达',
                    '3. Check that the private server / custom node address is correct and reachable'
                  )}
                  <br />
                  {tl(
                    '4. 改用家庭 WiFi，避免校园网、手机热点等受限网络',
                    '4. Use home WiFi; avoid restricted networks like campus networks or hotspots'
                  )}
                </div>
              </div>
            ),
            duration: 10,
          });
        }
      }
    } finally {
      const currentSession = lobbySessionCoordinator.current();
      if (
        !sessionTicket ||
        !currentSession ||
        currentSession.generation === sessionTicket.generation
      ) {
        setLoading(false);
      }
    }
  };

  const handleCancel = () => {
    lobbySessionCoordinator.cancel();
    setAppState('idle');
    onClose();
  };

  // 【#4】创建/加入过程中强制手动停止：杀掉 EasyTier 进程，
  // 后端 create_lobby/join_lobby 会因进程被终止而返回错误，从而解除阻塞
  const [forceStopping, setForceStopping] = useState(false);
  const handleForceStop = async () => {
    if (forceStopping) return;
    setForceStopping(true);
    try {
      message.info(tl('正在强制停止…', 'Force stopping...'));
      await invoke('cancel_lobby_connecting');
    } catch (e) {
      console.warn('强制停止时出错（忽略）:', e);
    } finally {
      setLoading(false);
      setForceStopping(false);
      setAppState('idle');
      message.success(tl('已停止本次操作', 'Operation stopped'));
    }
  };

  const serverNodeOptions = availableServerNodes.map((node) => {
    const latency = nodeLatencies[node.value];
    let suffix = '';
    if (node.value !== 'custom') {
      if (latency === 'testing') suffix = tl(' · 测速中…', ' · testing…');
      else if (typeof latency === 'number') suffix = ` · ${latency}ms`;
      else if (latency === null) suffix = tl(' · 不可达', ' · unreachable');
    }
    return { value: node.value, label: `${node.label}${suffix}` };
  });

  return (
    <div className="lobby-form-container" data-tauri-drag-region>
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <Title level={2} className="lobby-form-title" style={{ margin: 0 }}>
              {mode === 'create' ? tl('创建大厅', 'Create Lobby') : tl('加入大厅', 'Join Lobby')}
            </Title>
            <div className="lobby-action-bar">
              {/* 常用信息列表按钮 */}
              <motion.button
                onClick={() => setShowFavoritesModal(true)}
                disabled={loading}
                title={tl('常用大厅信息', 'Favorite lobbies')}
                className="lobby-action-btn"
                whileHover={{ y: -2 }}
                whileTap={{ scale: 0.94 }}
              >
                <StarIcon size={18} />
                <span className="lobby-action-label">{tl('常用', 'Favorites')}</span>
              </motion.button>

              {/* 最近联机按钮 */}
              <motion.button
                onClick={() => setShowRecentModal(true)}
                disabled={loading}
                title={tl('最近联机（快速重进）', 'Recent (quick rejoin)')}
                className="lobby-action-btn"
                whileHover={{ y: -2 }}
                whileTap={{ scale: 0.94 }}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#FFFFFF"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="10"></circle>
                  <polyline points="12 6 12 12 16 14"></polyline>
                </svg>
                <span className="lobby-action-label">{tl('最近', 'Recent')}</span>
              </motion.button>

              {/* 公开广场按钮 */}
              <motion.button
                onClick={() => setShowPublicPlaza(true)}
                disabled={loading}
                title={tl('公开广场（浏览并加入公开大厅）', 'Public Plaza')}
                className="lobby-action-btn"
                whileHover={{ y: -2 }}
                whileTap={{ scale: 0.94 }}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#FFFFFF"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="2" y1="12" x2="22" y2="12"></line>
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
                </svg>
                <span className="lobby-action-label">{tl('广场', 'Plaza')}</span>
              </motion.button>

              {mode === 'create' ? (
                <motion.button
                  onClick={handleRandomGenerate}
                  disabled={loading}
                  title={tl('随机生成大厅名称和密码', 'Generate random name and password')}
                  className="lobby-action-btn"
                  whileHover={{ y: -2 }}
                  whileTap={{ scale: 0.94 }}
                >
                  <DiceIcon size={20} />
                  <span className="lobby-action-label">{tl('随机', 'Random')}</span>
                </motion.button>
              ) : (
                <motion.button
                  onClick={() => recognizeClipboard(false)}
                  disabled={loading}
                  title={tl('识别剪贴板中的大厅信息', 'Detect lobby info from clipboard')}
                  className="lobby-action-btn"
                  whileHover={{ y: -2 }}
                  whileTap={{ scale: 0.94 }}
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#FFFFFF"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
                    <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
                    <line x1="9" y1="12" x2="15" y2="12" />
                    <line x1="9" y1="16" x2="15" y2="16" />
                  </svg>
                  <span className="lobby-action-label">{tl('识别', 'Detect')}</span>
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
              label={tl('大厅名称', 'Lobby Name')}
              name="lobbyName"
              rules={[
                { required: true, message: tl('请输入大厅名称', 'Please enter a lobby name') },
                {
                  whitespace: true,
                  message: tl('大厅名称不能为空白字符', 'Lobby name cannot be only whitespace'),
                },
                {
                  min: 4,
                  max: 32,
                  message: tl('大厅名称长度为 4-32 个字符', 'Lobby name must be 4-32 characters'),
                },
                {
                  pattern: /^[\u4e00-\u9fa5a-zA-Z0-9_\-\s]+$/,
                  message: tl(
                    '大厅名称只能包含中文、字母、数字、下划线、连字符和空格',
                    'Only Chinese, letters, digits, underscores, hyphens and spaces allowed'
                  ),
                },
                {
                  validator: (_, value) => {
                    if (!value) return Promise.resolve();
                    const hasAlphanumeric = /[a-zA-Z0-9\u4e00-\u9fa5]/.test(value);
                    if (!hasAlphanumeric) {
                      return Promise.reject(
                        new Error(
                          tl(
                            '大厅名称必须包含至少一个字母或数字',
                            'Lobby name must contain at least one letter or digit'
                          )
                        )
                      );
                    }
                    return Promise.resolve();
                  },
                },
              ]}
            >
              <Input
                placeholder={
                  mode === 'create'
                    ? tl('输入大厅名称（至少4个字符）', 'Enter a lobby name (min 4 chars)')
                    : tl('输入要加入的大厅名称', 'Enter the lobby name to join')
                }
                size="large"
                disabled={loading}
                autoComplete="off"
                spellCheck={false}
                onChange={() => {
                  setTemporaryServerNode(undefined);
                  setTemporarySignalingServer(undefined);
                }}
              />
            </Form.Item>

            <Form.Item
              label={tl('密码', 'Password')}
              name="password"
              rules={[
                {
                  validator: (_, value) => {
                    if (!value) return Promise.resolve();
                    if (value.trim() !== value || value.length < 8 || value.length > 32) {
                      return Promise.reject(
                        new Error(
                          tl(
                            '密码留空表示无密码，否则必须为 8-32 个字符',
                            'Leave blank for no password; otherwise use 8-32 characters'
                          )
                        )
                      );
                    }
                    const hasLetter = /[a-zA-Z]/.test(value);
                    const hasDigit = /[0-9]/.test(value);
                    if (!hasLetter) {
                      return Promise.reject(
                        new Error(
                          tl(
                            '密码必须包含至少一个字母',
                            'Password must contain at least one letter'
                          )
                        )
                      );
                    }
                    if (!hasDigit) {
                      return Promise.reject(
                        new Error(
                          tl('密码必须包含至少一个数字', 'Password must contain at least one digit')
                        )
                      );
                    }
                    return Promise.resolve();
                  },
                },
              ]}
            >
              <PasswordInput
                placeholder={tl(
                  '留空创建无密码大厅，或输入 8-32 位密码',
                  'Leave blank for no password, or enter 8-32 characters'
                )}
                size="large"
                disabled={loading}
                autoComplete="new-password"
                spellCheck={false}
              />
            </Form.Item>

            <Form.Item
              label={tl('玩家名称', 'Player Name')}
              name="playerName"
              rules={[
                { required: true, message: tl('请输入玩家名称', 'Please enter a player name') },
                {
                  whitespace: true,
                  message: tl('玩家名称不能为空白字符', 'Player name cannot be only whitespace'),
                },
                {
                  min: 1,
                  max: 8,
                  message: tl('玩家名称长度为 1-8 个字', 'Player name must be 1-8 characters'),
                },
              ]}
            >
              <Input
                placeholder={tl('输入你的玩家名称（最多8个字）', 'Your player name (max 8 chars)')}
                size="large"
                disabled={loading}
                maxLength={8}
                autoComplete="off"
                spellCheck={false}
              />
            </Form.Item>

            {!privateServerConfig.usePrivateServer && (
              <>
                <Form.Item
                  className="server-node-form-item"
                  label={tl('服务器节点', 'Server Node')}
                  name="serverNode"
                  rules={[
                    {
                      required: true,
                      message: tl('请选择服务器节点', 'Please select a server node'),
                    },
                  ]}
                  extra={
                    <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12 }}>
                      {temporaryServerNode
                        ? tl(
                            '此节点仅用于本次加入，不会修改默认节点',
                            'Used for this join only; your default node is unchanged'
                          )
                        : tl('双方需选同一节点', 'Both must pick the same node')}
                    </span>
                  }
                >
                  <ServerNodeSelect
                    options={serverNodeOptions}
                    disabled={loading}
                    ariaLabel={tl('服务器节点', 'Server Node')}
                    onChange={handleServerNodeChange}
                  />
                </Form.Item>

                <div style={{ marginTop: '-8px', marginBottom: '12px', textAlign: 'right' }}>
                  <Button
                    size="small"
                    type="primary"
                    onClick={handleTestNodes}
                    loading={testingNodes}
                    disabled={loading}
                  >
                    {tl('一键使用最优节点', 'Use the best node')}
                  </Button>
                </div>
              </>
            )}

            {showCustomServer && !privateServerConfig.usePrivateServer && (
              <>
                <Form.Item
                  label={tl('临时 EasyTier 节点服务器', 'Temporary EasyTier node server')}
                  name="customEasytierServer"
                  rules={[
                    {
                      required: true,
                      message: tl(
                        '请输入 EasyTier 节点服务器地址',
                        'Please enter the EasyTier node server address'
                      ),
                    },
                    {
                      pattern: /^(tcp|udp|ws|wss|txt):\/\/.+$/,
                      message: tl(
                        '格式：tcp://、udp://、ws://、wss:// 或 txt:// 开头',
                        'Format: starts with tcp://, udp://, ws://, wss:// or txt://'
                      ),
                    },
                  ]}
                >
                  <Input
                    placeholder={tl(
                      '例如：udp://us01.225284.xyz:11010 或 wss://your-server.com',
                      'e.g. udp://us01.225284.xyz:11010 or wss://your-server.com'
                    )}
                    size="large"
                    disabled={loading}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </Form.Item>
                <Form.Item
                  label={tl('临时 WebRTC 信令服务器', 'Temporary WebRTC signaling server')}
                  name="customSignalingServer"
                  rules={[
                    {
                      required: true,
                      message: tl(
                        '请输入信令服务器地址',
                        'Please enter the signaling server address'
                      ),
                    },
                    {
                      pattern: /^wss?:\/\/.+$/,
                      message: tl(
                        '格式：ws://域名/path 或 wss://域名/path',
                        'Format: ws://host/path or wss://host/path'
                      ),
                    },
                  ]}
                >
                  <Input
                    placeholder={tl(
                      '例如：wss://test.pmhs.top',
                      'e.g. wss://test.pmhs.top'
                    )}
                    size="large"
                    disabled={loading}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </Form.Item>
              </>
            )}

            {privateServerConfig.usePrivateServer && (
              <div
                style={{
                  padding: '12px',
                  background: 'rgba(126, 211, 33, 0.1)',
                  border: '1px solid rgba(126, 211, 33, 0.3)',
                  borderRadius: '8px',
                  marginBottom: '16px',
                }}
              >
                <div
                  style={{
                    fontSize: '14px',
                    color: 'rgba(126, 211, 33, 0.9)',
                    marginBottom: '8px',
                  }}
                >
                  ✓ {tl('已启用私有服务器', 'Private server enabled')}
                </div>
                <div
                  style={{
                    fontSize: '12px',
                    color: 'rgba(255, 255, 255, 0.6)',
                    wordBreak: 'break-all',
                    lineHeight: 1.9,
                  }}
                >
                  EasyTier: {privateServerConfig.privateEasytierServer}
                  <br />
                  {tl('信令服务器: ', 'Signaling: ')}
                  {privateServerConfig.privateSignalingServer}
                </div>
              </div>
            )}

            <Form.Item
              label={tl('使用虚拟域名', 'Use virtual domain')}
              name="useDomain"
              valuePropName="checked"
              tooltip={tl(
                '开启后，您的虚拟IP将显示为域名格式，便于记忆与访问',
                'When enabled, your virtual IP is shown as a domain name for easier access'
              )}
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
                    className={loading ? 'force-stop-btn' : ''}
                    onClick={loading ? handleForceStop : handleCancel}
                    loading={forceStopping}
                    block
                  >
                    {loading ? tl('强制停止', 'Force Stop') : tl('取消', 'Cancel')}
                  </Button>
                </motion.div>
                <motion.div
                  style={{ flex: 1 }}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <Button type="primary" size="large" htmlType="submit" loading={loading} block>
                    {mode === 'create' ? tl('创建', 'Create') : tl('加入', 'Join')}
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
            <div className="network-tip-title">{tl('重要提示', 'Important')}</div>
            <div className="network-tip-text">
              <strong>{tl('网络环境：', 'Network: ')}</strong>
              {tl(
                '本软件使用纯 P2P 方式连接，为确保联机成功：',
                'This app connects purely via P2P. For a successful connection:'
              )}
              <br />
              {tl('✓ 推荐使用家庭 WiFi 网络', '✓ Home WiFi is recommended')}
              <br />
              {tl(
                '✗ 不建议使用校园网、手机流量或热点',
                '✗ Campus networks, mobile data or hotspots are not recommended'
              )}
              <br />
              <br />
              <strong>{tl('虚拟域名：', 'Virtual domain: ')}</strong>
              {tl(
                '虚拟域名仅能用于访问网站使用，Minecraft 多人游戏不支持使用虚拟域名。加入 Minecraft 服务器时，请使用虚拟IP+端口号（例如：10.126.126.1:25565）',
                'Virtual domains only work for websites; Minecraft multiplayer does not support them. Use virtual IP + port (e.g. 10.126.126.1:25565) to join a server.'
              )}
              <br />
              <br />
              <strong>{tl('代理工具：', 'Proxy tools: ')}</strong>
              {tl(
                '使用虚拟域名功能时，请务必关闭代理工具（如梯子、VPN等），否则域名解析将失效',
                'When using virtual domains, turn off proxy tools (VPN, etc.) or domain resolution will fail.'
              )}
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
              transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 5v14M19 12l-7 7-7-7" />
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
        defaultServerNode={favoriteServerNode}
        defaultSignalingServer={favoriteSignalingServer}
      />

      {/* 最近联机弹窗 */}
      <RecentManager
        visible={showRecentModal}
        onClose={() => setShowRecentModal(false)}
        onSelectLobby={handleSelectRecent}
      />

      {/* 公开广场弹窗 */}
      <PublicPlaza
        visible={showPublicPlaza}
        onClose={() => setShowPublicPlaza(false)}
        onJoin={handleSelectPublic}
      />
    </div>
  );
};
