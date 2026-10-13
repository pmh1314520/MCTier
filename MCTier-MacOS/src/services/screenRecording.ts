import { invoke } from '@tauri-apps/api/core';
import { requestNativeScreen } from './screenShare/nativeCapture';
import { openMicrophone, resumeAudioContext } from './voice/nativeMicrophone';
import type { ScreenShareQuality } from './screenShare/quality';
import { showFeedback } from './ui/feedback';
import { tl } from '../i18n';

export type RecordingState = { phase: 'idle' | 'preparing' | 'recording' | 'paused' | 'saving'; seconds: number; bytes: number; path: string; error: string };
export type RecordingOptions = ScreenShareQuality & { systemAudio: boolean; microphone: boolean; countdown: number };
export function recordingFormat() {
  const mime = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp8,opus', 'video/webm'].find(x => MediaRecorder.isTypeSupported(x));
  if (!mime) throw new Error('当前运行环境不支持视频编码');
  return { mime, extension: mime.startsWith('video/mp4') ? 'mp4' : 'webm' };
}
class ScreenRecording {
  private state: RecordingState = { phase: 'idle', seconds: 0, bytes: 0, path: '', error: '' };
  private listeners = new Set<() => void>();
  private recorder?: MediaRecorder;
  private streams: MediaStream[] = [];
  private audio?: AudioContext;
  private abort?: AbortController;
  private output?: { id: string; path: string };
  private writing = Promise.resolve();
  private queued = 0;
  private tick?: ReturnType<typeof setInterval>;
  private recordingAt = 0;
  private elapsed = 0;
  private stopping?: Promise<void>;
  private stopped?: Promise<void>;
  private writeFailed = false;
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<RecordingState>) { this.state = { ...this.state, ...patch }; this.listeners.forEach(f => f()); }
  async start(options: RecordingOptions) {
    if (this.state.phase !== 'idle') return;
    this.update({ phase: 'preparing', error: '', path: '', bytes: 0, seconds: 0 });
    this.abort = new AbortController();
    this.elapsed = 0; this.queued = 0; this.writing = Promise.resolve(); this.writeFailed = false;
    try {
      const format = recordingFormat();
      this.output = await invoke('recording_create', { extension: format.extension }) ?? undefined;
      if (!this.output) { this.update({ phase: 'idle' }); return; }
      if (this.abort.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      const video = await requestNativeScreen(options, false, this.abort.signal, true);
      this.streams.push(video);
      for (const wanted of [options.systemAudio ? 'system' : '', options.microphone ? 'mic' : '']) {
        if (wanted) this.streams.push(await openMicrophone('', true, wanted === 'system', true));
        if (this.abort.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      }
      const tracks = [...video.getVideoTracks()];
      if (this.streams.length > 1) {
        this.audio = new AudioContext({ sampleRate: 48000, latencyHint: 'playback' });
        const destination = this.audio.createMediaStreamDestination();
        this.streams.slice(1).forEach(stream => {
          const gain = this.audio!.createGain();
          gain.gain.value = 1 / (this.streams.length - 1);
          this.audio!.createMediaStreamSource(stream).connect(gain).connect(destination);
        });
        await resumeAudioContext(this.audio);
        tracks.push(...destination.stream.getAudioTracks());
      }
      for (let remaining = options.countdown; remaining > 0; remaining--) {
        this.update({ seconds: remaining });
        await new Promise(resolve => setTimeout(resolve, 1000));
        if (this.abort.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      }
      this.recorder = new MediaRecorder(new MediaStream(tracks), {
        mimeType: format.mime, videoBitsPerSecond: (options.bitrateMbps || 16) * 1_000_000, audioBitsPerSecond: 192000,
      });
      this.stopped = new Promise(resolve => this.recorder!.addEventListener('stop', () => { resolve(); void this.stop(); }, { once: true }));
      this.recorder.ondataavailable = event => {
        if (!event.data.size || this.writeFailed) return;
        if (this.queued + event.data.size > 32 * 1024 * 1024) { this.writeFailed = true; this.update({ error: '磁盘写入过慢，录制已停止，请降低画质；文件可能不完整' }); void this.stop(); return; }
        this.queued += event.data.size;
        const output = this.output!;
        this.writing = this.writing.then(async () => {
          const bytes = await event.data.arrayBuffer();
          // Keep IPC requests bounded even when a resumed encoder emits a large blob.
          for (let offset = 0; offset < bytes.byteLength; offset += 1024 * 1024) {
            await invoke('recording_write', bytes.slice(offset, offset + 1024 * 1024), { headers: { 'x-recording-id': output.id } });
          }
          this.update({ bytes: this.state.bytes + bytes.byteLength });
        }).catch(error => { this.writeFailed = true; this.update({ error: String(error) }); void this.stop(); throw error; }).finally(() => { this.queued -= event.data.size; });
        void this.writing.catch(() => {});
      };
      this.recorder.onerror = () => { this.update({ error: '视频编码失败，已停止录制' }); void this.stop(); };
      this.streams.forEach(stream => stream.getTracks().forEach(track => track.addEventListener('ended', () => { void this.stop(); }, { once: true })));
      this.recorder.start(1000);
      this.recordingAt = performance.now();
      this.tick = setInterval(() => { if (this.state.phase === 'recording') this.update({ seconds: Math.floor((this.elapsed + performance.now() - this.recordingAt) / 1000) }); }, 500);
      this.update({ phase: 'recording', seconds: 0, path: this.output.path });
    } catch (error) {
      // 麦克风未授权时弹出系统授权引导，与开麦/试音一致，而不是只在面板里报错。
      if (error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError')) {
        window.dispatchEvent(new CustomEvent('mctier-microphone-permission-required'));
      } else if ((error as Error).name !== 'AbortError') {
        this.update({ error: String(error) });
      }
      await this.release(true);
    }
  }
  pause() {
    if (this.state.phase === 'recording') {
      this.recorder?.pause(); this.elapsed += performance.now() - this.recordingAt; this.update({ phase: 'paused' });
    } else if (this.state.phase === 'paused') {
      this.recorder?.resume(); this.recordingAt = performance.now(); this.update({ phase: 'recording' });
    }
  }
  cancel() { this.abort?.abort(); }
  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    if (this.state.phase === 'preparing') { this.cancel(); return Promise.resolve(); }
    if (!this.recorder) return Promise.resolve();
    this.update({ phase: 'saving' });
    this.stopping = (async () => {
      const recorder = this.recorder!;
      if (recorder.state !== 'inactive') recorder.stop();
      // An encoder error sets inactive before dispatching its final data and stop events.
      await this.stopped;
      await this.writing.catch(() => {});
      await this.release(false);
    })().finally(() => { this.stopping = undefined; });
    return this.stopping;
  }
  private async release(discard: boolean) {
    clearInterval(this.tick);
    this.streams.forEach(s => s.getTracks().forEach(t => t.stop())); this.streams = [];
    await this.audio?.close().catch(() => {}); this.audio = undefined; this.recorder = undefined;
    if (this.output) {
      try {
        const path = await invoke<string>('recording_finish', { id: this.output.id, discard });
        this.update({ path });
        if (!discard && path && !this.state.error) showFeedback('success', `${tl('视频已保存至：', 'Video saved to:')} ${path}`);
      }
      catch (error) { this.update({ error: String(error) }); }
      this.output = undefined;
    }
    this.update({ phase: 'idle' });
  }
}
export const screenRecording = new ScreenRecording();
