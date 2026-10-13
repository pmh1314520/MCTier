/**
 * 说话状态检测器
 * - 对本机麦克风流与各远程音频流做"只读"音量分析（不影响播放）
 * - 通过 RMS 能量+阈值+去抖，判定某人是否正在说话
 * - 仅用于 UI 高亮提示，不参与音频传输
 */

type SpeakingCallback = (playerId: string, speaking: boolean) => void;

interface DetectorEntry {
  source: MediaStreamAudioSourceNode;
  analyser: AnalyserNode;
  data: Uint8Array;
  speaking: boolean;
  /** 低于阈值持续计数，用于延迟判定"停止说话"，避免频闪 */
  silenceFrames: number;
}

class SpeakingDetector {
  private ctx: AudioContext | null = null;
  private entries: Map<string, DetectorEntry> = new Map();
  private rafId: number | null = null;
  private callback?: SpeakingCallback;

  // 阈值：RMS（0~1）。说话通常在 0.02 以上
  private readonly SPEAK_THRESHOLD = 0.02;
  // 连续静音帧数达到此值才判定停止（约 ~0.5s @ 监测间隔）
  private readonly SILENCE_HOLD = 12;

  setCallback(cb: SpeakingCallback): void {
    this.callback = cb;
  }

  private ensureContext(): AudioContext | null {
    if (!this.ctx) {
      try {
        this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      } catch (e) {
        console.warn('[SpeakingDetector] 无法创建 AudioContext:', e);
        return null;
      }
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  /** 接入一个流进行说话检测 */
  attach(playerId: string, stream: MediaStream): void {
    if (!stream || stream.getAudioTracks().length === 0) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    // 已存在则先移除旧的
    this.detach(playerId);

    try {
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.5;
      source.connect(analyser);
      // 注意：不连接到 destination，避免二次播放/回声
      const data = new Uint8Array(analyser.fftSize);
      this.entries.set(playerId, { source, analyser, data, speaking: false, silenceFrames: 0 });
      this.startLoop();
    } catch (e) {
      console.warn(`[SpeakingDetector] attach 失败 (${playerId}):`, e);
    }
  }

  /** 移除某个流的检测 */
  detach(playerId: string): void {
    const entry = this.entries.get(playerId);
    if (entry) {
      try {
        entry.source.disconnect();
        entry.analyser.disconnect();
      } catch { /* ignore */ }
      this.entries.delete(playerId);
      if (entry.speaking && this.callback) {
        this.callback(playerId, false);
      }
    }
    if (this.entries.size === 0) {
      this.stopLoop();
    }
  }

  /** 全部清理 */
  clear(): void {
    const ids = Array.from(this.entries.keys());
    ids.forEach((id) => this.detach(id));
    this.stopLoop();
  }

  private startLoop(): void {
    if (this.rafId !== null) return;
    const tick = () => {
      this.entries.forEach((entry, playerId) => {
        entry.analyser.getByteTimeDomainData(entry.data);
        // 计算 RMS
        let sum = 0;
        for (let i = 0; i < entry.data.length; i++) {
          const v = (entry.data[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / entry.data.length);

        if (rms >= this.SPEAK_THRESHOLD) {
          entry.silenceFrames = 0;
          if (!entry.speaking) {
            entry.speaking = true;
            this.callback?.(playerId, true);
          }
        } else {
          entry.silenceFrames += 1;
          if (entry.speaking && entry.silenceFrames >= this.SILENCE_HOLD) {
            entry.speaking = false;
            this.callback?.(playerId, false);
          }
        }
      });
      this.rafId = window.requestAnimationFrame(tick);
    };
    this.rafId = window.requestAnimationFrame(tick);
  }

  private stopLoop(): void {
    if (this.rafId !== null) {
      window.cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }
}

export const speakingDetector = new SpeakingDetector();
