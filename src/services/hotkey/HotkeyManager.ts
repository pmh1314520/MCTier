/**
 * 快捷键管理器
 * 处理全局快捷键注册和监听
 */

export type HotkeyCallback = () => void | Promise<void>;

interface HotkeyRegistration {
  key: string;
  callback: HotkeyCallback;
  description: string;
  handler: (event: KeyboardEvent) => void;
  enabled: boolean;
}

/**
 * 快捷键管理器类
 */
export class HotkeyManager {
  private registrations: Map<string, HotkeyRegistration> = new Map();
  private isInitialized: boolean = false;
  private globalEnabled: boolean = true;

  /**
   * 初始化快捷键管理器
   */
  async initialize(): Promise<void> {
    try {
      if (this.isInitialized) {
        console.warn('快捷键管理器已经初始化');
        return;
      }

      this.isInitialized = true;
      console.log('快捷键管理器初始化成功');
    } catch (error) {
      console.error('快捷键管理器初始化失败:', error);
      throw error;
    }
  }

  /**
   * 解析快捷键字符串
   * 例如: "CommandOrControl+M" -> { ctrl: true, key: 'm' }
   */
  private parseHotkey(key: string): {
    ctrl: boolean;
    alt: boolean;
    shift: boolean;
    meta: boolean;
    key: string;
  } {
    const parts = key.toLowerCase().split('+');
    const result = {
      ctrl: false,
      alt: false,
      shift: false,
      meta: false,
      key: '',
    };

    parts.forEach((part) => {
      if (part === 'ctrl' || part === 'control' || part === 'commandorcontrol') {
        result.ctrl = true;
      } else if (part === 'alt' || part === 'option') {
        result.alt = true;
      } else if (part === 'shift') {
        result.shift = true;
      } else if (part === 'meta' || part === 'command' || part === 'cmd') {
        result.meta = true;
      } else {
        result.key = part;
      }
    });

    return result;
  }

  /**
   * 检查键盘事件是否匹配快捷键
   */
  private matchesHotkey(
    event: KeyboardEvent,
    hotkey: ReturnType<typeof this.parseHotkey>
  ): boolean {
    const eventKey = event.key.toLowerCase();
    const keyMatches = eventKey === hotkey.key || event.code.toLowerCase() === `key${hotkey.key}`;

    return (
      keyMatches &&
      event.ctrlKey === hotkey.ctrl &&
      event.altKey === hotkey.alt &&
      event.shiftKey === hotkey.shift &&
      event.metaKey === hotkey.meta
    );
  }

  /**
   * 注册快捷键
   */
  async registerHotkey(
    key: string,
    callback: HotkeyCallback,
    description: string = ''
  ): Promise<boolean> {
    try {
      if (!this.isInitialized) {
        console.warn('快捷键管理器未初始化');
        return false;
      }

      // 检查是否已注册
      if (this.registrations.has(key)) {
        console.warn(`快捷键 ${key} 已经注册`);
        await this.unregisterHotkey(key);
      }

      // 解析快捷键
      const parsedHotkey = this.parseHotkey(key);

      // 创建事件处理器
      const handler = async (event: KeyboardEvent) => {
        // 检查全局是否启用
        if (!this.globalEnabled) {
          return;
        }

        // 检查当前快捷键是否启用
        const registration = this.registrations.get(key);
        if (!registration || !registration.enabled) {
          return;
        }

        if (this.matchesHotkey(event, parsedHotkey)) {
          event.preventDefault();
          event.stopPropagation();

          try {
            console.log(`快捷键触发: ${key}`);
            await callback();
          } catch (error) {
            console.error(`快捷键回调执行失败 (${key}):`, error);
          }
        }
      };

      // 添加事件监听器
      window.addEventListener('keydown', handler);

      // 保存注册信息
      this.registrations.set(key, {
        key,
        callback,
        description,
        handler,
        enabled: true,
      });

      console.log(`快捷键注册成功: ${key} - ${description}`);
      return true;
    } catch (error) {
      console.error(`注册快捷键失败 (${key}):`, error);
      return false;
    }
  }

  /**
   * 注销快捷键
   */
  async unregisterHotkey(key: string): Promise<boolean> {
    try {
      const registration = this.registrations.get(key);
      if (!registration) {
        console.warn(`快捷键 ${key} 未注册`);
        return false;
      }

      // 移除事件监听器
      window.removeEventListener('keydown', registration.handler);

      // 移除注册信息
      this.registrations.delete(key);

      console.log(`快捷键注销成功: ${key}`);
      return true;
    } catch (error) {
      console.error(`注销快捷键失败 (${key}):`, error);
      return false;
    }
  }

  /**
   * 更新快捷键
   */
  async updateHotkey(
    oldKey: string,
    newKey: string,
    callback: HotkeyCallback,
    description: string = ''
  ): Promise<boolean> {
    try {
      // 注销旧快捷键
      if (oldKey && oldKey !== newKey) {
        await this.unregisterHotkey(oldKey);
      }

      // 注册新快捷键
      return await this.registerHotkey(newKey, callback, description);
    } catch (error) {
      console.error('更新快捷键失败:', error);
      return false;
    }
  }

  /**
   * 获取所有已注册的快捷键
   */
  getRegisteredHotkeys(): Array<{
    key: string;
    description: string;
  }> {
    return Array.from(this.registrations.values()).map((reg) => ({
      key: reg.key,
      description: reg.description,
    }));
  }

  /**
   * 检查快捷键是否已注册
   */
  isHotkeyRegistered(key: string): boolean {
    return this.registrations.has(key);
  }

  /**
   * 启用指定快捷键
   */
  enableHotkey(key: string): boolean {
    try {
      const registration = this.registrations.get(key);
      if (!registration) {
        console.warn(`快捷键 ${key} 未注册`);
        return false;
      }

      registration.enabled = true;
      console.log(`快捷键已启用: ${key}`);
      return true;
    } catch (error) {
      console.error(`启用快捷键失败 (${key}):`, error);
      return false;
    }
  }

  /**
   * 禁用指定快捷键
   */
  disableHotkey(key: string): boolean {
    try {
      const registration = this.registrations.get(key);
      if (!registration) {
        console.warn(`快捷键 ${key} 未注册`);
        return false;
      }

      registration.enabled = false;
      console.log(`快捷键已禁用: ${key}`);
      return true;
    } catch (error) {
      console.error(`禁用快捷键失败 (${key}):`, error);
      return false;
    }
  }

  /**
   * 全局启用所有快捷键
   */
  enableAll(): void {
    this.globalEnabled = true;
    console.log('所有快捷键已全局启用');
  }

  /**
   * 全局禁用所有快捷键
   */
  disableAll(): void {
    this.globalEnabled = false;
    console.log('所有快捷键已全局禁用');
  }

  /**
   * 检查快捷键是否启用
   */
  isHotkeyEnabled(key: string): boolean {
    const registration = this.registrations.get(key);
    return registration ? registration.enabled : false;
  }

  /**
   * 清理所有快捷键
   */
  async cleanup(): Promise<void> {
    try {
      const keys = Array.from(this.registrations.keys());
      for (const key of keys) {
        await this.unregisterHotkey(key);
      }

      this.registrations.clear();
      this.isInitialized = false;

      console.log('快捷键管理器已清理');
    } catch (error) {
      console.error('清理快捷键管理器失败:', error);
    }
  }
}

// 导出单例实例
export const hotkeyManager = new HotkeyManager();
