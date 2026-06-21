import React, { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { tl } from '../../i18n';
import './GameHudOverlay.css';

interface HudPeer {
  name: string;
  ping: number | null; // ms，null=不可达
  loss: number;        // 丢包率 0~100
  speaking: boolean;
  self: boolean;
}

interface HudPayload {
  peers: HudPeer[];
}

/**
 * 游戏内 HUD 浮层（运行在独立的置顶透明穿透窗口）。
 * 接收主窗口推送的 'hud-update' 事件，显示每位队友的延迟/丢包与"谁在说话"。
 */
export const GameHudOverlay: React.FC = () => {
  const [peers, setPeers] = useState<HudPeer[]>([]);
  const [, setLangTick] = useState(0);
  const cardRef = useRef<HTMLDivElement>(null);
  const ignoreRef = useRef<boolean>(true);

  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    html.style.background = 'transparent';
    body.style.background = 'transparent';
    body.style.margin = '0';
    body.style.overflow = 'hidden';
    body.style.pointerEvents = 'none';
    body.style.userSelect = 'none';
    const root = document.getElementById('root');
    if (root) { root.style.background = 'transparent'; root.style.pointerEvents = 'none'; }

    let un: (() => void) | undefined;
    listen<HudPayload>('hud-update', (e) => {
      if (e.payload && Array.isArray(e.payload.peers)) setPeers(e.payload.peers);
    }).then((fn) => { un = fn; });
    let unLang: (() => void) | undefined;
    listen<string>('mctier-lang-changed', (e) => {
      const lang = e.payload === 'en' ? 'en' : 'zh';
      void import('../../i18n').then(({ applyLanguageLocal }) => { applyLanguageLocal(lang); });
      setLangTick((t) => t + 1);
    }).then((fn) => { unLang = fn; });
    return () => { if (un) un(); if (unLang) unLang(); };
  }, []);

  // 光标轮询：悬停到 HUD 卡片上时关闭穿透以便拖动，移开恢复穿透不挡游戏
  useEffect(() => {
    let timer = 0;
    let stopped = false;
    let busy = false;
    const setIgnore = (ig: boolean) => {
      if (ignoreRef.current === ig) return;
      ignoreRef.current = ig;
      void invoke('set_gamehud_ignore_cursor', { ignore: ig }).catch(() => {});
    };
    const tick = async () => {
      if (stopped) return;
      if (!busy) {
        busy = true;
        try {
          const pos = await invoke<[number, number] | null>('gamehud_cursor_pos');
          const el = cardRef.current;
          if (pos && el) {
            const [cx, cy] = pos;
            const r = el.getBoundingClientRect();
            setIgnore(!(cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom));
          }
        } catch { /* ignore */ }
        busy = false;
      }
      timer = window.setTimeout(tick, 120) as unknown as number;
    };
    tick();
    return () => { stopped = true; window.clearTimeout(timer); };
  }, []);

  const onDragStart = (e: React.MouseEvent) => {
    // 仅左键、且不在按钮等元素上时拖动整窗
    if (e.button !== 0) return;
    void getCurrentWindow().startDragging().catch(() => {});
  };

  const pingColor = (p: number | null) => {
    if (p == null) return '#ff5a5a';
    if (p < 80) return '#7ccf00';
    if (p < 200) return '#ffcc00';
    return '#ff8a3d';
  };

  return (
    <div className="hud-root" ref={cardRef} style={{ pointerEvents: 'auto' }} onMouseDown={onDragStart}>
      <div className="hud-title">MCTier · {tl('队伍状态（可拖动）', 'Squad (drag to move)')}</div>
      {peers.length === 0 ? (
        <div className="hud-empty">{tl('暂无队友数据', 'No teammates yet')}</div>
      ) : (
        peers.map((p, i) => (
          <div className="hud-row" key={i}>
            <span className={`hud-dot${p.speaking ? ' speaking' : ''}`} />
            <span className="hud-name">{p.name}{p.self ? tl('（我）', ' (me)') : ''}</span>
            {p.self ? (
              <span className="hud-ping" style={{ color: '#9aa0a6' }}>—</span>
            ) : (
              <span className="hud-ping" style={{ color: pingColor(p.ping) }}>
                {p.ping == null ? tl('离线', 'off') : `${p.ping}ms`}{p.loss > 0 && p.ping != null ? ` · ${p.loss}%` : ''}
              </span>
            )}
          </div>
        ))
      )}
    </div>
  );
};
