/**
 * 游戏内 HUD 浮层服务（主窗口侧）
 * - 管理 HUD 透明度与尺寸（等比缩放）配置（持久化到 localStorage，全局设置 / 大厅动态设置共用）
 * - 配置变化时实时推送给 HUD 浮层窗口，无需重开
 */

import { emitTo } from '@tauri-apps/api/event';

const LS_OPACITY = 'mctier_game_hud_opacity';
const LS_SCALE = 'mctier_game_hud_scale';
export const DEFAULT_HUD_OPACITY = 0.85;
export const DEFAULT_HUD_SCALE = 1.0;
const MIN_OPACITY = 0.2;
const MAX_OPACITY = 1;
const MIN_SCALE = 0.7;
const MAX_SCALE = 1.6;

const clampOpacity = (v: number) => Math.min(MAX_OPACITY, Math.max(MIN_OPACITY, v));
const clampScale = (v: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, v));

class GameHudService {
  private opacity = DEFAULT_HUD_OPACITY;
  private scale = DEFAULT_HUD_SCALE;

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      const o = localStorage.getItem(LS_OPACITY);
      if (o != null) {
        const v = parseFloat(o);
        if (!Number.isNaN(v)) this.opacity = clampOpacity(v);
      }
      const s = localStorage.getItem(LS_SCALE);
      if (s != null) {
        const v = parseFloat(s);
        if (!Number.isNaN(v)) this.scale = clampScale(v);
      }
    } catch {
      this.opacity = DEFAULT_HUD_OPACITY;
      this.scale = DEFAULT_HUD_SCALE;
    }
  }

  getOpacity(): number {
    return this.opacity;
  }

  getScale(): number {
    return this.scale;
  }

  async setOpacity(v: number): Promise<void> {
    this.opacity = clampOpacity(v);
    try { localStorage.setItem(LS_OPACITY, String(this.opacity)); } catch { /* ignore */ }
    await this.emitConfig();
  }

  async setScale(v: number): Promise<void> {
    this.scale = clampScale(v);
    try { localStorage.setItem(LS_SCALE, String(this.scale)); } catch { /* ignore */ }
    await this.emitConfig();
  }

  /** 实时通知 HUD 浮层窗口应用新的透明度/尺寸 */
  private async emitConfig(): Promise<void> {
    try { await emitTo('gamehud', 'hud-config', { opacity: this.opacity, scale: this.scale }); } catch { /* HUD 窗口未开时忽略 */ }
  }
}

export const gameHudService = new GameHudService();
