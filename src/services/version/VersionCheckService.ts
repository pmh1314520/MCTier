/**
 * 版本更新检测服务
 * 从 Gitee API 获取最新版本信息并与当前版本对比
 */

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
  private readonly CURRENT_VERSION = '1.3.0'; // 从 package.json 读取
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

      // 直接获取最后一个标签（最新版本）
      const latestTag = tags[tags.length - 1];
      const latestVersion = latestTag.name.replace(/^v/, ''); // 移除 'v' 前缀
      
      console.log('📦 [VersionCheckService] 最新版本:', latestVersion);
      console.log('📦 [VersionCheckService] 当前版本:', this.CURRENT_VERSION);

      // 比较版本号
      const hasUpdate = this.compareVersions(latestVersion, this.CURRENT_VERSION) > 0;
      
      console.log(hasUpdate ? '🎉 [VersionCheckService] 发现新版本！' : '✅ [VersionCheckService] 当前已是最新版本');

      return {
        latestVersion,
        currentVersion: this.CURRENT_VERSION,
        hasUpdate,
        updateMessage: hasUpdate ? latestTag.message : undefined,
      };
    } catch (error) {
      console.error('❌ [VersionCheckService] 检查版本更新失败:', error);
      return null;
    }
  }

  /**
   * 比较两个版本号
   * @returns 1: v1 > v2, 0: v1 === v2, -1: v1 < v2
   * 
   * 版本号格式: x.y.z
   * 比较规则：
   * 1. 先比较第一位数字（主版本号）
   * 2. 如果第一位相同，比较第二位数字（次版本号）
   * 3. 如果第二位相同，比较第三位数字（修订号）
   * 
   * 例如：
   * - 1.2.1 > 1.2.0
   * - 1.3.0 > 1.2.9
   * - 2.0.0 > 1.9.9
   */
  private compareVersions(v1: string, v2: string): number {
    try {
      // 移除可能的 'v' 前缀
      const cleanV1 = v1.replace(/^v/, '');
      const cleanV2 = v2.replace(/^v/, '');

      // 分割版本号并转换为数字
      const parts1 = cleanV1.split('.').map(part => {
        const num = parseInt(part, 10);
        return isNaN(num) ? 0 : num;
      });
      const parts2 = cleanV2.split('.').map(part => {
        const num = parseInt(part, 10);
        return isNaN(num) ? 0 : num;
      });

      // 确保至少有3位版本号
      while (parts1.length < 3) parts1.push(0);
      while (parts2.length < 3) parts2.push(0);

      console.log(`🔍 [VersionCheckService] 比较版本号: ${cleanV1} vs ${cleanV2}`);
      console.log(`🔍 [VersionCheckService] 解析后: [${parts1.join(', ')}] vs [${parts2.join(', ')}]`);

      // 逐位比较
      for (let i = 0; i < 3; i++) {
        const num1 = parts1[i];
        const num2 = parts2[i];

        console.log(`🔍 [VersionCheckService] 比较第${i + 1}位: ${num1} vs ${num2}`);

        if (num1 > num2) {
          console.log(`✅ [VersionCheckService] ${cleanV1} > ${cleanV2}`);
          return 1;
        }
        if (num1 < num2) {
          console.log(`✅ [VersionCheckService] ${cleanV1} < ${cleanV2}`);
          return -1;
        }
        // 如果相等，继续比较下一位
      }

      console.log(`✅ [VersionCheckService] ${cleanV1} === ${cleanV2}`);
      return 0;
    } catch (error) {
      console.error('❌ [VersionCheckService] 版本号比较失败:', error);
      return 0;
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
