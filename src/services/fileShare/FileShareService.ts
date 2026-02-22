/**
 * 文件共享服务
 * 基于 HTTP over WireGuard 的高性能文件传输
 */

import { invoke } from '@tauri-apps/api/core';
import { SharedFolder, FileInfo, PlayerShare } from '../../types/fileShare';

class FileShareService {
  private localShares: SharedFolder[] = [];
  private playerShares: Map<string, PlayerShare> = new Map();
  private serverStarted: boolean = false;

  /**
   * 启动HTTP文件服务器
   */
  async startServer(virtualIp: string): Promise<void> {
    try {
      await invoke('start_file_server', { virtualIp });
      this.serverStarted = true;
      console.log('✅ HTTP文件服务器启动成功');
    } catch (error) {
      console.error('❌ 启动HTTP文件服务器失败:', error);
      throw error;
    }
  }

  /**
   * 停止HTTP文件服务器
   */
  async stopServer(): Promise<void> {
    try {
      await invoke('stop_file_server');
      this.serverStarted = false;
      console.log('✅ HTTP文件服务器已停止');
    } catch (error) {
      console.error('❌ 停止HTTP文件服务器失败:', error);
      throw error;
    }
  }

  /**
   * 添加共享文件夹
   */
  async addShare(share: SharedFolder): Promise<void> {
    try {
      await invoke('add_shared_folder', { share });
      this.localShares.push(share);
      console.log('✅ 添加共享成功:', share.name);
    } catch (error) {
      console.error('❌ 添加共享失败:', error);
      throw error;
    }
  }

  /**
   * 删除共享文件夹
   */
  async removeShare(shareId: string): Promise<void> {
    try {
      await invoke('remove_shared_folder', { shareId });
      this.localShares = this.localShares.filter(s => s.id !== shareId);
      console.log('✅ 删除共享成功:', shareId);
    } catch (error) {
      console.error('❌ 删除共享失败:', error);
      throw error;
    }
  }

  /**
   * 获取本地共享列表
   */
  async getLocalShares(): Promise<SharedFolder[]> {
    try {
      const shares = await invoke<SharedFolder[]>('get_local_shares');
      this.localShares = shares;
      return shares;
    } catch (error) {
      console.error('❌ 获取本地共享失败:', error);
      throw error;
    }
  }

  /**
   * 清理过期共享
   */
  async cleanupExpiredShares(): Promise<void> {
    try {
      await invoke('cleanup_expired_shares');
      await this.getLocalShares(); // 刷新列表
    } catch (error) {
      console.error('❌ 清理过期共享失败:', error);
      throw error;
    }
  }

  /**
   * 获取远程玩家的共享列表
   */
  async getRemoteShares(peerIp: string): Promise<SharedFolder[]> {
    try {
      const shares = await invoke<SharedFolder[]>('get_remote_shares', { peerIp });
      return shares;
    } catch (error) {
      console.error('❌ 获取远程共享失败:', error);
      throw error;
    }
  }

  /**
   * 获取远程文件列表
   */
  async getRemoteFiles(
    peerIp: string,
    shareId: string,
    path?: string
  ): Promise<FileInfo[]> {
    try {
      const files = await invoke<FileInfo[]>('get_remote_files', {
        peerIp,
        shareId,
        path: path || null,
      });
      return files;
    } catch (error) {
      console.error('❌ 获取远程文件列表失败:', error);
      throw error;
    }
  }

  /**
   * 验证共享密码
   */
  async verifyPassword(
    peerIp: string,
    shareId: string,
    password: string
  ): Promise<boolean> {
    try {
      const result = await invoke<boolean>('verify_share_password', {
        peerIp,
        shareId,
        password,
      });
      return result;
    } catch (error) {
      console.error('❌ 验证密码失败:', error);
      throw error;
    }
  }

  /**
   * 获取文件下载URL
   */
  async getDownloadUrl(
    peerIp: string,
    shareId: string,
    filePath: string
  ): Promise<string> {
    try {
      const url = await invoke<string>('get_download_url', {
        peerIp,
        shareId,
        filePath,
      });
      return url;
    } catch (error) {
      console.error('❌ 获取下载URL失败:', error);
      throw error;
    }
  }

  /**
   * 更新玩家共享信息
   */
  async updatePlayerShares(
    playerId: string,
    playerName: string,
    virtualIp: string
  ): Promise<void> {
    try {
      const shares = await this.getRemoteShares(virtualIp);
      this.playerShares.set(playerId, {
        player_id: playerId,
        player_name: playerName,
        virtual_ip: virtualIp,
        shares,
      });
    } catch (error) {
      console.error('❌ 更新玩家共享信息失败:', error);
      // 不抛出错误，允许静默失败
    }
  }

  /**
   * 获取所有玩家的共享信息
   */
  getPlayerShares(): PlayerShare[] {
    return Array.from(this.playerShares.values());
  }

  /**
   * 移除玩家共享信息
   */
  removePlayerShares(playerId: string): void {
    this.playerShares.delete(playerId);
  }

  /**
   * 清空所有数据
   */
  clear(): void {
    this.localShares = [];
    this.playerShares.clear();
    this.serverStarted = false;
  }

  /**
   * 检查服务器是否已启动
   */
  isServerStarted(): boolean {
    return this.serverStarted;
  }
}

export const fileShareService = new FileShareService();
