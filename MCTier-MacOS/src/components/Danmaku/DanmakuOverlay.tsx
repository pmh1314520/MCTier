import React, { useEffect, useRef, useState, useCallback } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { tl } from '../../i18n';
import {
  MAX_CHAT_TEXT_LENGTH,
  sanitizeImageDataUrl,
  sanitizeUntrustedText,
  sanitizeIdentifier,
} from '../../security/trustBoundary';
import './DanmakuOverlay.css';
import type { PreviewKind } from '../../services/danmaku/messagePreview';
import { safeVoiceUrl } from '../../services/chat/voiceMessage';
import { parseChatAttachment, type ChatAttachment } from '../../services/chat/fileAttachment';
import { FileOutlined, PlayCircleOutlined, AudioOutlined, SoundOutlined } from '@ant-design/icons';

interface Bullet {
  attachment?: ChatAttachment;
  ownerPlayerId?: string;
  voice?: string;
  id: number;
  text: string;
  color: string;
  fontSize: number;
  duration: number; // s
  top: number;      // px
  kind: PreviewKind;
  detail?: string;
  image?: string;
  copyText?: string;
}

interface DanmakuPayload {
  attachment?: ChatAttachment;
  ownerPlayerId?: string;
  voice?: string;
  text: string;
  color: string;
  fontSize: number;
  speed: number;
  opacity: number;
  tracks: number;
  kind?: PreviewKind;
  detail?: string;
  image?: string;
  copyText?: string;
}

/**
 * 弹幕覆盖窗口的渲染组件（运行在独立的置顶透明窗口中）。
 * 鼠标悬停暂停以便点击；直接点击文本复制、语音播放、图片/附件下载。
 * 鼠标移开或点击后恢复飘动，每条弹幕最多触发一次操作。
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
  const hoverIdRef = useRef<number | null>(null);
  const actionedRef = useRef<Set<number>>(new Set()); // 已操作的弹幕不再因悬停暂停
  const ignoreRef = useRef<boolean>(true);
  const toastTimer = useRef<number | null>(null);
  const voicePlayer = useRef<HTMLAudioElement | null>(null);
  const stopVoice = useCallback(() => {
    const player = voicePlayer.current;
    voicePlayer.current = null;
    if (player) {
      player.onended = null;
      player.onerror = null;
      player.pause();
      player.removeAttribute('src');
      player.load();
    }
  }, []);

  useEffect(() => () => {
    stopVoice();
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
  }, [stopVoice]);

  hoverIdRef.current = hoverId;

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), 2500);
  }, []);

  const spawn = useCallback((p: DanmakuPayload) => {
    if (!p || typeof p !== 'object') return;
    const text = sanitizeUntrustedText(p.text, MAX_CHAT_TEXT_LENGTH);
    const image = sanitizeImageDataUrl(p.image);
    const kind: PreviewKind = ['image', 'video', 'voice', 'audio', 'file'].includes(p.kind ?? '') ? p.kind! : 'text';
    const isImage = (kind === 'image' || kind === 'video') && !!image;
    if (!text && !isImage) return;

    const vw = window.innerWidth || 1920;
    const tracks = Number.isFinite(p.tracks) ? Math.max(1, Math.min(12, Math.floor(p.tracks))) : 4;
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
    const speed = Number.isFinite(p.speed) ? Math.max(40, Math.min(1000, p.speed)) : 140;
    const fontSize = Number.isFinite(p.fontSize) ? Math.max(12, Math.min(72, p.fontSize)) : 24;
    const imgH = fontSize * 1.55;
    const estWidth = isImage
      ? (text.length * fontSize * 0.62) + fontSize * 3.6 + 50
      : text.length * fontSize * 0.62 + 40;
    const distance = vw + estWidth;
    const duration = distance / speed; // s
    const releaseDelay = (estWidth + 30) / speed * 1000;
    trackFreeAt.current[track] = now + releaseDelay;

    const lineHeight = imgH * 1.6;
    const top = 12 + track * lineHeight;

    const bullet: Bullet = {
      id: idRef.current++,
      text,
      color: typeof p.color === 'string' && p.color.length <= 32 ? p.color : '#ffffff',
      fontSize,
      duration,
      top,
      kind,
      voice: kind === 'voice' && safeVoiceUrl(p.voice) ? p.voice : undefined,
      attachment: parseChatAttachment(p.attachment) ?? undefined,
      ownerPlayerId: sanitizeIdentifier(p.ownerPlayerId) || undefined,
      detail: sanitizeUntrustedText(p.detail, 200),
      image,
      copyText: sanitizeUntrustedText(p.copyText, MAX_CHAT_TEXT_LENGTH),
    };
    setOpacity(Number.isFinite(p.opacity) ? Math.max(0, Math.min(1, p.opacity)) : 0.9);
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
              const overBullet = !!el && within(el.getBoundingClientRect(), cx, cy);
              if (overBullet) target = hid;
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
      if (e.payload && typeof e.payload === 'object') spawn(e.payload);
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

  // 点击后立即恢复飘动：标记为已操作并取消悬停暂停
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
    if (!b.image && !b.attachment) { showToast(tl('下载内容不可用，请在聊天室重试', 'Download unavailable. Try in chat')); releaseAfterAction(b.id); return; }
    try {
      showToast(tl('正在下载…', 'Downloading…'));
      if (b.attachment && b.ownerPlayerId) {
        await invoke<string>('download_danmaku_attachment', { ownerPlayerId: b.ownerPlayerId, attachment: b.attachment });
      } else if (b.image) {
        await invoke<string>('save_danmaku_image', { dataUrl: b.image });
      } else { throw new Error('Missing attachment owner'); }
      showToast(tl('已保存到下载文件夹', 'Saved to Downloads'));
    } catch {
      showToast(tl('保存失败', 'Save failed'));
    }
    releaseAfterAction(b.id);
  }, [showToast, releaseAfterAction]);

  const doPlayVoice = useCallback(async (b: Bullet) => {
    if (!safeVoiceUrl(b.voice)) { showToast(tl('语音不可用，请在聊天室重试', 'Voice unavailable. Try in chat')); return; }
    stopVoice();
    const player = new Audio(b.voice);
    voicePlayer.current = player;
    player.onended = () => { if (voicePlayer.current === player) stopVoice(); };
    player.onerror = () => { if (voicePlayer.current === player) { stopVoice(); showToast(tl('语音播放失败', 'Voice playback failed')); } };
    try { await player.play(); }
    catch { if (voicePlayer.current === player) { stopVoice(); showToast(tl('语音播放失败', 'Voice playback failed')); } }
    releaseAfterAction(b.id);
  }, [showToast, releaseAfterAction, stopVoice]);

  const activateBullet = (b: Bullet) => {
    if (actionedRef.current.has(b.id)) return;
    // Guard before starting async work, so a double click cannot duplicate downloads.
    releaseAfterAction(b.id);
    if (b.attachment || b.kind === 'image' || b.kind === 'file' || b.kind === 'audio' || b.kind === 'video') void doDownload(b);
    else if (b.kind === 'voice') void doPlayVoice(b);
    else void doCopy(b);
  };

  return (
    <div className="danmaku-root" style={{ opacity, pointerEvents: 'none' }}>
      {bullets.map((b) => {
        const paused = hoverId === b.id;
        return (
          <div
            key={b.id}
            ref={(el) => { if (el) nodeRefs.current.set(b.id, el); else nodeRefs.current.delete(b.id); }}
            className={`danmaku-bullet${paused ? ' danmaku-pinned' : ''}`}
            role="button"
            tabIndex={0}
            aria-label={b.kind === 'text' ? tl('复制消息', 'Copy message') : b.kind === 'voice' ? tl('播放语音', 'Play voice') : tl('下载消息附件', 'Download attachment')}
            onClick={() => activateBullet(b)}
            onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activateBullet(b); } }}
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
            {(b.kind === 'image' || b.kind === 'video') && b.image ? (
              <>
                {b.text && <span className="danmaku-name">{b.text}</span>}
                <span className="danmaku-visual"><img className="danmaku-img" src={b.image} alt={b.kind === 'video' ? '视频预览' : '图片'} style={{ height: `${b.fontSize * 1.55}px`, maxWidth: `${b.fontSize * 3.6}px` }} draggable={false} />{b.kind === 'video' && <PlayCircleOutlined className="danmaku-video-mark" />}</span>
              </>
            ) : b.kind !== 'text' ? (
              <span className="danmaku-media-card">
                {b.kind === 'voice' ? <AudioOutlined /> : b.kind === 'audio' ? <SoundOutlined /> : b.kind === 'video' ? <PlayCircleOutlined /> : <FileOutlined />}
                <span><span>{b.text}</span>{b.detail && <small>{b.detail}</small>}</span>
                {b.kind === 'voice' && <span className="danmaku-wave" aria-hidden>▂▅▃▇▅▂</span>}
              </span>
            ) : (
              <span>{b.text}</span>
            )}
          </div>
        );
      })}
      {toast && <div className="danmaku-toast">{toast}</div>}
    </div>
  );
};
