/**
 * 文件共享服务
 * 基于 HTTP over WireGuard 的高性能文件传输
 */

import { invoke } from '@tauri-apps/api/core';
import { SharedFolder, SharedFolderSummary, FileInfo, PlayerShare } from '../../types/fileShare';

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
   * 下发允许访问共享的大厅成员虚拟IP（含自己）
   *
   * EasyTier 的网络名与密钥在大厅存续期间不变，被房主移出大厅的玩家仍可能
   * 留在虚拟网内。后端据此拒绝非成员浏览共享列表、文件列表与下载。
   */
  async updateAllowedPeers(ips: string[]): Promise<void> {
    try {
      await invoke('set_share_allowed_peers', { ips });
      console.log(`🪪 [FileShareService] 已下发可访问成员（${ips.length} 个）`);
    } catch (error) {
      console.warn('⚠️ [FileShareService] 下发可访问成员失败:', error);
    }
  }

  /**
   * 清空允许访问共享的成员列表（退出大厅时调用）
   */
  async clearAllowedPeers(): Promise<void> {
    try {
      await invoke('clear_share_allowed_peers');
    } catch (error) {
      console.warn('⚠️ [FileShareService] 清空可访问成员失败:', error);
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
      // 注意：后端Rust参数名使用下划线命名
      await invoke('remove_shared_folder', { share_id: shareId });
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
  async getRemoteShares(peerIp: string): Promise<SharedFolderSummary[]> {
    try {
      console.log(`📡 [FileShareService] 正在获取远程共享: ${peerIp}`);
      console.log(`📡 [FileShareService] 调用 invoke('get_remote_shares', { peerIp: '${peerIp}' })`);
      
      // Tauri会自动将驼峰命名peerIp转换为Rust的下划线命名peer_ip
      const shares = await invoke<SharedFolderSummary[]>('get_remote_shares', { peerIp });
      
      console.log(`✅ [FileShareService] 成功获取 ${shares.length} 个共享`);
      if (shares.length > 0) {
        console.log(`📋 [FileShareService] 共享列表:`, shares);
      }
      return shares;
    } catch (error) {
      console.error(`❌ [FileShareService] 获取远程共享失败 (${peerIp}):`, error);
      console.error(`❌ [FileShareService] 错误类型:`, typeof error);
      console.error(`❌ [FileShareService] 错误内容:`, JSON.stringify(error, null, 2));
      throw error;
    }
  }

  /**
   * 获取远程文件列表
   */
  async getRemoteFiles(
    peerIp: string,
    shareId: string,
    path?: string,
    password?: string
  ): Promise<FileInfo[]> {
    try {
      // 注意：后端Rust参数名使用下划线命名
      const files = await invoke<FileInfo[]>('get_remote_files', {
        peer_ip: peerIp,
        share_id: shareId,
        path: path || null,
        password: password || null,
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
      // 注意：后端Rust参数名使用下划线命名
      const result = await invoke<boolean>('verify_share_password', {
        peer_ip: peerIp,
        share_id: shareId,
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
      // 注意：后端Rust参数名使用下划线命名
      const url = await invoke<string>('get_download_url', {
        peer_ip: peerIp,
        share_id: shareId,
        file_path: filePath,
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

  // ==================== 兼容旧WebRTC API的方法（临时） ====================
  // 这些方法是为了让旧的FileShareManager组件能够编译通过
  // 在完全迁移到HTTP API后可以删除

  onRemoteSharesChanged(_callback: (shares: any[]) => void): void {
    console.warn('onRemoteSharesChanged方法已废弃');
  }

  onShareAdded(_callback: (share: any) => void): void {
    console.warn('onShareAdded方法已废弃');
  }

  onShareRemoved(_callback: (shareId: string) => void): void {
    console.warn('onShareRemoved方法已废弃');
  }

  onShareUpdated(_callback: (share: any) => void): void {
    console.warn('onShareUpdated方法已废弃');
  }

  // setWebSocket方法已完全移除，HTTP模式不使用WebSocket

  getLocalSharesForBroadcast(): any[] {
    console.warn('getLocalSharesForBroadcast方法已废弃');
    return [];
  }

  handlePlayerLeft(_playerId: string): void {
    console.warn('handlePlayerLeft方法已废弃');
  }

  updateRemoteShares(_shares: any): void {
    console.warn('updateRemoteShares方法已废弃');
  }

  handleFileListRequest(_shareId: string, _path: string): Promise<any> {
    console.warn('handleFileListRequest方法已废弃');
    return Promise.resolve([]);
  }

  handleFileListResponse(_shareId: string, _path: string, _files: any): void {
    console.warn('handleFileListResponse方法已废弃');
  }

  handleRemoteShareAdded(_share: any): void {
    console.warn('handleRemoteShareAdded方法已废弃');
  }

  handleRemoteShareRemoved(_shareId: string): void {
    console.warn('handleRemoteShareRemoved方法已废弃');
  }

  handleRemoteShareUpdated(_share: any): void {
    console.warn('handleRemoteShareUpdated方法已废弃');
  }

  cleanup(): void {
    this.clear();
  }
}

export const fileShareService = new FileShareService();
