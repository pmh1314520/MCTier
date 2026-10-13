/**
 * 倒计时服务（模块级单例）
 * - 使用绝对结束时间戳计算剩余秒数，避免后台节流导致的计时漂移
 * - 计时器在模块级运行，不随组件挂载/卸载而中断（切换界面、挂后台仍继续）
 * - 倒计时结束自动播放提示音并通知订阅者
 */

type Listener = (remaining: number | null) => void;

class CountdownService {
  private endTime: number | null = null;
  private timer: number | null = null;
  private listeners = new Set<Listener>();

  /** 启动倒计时（秒） */
  start(totalSeconds: number): void {
    if (totalSeconds <= 0) return;
    this.endTime = Date.now() + totalSeconds * 1000;
    this.ensureTimer();
    this.emit();
  }

  /** 停止并清除倒计时 */
  stop(): void {
    this.endTime = null;
    this.clearTimer();
    this.emit();
  }

  /** 当前剩余秒数，未运行时为 null */
  getRemaining(): number | null {
    if (this.endTime === null) return null;
    return Math.max(0, Math.ceil((this.endTime - Date.now()) / 1000));
  }

  isRunning(): boolean {
    return this.endTime !== null;
  }

  /** 订阅剩余时间变化，返回取消订阅函数 */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.getRemaining());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private ensureTimer(): void {
    if (this.timer !== null) return;
    this.timer = window.setInterval(() => {
      const remaining = this.getRemaining();
      if (remaining !== null && remaining <= 0) {
        this.endTime = null;
        this.clearTimer();
        this.emit();
        this.playAlarm();
        return;
      }
      this.emit();
    }, 250);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }

  private emit(): void {
    const remaining = this.getRemaining();
    this.listeners.forEach((l) => l(remaining));
  }

  private playAlarm(): void {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      // 连续响三声
      const beeps = 3;
      const beepDuration = 0.18; // 每声时长
      const gap = 0.12; // 间隔
      for (let i = 0; i < beeps; i++) {
        const start = ctx.currentTime + i * (beepDuration + gap);
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + beepDuration);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + beepDuration);
      }
      // 三声播放完毕后关闭上下文
      const total = beeps * (beepDuration + gap) + 0.2;
      setTimeout(() => ctx.close().catch(() => {}), total * 1000);
    } catch {
      /* ignore */
    }
  }
}

export const countdownService = new CountdownService();
