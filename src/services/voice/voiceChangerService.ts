/**
 * 变声服务（主窗口侧）
 * - 持久化当前音色预设（全局默认 = 进入大厅时使用；大厅动态设置可实时切换）
 * - 持有 VoiceChanger 引擎，对麦克风流做实时变声，输出稳定轨道供 WebRTC 发送
 */

import { VoiceChanger, type VoicePreset } from './voiceChanger';

const LS_KEY = 'mctier_voice_preset';

export const VOICE_PRESETS: { id: VoicePreset; zh: string; en: string }[] = [
  { id: 'none', zh: '原声', en: 'Original' },
  { id: 'uncle', zh: '大叔', en: 'Uncle' },
  { id: 'male', zh: '男声', en: 'Male' },
  { id: 'female', zh: '女声', en: 'Female' },
  { id: 'loli', zh: '萝莉', en: 'Loli' },
  { id: 'chipmunk', zh: '花栗鼠', en: 'Chipmunk' },
  { id: 'robot', zh: '机器人', en: 'Robot' },
  { id: 'telephone', zh: '电话音', en: 'Telephone' },
];

class VoiceChangerService {
  private engine = new VoiceChanger();
  private preset: VoicePreset = 'none';
  private active = false;

  constructor() {
    try {
      const saved = localStorage.getItem(LS_KEY) as VoicePreset | null;
      if (saved) this.preset = saved;
    } catch { /* ignore */ }
  }

  getPreset(): VoicePreset {
    return this.preset;
  }

  /** 设置音色：持久化 + 若正在变声则实时切换 */
  setPreset(preset: VoicePreset): void {
    this.preset = preset;
    try { localStorage.setItem(LS_KEY, preset); } catch { /* ignore */ }
    if (this.active) {
      this.engine.setPreset(preset);
    }
  }

  /** 处理原始麦克风流，返回用于发送的变声流（始终经过引擎，便于大厅内无缝切换） */
  process(rawStream: MediaStream): MediaStream {
    try {
      const out = this.engine.attach(rawStream, this.preset);
      this.active = true;
      return out;
    } catch (e) {
      console.warn('变声器初始化失败，使用原始音频', e);
      this.active = false;
      return rawStream;
    }
  }

  /** 麦克风关闭/清理时调用 */
  dispose(): void {
    this.active = false;
    this.engine.dispose();
  }
}

export const voiceChangerService = new VoiceChangerService();
