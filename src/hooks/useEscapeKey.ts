import { useEffect } from 'react';

/**
 * ESC键监听Hook
 * 只在窗口聚焦时监听ESC键
 * 
 * @param onEscape - ESC键按下时的回调函数
 * @param enabled - 是否启用监听，默认为true
 */
export const useEscapeKey = (onEscape: () => void, enabled: boolean = true) => {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      // 只在ESC键按下且窗口聚焦时触发
      if (event.key === 'Escape' && document.hasFocus()) {
        event.preventDefault();
        event.stopPropagation();
        onEscape();
      }
    };

    // 添加键盘事件监听
    window.addEventListener('keydown', handleKeyDown);

    // 清理函数
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onEscape, enabled]);
};
