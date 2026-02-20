/**
 * Store 初始化模块
 * 负责在应用启动时初始化状态管理
 */

import { initializeStorePersistence } from './persistence';
import { mountDevtools } from './devtools';

/**
 * 初始化应用 Store
 * 应该在应用启动时调用一次
 */
export const initializeStore = (): void => {
  try {
    // 初始化持久化功能
    initializeStorePersistence();
    console.log('✅ Store 持久化已初始化');

    // 在开发环境下挂载调试工具
    if (import.meta.env.DEV) {
      mountDevtools();
    }

    console.log('✅ Store 初始化完成');
  } catch (error) {
    console.error('❌ Store 初始化失败:', error);
    // 不抛出错误，避免阻止应用启动
  }
};
