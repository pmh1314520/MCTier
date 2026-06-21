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

  // 试听（audition）相关：独立的麦克风/引擎/音频上下文，避免影响正在进行的通话
  private auditionEngine: VoiceChanger | null = null;
  private auditionMic: MediaStream | null = null;
  private auditionCtx: AudioContext | null = null;
  private auditioning = false;

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
    // 试听中也实时切换，便于对比不同音色
    if (this.auditioning && this.auditionEngine) {
      this.auditionEngine.setPreset(preset);
    }
  }

  isAuditioning(): boolean {
    return this.auditioning;
  }

  /**
   * 开始试听：打开麦克风，用当前音色变声后实时回放到扬声器，
   * 用户可以直接说话听到变声效果。
   */
  async startAudition(): Promise<void> {
    await this.stopAudition();
    const raw = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    this.auditionMic = raw;
    this.auditionEngine = new VoiceChanger();
    const processed = this.auditionEngine.attach(raw, this.preset);

    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC();
    this.auditionCtx = ctx;
    const src = ctx.createMediaStreamSource(processed);
    // 实时回放（不加延迟，避免输出被麦克风再次采集形成叠加回声）
    src.connect(ctx.destination);
    try { await ctx.resume(); } catch { /* ignore */ }
    this.auditioning = true;
  }

  /** 停止试听并释放麦克风/音频资源 */
  async stopAudition(): Promise<void> {
    this.auditioning = false;
    if (this.auditionMic) {
      this.auditionMic.getTracks().forEach((t) => t.stop());
      this.auditionMic = null;
    }
    if (this.auditionEngine) {
      this.auditionEngine.dispose();
      this.auditionEngine = null;
    }
    if (this.auditionCtx) {
      try { await this.auditionCtx.close(); } catch { /* ignore */ }
      this.auditionCtx = null;
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
