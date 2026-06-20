/**
 * 实时变声器（非 AI，基于 Web Audio）
 * - 采用经典 "Jungle" 相位声码器进行实时变调（±半音）
 * - 叠加环形调制（机器人）、带通滤波（电话音）等音色
 * - 输出一个稳定的 MediaStreamDestination 轨道，切换音色时无需重新协商 WebRTC
 */

// ===== Jungle 变调核心（来自 Web Audio 经典实现，做了 TS 化） =====
const DELAY_TIME = 0.1;
const FADE_TIME = 0.05;
const BUFFER_TIME = 0.1;

function createFadeBuffer(ctx: AudioContext, activeTime: number, fadeTime: number): AudioBuffer {
  const length1 = activeTime * ctx.sampleRate;
  const length2 = (activeTime - 2 * fadeTime) * ctx.sampleRate;
  const length = length1 + length2;
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const p = buffer.getChannelData(0);
  const fadeLength = fadeTime * ctx.sampleRate;
  const fadeIndex1 = fadeLength;
  const fadeIndex2 = length1 - fadeLength;
  for (let i = 0; i < length1; ++i) {
    let value: number;
    if (i < fadeIndex1) value = Math.sqrt(i / fadeLength);
    else if (i >= fadeIndex2) value = Math.sqrt(1 - (i - fadeIndex2) / fadeLength);
    else value = 1;
    p[i] = value;
  }
  for (let i = length1; i < length; ++i) p[i] = 0;
  return buffer;
}

function createDelayTimeBuffer(ctx: AudioContext, activeTime: number, fadeTime: number, shiftUp: boolean): AudioBuffer {
  const length1 = activeTime * ctx.sampleRate;
  const length2 = (activeTime - 2 * fadeTime) * ctx.sampleRate;
  const length = length1 + length2;
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const p = buffer.getChannelData(0);
  for (let i = 0; i < length1; ++i) {
    if (shiftUp) p[i] = (length1 - i) / length;
    else p[i] = i / length1;
  }
  for (let i = length1; i < length; ++i) p[i] = 0;
  return buffer;
}

class Jungle {
  readonly input: GainNode;
  readonly output: GainNode;
  private ctx: AudioContext;
  private mod1Gain: GainNode;
  private mod2Gain: GainNode;
  private mod3Gain: GainNode;
  private mod4Gain: GainNode;
  private modGain1: GainNode;
  private modGain2: GainNode;
  private sources: AudioBufferSourceNode[] = [];

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.output = ctx.createGain();

    const mod1 = ctx.createBufferSource();
    const mod2 = ctx.createBufferSource();
    const mod3 = ctx.createBufferSource();
    const mod4 = ctx.createBufferSource();
    const shiftDownBuffer = createDelayTimeBuffer(ctx, BUFFER_TIME, FADE_TIME, false);
    const shiftUpBuffer = createDelayTimeBuffer(ctx, BUFFER_TIME, FADE_TIME, true);
    mod1.buffer = shiftDownBuffer;
    mod2.buffer = shiftDownBuffer;
    mod3.buffer = shiftUpBuffer;
    mod4.buffer = shiftUpBuffer;
    mod1.loop = true; mod2.loop = true; mod3.loop = true; mod4.loop = true;

    this.mod1Gain = ctx.createGain();
    this.mod2Gain = ctx.createGain();
    this.mod3Gain = ctx.createGain();
    this.mod3Gain.gain.value = 0;
    this.mod4Gain = ctx.createGain();
    this.mod4Gain.gain.value = 0;

    mod1.connect(this.mod1Gain);
    mod2.connect(this.mod2Gain);
    mod3.connect(this.mod3Gain);
    mod4.connect(this.mod4Gain);

    this.modGain1 = ctx.createGain();
    this.modGain2 = ctx.createGain();
    const delay1 = ctx.createDelay();
    const delay2 = ctx.createDelay();
    this.mod1Gain.connect(this.modGain1);
    this.mod3Gain.connect(this.modGain1);
    this.mod2Gain.connect(this.modGain2);
    this.mod4Gain.connect(this.modGain2);
    this.modGain1.connect(delay1.delayTime);
    this.modGain2.connect(delay2.delayTime);

    const fade1 = ctx.createBufferSource();
    const fade2 = ctx.createBufferSource();
    const fadeBuffer = createFadeBuffer(ctx, BUFFER_TIME, FADE_TIME);
    fade1.buffer = fadeBuffer;
    fade2.buffer = fadeBuffer;
    fade1.loop = true; fade2.loop = true;

    const mix1 = ctx.createGain();
    const mix2 = ctx.createGain();
    mix1.gain.value = 0;
    mix2.gain.value = 0;
    fade1.connect(mix1.gain);
    fade2.connect(mix2.gain);

    this.input.connect(delay1);
    this.input.connect(delay2);
    delay1.connect(mix1);
    delay2.connect(mix2);
    mix1.connect(this.output);
    mix2.connect(this.output);

    const t = ctx.currentTime + 0.05;
    const t2 = t + BUFFER_TIME - FADE_TIME;
    mod1.start(t); mod2.start(t2); mod3.start(t); mod4.start(t2);
    fade1.start(t); fade2.start(t2);
    this.sources = [mod1, mod2, mod3, mod4, fade1, fade2];
  }

  private setDelay(delayTime: number): void {
    this.modGain1.gain.setTargetAtTime(0.5 * delayTime, this.ctx.currentTime, 0.01);
    this.modGain2.gain.setTargetAtTime(0.5 * delayTime, this.ctx.currentTime, 0.01);
  }

  /** mult: 变调量，>0 升调，<0 降调，单位约为「八度比例」（半音/12） */
  setPitchOffset(mult: number): void {
    if (mult > 0) {
      this.mod1Gain.gain.value = 0;
      this.mod2Gain.gain.value = 0;
      this.mod3Gain.gain.value = 1;
      this.mod4Gain.gain.value = 1;
    } else {
      this.mod1Gain.gain.value = 1;
      this.mod2Gain.gain.value = 1;
      this.mod3Gain.gain.value = 0;
      this.mod4Gain.gain.value = 0;
    }
    this.setDelay(DELAY_TIME * Math.abs(mult));
  }

  stop(): void {
    this.sources.forEach((s) => { try { s.stop(); } catch { /* ignore */ } });
    try { this.input.disconnect(); } catch { /* ignore */ }
    try { this.output.disconnect(); } catch { /* ignore */ }
  }
}

// ===== 音色预设 =====
export type VoicePreset =
  | 'none' | 'uncle' | 'male' | 'female' | 'loli' | 'chipmunk' | 'robot' | 'telephone';

/** 各预设的变调半音数 */
const PRESET_SEMITONES: Record<VoicePreset, number> = {
  none: 0,
  uncle: -6,
  male: -3,
  female: 4,
  loli: 7,
  chipmunk: 10,
  robot: 0,
  telephone: 1,
};

export class VoiceChanger {
  private ctx: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private inputGain: GainNode | null = null;
  private outputGain: GainNode | null = null;
  private dest: MediaStreamAudioDestinationNode | null = null;
  private jungle: Jungle | null = null;
  private ringOsc: OscillatorNode | null = null;
  private ringGain: GainNode | null = null;
  private bandpass: BiquadFilterNode | null = null;
  private preset: VoicePreset = 'none';

  /** 处理原始麦克风流，返回变声后的输出流（轨道稳定） */
  attach(rawStream: MediaStream, preset: VoicePreset): MediaStream {
    this.disposeGraphOnly();
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    this.ctx = new AC();
    this.source = this.ctx.createMediaStreamSource(rawStream);
    this.inputGain = this.ctx.createGain();
    this.outputGain = this.ctx.createGain();
    this.dest = this.ctx.createMediaStreamDestination();
    this.source.connect(this.inputGain);
    this.outputGain.connect(this.dest);
    this.buildChain(preset);
    return this.dest.stream;
  }

  /** 实时切换音色（输出轨道不变，无需重新协商） */
  setPreset(preset: VoicePreset): void {
    if (!this.ctx || !this.inputGain || !this.outputGain) {
      this.preset = preset;
      return;
    }
    this.buildChain(preset);
  }

  getPreset(): VoicePreset {
    return this.preset;
  }

  private teardownEffects(): void {
    if (this.jungle) { this.jungle.stop(); this.jungle = null; }
    if (this.ringOsc) { try { this.ringOsc.stop(); } catch { /* ignore */ } try { this.ringOsc.disconnect(); } catch { /* ignore */ } this.ringOsc = null; }
    if (this.ringGain) { try { this.ringGain.disconnect(); } catch { /* ignore */ } this.ringGain = null; }
    if (this.bandpass) { try { this.bandpass.disconnect(); } catch { /* ignore */ } this.bandpass = null; }
    try { this.inputGain?.disconnect(); } catch { /* ignore */ }
  }

  private buildChain(preset: VoicePreset): void {
    if (!this.ctx || !this.inputGain || !this.outputGain) return;
    this.preset = preset;
    this.teardownEffects();
    const ctx = this.ctx;

    if (preset === 'none') {
      this.inputGain.connect(this.outputGain);
      return;
    }

    let node: AudioNode = this.inputGain;

    // 电话音：带通滤波，模拟窄频
    if (preset === 'telephone') {
      this.bandpass = ctx.createBiquadFilter();
      this.bandpass.type = 'bandpass';
      this.bandpass.frequency.value = 1500;
      this.bandpass.Q.value = 6;
      node.connect(this.bandpass);
      node = this.bandpass;
    }

    // 机器人：环形调制
    if (preset === 'robot') {
      this.ringGain = ctx.createGain();
      this.ringGain.gain.value = 0; // 由振荡器驱动 -> 实现 input * osc
      this.ringOsc = ctx.createOscillator();
      this.ringOsc.type = 'sine';
      this.ringOsc.frequency.value = 50;
      this.ringOsc.connect(this.ringGain.gain);
      this.ringOsc.start();
      node.connect(this.ringGain);
      node = this.ringGain;
    }

    const semis = PRESET_SEMITONES[preset] ?? 0;
    if (semis !== 0) {
      this.jungle = new Jungle(ctx);
      this.jungle.setPitchOffset(semis / 12);
      node.connect(this.jungle.input);
      this.jungle.output.connect(this.outputGain);
    } else {
      node.connect(this.outputGain);
    }
  }

  private disposeGraphOnly(): void {
    this.teardownEffects();
    try { this.source?.disconnect(); } catch { /* ignore */ }
    try { this.outputGain?.disconnect(); } catch { /* ignore */ }
    if (this.ctx) { try { void this.ctx.close(); } catch { /* ignore */ } }
    this.ctx = null;
    this.source = null;
    this.inputGain = null;
    this.outputGain = null;
    this.dest = null;
  }

  dispose(): void {
    this.disposeGraphOnly();
    this.preset = 'none';
  }
}
