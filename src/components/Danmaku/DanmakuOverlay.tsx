import React, { useEffect, useRef, useState, useCallback } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { tl } from '../../i18n';
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
 * 弹幕覆盖窗口的渲染组件（运行在独立的置顶透明窗口中）。
 * 桌面端交互：鼠标悬停到弹幕上即暂停（定住）并显示操作按钮（文本→复制，图片→下载）；
 * 鼠标移开自动恢复飘动；点击复制/下载后也立即恢复飘动。
 */
export const DanmakuOverlay: React.FC = () => {
  const [bullets, setBullets] = useState<Bullet[]>([]);
  const [opacity, setOpacity] = useState(0.9);
  const [hoverId, setHoverId] = useState<number | null>(null);
  const [toast, setToast] = useState<string>('');
  const [, setLangTick] = useState(0);
  const idRef = useRef(1);
  const trackFreeAt = useRef<number[]>([]);
  const nodeRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const actionBtnRef = useRef<HTMLDivElement | null>(null);
  const hoverIdRef = useRef<number | null>(null);
  const actionedRef = useRef<Set<number>>(new Set()); // 已点过按钮的弹幕：不再因悬停暂停，直接飘走
  const ignoreRef = useRef<boolean>(true);
  const toastTimer = useRef<number | null>(null);

  hoverIdRef.current = hoverId;

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
    const imgH = p.fontSize * 1.55;
    const estWidth = isImage
      ? (p.text.length * p.fontSize * 0.62) + p.fontSize * 3.6 + 50
      : p.text.length * p.fontSize * 0.62 + 40;
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
    // 移除交由 onAnimationEnd 处理：暂停时动画不结束故不会被移除，恢复后飘出自动清理。
  }, []);

  const setIgnore = useCallback((ignore: boolean) => {
    if (ignoreRef.current === ignore) return;
    ignoreRef.current = ignore;
    void invoke('set_danmaku_ignore_cursor', { ignore }).catch(() => {});
  }, []);

  const within = (r: DOMRect, x: number, y: number) =>
    x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;

  // 轮询鼠标位置：悬停到某条弹幕（或其操作按钮）上时暂停该弹幕，移开后恢复。
  useEffect(() => {
    let timer = 0;
    let stopped = false;
    let busy = false;
    const tick = async () => {
      if (stopped) return;
      if (nodeRefs.current.size === 0) {
        if (hoverIdRef.current !== null) setHoverId(null);
        setIgnore(true);
      } else if (!busy) {
        busy = true;
        try {
          const pos = await invoke<[number, number] | null>('danmaku_cursor_pos');
          if (pos) {
            const [cx, cy] = pos;
            let target: number | null = null;
            const hid = hoverIdRef.current;
            // 1) 维持当前悬停：鼠标仍在该弹幕或其按钮上
            if (hid !== null) {
              const el = nodeRefs.current.get(hid);
              const btn = actionBtnRef.current;
              const overBullet = !!el && within(el.getBoundingClientRect(), cx, cy);
              const overBtn = !!btn && within(btn.getBoundingClientRect(), cx, cy);
              if (overBullet || overBtn) target = hid;
            }
            // 2) 否则寻找鼠标下的新弹幕（已点过按钮的跳过）
            if (target === null) {
              nodeRefs.current.forEach((el, id) => {
                if (target !== null || actionedRef.current.has(id)) return;
                if (within(el.getBoundingClientRect(), cx, cy)) target = id;
              });
            }
            if (target !== hoverIdRef.current) setHoverId(target);
            setIgnore(target === null);
          }
        } catch { /* ignore */ }
        busy = false;
      }
      timer = window.setTimeout(tick, 50) as unknown as number;
    };
    tick();
    return () => { stopped = true; window.clearTimeout(timer); };
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
    // body 保持 pointer-events:none 确保透明穿透窗正常渲染；弹幕/按钮单独设 auto 即可点击。
    body.style.pointerEvents = 'none';
    body.style.userSelect = 'none';
    if (root) {
      root.style.background = 'transparent';
      root.style.pointerEvents = 'none';
    }

    let un: (() => void) | undefined;
    listen<DanmakuPayload>('danmaku-msg', (e) => {
      if (e.payload && (e.payload.text || e.payload.image)) spawn(e.payload);
    }).then((fn) => { un = fn; });
    // 语言同步：主窗口切换语言时本窗口随之刷新
    let unLang: (() => void) | undefined;
    listen<string>('mctier-lang-changed', (e) => {
      const lang = e.payload === 'en' ? 'en' : 'zh';
      void import('../../i18n').then(({ applyLanguageLocal }) => { applyLanguageLocal(lang); });
      setLangTick((t) => t + 1);
    }).then((fn) => { unLang = fn; });
    return () => {
      if (un) un();
      if (unLang) unLang();
      html.style.background = prev.htmlBg;
      body.style.background = prev.bodyBg;
      body.style.pointerEvents = prev.bodyPe;
      body.style.overflow = prev.bodyOverflow;
    };
  }, [spawn]);

  const removeBullet = useCallback((id: number) => {
    setBullets((prev) => prev.filter((b) => b.id !== id));
    nodeRefs.current.delete(id);
    actionedRef.current.delete(id);
    if (hoverIdRef.current === id) setHoverId(null);
  }, []);

  // 点击按钮后立即恢复飘动：标记为已操作并取消悬停暂停
  const releaseAfterAction = useCallback((id: number) => {
    actionedRef.current.add(id);
    setHoverId(null);
    setIgnore(true);
  }, [setIgnore]);

  const doCopy = useCallback(async (b: Bullet) => {
    const t = b.copyText ?? b.text;
    try {
      const mod = await import('@tauri-apps/plugin-clipboard-manager');
      await mod.writeText(t);
      showToast(tl('已复制消息内容', 'Message content copied'));
    } catch {
      try { await navigator.clipboard.writeText(t); showToast(tl('已复制消息内容', 'Message content copied')); }
      catch { showToast(tl('复制失败', 'Copy failed')); }
    }
    releaseAfterAction(b.id);
  }, [showToast, releaseAfterAction]);

  const doDownload = useCallback(async (b: Bullet) => {
    if (!b.image) { releaseAfterAction(b.id); return; }
    try {
      await invoke<string>('save_danmaku_image', { dataUrl: b.image });
      showToast(tl('图片已保存到下载文件夹', 'Image saved to Downloads'));
    } catch {
      showToast(tl('保存失败', 'Save failed'));
    }
    releaseAfterAction(b.id);
  }, [showToast, releaseAfterAction]);

  return (
    <div className="danmaku-root" style={{ opacity, pointerEvents: 'none' }}>
      {bullets.map((b) => {
        const paused = hoverId === b.id;
        return (
          <div
            key={b.id}
            ref={(el) => { if (el) nodeRefs.current.set(b.id, el); else nodeRefs.current.delete(b.id); }}
            className={`danmaku-bullet${paused ? ' danmaku-pinned' : ''}`}
            style={{
              top: `${b.top}px`,
              color: b.color,
              fontSize: `${b.fontSize}px`,
              animationDuration: `${b.duration}s`,
              animationPlayState: paused ? 'paused' : 'running',
              pointerEvents: 'auto',
            }}
            onAnimationEnd={() => removeBullet(b.id)}
          >
            {b.kind === 'image' && b.image ? (
              <>
                {b.text && <span className="danmaku-name">{b.text}</span>}
                <img className="danmaku-img" src={b.image} alt="img" style={{ height: `${b.fontSize * 1.55}px`, maxWidth: `${b.fontSize * 3.6}px` }} draggable={false} />
              </>
            ) : (
              <span>{b.text}</span>
            )}
            {paused && (
              <div className="danmaku-actions" ref={actionBtnRef}>
                {b.kind === 'image' ? (
                  <button className="danmaku-action-btn" onClick={() => doDownload(b)}>{tl('下载图片', 'Download')}</button>
                ) : (
                  <button className="danmaku-action-btn" onClick={() => doCopy(b)}>{tl('复制内容', 'Copy')}</button>
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
