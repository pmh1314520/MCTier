import React, { useEffect, useRef, useState, useCallback } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import './DanmakuOverlay.css';

interface Bullet {
  id: number;
  text: string;
  color: string;
  fontSize: number;
  duration: number; // s
  top: number;      // px
  kind: 'text' | 'image';
  image?: string;
  copyText?: string;
}

interface DanmakuPayload {
  text: string;
  color: string;
  fontSize: number;
  speed: number;
  opacity: number;
  tracks: number;
  kind?: 'text' | 'image';
  image?: string;
  copyText?: string;
}

/**
 * 弹幕覆盖窗口的渲染组件（运行在独立的置顶透明窗口中）
 * 接收 'danmaku-msg' 事件，按轨道从右向左飘过。
 * 支持图片弹幕；点击弹幕暂停并显示操作按钮（文本→复制，图片→下载），点击空白处恢复。
 */
export const DanmakuOverlay: React.FC = () => {
  const [bullets, setBullets] = useState<Bullet[]>([]);
  const [opacity, setOpacity] = useState(0.9);
  const [pinnedId, setPinnedId] = useState<number | null>(null);
  const [toast, setToast] = useState<string>('');
  const idRef = useRef(1);
  const trackFreeAt = useRef<number[]>([]);
  // 弹幕 DOM 节点引用（用于命中检测）
  const nodeRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const pinnedIdRef = useRef<number | null>(null);
  const ignoreRef = useRef<boolean>(true); // 当前是否处于穿透状态
  const toastTimer = useRef<number | null>(null);

  pinnedIdRef.current = pinnedId;

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), 2500);
  }, []);

  const spawn = useCallback((p: DanmakuPayload) => {
    const vw = window.innerWidth || 1920;
    const tracks = Math.max(1, Math.min(12, p.tracks || 4));
    if (trackFreeAt.current.length !== tracks) {
      trackFreeAt.current = new Array(tracks).fill(0);
    }
    const now = performance.now();
    let track = 0;
    let earliest = Infinity;
    for (let i = 0; i < tracks; i++) {
      if (trackFreeAt.current[i] <= now) { track = i; break; }
      if (trackFreeAt.current[i] < earliest) { earliest = trackFreeAt.current[i]; track = i; }
    }
    const speed = Math.max(40, p.speed || 140);
    const isImage = p.kind === 'image' && !!p.image;
    // 图片弹幕按高度估算宽度，文本按字数估算
    const imgH = p.fontSize * 1.8;
    const estWidth = isImage ? imgH * 1.4 + 40 : p.text.length * p.fontSize * 0.62 + 40;
    const distance = vw + estWidth;
    const duration = distance / speed; // s
    const releaseDelay = (estWidth + 30) / speed * 1000;
    trackFreeAt.current[track] = now + releaseDelay;

    const lineHeight = (isImage ? imgH : p.fontSize) * 1.6;
    const top = 12 + track * lineHeight;

    const bullet: Bullet = {
      id: idRef.current++,
      text: p.text,
      color: p.color || '#ffffff',
      fontSize: p.fontSize,
      duration,
      top,
      kind: isImage ? 'image' : 'text',
      image: p.image,
      copyText: p.copyText,
    };
    setOpacity(p.opacity ?? 0.9);
    setBullets((prev) => [...prev, bullet]);
    window.setTimeout(() => {
      // 被定住的弹幕不自动移除
      if (pinnedIdRef.current === bullet.id) return;
      setBullets((prev) => prev.filter((b) => b.id !== bullet.id));
      nodeRefs.current.delete(bullet.id);
    }, duration * 1000 + 400);
  }, []);

  // 设置穿透状态（去抖，只在变化时调用）
  const setIgnore = useCallback((ignore: boolean) => {
    if (ignoreRef.current === ignore) return;
    ignoreRef.current = ignore;
    void invoke('set_danmaku_ignore_cursor', { ignore }).catch(() => {});
  }, []);

  // 鼠标位置轮询：穿透模式下也能感知鼠标是否悬停在弹幕上，从而临时关闭穿透以便点击
  useEffect(() => {
    let raf = 0;
    let stopped = false;
    let busy = false;
    const tick = async () => {
      if (stopped) return;
      // 有定住的弹幕时，保持可交互（不穿透），等待用户点击按钮或空白
      if (pinnedIdRef.current !== null) {
        setIgnore(false);
      } else if (nodeRefs.current.size === 0) {
        // 屏幕上没有弹幕时保持穿透，省去无谓的 IPC 轮询
        setIgnore(true);
      } else if (!busy) {
        busy = true;
        try {
          const pos = await invoke<[number, number] | null>('danmaku_cursor_pos');
          if (pos) {
            const [cx, cy] = pos;
            let over = false;
            nodeRefs.current.forEach((el) => {
              if (over || !el) return;
              const r = el.getBoundingClientRect();
              if (cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom) over = true;
            });
            setIgnore(!over);
          }
        } catch { /* ignore */ }
        busy = false;
      }
      raf = window.setTimeout(tick, 60) as unknown as number;
    };
    tick();
    return () => { stopped = true; window.clearTimeout(raf); };
  }, [setIgnore]);

  useEffect(() => {
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
    // 注意：不再把整个 body 设为 pointer-events:none，否则无法点击弹幕。
    // 穿透由 Rust set_ignore_cursor_events 动态控制；空白区域由根容器 pointer-events 处理。
    body.style.pointerEvents = 'auto';
    body.style.userSelect = 'none';
    if (root) {
      root.style.background = 'transparent';
      root.style.pointerEvents = 'auto';
    }

    let un: (() => void) | undefined;
    listen<DanmakuPayload>('danmaku-msg', (e) => {
      if (e.payload && (e.payload.text || e.payload.image)) spawn(e.payload);
    }).then((fn) => { un = fn; });
    return () => {
      if (un) un();
      html.style.background = prev.htmlBg;
      body.style.background = prev.bodyBg;
      body.style.pointerEvents = prev.bodyPe;
      body.style.overflow = prev.bodyOverflow;
    };
  }, [spawn]);

  const onBulletClick = useCallback((e: React.MouseEvent, b: Bullet) => {
    e.stopPropagation();
    setPinnedId((cur) => (cur === b.id ? null : b.id));
  }, []);

  // 点击空白区域：取消定住，让弹幕继续飘动并在飘出后移除
  const onBackgroundClick = useCallback(() => {
    if (pinnedIdRef.current !== null) {
      const pid = pinnedIdRef.current;
      setPinnedId(null);
      // 恢复后按其完整时长兜底移除（恢复点在动画中段，剩余时间必然更短，飘出屏幕后清理）
      setBullets((prev) => {
        const b = prev.find((x) => x.id === pid);
        const ms = (b ? b.duration : 8) * 1000 + 400;
        window.setTimeout(() => {
          setBullets((cur) => cur.filter((x) => x.id !== pid));
          nodeRefs.current.delete(pid);
        }, ms);
        return prev;
      });
    }
  }, []);

  const doCopy = useCallback(async (b: Bullet) => {
    const t = b.copyText ?? b.text;
    try {
      await writeText(t);
      showToast('已复制消息内容');
    } catch {
      try { await navigator.clipboard.writeText(t); showToast('已复制消息内容'); }
      catch { showToast('复制失败'); }
    }
  }, [showToast]);

  const doDownload = useCallback(async (b: Bullet) => {
    if (!b.image) return;
    try {
      const path = await invoke<string>('save_danmaku_image', { dataUrl: b.image });
      showToast('图片已保存到下载文件夹');
      void path;
    } catch (err) {
      showToast('保存失败');
    }
  }, [showToast]);

  return (
    <div
      className="danmaku-root"
      style={{ opacity, pointerEvents: pinnedId !== null ? 'auto' : 'none' }}
      onClick={onBackgroundClick}
    >
      {bullets.map((b) => {
        const pinned = pinnedId === b.id;
        return (
          <div
            key={b.id}
            ref={(el) => { if (el) nodeRefs.current.set(b.id, el); else nodeRefs.current.delete(b.id); }}
            className={`danmaku-bullet${pinned ? ' danmaku-pinned' : ''}`}
            style={{
              top: `${b.top}px`,
              color: b.color,
              fontSize: `${b.fontSize}px`,
              animationDuration: `${b.duration}s`,
              animationPlayState: pinned ? 'paused' : 'running',
              pointerEvents: 'auto',
            }}
            onClick={(e) => onBulletClick(e, b)}
          >
            {b.kind === 'image' && b.image ? (
              <img className="danmaku-img" src={b.image} alt="img" style={{ height: `${b.fontSize * 1.8}px` }} draggable={false} />
            ) : (
              <span>{b.text}</span>
            )}
            {pinned && (
              <div className="danmaku-actions" onClick={(e) => e.stopPropagation()}>
                {b.kind === 'image' ? (
                  <button className="danmaku-action-btn" onClick={() => doDownload(b)}>下载图片</button>
                ) : (
                  <button className="danmaku-action-btn" onClick={() => doCopy(b)}>复制内容</button>
                )}
              </div>
            )}
          </div>
        );
      })}
      {toast && <div className="danmaku-toast">{toast}</div>}
    </div>
  );
};
