/** Counters, not audio loudness: silence/DTX and intentional mute are not failures. */
export class VoiceHealth {
  private previous?: { received: number; sent: number | null };
  private suspectSince: number | null = null;
  private remoteProgressAt = -Infinity;
  private lastReason: string | null = null;
  private nextRepairAt = 0;
  private failures = 0;
  private healthySince: number | null = null;

  resetSample() {
    this.previous = undefined;
    this.suspectSince = null;
    this.remoteProgressAt = -Infinity;
    this.lastReason = null;
    this.healthySince = null;
  }

  observe(now: number, received: number, sent: number | null, broken: boolean): string | null {
    const previous = this.previous;
    this.previous = { received, sent };
    if (
      previous &&
      (received < previous.received ||
        (sent !== null && previous.sent !== null && sent < previous.sent))
    ) {
      this.resetSample();
      this.previous = { received, sent };
      return null;
    }
    if (sent !== null && previous?.sent != null && sent > previous.sent)
      this.remoteProgressAt = now;
    const receiving = previous !== undefined && received > previous.received;
    const reason = broken
      ? 'audio-track-or-negotiation'
      : previous && !receiving && sent !== null && now - this.remoteProgressAt < 6000
        ? 'inbound-audio-stalled'
        : null;
    if (reason === null) {
      this.suspectSince = null;
      this.lastReason = null;
      if (receiving) {
        this.healthySince ??= now;
        if (now - this.healthySince >= 60000) {
          this.failures = 0;
          this.nextRepairAt = 0;
        }
      } else this.healthySince = null;
      return null;
    }
    this.healthySince = null;
    if (reason !== this.lastReason) {
      this.suspectSince = now;
      this.lastReason = reason;
    }
    if (now - (this.suspectSince ?? now) < 8000 || now < this.nextRepairAt) return null;
    this.nextRepairAt = now + Math.min(120000, 30000 * 2 ** Math.min(this.failures, 2));
    this.failures = Math.min(this.failures + 1, 3);
    this.suspectSince = now;
    return reason;
  }
}

export const VOICE_HEALTH_CHANNEL = 'mctier-voice-health-v1';
export function parseVoiceHealth(data: unknown): number | null {
  if (typeof data !== 'string' || data.length > 128) return null;
  try {
    const value = JSON.parse(data);
    return value?.v === 1 && Number.isSafeInteger(value.packets) && value.packets >= 0
      ? value.packets
      : null;
  } catch {
    return null;
  }
}
