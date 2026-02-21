/**
 * 文件共享服务
 * 管理文件夹共享、文件列表获取等功能
 */

import { invoke } from '@tauri-apps/api/core';
import type { SharedFolder, FileInfo, FileShareSignalingMessage } from '../../types';

export class FileShareService {
  private sharedFolders: Map<string, SharedFolder> = new Map();
  private remoteShares: Map<string, SharedFolder> = new Map();
  private websocket: WebSocket | null = null;
  private localPlayerId: string = '';
  private localPlayerName: string = '';
  private expiryCheckInterval: number | null = null;
  
  // 事件回调
  private onShareAddedCallback?: (share: SharedFolder) => void;
  private onShareRemovedCallback?: (shareId: string) => void;
  private onShareUpdatedCallback?: (share: SharedFolder) => void;
  private onRemoteSharesChangedCallback?: (shares: SharedFolder[]) => void;

  /**
   * 初始化文件共享服务
   */
  initialize(playerId: string, playerName: string): void {
    console.log('🗂️ 初始化文件共享服务...');
    
    // 清理旧数据（防止跨大厅数据泄露）
    this.sharedFolders.clear();
    this.remoteShares.clear();
    console.log('✅ 已清理旧的文件共享数据');
    
    // 停止旧的定时器
    if (this.expiryCheckInterval) {
      window.clearInterval(this.expiryCheckInterval);
    }
    
    this.localPlayerId = playerId;
    this.localPlayerName = playerName;
    
    // 启动过期检查定时器（每10秒检查一次）
    this.startExpiryCheck();
    
    console.log('✅ 文件共享服务初始化完成');
  }
  
  /**
   * 设置WebSocket连接（由WebRTCClient调用）
   */
  setWebSocket(websocket: WebSocket): void {
    this.websocket = websocket;
  }

  /**
   * 添加共享文件夹
   */
  async addSharedFolder(
    folderPath: string,
    hasPassword: boolean,
    password: string | undefined,
    hasExpiry: boolean,
    expiryTime: number | undefined
  ): Promise<SharedFolder> {
    try {
      console.log('📁 添加共享文件夹:', folderPath);

      // 获取文件夹名称
      const folderName = await invoke<string>('get_folder_name', { path: folderPath });
      
      // 获取文件夹信息（文件数量和总大小）
      const folderInfo = await invoke<{ fileCount: number; totalSize: number }>('get_folder_info', {
        path: folderPath,
      });

      // 创建共享配置
      const share: SharedFolder = {
        id: `share-${Date.now()}-${this.localPlayerId}`,
        ownerId: this.localPlayerId,
        ownerName: this.localPlayerName,
        folderPath,
        folderName,
        hasPassword,
        password: hasPassword ? password : undefined,
        hasExpiry,
        expiryTime: hasExpiry ? expiryTime : undefined,
        createdAt: Date.now(),
        fileCount: folderInfo.fileCount,
        totalSize: folderInfo.totalSize,
      };

      // 保存到本地
      this.sharedFolders.set(share.id, share);

      // 广播到其他玩家（不包含密码）
      this.broadcastShareAdded(share);

      // 触发回调
      if (this.onShareAddedCallback) {
        this.onShareAddedCallback(share);
      }

      console.log('✅ 共享文件夹已添加:', share.folderName);
      return share;
    } catch (error) {
      console.error('❌ 添加共享文件夹失败:', error);
      throw new Error(`添加共享文件夹失败: ${error}`);
    }
  }

  /**
   * 移除共享文件夹
   */
  removeSharedFolder(shareId: string): void {
    try {
      console.log('🗑️ 移除共享文件夹:', shareId);

      const share = this.sharedFolders.get(shareId);
      if (!share) {
        console.warn('⚠️ 共享文件夹不存在:', shareId);
        return;
      }

      // 从本地删除
      this.sharedFolders.delete(shareId);

      // 广播到其他玩家
      this.broadcastShareRemoved(shareId);

      // 触发回调
      if (this.onShareRemovedCallback) {
        this.onShareRemovedCallback(shareId);
      }

      console.log('✅ 共享文件夹已移除');
    } catch (error) {
      console.error('❌ 移除共享文件夹失败:', error);
    }
  }

  /**
   * 更新共享文件夹配置
   */
  async updateSharedFolder(
    shareId: string,
    hasPassword: boolean,
    password: string | undefined,
    hasExpiry: boolean,
    expiryTime: number | undefined
  ): Promise<void> {
    try {
      console.log('✏️ 更新共享文件夹:', shareId);

      const share = this.sharedFolders.get(shareId);
      if (!share) {
        throw new Error('共享文件夹不存在');
      }

      // 更新配置
      share.hasPassword = hasPassword;
      share.password = hasPassword ? password : undefined;
      share.hasExpiry = hasExpiry;
      share.expiryTime = hasExpiry ? expiryTime : undefined;

      // 广播到其他玩家（不包含密码）
      this.broadcastShareUpdated(share);

      // 触发回调
      if (this.onShareUpdatedCallback) {
        this.onShareUpdatedCallback(share);
      }

      console.log('✅ 共享文件夹已更新');
    } catch (error) {
      console.error('❌ 更新共享文件夹失败:', error);
      throw error;
    }
  }

  /**
   * 获取本地共享列表
   */
  getLocalShares(): SharedFolder[] {
    return Array.from(this.sharedFolders.values());
  }
  
  /**
   * 获取本地共享列表（不包含密码，用于发送给其他玩家）
   */
  getLocalSharesForBroadcast(): SharedFolder[] {
    return Array.from(this.sharedFolders.values()).map(share => ({
      ...share,
      password: undefined,
    }));
  }

  /**
   * 获取远程共享列表
   */
  getRemoteShares(): SharedFolder[] {
    return Array.from(this.remoteShares.values());
  }

  /**
   * 获取文件列表
   */
  async getFileList(shareId: string, path: string, password?: string): Promise<FileInfo[]> {
    try {
      console.log('📋 获取文件列表:', shareId, path);

      // 检查是否是本地共享
      const localShare = this.sharedFolders.get(shareId);
      if (localShare) {
        // 本地共享，直接读取文件系统
        return await this.getLocalFileList(localShare, path);
      }

      // 远程共享，通过信令服务器请求
      const remoteShare = this.remoteShares.get(shareId);
      if (!remoteShare) {
        throw new Error('共享不存在');
      }

      // 检查密码
      if (remoteShare.hasPassword && !password) {
        throw new Error('需要密码');
      }

      // 发送文件列表请求
      return await this.requestRemoteFileList(remoteShare, path, password);
    } catch (error) {
      console.error('❌ 获取文件列表失败:', error);
      throw error;
    }
  }

  /**
   * 获取本地文件列表
   */
  private async getLocalFileList(share: SharedFolder, relativePath: string): Promise<FileInfo[]> {
    try {
      const fullPath = relativePath === '/' 
        ? share.folderPath 
        : `${share.folderPath}/${relativePath}`;

      const files = await invoke<FileInfo[]>('list_directory_files', {
        path: fullPath,
      });

      // 添加兼容字段，确保isDirectory字段存在
      return files.map(file => ({
        ...file,
        isDirectory: file.is_directory !== undefined ? file.is_directory : file.isDirectory,
      }));
    } catch (error) {
      console.error('❌ 获取本地文件列表失败:', error);
      throw error;
    }
  }

  /**
   * 请求远程文件列表
   */
  private async requestRemoteFileList(
    share: SharedFolder,
    path: string,
    password?: string
  ): Promise<FileInfo[]> {
    return new Promise((resolve, reject) => {
      if (!this.websocket) {
        reject(new Error('WebSocket未连接'));
        return;
      }

      // 设置超时
      const timeout = setTimeout(() => {
        reject(new Error('请求超时'));
      }, 10000);

      // 监听响应
      const handleMessage = (event: MessageEvent) => {
        try {
          const message: FileShareSignalingMessage = JSON.parse(event.data);
          
          if (message.type === 'file-list-response' && message.shareId === share.id) {
            clearTimeout(timeout);
            this.websocket?.removeEventListener('message', handleMessage);
            
            if (message.files) {
              // 添加兼容字段
              const filesWithCompat = message.files.map(file => ({
                ...file,
                isDirectory: file.is_directory !== undefined ? file.is_directory : file.isDirectory,
              }));
              resolve(filesWithCompat);
            } else if (message.error) {
              reject(new Error(message.error));
            }
          }
        } catch (error) {
          // 忽略解析错误
        }
      };

      this.websocket.addEventListener('message', handleMessage);

      // 发送请求
      const request: FileShareSignalingMessage = {
        type: 'file-list-request',
        from: this.localPlayerId,
        to: share.ownerId,
        shareId: share.id,
        path,
        password,
      };

      this.websocket.send(JSON.stringify(request));
      console.log('📤 已发送文件列表请求');
    });
  }

  /**
   * 处理文件列表请求（返回文件列表或抛出错误）
   */
  async handleFileListRequest(
    shareId: string,
    path: string,
    password?: string
  ): Promise<FileInfo[]> {
    try {
      console.log('📥 处理文件列表请求:', shareId, path);

      const share = this.sharedFolders.get(shareId);
      if (!share) {
        throw new Error('共享不存在');
      }

      // 检查密码
      if (share.hasPassword && share.password !== password) {
        throw new Error('密码错误');
      }

      // 检查有效期
      if (share.hasExpiry && share.expiryTime && Date.now() > share.expiryTime) {
        throw new Error('共享已过期');
      }

      // 获取文件列表
      const files = await this.getLocalFileList(share, path);
      return files;
    } catch (error) {
      console.error('❌ 处理文件列表请求失败:', error);
      throw error;
    }
  }
  
  /**
   * 处理文件列表响应
   */
  handleFileListResponse(shareId: string, path: string, files: FileInfo[]): void {
    console.log('📥 处理文件列表响应:', shareId, path, files.length);
    // 添加兼容字段
    files.forEach(file => {
      if (file.is_directory !== undefined && file.isDirectory === undefined) {
        file.isDirectory = file.is_directory;
      }
    });
    // 这个方法由FileShareManager组件通过Promise处理
    // 实际的响应处理在requestRemoteFileList中
  }
  
  /**
   * 更新远程共享列表
   */
  updateRemoteShares(shares: SharedFolder[]): void {
    console.log('📥 更新远程共享列表:', shares.length);
    this.remoteShares.clear();
    shares.forEach(share => {
      this.remoteShares.set(share.id, share);
    });
    
    if (this.onRemoteSharesChangedCallback) {
      this.onRemoteSharesChangedCallback(this.getRemoteShares());
    }
  }

  /**
   * 广播共享添加
   */
  private broadcastShareAdded(share: SharedFolder): void {
    if (!this.websocket) return;

    // 创建不包含密码的副本
    const publicShare: SharedFolder = {
      ...share,
      password: undefined,
    };

    const message = {
      type: 'share-added',
      from: this.localPlayerId,
      share: publicShare,
    };

    this.websocket.send(JSON.stringify(message));
    console.log('📤 已广播共享添加');
  }

  /**
   * 广播共享移除
   */
  private broadcastShareRemoved(shareId: string): void {
    if (!this.websocket) return;

    const message = {
      type: 'share-removed',
      from: this.localPlayerId,
      shareId,
    };

    this.websocket.send(JSON.stringify(message));
    console.log('📤 已广播共享移除');
  }

  /**
   * 广播共享更新
   */
  private broadcastShareUpdated(share: SharedFolder): void {
    if (!this.websocket) return;

    // 创建不包含密码的副本
    const publicShare: SharedFolder = {
      ...share,
      password: undefined,
    };

    const message = {
      type: 'share-updated',
      from: this.localPlayerId,
      share: publicShare,
    };

    this.websocket.send(JSON.stringify(message));
    console.log('📤 已广播共享更新');
  }

  /**
   * 处理远程共享添加
   */
  handleRemoteShareAdded(share: SharedFolder): void {
    console.log('📥 收到远程共享添加:', share.folderName, 'from', share.ownerId);
    
    // 不添加自己的共享到远程列表
    if (share.ownerId === this.localPlayerId) {
      console.log('⏭️ 跳过自己的共享');
      return;
    }
    
    this.remoteShares.set(share.id, share);
    
    if (this.onRemoteSharesChangedCallback) {
      this.onRemoteSharesChangedCallback(this.getRemoteShares());
    }
  }

  /**
   * 处理远程共享移除
   */
  handleRemoteShareRemoved(shareId: string): void {
    console.log('📥 收到远程共享移除:', shareId);
    this.remoteShares.delete(shareId);
    
    if (this.onRemoteSharesChangedCallback) {
      this.onRemoteSharesChangedCallback(this.getRemoteShares());
    }
  }

  /**
   * 处理远程共享更新
   */
  handleRemoteShareUpdated(share: SharedFolder): void {
    console.log('📥 收到远程共享更新:', share.folderName, 'from', share.ownerId);
    
    // 不更新自己的共享到远程列表
    if (share.ownerId === this.localPlayerId) {
      console.log('⏭️ 跳过自己的共享');
      return;
    }
    
    this.remoteShares.set(share.id, share);
    
    if (this.onRemoteSharesChangedCallback) {
      this.onRemoteSharesChangedCallback(this.getRemoteShares());
    }
  }

  /**
   * 处理玩家离开（清理该玩家的所有共享）
   */
  handlePlayerLeft(playerId: string): void {
    console.log('👋 玩家离开，清理共享:', playerId);
    
    // 删除该玩家的所有远程共享
    const sharesToRemove: string[] = [];
    this.remoteShares.forEach((share, shareId) => {
      if (share.ownerId === playerId) {
        sharesToRemove.push(shareId);
      }
    });

    sharesToRemove.forEach(shareId => {
      this.remoteShares.delete(shareId);
    });

    if (sharesToRemove.length > 0 && this.onRemoteSharesChangedCallback) {
      this.onRemoteSharesChangedCallback(this.getRemoteShares());
    }
  }

  /**
   * 设置事件回调
   */
  onShareAdded(callback: (share: SharedFolder) => void): void {
    this.onShareAddedCallback = callback;
  }

  onShareRemoved(callback: (shareId: string) => void): void {
    this.onShareRemovedCallback = callback;
  }

  onShareUpdated(callback: (share: SharedFolder) => void): void {
    this.onShareUpdatedCallback = callback;
  }

  onRemoteSharesChanged(callback: (shares: SharedFolder[]) => void): void {
    this.onRemoteSharesChangedCallback = callback;
  }

  /**
   * 启动过期检查定时器
   */
  private startExpiryCheck(): void {
    this.expiryCheckInterval = window.setInterval(() => {
      this.checkAndRemoveExpiredShares();
    }, 10000); // 每10秒检查一次
    console.log('⏰ 过期检查定时器已启动');
  }
  
  /**
   * 检查并移除过期的共享
   */
  private checkAndRemoveExpiredShares(): void {
    const now = Date.now();
    const expiredShares: string[] = [];
    
    // 检查本地共享
    this.sharedFolders.forEach((share, shareId) => {
      if (share.hasExpiry && share.expiryTime && now > share.expiryTime) {
        console.log('⏰ 检测到过期共享:', share.folderName);
        expiredShares.push(shareId);
      }
    });
    
    // 移除过期的本地共享
    expiredShares.forEach(shareId => {
      this.removeSharedFolder(shareId);
    });
    
    // 检查远程共享
    const expiredRemoteShares: string[] = [];
    this.remoteShares.forEach((share, shareId) => {
      if (share.hasExpiry && share.expiryTime && now > share.expiryTime) {
        console.log('⏰ 检测到过期的远程共享:', share.folderName);
        expiredRemoteShares.push(shareId);
      }
    });
    
    // 移除过期的远程共享
    expiredRemoteShares.forEach(shareId => {
      this.remoteShares.delete(shareId);
    });
    
    // 如果有远程共享被移除，触发回调
    if (expiredRemoteShares.length > 0) {
      if (this.onRemoteSharesChangedCallback) {
        this.onRemoteSharesChangedCallback(Array.from(this.remoteShares.values()));
      }
    }
  }

  /**
   * 清理资源
   */
  cleanup(): void {
    console.log('🧹 清理文件共享服务...');
    
    // 停止过期检查定时器
    if (this.expiryCheckInterval) {
      window.clearInterval(this.expiryCheckInterval);
      this.expiryCheckInterval = null;
    }
    
    this.sharedFolders.clear();
    this.remoteShares.clear();
    this.websocket = null;
    console.log('✅ 文件共享服务已清理');
  }
}

// 导出单例实例
export const fileShareService = new FileShareService();
