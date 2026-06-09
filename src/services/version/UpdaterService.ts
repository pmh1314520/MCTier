/**
 * 应用内自动更新服务（基于 Tauri 官方 updater 插件）
 * - 从配置的 endpoint 拉取 latest.json，校验签名后判断是否有新版本
 * - 支持应用内下载并自动安装，安装完成后自动重启
 */

import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

export interface UpdateInfo {
  available: boolean;
  version: string;
  notes: string;
}

class UpdaterService {
  private pending: Update | null = null;

  /** 检查是否有可用更新 */
  async checkForUpdate(): Promise<UpdateInfo | null> {
    try {
      const update = await check();
      if (update) {
        this.pending = update;
        return {
          available: true,
          version: update.version,
          notes: update.body || '',
        };
      }
      return { available: false, version: '', notes: '' };
    } catch (error) {
      console.error('❌ [Updater] 检查更新失败:', error);
      return null;
    }
  }

  /** 是否有已检出的待安装更新 */
  hasPendingUpdate(): boolean {
    return this.pending !== null;
  }

  /**
   * 下载并安装更新
   * @param onProgress 进度回调 (已下载字节, 总字节)
   */
  async downloadAndInstall(onProgress?: (downloaded: number, total: number) => void): Promise<void> {
    if (!this.pending) {
      throw new Error('没有可用更新');
    }
    let downloaded = 0;
    let total = 0;
    await this.pending.downloadAndInstall((event) => {
      switch (event.event) {
        case 'Started':
          total = event.data.contentLength || 0;
          onProgress?.(0, total);
          break;
        case 'Progress':
          downloaded += event.data.chunkLength;
          onProgress?.(downloaded, total);
          break;
        case 'Finished':
          onProgress?.(total, total);
          break;
      }
    });
  }

  /** 重启应用以完成更新 */
  async relaunchApp(): Promise<void> {
    await relaunch();
  }
}

export const updaterService = new UpdaterService();
