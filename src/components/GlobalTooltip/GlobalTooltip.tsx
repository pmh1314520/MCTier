/**
 * 全局自定义悬停提示
 * - 接管全应用所有元素的原生 title 属性，悬停时抑制浏览器原生提示，
 *   改为显示符合 MCTier 主题的自定义提示气泡。
 * - 一处实现，覆盖所有使用 title 的按钮/图标，无需逐个改造。
 */

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './GlobalTooltip.css';

interface TipState {
  text: string;
  x: number;
  y: number;
  placement: 'top' | 'bottom';
}

export const GlobalTooltip: React.FC = () => {
  const [tip, setTip] = useState<TipState | null>(null);
  const currentRef = useRef<HTMLElement | null>(null);
  const showTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const clearShowTimer = () => {
      if (showTimerRef.current !== null) {
        window.clearTimeout(showTimerRef.current);
        showTimerRef.current = null;
      }
    };

    // 还原某元素被临时摘除的 title
    const restore = (el: HTMLElement | null) => {
      if (el && el.dataset.mctTip !== undefined) {
        el.setAttribute('title', el.dataset.mctTip);
        delete el.dataset.mctTip;
      }
    };

    const hide = () => {
      clearShowTimer();
      restore(currentRef.current);
      currentRef.current = null;
      setTip(null);
    };

    const handleOver = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target || typeof target.closest !== 'function') return;
      const el = target.closest('[title]') as HTMLElement | null;
      if (!el) return;
      const text = el.getAttribute('title');
      if (!text || !text.trim()) return;

      // 切换到新元素前，先还原上一个
      if (currentRef.current && currentRef.current !== el) {
        restore(currentRef.current);
      }

      // 摘除原生 title，避免系统原生提示弹出
      el.dataset.mctTip = text;
      el.removeAttribute('title');
      currentRef.current = el;

      clearShowTimer();
      showTimerRef.current = window.setTimeout(() => {
        if (currentRef.current !== el) return;
        const r = el.getBoundingClientRect();
        const placeBottom = r.top < 44; // 顶部空间不足则显示在下方
        setTip({
          text,
          x: r.left + r.width / 2,
          y: placeBottom ? r.bottom + 8 : r.top - 8,
          placement: placeBottom ? 'bottom' : 'top',
        });
      }, 350);
    };

    const handleOut = (e: MouseEvent) => {
      const related = e.relatedTarget as HTMLElement | null;
      // 仍在当前元素内部移动则不隐藏
      if (currentRef.current && related && currentRef.current.contains(related)) return;
      hide();
    };

    document.addEventListener('mouseover', handleOver, true);
    document.addEventListener('mouseout', handleOut, true);
    document.addEventListener('mousedown', hide, true);
    window.addEventListener('blur', hide);

    return () => {
      document.removeEventListener('mouseover', handleOver, true);
      document.removeEventListener('mouseout', handleOut, true);
      document.removeEventListener('mousedown', hide, true);
      window.removeEventListener('blur', hide);
      restore(currentRef.current);
      clearShowTimer();
    };
  }, []);

  if (!tip) return null;

  return createPortal(
    <div
      className={`mct-global-tip mct-global-tip-${tip.placement}`}
      style={{ left: tip.x, top: tip.y }}
      role="tooltip"
    >
      {tip.text}
    </div>,
    document.body
  );
};
