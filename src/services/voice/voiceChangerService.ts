/**
 * 变声服务（主窗口侧）
 * - 持久化当前音色预设（全局默认 = 进入大厅时使用；大厅动态设置可实时切换）
 * - 持有 VoiceChanger 引擎，对麦克风流做实时变声，输出稳定轨道供 WebRTC 发送
 */

import { VoiceChanger, type VoicePreset } from './voiceChanger';
import { isBypassPreset, requiresOutputRebuild } from './voicePresetPolicy';

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
  /** 最近一次 process() 收到的原始麦克风流，用于跨旁路边界切换时重建输出。 */
  private rawStream: MediaStream | null = null;
  /** 输出轨道被替换时通知调用方（WebRTC 侧据此 replaceTrack）。 */
  private onOutputChanged: ((stream: MediaStream) => void) | null = null;

  // 试听（audition）相关：独立的麦克风/引擎/音频上下文，避免影响正在进行的通话
  private auditionEngine: VoiceChanger | null = null;
  private auditionMic: MediaStream | null = null;
  private auditionCtx: AudioContext | null = null;
  private auditioning = false;
  /**
   * 试听代次。跨旁路边界连点音色会连续触发重建，而 startAudition 内部有 await
   * （stopAudition + getUserMedia），多次调用会交叠执行。每次进入自增此值，
   * await 之后若已不是最新代次就把本次拿到的麦克风立即释放并退出，
   * 避免「较慢的那次后完成」导致麦克风泄漏或回放叠加。
   */
  private auditionGeneration = 0;

  constructor() {
    try {
      const saved = localStorage.getItem(LS_KEY) as VoicePreset | null;
      if (saved) this.preset = saved;
    } catch { /* ignore */ }
  }

  getPreset(): VoicePreset {
    return this.preset;
  }

  /** 输出轨道变化的订阅入口（跨「原声 ↔ 变声」边界时会触发）。 */
  setOutputChangedHandler(handler: ((stream: MediaStream) => void) | null): void {
    this.onOutputChanged = handler;
  }

  /** 设置音色：持久化 + 若正在通话则实时切换 */
  setPreset(preset: VoicePreset): void {
    const previous = this.preset;
    this.preset = preset;
    try { localStorage.setItem(LS_KEY, preset); } catch { /* ignore */ }

    // 跨越「原声（不接图）↔ 变声（接图）」边界时，输出轨道必然要换一条，
    // 只改引擎内部的图是不够的——原声态下引擎根本没有图。
    if (this.rawStream && requiresOutputRebuild(previous, preset)) {
      const rebuilt = this.process(this.rawStream);
      this.onOutputChanged?.(rebuilt);
    } else if (this.active) {
      this.engine.setPreset(preset);
    }
    // 试听中也实时切换，便于对比不同音色。
    // 跨旁路边界时试听侧同样要重建：原声试听没有引擎，只调 setPreset 不会生效。
    if (this.auditioning) {
      if (requiresOutputRebuild(previous, preset)) {
        void this.startAudition().catch(() => {});
      } else if (this.auditionEngine) {
        this.auditionEngine.setPreset(preset);
      }
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
    // 先停掉上一轮（stopAudition 会自增代次，作废任何在途的 start），
    // 之后再取本次代次——顺序反了的话本次会被自己的 stopAudition 作废，试听永远开不起来。
    await this.stopAudition();
    const generation = ++this.auditionGeneration;
    // 试听必须与实际发送链路一致：桌面端已取消全部降噪/回声消除/自动增益，
    // 若这里仍开启处理，用户试听到的音色就不是对方真正听到的声音。
    const raw = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });

    // 期间又发生了一次切换/停止，本次结果已作废，直接释放麦克风。
    if (generation !== this.auditionGeneration) {
      raw.getTracks().forEach((t) => t.stop());
      return;
    }

    this.auditionMic = raw;

    // 「原声」的发送链路已经不接变声图，试听也必须一致地直接回放原始流，
    // 否则试听到的是经过 WebAudio 往返的声音，而对方听到的是原始轨道。
    let processed = raw;
    if (!isBypassPreset(this.preset)) {
      this.auditionEngine = new VoiceChanger();
      processed = this.auditionEngine.attach(raw, this.preset);
    }

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
    // 同时作废在途的 startAudition：否则「用户关掉试听」与「上一次尚未完成的开启」
    // 交叠时，后完成的那次会把麦克风重新挂上，表现为关掉试听却仍在回放。
    this.auditionGeneration++;
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

  /**
   * 处理原始麦克风流，返回用于发送的音频流。
   *
   * 「原声」直接返回采集到的原始流，不接 WebAudio 图——接了就等于在纯原声通话里
   * 插了一层 MediaStreamSource → Gain → MediaStreamDestination 的中间处理层，
   * 既与「无降噪、纯天然」的定位不符，也让 Linux 下多跨一次
   * WebAudio↔GStreamer 桥接（issue #42 第 4 条的死锁栈就卡在这段管线上）。
   */
  process(rawStream: MediaStream): MediaStream {
    this.rawStream = rawStream;

    if (isBypassPreset(this.preset)) {
      this.engine.dispose();
      this.active = false;
      return rawStream;
    }

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
    this.rawStream = null;
    this.engine.dispose();
  }
}

export const voiceChangerService = new VoiceChangerService();
