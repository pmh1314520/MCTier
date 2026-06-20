/**
 * 音效服务
 * 管理应用中的所有音效播放
 * 支持：自定义提示音（可恢复默认）、音量调节、消息免打扰时段
 */

import { convertFileSrc } from '@tauri-apps/api/core';

export type SoundType = 'newMessage' | 'userJoined' | 'userLeft';

const DEFAULT_SRC: Record<SoundType, string> = {
  newMessage: 'NewMsg.mp3',
  userJoined: 'UserJoined.mp3',
  userLeft: 'UserLeft.mp3',
};

const LS_KEY = 'mctier_sound_settings';

interface SoundSettings {
  volume: number; // 0~1
  muted: boolean; // 旧版全局禁音（保留用于迁移）
  mutedSounds: Partial<Record<SoundType, boolean>>; // 每个音效是否独立禁音
  custom: Partial<Record<SoundType, string>>; // 自定义音频文件路径（空=默认）
  dndEnabled: boolean;
  dndStart: number; // 自 00:00 起的分钟数
  dndEnd: number;
}

const defaultSettings: SoundSettings = {
  volume: 0.5,
  muted: false,
  mutedSounds: {},
  custom: {},
  dndEnabled: false,
  dndStart: 22 * 60,
  dndEnd: 8 * 60,
};

class AudioService {
  private sounds: Map<SoundType, HTMLAudioElement> = new Map();
  private enabled: boolean = true;
  private settings: SoundSettings = defaultSettings;

  constructor() {
    this.loadSettings();
    this.initializeSounds();
  }

  private loadSettings() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) this.settings = { ...defaultSettings, ...JSON.parse(raw) };
      if (!this.settings.mutedSounds) this.settings.mutedSounds = {};
      // 旧版全局禁音迁移：muted=true 时把所有音效设为禁音
      if (this.settings.muted && Object.keys(this.settings.mutedSounds).length === 0) {
        this.settings.mutedSounds = { newMessage: true, userJoined: true, userLeft: true };
      }
    } catch {
      this.settings = { ...defaultSettings, mutedSounds: {} };
    }
  }

  private persist() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(this.settings)); } catch { /* ignore */ }
  }

  getSettings(): SoundSettings { return { ...this.settings, custom: { ...this.settings.custom } }; }

  /** 初始化所有音效（按自定义/默认源） */
  private initializeSounds() {
    (Object.keys(DEFAULT_SRC) as SoundType[]).forEach((type) => {
      this.rebuild(type);
    });
    console.log('音效系统初始化成功');
  }

  private rebuild(type: SoundType) {
    try {
      const custom = this.settings.custom[type];
      let src: string;
      if (!custom) src = new URL(DEFAULT_SRC[type], window.location.href).href;
      else if (custom.startsWith('data:') || custom.startsWith('http')) src = custom; // data URL 或网络地址直接用
      else src = convertFileSrc(custom); // 本地文件路径
      const audio = new Audio(src);
      audio.preload = 'auto';
      audio.volume = this.settings.volume;
      this.sounds.set(type, audio);
    } catch (error) {
      console.error('构建音效失败:', type, error);
    }
  }

  /** 是否处于免打扰时段（支持跨午夜） */
  private inDnd(): boolean {
    if (!this.settings.dndEnabled) return false;
    const now = new Date();
    const cur = now.getHours() * 60 + now.getMinutes();
    const { dndStart: s, dndEnd: e } = this.settings;
    return s <= e ? cur >= s && cur < e : cur >= s || cur < e;
  }

  /** 播放指定音效 */
  async play(soundType: SoundType): Promise<void> {
    if (!this.enabled) return;
    if (this.settings.mutedSounds?.[soundType]) { console.log('该音效已禁音，跳过:', soundType); return; }
    if (this.inDnd()) { console.log('免打扰时段，跳过音效:', soundType); return; }
    try {
      const cached = this.sounds.get(soundType);
      if (!cached) return;
      const sound = new Audio(cached.currentSrc || cached.src);
      sound.preload = 'auto';
      sound.volume = this.settings.volume;
      sound.currentTime = 0;
      await sound.play();
    } catch (error) {
      console.error('播放音效失败:', soundType, error);
    }
  }

  /** 设置音效音量（持久化） */
  setVolume(volume: number) {
    const v = Math.max(0, Math.min(1, volume));
    this.settings.volume = v;
    this.sounds.forEach((sound) => { sound.volume = v; });
    this.persist();
  }

  /** 设置自定义提示音（path 为本地文件绝对路径） */
  setCustomSound(type: SoundType, path: string) {
    this.settings.custom[type] = path;
    this.rebuild(type);
    this.persist();
  }

  /** 恢复某提示音为默认 */
  resetSound(type: SoundType) {
    delete this.settings.custom[type];
    this.rebuild(type);
    this.persist();
  }

  /** 设置免打扰时段 */
  setDnd(enabled: boolean, start?: number, end?: number) {
    this.settings.dndEnabled = enabled;
    if (typeof start === 'number') this.settings.dndStart = start;
    if (typeof end === 'number') this.settings.dndEnd = end;
    this.persist();
  }

  setEnabled(enabled: boolean) { this.enabled = enabled; }
  isEnabled(): boolean { return this.enabled; }
  /** 获取禁音状态 */
  isMuted(): boolean { return this.settings.muted; }
  /** 读取设置（含muted） */
  getFullSettings(): SoundSettings { return { ...this.settings, custom: { ...this.settings.custom } }; }

  setMuted(muted: boolean) {
    this.settings.muted = muted;
    this.persist();
  }

  /** 某个音效是否禁音 */
  isSoundMuted(type: SoundType): boolean {
    return !!this.settings.mutedSounds?.[type];
  }

  /** 设置某个音效是否禁音（独立配置） */
  setSoundMuted(type: SoundType, muted: boolean) {
    if (!this.settings.mutedSounds) this.settings.mutedSounds = {};
    this.settings.mutedSounds[type] = muted;
    this.persist();
  }
}

// 导出单例
export const audioService = new AudioService();
