/**
 * 文件共享相关类型定义
 */

/**
 * 共享文件夹配置
 */
export interface SharedFolder {
  id: string; // 共享ID
  ownerId: string; // 所有者玩家ID
  ownerName: string; // 所有者玩家名称
  folderPath: string; // 本地文件夹路径
  folderName: string; // 文件夹名称
  hasPassword: boolean; // 是否有密码保护
  password?: string; // 密码（仅所有者可见）
  hasExpiry: boolean; // 是否有有效期
  expiryTime?: number; // 过期时间戳
  createdAt: number; // 创建时间
  fileCount: number; // 文件数量
  totalSize: number; // 总大小（字节）
}

/**
 * 文件/文件夹信息
 */
export interface FileInfo {
  name: string; // 文件/文件夹名称
  path: string; // 相对路径
  isDirectory: boolean; // 是否是文件夹
  is_directory?: boolean; // Rust后端返回的字段名（兼容）
  size: number; // 文件大小（字节）
  modifiedTime: number; // 修改时间
  modified_time?: number; // Rust后端返回的字段名（兼容）
}

/**
 * 文件传输请求
 */
export interface FileTransferRequest {
  requestId: string; // 请求ID
  shareId: string; // 共享ID
  ownerId: string; // 文件所有者ID
  requesterId: string; // 请求者ID
  requesterName: string; // 请求者名称
  filePath: string; // 文件路径
  fileName: string; // 文件名
  fileSize: number; // 文件大小
  timestamp: number; // 请求时间
}

/**
 * 文件传输进度
 */
export interface FileTransferProgress {
  requestId: string; // 请求ID
  fileName: string; // 文件名
  totalSize: number; // 总大小
  transferredSize: number; // 已传输大小
  progress: number; // 进度百分比 (0-100)
  speed: number; // 传输速度（字节/秒）
  status: 'pending' | 'transferring' | 'completed' | 'failed' | 'cancelled'; // 状态
  error?: string; // 错误信息
}

/**
 * 文件分块
 */
export interface FileChunk {
  requestId: string; // 请求ID
  chunkIndex: number; // 分块索引
  totalChunks: number; // 总分块数
  data: Uint8Array; // 分块数据
}

/**
 * 信令消息类型
 */
export interface FileShareSignalingMessage {
  type: 'share-list' | 'share-added' | 'share-removed' | 'share-updated' | 
        'file-list-request' | 'file-list-response' | 
        'file-transfer-request' | 'file-transfer-response' |
        'file-chunk' | 'file-transfer-complete' | 'file-transfer-error';
  from?: string;
  to?: string;
  shareId?: string;
  share?: SharedFolder;
  shares?: SharedFolder[];
  path?: string;
  password?: string;
  files?: FileInfo[];
  request?: FileTransferRequest;
  accepted?: boolean;
  chunk?: FileChunk;
  error?: string;
}
