/**
 * MCTier 应用程序类型定义
 */

/**
 * 应用状态枚举
 */
export type AppState = 'idle' | 'connecting' | 'in-lobby' | 'error';

/**
 * 大厅信息
 */
export interface Lobby {
  /** 大厅 ID */
  id: string;
  /** 大厅名称 */
  name: string;
  /** 大厅密码（用于复制分享） */
  password?: string;
  /** 创建时间 */
  createdAt: string;
  /** 虚拟 IP 地址（当前玩家的） */
  virtualIp: string;
  /** 创建者的虚拟 IP 地址（用于连接 WebSocket 信令服务器） */
  creatorVirtualIp: string;
  /** 虚拟域名（如果配置了） */
  virtualDomain?: string;
  /** 是否使用域名访问 */
  useDomain?: boolean;
}

/**
 * 玩家信息
 */
export interface Player {
  /** 玩家 ID */
  id: string;
  /** 玩家名称 */
  name: string;
  /** 虚拟IP */
  virtualIp?: string;
  /** 虚拟域名 */
  virtualDomain?: string;
  /** 是否使用域名访问 */
  useDomain?: boolean;
  /** 麦克风是否开启 */
  micEnabled: boolean;
  /** 是否被静音 */
  isMuted: boolean;
  /** 加入时间 */
  joinedAt: string;
}

/**
 * 窗口位置信息
 */
export interface WindowPosition {
  /** X 坐标 */
  x: number;
  /** Y 坐标 */
  y: number;
  /** 宽度 */
  width?: number;
  /** 高度 */
  height?: number;
}

/**
 * 用户配置
 */
export interface UserConfig {
  /** 玩家名称 */
  playerName?: string;
  /** 首选服务器节点 */
  preferredServer?: string;
  /** 麦克风快捷键 */
  micHotkey?: string;
  /** 全局听筒快捷键 */
  globalMuteHotkey?: string;
  /** 窗口位置 */
  windowPosition?: WindowPosition;
  /** 音频设备 ID */
  audioDeviceId?: string;
  /** 窗口透明度 (0.0-1.0)，默认 0.95 */
  opacity?: number;
  /** 高级网络配置 */
  advancedNetwork?: AdvancedNetworkConfig;
}

/**
 * 音频设备信息
 */
export interface AudioDevice {
  /** 设备 ID */
  id: string;
  /** 设备名称 */
  name: string;
  /** 设备类型 */
  deviceType: 'microphone' | 'speaker';
}

/**
 * 连接状态
 */
export type ConnectionStatus =
  | { type: 'connected'; virtualIp: string }
  | { type: 'disconnected' }
  | { type: 'connecting' }
  | { type: 'error'; message: string };

/**
 * 聊天消息
 */
export interface ChatMessage {
  /** 消息ID */
  id: string;
  /** 发送者玩家ID */
  playerId: string;
  /** 发送者玩家名称 */
  playerName: string;
  /** 消息内容 */
  content: string;
  /** 发送时间戳 */
  timestamp: number;
  /** 消息类型 */
  type?: 'text' | 'image';
  /** 图片数据（Base64） */
  imageData?: string;
}

/**
 * 高级网络配置
 */
export interface AdvancedNetworkConfig {
  /** 虚拟域名 */
  virtualDomain?: string;
}

// 导出文件共享相关类型
export * from './fileShare';

/**
 * 屏幕共享信息
 */
export interface ScreenShare {
  /** 共享ID */
  id: string;
  /** 共享者玩家ID */
  playerId: string;
  /** 共享者玩家名称 */
  playerName: string;
  /** 共享者虚拟IP */
  virtualIp: string;
  /** 是否需要密码 */
  requirePassword: boolean;
  /** 密码（如果需要） */
  password?: string;
  /** 共享开始时间 */
  startTime: number;
  /** 共享状态 */
  status: 'active' | 'paused' | 'stopped';
  /** 正在查看的玩家ID（单人查看限制） */
  viewerId?: string;
  /** 正在查看的玩家名称 */
  viewerName?: string;
}
