import { invoke, isTauri } from '@tauri-apps/api/core';
import workletUrl from './nativeMicrophoneWorklet.js?url&no-inline';
import { pcmRms } from './microphoneLevel';
import { isMacOSPlatform } from '../../utils/platform';

const nativeLevels = new WeakMap<MediaStream, number>();
/** Undefined for browser streams; native values come directly from WASAPI PCM. */
export function nativeMicrophoneLevel(stream: MediaStream): number | undefined {
  return nativeLevels.get(stream);
}

export type MicrophoneDevice = Pick<MediaDeviceInfo, 'deviceId' | 'kind' | 'label'> & { isDefault?: boolean; isCommunications?: boolean };
let supported: Promise<boolean> | undefined;
export async function resumeAudioContext(context: AudioContext): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([context.resume(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('音频引擎未能启动，请重新开启麦克风或试音')), 3000);
    })]);
    if (context.state !== 'running') throw new Error(`音频引擎状态异常: ${context.state}`);
  } finally { clearTimeout(timer); }
}
function diagnostic(stage: string, detail: string): void {
  void invoke('report_audio_diagnostic', { stage, detail }).catch(() => {});
}
export function nativeMicrophoneSupported(): Promise<boolean> {
  if (!isTauri()) return Promise.resolve(false);
  return supported ??= invoke<boolean>('native_microphone_supported').catch(error => {
    supported = undefined;
    throw error;
  });
}
export async function microphoneDevices(): Promise<MicrophoneDevice[]> {
  // macOS 走 getUserMedia 采集，设备也用浏览器枚举，保证选择器里的 id 能被 getUserMedia 认。
  if (!isMacOSPlatform && (await nativeMicrophoneSupported())) {
    return invoke<MicrophoneDevice[]>('native_microphone_devices');
  }
  return (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === 'audioinput');
}

/** 浏览器采集。平台没有原生实现时用它；macOS 上原生单元打不开时也用它兜底。 */
function openBrowserMicrophone(deviceId: string, systemProcessing: boolean): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({ audio: {
    ...(deviceId ? { deviceId: { ideal: deviceId } } : {}),
    echoCancellation: true, noiseSuppression: systemProcessing, autoGainControl: true,
  }, video: false });
}

export async function openMicrophone(deviceId = '', systemProcessing = true, loopback = false, recording = false): Promise<MediaStream> {
  // macOS：麦克风采集直接走 WKWebView 的 getUserMedia，不碰原生 CoreAudio 单元。
  // 未签名/ad-hoc 打包版里，原生 AUHAL 输入单元即使授权状态为 Authorized，coreaudiod
  // 也不认这个 TCC 授权、输入回调永不触发（日志实测 total_frames=0），采集必然静音；
  // 而且每次还白等 3 秒超时。WKWebView 的 getUserMedia 走 Apple 自己的媒体栈，TCC
  // 由系统正确处理，是打包版唯一可靠的麦克风路径。原生单元本来就是为 Windows 绕开
  // WebView2 而存在，macOS 没有这个必要。
  // 系统声音(loopback)例外：那条走 ScreenCaptureKit，没有浏览器等价实现，仍用原生。
  if (isMacOSPlatform && !loopback) {
    return openBrowserMicrophone(deviceId.startsWith('coreaudio:') ? '' : deviceId, systemProcessing);
  }
  if (!(await nativeMicrophoneSupported())) {
    if (loopback) {
      throw new Error(isMacOSPlatform
        ? 'macOS 录制系统声音需要虚拟音频设备（如 BlackHole）'
        : 'System audio recording requires Windows');
    }
    return openBrowserMicrophone(deviceId, systemProcessing);
  }
  try {
    return await openNativeMicrophone(deviceId, systemProcessing, loopback, recording);
  } catch (error) {
    // Windows 绝不回退到浏览器采集：绕开 WebView2 的麦克风链路正是原生采集存在的理由。
    if (!isMacOSPlatform || loopback) throw error;
    if (error instanceof DOMException && error.name === 'NotAllowedError') throw error;
    diagnostic('capture-error', `native capture failed, falling back to browser: ${String(error)}`);
    console.warn('原生麦克风不可用，回退到浏览器采集:', error);
    return openBrowserMicrophone('', systemProcessing);
  }
}

async function openNativeMicrophone(deviceId: string, systemProcessing: boolean, loopback: boolean, recording: boolean): Promise<MediaStream> {
  const info = await invoke<{ id: string; deviceId: string; sampleRate: number }>(loopback ? 'recording_system_audio_start' : 'native_microphone_start', { deviceId, systemProcessing, recording }).catch(error => {
    diagnostic('capture-error', String(error));
    if (String(error).startsWith('MIC_NOT_FOUND:')) throw new DOMException(String(error).slice(14), 'NotFoundError');
    if (String(error).startsWith('MIC_PERMISSION_DENIED:')) throw new DOMException(String(error).slice(22), 'NotAllowedError');
    throw new Error(String(error));
  });
  let context: AudioContext | undefined;
  let node: AudioWorkletNode | undefined;
  let track: MediaStreamTrack | undefined;
  let stopTrack: (() => void) | undefined;
  let nativeStream: MediaStream | undefined;
  let stopped = false;
  let inFlight = 0;
  let wake: (() => void) | undefined;
  const stop = (notify = false) => {
    if (stopped) return;
    stopped = true;
    if (nativeStream) nativeLevels.set(nativeStream, 0);
    wake?.();
    window.removeEventListener('beforeunload', unload);
    stopTrack?.();
    node?.disconnect();
    node?.port.close();
    void context?.close().catch(() => {});
    void invoke('native_microphone_stop', { id: info.id }).catch(() => {});
    if (notify) track?.dispatchEvent(new Event('ended'));
  };
  const unload = () => stop();
  try {
    window.addEventListener('beforeunload', unload, { once: true });
    if (info.sampleRate !== 48000) throw new Error('Unsupported microphone sample rate');
    context = new AudioContext({ sampleRate: info.sampleRate, latencyHint: recording ? 'playback' : 'interactive' });
    if (context.sampleRate !== info.sampleRate) throw new Error('Audio output sample rate mismatch');
    await context.audioWorklet.addModule(workletUrl);
    if (stopped) throw new Error('Microphone initialization cancelled');
    node = new AudioWorkletNode(context, 'mctier-native-microphone', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1], processorOptions: { recording } });
    node.port.onmessage = event => {
      if (event?.data && typeof event.data === 'object') {
        diagnostic('realtime', `source=${loopback ? 'system' : 'microphone'}, recording=${recording}, underrun=${event.data.underrun}, buffered=${event.data.buffered}`);
        return;
      }
      inFlight = Math.max(0, inFlight - 1); wake?.(); wake = undefined;
    };
    const destination = context.createMediaStreamDestination();
    nativeStream = destination.stream;
    nativeLevels.set(nativeStream, 0);
    destination.channelCount = 1;
    node.connect(destination);
    track = destination.stream.getAudioTracks()[0];
    stopTrack = track.stop.bind(track);
    track.stop = () => stop();
    const settings = track.getSettings.bind(track);
    track.getSettings = () => ({ ...settings(), deviceId: info.deviceId, sampleRate: info.sampleRate, channelCount: 1 });
    await resumeAudioContext(context);
    if (stopped) throw new Error('Microphone initialization cancelled');
    const pump = async () => {
      let acknowledged = false;
      while (!stopped) {
        try {
          // Bound the MessagePort queue as well as the native and worklet ring buffers.
          while (!stopped && inFlight >= (recording ? 20 : 6)) await new Promise<void>(resolve => { wake = resolve; });
          if (stopped) return;
          const bytes = await invoke<ArrayBuffer>('native_microphone_read', { id: info.id });
          if (stopped) return;
          if (!(bytes instanceof ArrayBuffer) || bytes.byteLength < 3840 || bytes.byteLength % 3840 !== 0 || bytes.byteLength > (recording ? 38400 : 19200)) throw new Error('Invalid microphone packet');
          nativeLevels.set(destination.stream, pcmRms(new Float32Array(bytes)));
          if (!acknowledged) { diagnostic('capture-ready', `input=${info.deviceId}, context=${context!.state}, sampleRate=${info.sampleRate}`); acknowledged = true; }
          inFlight += bytes.byteLength / 3840;
          node!.port.postMessage(bytes, [bytes]);
        } catch (error) {
          if (!stopped) { diagnostic('capture-error', String(error)); console.warn('Native microphone stopped', error); stop(true); }
        }
      }
    };
    node.onprocessorerror = () => { diagnostic('capture-error', 'AudioWorklet processor failed'); stop(true); };
    void pump();
    return destination.stream;
  } catch (error) { diagnostic('capture-error', String(error)); stop(); throw error; }
}
