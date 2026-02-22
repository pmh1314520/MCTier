/**
 * 文件共享类型定义
 * 基于 HTTP over WireGuard 的文件传输
 */

/**
 * 共享文件夹信息
 */
export interface SharedFolder {
  id: string;
  name: string;
  path: string;
  password?: string;
  expire_time?: number; // Unix timestamp
  compress_before_send?: boolean; // 是否启用"先压后发"策略
  owner_id: string;
  created_at: number;
}

/**
 * 文件信息
 */
export interface FileInfo {
  name: string;
  path: string; // 相对于共享文件夹的路径
  size: number;
  is_dir: boolean;
  modified: number;
}

/**
 * 下载任务
 */
export interface DownloadTask {
  id: string;
  share_id: string;
  file_path: string;
  file_name: string;
  file_size: number;
  downloaded: number;
  progress: number;
  speed: number;
  status: 'pending' | 'downloading' | 'completed' | 'failed' | 'cancelled';
  error?: string;
  save_path: string;
  peer_ip: string;
  started_at?: number;
  completed_at?: number;
}

/**
 * 玩家共享信息
 */
export interface PlayerShare {
  player_id: string;
  player_name: string;
  virtual_ip: string;
  shares: SharedFolder[];
}

/**
 * 远程共享（包含所有者信息）
 */
export interface RemoteShare {
  share: SharedFolder;
  owner_name: string;
  owner_ip: string;
}
