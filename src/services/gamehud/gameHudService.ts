/**
 * 游戏内 HUD 浮层服务（主窗口侧）
 * - 管理 HUD 透明度配置（持久化到 localStorage，全局设置 / 大厅动态设置共用）
 * - 透明度变化时实时推送给 HUD 浮层窗口，无需重开
 */

import { emitTo } from '@tauri-apps/api/event';

const LS_KEY = 'mctier_game_hud_opacity';
export const DEFAULT_HUD_OPACITY = 0.85;
const MIN_OPACITY = 0.2;
const MAX_OPACITY = 1;

const clamp = (v: number) => Math.min(MAX_OPACITY, Math.max(MIN_OPACITY, v));

class GameHudService {
  private opacity = DEFAULT_HUD_OPACITY;

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw != null) {
        const v = parseFloat(raw);
        if (!Number.isNaN(v)) this.opacity = clamp(v);
      }
    } catch {
      this.opacity = DEFAULT_HUD_OPACITY;
    }
  }

  getOpacity(): number {
    return this.opacity;
  }

  async setOpacity(v: number): Promise<void> {
    this.opacity = clamp(v);
    try { localStorage.setItem(LS_KEY, String(this.opacity)); } catch { /* ignore */ }
    // 实时通知 HUD 浮层窗口应用新的透明度
    try { await emitTo('gamehud', 'hud-config', { opacity: this.opacity }); } catch { /* HUD 窗口未开时忽略 */ }
  }
}

export const gameHudService = new GameHudService();
