/**
 * 弹幕服务（主窗口侧）
 * - 管理弹幕配置（持久化）
 * - 控制弹幕覆盖窗口的开启/关闭
 * - 把聊天消息以事件形式发送给弹幕窗口渲染
 */

import { invoke } from '@tauri-apps/api/core';
import { emitTo } from '@tauri-apps/api/event';

export interface DanmakuConfig {
  enabled: boolean;
  fontSize: number;   // 字号 px
  speed: number;      // 滚动速度 px/s
  opacity: number;    // 不透明度 0~1
  tracks: number;     // 弹幕轨道数（行数）
  color: string;      // 弹幕文字颜色
}

export const DEFAULT_DANMAKU_CONFIG: DanmakuConfig = {
  enabled: true,
  fontSize: 24,
  speed: 140,
  opacity: 0.9,
  tracks: 4,
  color: '#ffffff',
};

const LS_KEY = 'mctier_danmaku_config';

/** 生成一个明亮鲜艳的随机颜色（用于"彩色"模式，每条弹幕颜色不同） */
function randomBrightColor(): string {
  const h = Math.floor(Math.random() * 360);
  return `hsl(${h}, 85%, 62%)`;
}

/** 解析配置颜色：'rainbow' 返回随机色，否则原样返回 */
function resolveColor(color: string): string {
  return color === 'rainbow' ? randomBrightColor() : color;
}

export interface DanmakuPayload {
  text: string;
  color: string;
  fontSize: number;
  speed: number;
  opacity: number;
  tracks: number;
  /** 弹幕类型：text=文本，image=图片 */
  kind?: 'text' | 'image';
  /** 图片弹幕的图片数据（data URL） */
  image?: string;
  /** 文本弹幕可复制的原始消息内容（点击弹幕后复制用） */
  copyText?: string;
}

/** push 的可选项 */
export interface DanmakuPushOptions {
  color?: string;
  kind?: 'text' | 'image';
  image?: string;
  copyText?: string;
}

class DanmakuService {
  private config: DanmakuConfig = { ...DEFAULT_DANMAKU_CONFIG };

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) this.config = { ...DEFAULT_DANMAKU_CONFIG, ...JSON.parse(raw) };
    } catch {
      this.config = { ...DEFAULT_DANMAKU_CONFIG };
    }
  }

  getConfig(): DanmakuConfig {
    return { ...this.config };
  }

  async setConfig(patch: Partial<DanmakuConfig>): Promise<void> {
    const prevEnabled = this.config.enabled;
    this.config = { ...this.config, ...patch };
    try { localStorage.setItem(LS_KEY, JSON.stringify(this.config)); } catch { /* ignore */ }
    // 启用状态变化时开/关窗口
    if (this.config.enabled !== prevEnabled) {
      if (this.config.enabled) await this.openWindow();
      else await this.closeWindow();
    }
  }

  async openWindow(): Promise<void> {
    try { await invoke('open_danmaku_window'); } catch (e) { console.warn('打开弹幕窗口失败', e); }
  }

  async closeWindow(): Promise<void> {
    try { await invoke('close_danmaku_window'); } catch (e) { console.warn('关闭弹幕窗口失败', e); }
  }

  /** 进入大厅时按配置决定是否开启弹幕窗 */
  async syncWindowForLobby(inLobby: boolean): Promise<void> {
    if (inLobby && this.config.enabled) await this.openWindow();
    else if (!inLobby) await this.closeWindow();
  }

  /** 发送一条弹幕（带当前配置）。opts 可携带颜色/类型/图片/可复制文本 */
  async push(text: string, opts?: DanmakuPushOptions | string): Promise<void> {
    if (!this.config.enabled) return;
    // 兼容旧调用：第二参数为字符串时视为 color
    const o: DanmakuPushOptions = typeof opts === 'string' ? { color: opts } : (opts || {});
    const isImage = o.kind === 'image';
    if (!isImage && !text.trim()) return;
    const payload: DanmakuPayload = {
      text,
      color: resolveColor(o.color || this.config.color),
      fontSize: this.config.fontSize,
      speed: this.config.speed,
      opacity: this.config.opacity,
      tracks: this.config.tracks,
      kind: o.kind || 'text',
      image: o.image,
      copyText: o.copyText,
    };
    try {
      await emitTo('danmaku', 'danmaku-msg', payload);
    } catch (e) {
      console.warn('发送弹幕失败', e);
    }
  }

  /** 预览：临时开启窗口并发送一条示例弹幕（不改变 enabled 持久化状态） */
  async preview(text: string): Promise<void> {
    await this.openWindow();
    const payload: DanmakuPayload = {
      text,
      color: resolveColor(this.config.color),
      fontSize: this.config.fontSize,
      speed: this.config.speed,
      opacity: this.config.opacity,
      tracks: this.config.tracks,
    };
    // 等窗口就绪
    setTimeout(() => { void emitTo('danmaku', 'danmaku-msg', payload); }, 350);
    // 若未启用，预览几秒后自动关闭
    if (!this.config.enabled) {
      setTimeout(() => { void this.closeWindow(); }, 6000);
    }
  }
}

export const danmakuService = new DanmakuService();
