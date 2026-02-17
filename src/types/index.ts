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
  /** 创建时间 */
  createdAt: string;
  /** 虚拟 IP 地址（当前玩家的） */
  virtualIp: string;
  /** 创建者的虚拟 IP 地址（用于连接 WebSocket 信令服务器） */
  creatorVirtualIp: string;
}

/**
 * 玩家信息
 */
export interface Player {
  /** 玩家 ID */
  id: string;
  /** 玩家名称 */
  name: string;
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
  /** 窗口位置 */
  windowPosition?: WindowPosition;
  /** 音频设备 ID */
  audioDeviceId?: string;
  /** 窗口透明度 (0.0-1.0)，默认 0.95 */
  opacity?: number;
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
