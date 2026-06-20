/**
 * 文件传输服务
 * 使用 HTTP 协议通过 WireGuard 虚拟网络传输文件
 * 支持多线程下载、断点续传
 */

import { invoke } from '@tauri-apps/api/core';
import { DownloadTask } from '../../types/fileShare';
import { tl } from '../../i18n';

class FileTransferService {
  private downloadTasks: Map<string, DownloadTask> = new Map();
  private abortControllers: Map<string, AbortController> = new Map();

  /**
   * 开始下载文件
   */
  async startDownload(
    taskId: string,
    downloadUrl: string,
    fileName: string,
    fileSize: number,
    peerIp: string,
    shareId: string,
    filePath: string
  ): Promise<void> {
    // 让用户选择保存位置
    const saveFolder = await invoke<string | null>('select_folder');

    if (!saveFolder) {
      throw new Error(tl('用户取消了保存', 'Save cancelled by user'));
    }

    // 构建完整的保存路径
    const savePath = `${saveFolder}\\${fileName}`;

    // 创建下载任务
    const task: DownloadTask = {
      id: taskId,
      share_id: shareId,
      file_path: filePath,
      file_name: fileName,
      file_size: fileSize,
      downloaded: 0,
      progress: 0,
      speed: 0,
      status: 'downloading',
      save_path: savePath,
      peer_ip: peerIp,
      started_at: Date.now(),
    };

    this.downloadTasks.set(taskId, task);

    // 创建 AbortController 用于取消下载
    const abortController = new AbortController();
    this.abortControllers.set(taskId, abortController);

    try {
      await this.downloadFile(task, downloadUrl, abortController.signal);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        task.status = 'cancelled';
      } else {
        task.status = 'failed';
        task.error = error instanceof Error ? error.message : String(error);
      }
      this.downloadTasks.set(taskId, task);
      throw error;
    } finally {
      this.abortControllers.delete(taskId);
    }
  }

  /**
   * 下载文件（单线程）
   */
  private async downloadFile(
    task: DownloadTask,
    url: string,
    signal: AbortSignal
  ): Promise<void> {
    const startTime = Date.now();
    let lastUpdateTime = startTime;
    let lastDownloaded = 0;

    try {
      const response = await fetch(url, { signal });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error(tl('无法读取响应体', 'Unable to read response body'));
      }

      const chunks: Uint8Array[] = [];
      let downloaded = 0;

      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        if (value) {
          chunks.push(value);
          downloaded += value.length;

          // 更新进度（每100ms更新一次）
          const now = Date.now();
          if (now - lastUpdateTime >= 100) {
            const elapsed = (now - lastUpdateTime) / 1000;
            const speed = (downloaded - lastDownloaded) / elapsed;

            task.downloaded = downloaded;
            task.progress = (downloaded / task.file_size) * 100;
            task.speed = speed;
            this.downloadTasks.set(task.id, { ...task });

            lastUpdateTime = now;
            lastDownloaded = downloaded;
          }
        }
      }

      // 合并所有chunks
      const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
      const fileData = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        fileData.set(chunk, offset);
        offset += chunk.length;
      }

      // 保存文件
      await invoke('write_file_bytes', { 
        path: task.save_path, 
        data: Array.from(fileData) 
      });

      // 更新任务状态
      task.status = 'completed';
      task.downloaded = downloaded;
      task.progress = 100;
      task.speed = 0;
      task.completed_at = Date.now();
      this.downloadTasks.set(task.id, { ...task });

      console.log('✅ 文件下载完成:', task.file_name);
    } catch (error) {
      console.error('❌ 文件下载失败:', error);
      throw error;
    }
  }

  /**
   * 取消下载
   */
  async cancelDownload(taskId: string): Promise<void> {
    const controller = this.abortControllers.get(taskId);
    if (controller) {
      controller.abort();
      console.log('🛑 取消下载:', taskId);
    }
    
    // 【修复】删除已下载的残留文件
    const task = this.downloadTasks.get(taskId);
    if (task?.save_path) {
      try {
        console.log('🗑️ [FileTransferService] 删除残留文件:', task.save_path);
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('delete_file', { path: task.save_path });
        console.log('✅ [FileTransferService] 残留文件已删除');
      } catch (error) {
        console.error('❌ [FileTransferService] 删除残留文件失败:', error);
        // 不影响取消操作，继续执行
      }
    }
  }

  /**
   * 获取下载任务
   */
  getTask(taskId: string): DownloadTask | undefined {
    return this.downloadTasks.get(taskId);
  }

  /**
   * 获取所有下载任务
   */
  getAllTasks(): DownloadTask[] {
    return Array.from(this.downloadTasks.values());
  }

  /**
   * 获取正在下载的任务
   */
  getDownloadingTasks(): DownloadTask[] {
    return this.getAllTasks().filter(
      task => task.status === 'downloading' || task.status === 'pending'
    );
  }

  /**
   * 获取已完成的任务
   */
  getCompletedTasks(): DownloadTask[] {
    return this.getAllTasks().filter(task => task.status === 'completed');
  }

  /**
   * 删除任务
   */
  removeTask(taskId: string): void {
    this.downloadTasks.delete(taskId);
    this.abortControllers.delete(taskId);
  }

  /**
   * 清空所有任务
   */
  clear(): void {
    // 取消所有正在下载的任务
    for (const controller of this.abortControllers.values()) {
      controller.abort();
    }
    this.downloadTasks.clear();
    this.abortControllers.clear();
  }

  // ==================== 兼容旧WebRTC API的方法（临时） ====================

  onTransferProgress(_callback: (progress: any) => void): void {
    console.warn('onTransferProgress方法已废弃');
  }

  onTransferComplete(_callback: (requestId: string, filePath: string) => void): void {
    console.warn('onTransferComplete方法已废弃');
  }

  onTransferError(_callback: (requestId: string, error: string) => void): void {
    console.warn('onTransferError方法已废弃');
  }

  // setWebSocket方法已完全移除

  handleTransferRequest(_requestId: string, _shareId: string, _filePath: string, _fileSize: number, _peerId: string): Promise<void> {
    console.warn('handleTransferRequest方法已废弃');
    return Promise.resolve();
  }

  handleTransferError(_requestId: string, _error: string): void {
    console.warn('handleTransferError方法已废弃');
  }

  handleDataChannelMessage(_peerId: string, _data: any): void {
    console.warn('handleDataChannelMessage方法已废弃');
  }

  cleanup(): void {
    this.clear();
  }
}

export const fileTransferService = new FileTransferService();
