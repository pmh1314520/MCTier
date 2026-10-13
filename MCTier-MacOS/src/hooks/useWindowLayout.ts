import { useEffect, useState } from 'react';
import {
  applyWindowLayout,
  currentWindowLayout,
  type WindowLayout,
} from '../utils/windowLayout';

/**
 * 跟随窗口宽度在竖屏 / 横排之间切换，并把当前形态写入 <html data-layout>。
 * 窗口自带原生缩放手柄，用户拖到断点就会自动切换形态。
 */
export function useWindowLayout(): WindowLayout {
  const [layout, setLayout] = useState<WindowLayout>(currentWindowLayout);

  useEffect(() => {
    const sync = () => {
      const next = currentWindowLayout();
      // 先落 DOM 再进 state：否则 CSS 要等 React 重渲染完才跟上，缩放时会有一帧错位。
      applyWindowLayout(next);
      setLayout((previous) => (previous === next ? previous : next));
    };
    sync();
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, []);

  return layout;
}
