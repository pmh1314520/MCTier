import React, { useEffect, useRef, useState, useCallback } from 'react';
import { listen } from '@tauri-apps/api/event';
import './DanmakuOverlay.css';

interface Bullet {
  id: number;
  text: string;
  color: string;
  fontSize: number;
  duration: number; // s
  top: number;      // px
}

interface DanmakuPayload {
  text: string;
  color: string;
  fontSize: number;
  speed: number;
  opacity: number;
  tracks: number;
}

/**
 * 弹幕覆盖窗口的渲染组件（运行在独立的置顶透明窗口中）
 * 接收 'danmaku-msg' 事件，按轨道从右向左飘过。
 */
export const DanmakuOverlay: React.FC = () => {
  const [bullets, setBullets] = useState<Bullet[]>([]);
  const [opacity, setOpacity] = useState(0.9);
  const idRef = useRef(1);
  // 每条轨道下一次可用时间戳（避免重叠）
  const trackFreeAt = useRef<number[]>([]);

  const spawn = useCallback((p: DanmakuPayload) => {
    const vw = window.innerWidth || 1920;
    const tracks = Math.max(1, Math.min(12, p.tracks || 4));
    if (trackFreeAt.current.length !== tracks) {
      trackFreeAt.current = new Array(tracks).fill(0);
    }
    const now = performance.now();
    // 选一条最早空闲的轨道
    let track = 0;
    let earliest = Infinity;
    for (let i = 0; i < tracks; i++) {
      if (trackFreeAt.current[i] <= now) { track = i; break; }
      if (trackFreeAt.current[i] < earliest) { earliest = trackFreeAt.current[i]; track = i; }
    }
    const speed = Math.max(40, p.speed || 140);
    // 估算文本宽度（粗略：字数 * 字号 * 0.6 + padding）
    const estWidth = p.text.length * p.fontSize * 0.62 + 40;
    const distance = vw + estWidth;
    const duration = distance / speed; // s
    // 该轨道在弹幕完全离开右边界前不能再放（按文本宽度通过的时间）
    const releaseDelay = (estWidth + 30) / speed * 1000;
    trackFreeAt.current[track] = now + releaseDelay;

    const lineHeight = p.fontSize * 1.5;
    const top = 12 + track * lineHeight;

    const bullet: Bullet = {
      id: idRef.current++,
      text: p.text,
      color: p.color || '#ffffff',
      fontSize: p.fontSize,
      duration,
      top,
    };
    setOpacity(p.opacity ?? 0.9);
    setBullets((prev) => [...prev, bullet]);
    // 动画结束后移除
    window.setTimeout(() => {
      setBullets((prev) => prev.filter((b) => b.id !== bullet.id));
    }, duration * 1000 + 200);
  }, []);

  useEffect(() => {
    // 仅在弹幕窗口自身文档上设置透明背景与鼠标穿透，绝不影响主窗口
    const html = document.documentElement;
    const body = document.body;
    const root = document.getElementById('root');
    const prev = {
      htmlBg: html.style.background,
      bodyBg: body.style.background,
      bodyPe: body.style.pointerEvents,
      bodyOverflow: body.style.overflow,
    };
    html.style.background = 'transparent';
    body.style.background = 'transparent';
    body.style.margin = '0';
    body.style.overflow = 'hidden';
    body.style.pointerEvents = 'none';
    body.style.userSelect = 'none';
    if (root) {
      root.style.background = 'transparent';
      root.style.pointerEvents = 'none';
    }

    let un: (() => void) | undefined;
    listen<DanmakuPayload>('danmaku-msg', (e) => {
      if (e.payload && e.payload.text) spawn(e.payload);
    }).then((fn) => { un = fn; });
    return () => {
      if (un) un();
      html.style.background = prev.htmlBg;
      body.style.background = prev.bodyBg;
      body.style.pointerEvents = prev.bodyPe;
      body.style.overflow = prev.bodyOverflow;
    };
  }, [spawn]);

  return (
    <div className="danmaku-root" style={{ opacity }}>
      {bullets.map((b) => (
        <div
          key={b.id}
          className="danmaku-bullet"
          style={{
            top: `${b.top}px`,
            color: b.color,
            fontSize: `${b.fontSize}px`,
            animationDuration: `${b.duration}s`,
          }}
        >
          {b.text}
        </div>
      ))}
    </div>
  );
};
