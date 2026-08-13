/**
 * 版本更新检测服务
 * 从 Gitee API 获取最新版本信息并与当前版本对比
 */

import { compareVersions, newestVersionTag } from './versionPolicy';
import { getVersion } from '@tauri-apps/api/app';

interface GiteeTag {
  name: string;
  message: string;
  commit: {
    sha: string;
    date: string;
  };
  tagger: {
    name: string;
    email: string;
    date: string;
  };
}

interface VersionInfo {
  latestVersion: string;
  currentVersion: string;
  hasUpdate: boolean;
  updateMessage?: string;
}

class VersionCheckService {
  private readonly GITEE_API_URL = 'https://gitee.com/api/v5/repos/peng-minghang/mctier/tags';
  private readonly VERSION_CHECK_KEY = 'mctier_version_check_shown';

  /**
   * 检查是否需要显示更新提示
   * 只在首次打开软件时检查（使用sessionStorage，软件关闭后重置）
   */
  shouldShowUpdatePrompt(): boolean {
    try {
      // 使用sessionStorage，确保只在本次会话中检查一次
      // 软件关闭后sessionStorage会被清空，下次启动时会重新检查
      const hasShown = sessionStorage.getItem(this.VERSION_CHECK_KEY);
      return !hasShown;
    } catch (error) {
      console.error('❌ [VersionCheckService] 检查更新提示状态失败:', error);
      return false;
    }
  }

  /**
   * 标记已显示更新提示
   */
  markUpdatePromptShown(): void {
    try {
      // 使用sessionStorage，软件关闭后自动清除
      sessionStorage.setItem(this.VERSION_CHECK_KEY, 'true');
      console.log('✅ [VersionCheckService] 已标记更新提示已显示（本次会话）');
    } catch (error) {
      console.error('❌ [VersionCheckService] 标记更新提示失败:', error);
    }
  }

  /**
   * 重置更新提示状态（用于测试）
   */
  resetUpdatePromptStatus(): void {
    try {
      sessionStorage.removeItem(this.VERSION_CHECK_KEY);
      console.log('✅ [VersionCheckService] 已重置更新提示状态');
    } catch (error) {
      console.error('❌ [VersionCheckService] 重置更新提示状态失败:', error);
    }
  }

  /**
   * 从 Gitee API 获取最新版本信息
   */
  async fetchLatestVersion(): Promise<VersionInfo | null> {
    try {
      console.log('🔍 [VersionCheckService] 开始检查版本更新...');
      console.log('📡 [VersionCheckService] 请求 Gitee API:', this.GITEE_API_URL);

      const response = await fetch(this.GITEE_API_URL, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        console.error('❌ [VersionCheckService] API 请求失败:', response.status, response.statusText);
        return null;
      }

      const tags: GiteeTag[] = await response.json();
      console.log('✅ [VersionCheckService] 成功获取标签列表，共', tags.length, '个标签');

      if (!tags || tags.length === 0) {
        console.warn('⚠️ [VersionCheckService] 未找到任何版本标签');
        return null;
      }

      // 【修复】Gitee tags 接口不保证按语义版本排序，不能简单取数组末位，
      // 否则可能把旧 tag 当成"最新版"误报更新。这里遍历全部 tag，按语义版本取最大值。
      const latestTag = newestVersionTag(tags);
      if (!latestTag) return null;
      const latestVersion = latestTag.name.replace(/^v/, ''); // 移除 'v' 前缀
      const currentVersion = await getVersion();
      
      console.log('📦 [VersionCheckService] 最新版本:', latestVersion);
      console.log('📦 [VersionCheckService] 当前版本:', currentVersion);

      // 比较版本号
      const hasUpdate = compareVersions(latestVersion, currentVersion) > 0;
      
      console.log(hasUpdate ? '🎉 [VersionCheckService] 发现新版本！' : '✅ [VersionCheckService] 当前已是最新版本');

      return {
        latestVersion,
        currentVersion,
        hasUpdate,
        updateMessage: hasUpdate ? latestTag.message : undefined,
      };
    } catch (error) {
      console.error('❌ [VersionCheckService] 检查版本更新失败:', error);
      return null;
    }
  }

  /**
   * 格式化更新日志
   * 将 message 字符串格式化为数组，并自动去掉"- "前缀
   */
  formatUpdateMessage(message: string): string[] {
    try {
      // 按行分割，过滤空行，并去掉"- "前缀
      return message
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .map(line => {
          // 如果行以"- "开头，去掉这个前缀
          if (line.startsWith('- ')) {
            return line.substring(2);
          }
          return line;
        });
    } catch (error) {
      console.error('❌ [VersionCheckService] 格式化更新日志失败:', error);
      return [];
    }
  }

}

export const versionCheckService = new VersionCheckService();
