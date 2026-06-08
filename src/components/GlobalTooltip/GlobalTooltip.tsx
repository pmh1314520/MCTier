/**
 * 全局自定义悬停提示
 * - 接管全应用所有元素的原生 title 属性，悬停时抑制浏览器原生提示，
 *   改为显示符合 MCTier 主题的自定义提示气泡。
 * - 测量气泡真实尺寸后做视口边界钳制，避免靠边元素的提示超出可视区
 *   或被挤压成逐字换行；箭头动态指向目标元素中心。
 */

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './GlobalTooltip.css';

interface RawTip {
  text: string;
  rect: { left: number; top: number; width: number; height: number; bottom: number };
}

interface Pos {
  left: number;
  top: number;
  placement: 'top' | 'bottom';
  arrowLeft: number;
}

const MARGIN = 8;

export const GlobalTooltip: React.FC = () => {
  const [raw, setRaw] = useState<RawTip | null>(null);
  const [pos, setPos] = useState<Pos | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const currentRef = useRef<HTMLElement | null>(null);
  const showTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const clearShowTimer = () => {
      if (showTimerRef.current !== null) {
        window.clearTimeout(showTimerRef.current);
        showTimerRef.current = null;
      }
    };

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
      setRaw(null);
      setPos(null);
    };

    const handleOver = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target || typeof target.closest !== 'function') return;
      const el = target.closest('[title]') as HTMLElement | null;
      if (!el) return;
      const text = el.getAttribute('title');
      if (!text || !text.trim()) return;

      if (currentRef.current && currentRef.current !== el) {
        restore(currentRef.current);
      }

      el.dataset.mctTip = text;
      el.removeAttribute('title');
      currentRef.current = el;

      clearShowTimer();
      showTimerRef.current = window.setTimeout(() => {
        if (currentRef.current !== el) return;
        const r = el.getBoundingClientRect();
        setPos(null);
        setRaw({
          text,
          rect: { left: r.left, top: r.top, width: r.width, height: r.height, bottom: r.bottom },
        });
      }, 350);
    };

    const handleOut = (e: MouseEvent) => {
      const related = e.relatedTarget as HTMLElement | null;
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

  // 气泡渲染后测量真实尺寸并做边界钳制
  useLayoutEffect(() => {
    if (!raw || !tipRef.current) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const tw = tipRef.current.offsetWidth;
    const th = tipRef.current.offsetHeight;
    const centerX = raw.rect.left + raw.rect.width / 2;

    // 水平：居中对齐目标，再钳制进视口
    let left = centerX - tw / 2;
    left = Math.max(MARGIN, Math.min(left, vw - tw - MARGIN));

    // 垂直：默认显示在上方，空间不足则显示在下方
    let placement: 'top' | 'bottom' = 'top';
    let top = raw.rect.top - th - 8;
    if (top < MARGIN) {
      placement = 'bottom';
      top = raw.rect.bottom + 8;
    }
    top = Math.max(MARGIN, Math.min(top, vh - th - MARGIN));

    // 箭头指向目标中心（限制在气泡内部）
    const arrowLeft = Math.max(12, Math.min(centerX - left, tw - 12));

    setPos({ left, top, placement, arrowLeft });
  }, [raw]);

  if (!raw) return null;

  return createPortal(
    <div
      ref={tipRef}
      className={`mct-global-tip${pos ? ` mct-global-tip-${pos.placement}` : ''}`}
      style={{
        left: pos ? pos.left : -9999,
        top: pos ? pos.top : -9999,
        visibility: pos ? 'visible' : 'hidden',
      }}
      role="tooltip"
    >
      {raw.text}
      {pos && <span className="mct-global-tip-arrow" style={{ left: pos.arrowLeft }} />}
    </div>,
    document.body
  );
};
