import { invoke } from '@tauri-apps/api/core';
import { normalizeScreenQuality, type ScreenShareQuality } from './quality';

export interface CaptureSource {
  id: string;
  name: string;
  kind: 'monitor' | 'window';
  width: number;
  height: number;
  primary: boolean;
}
export interface CaptureInfo {
  id: string;
  source: CaptureSource;
  remote: boolean;
}
export interface CaptureChoice {
  remote: boolean;
  recording?: boolean;
  signal?: AbortSignal;
  resolve(source: CaptureSource): void;
  reject(error: Error): void;
}
let picker: ((request: CaptureChoice | null) => void) | undefined;
let pending: CaptureChoice | undefined;
export function registerCapturePicker(handler: (request: CaptureChoice | null) => void) {
  picker = handler;
  return () => {
    if (picker !== handler) return;
    pending?.reject(new DOMException('Screen picker closed', 'AbortError'));
    picker = undefined;
  };
}
function selectSource(remote: boolean, signal?: AbortSignal, recording = false): Promise<CaptureSource> {
  return new Promise((resolve, reject) => {
    if (!picker) {
      reject(new Error('Screen picker is not ready'));
      return;
    }
    if (pending) {
      reject(new Error('A screen selection is already in progress'));
      return;
    }
    if (signal?.aborted) {
      reject(new DOMException('Cancelled', 'AbortError'));
      return;
    }
    let finished = false;
    const finish = () => {
      if (finished) return false;
      finished = true;
      signal?.removeEventListener('abort', abort);
      pending = undefined;
      picker?.(null);
      return true;
    };
    const abort = () => {
      if (finish()) reject(new DOMException('Cancelled', 'AbortError'));
    };
    pending = {
      remote,
      recording,
      signal,
      resolve(source) {
        if (finish()) resolve(source);
      },
      reject(error) {
        if (finish()) reject(error);
      },
    };
    signal?.addEventListener('abort', abort, { once: true });
    picker(pending);
  });
}

/** Validates the binary boundary before allowing native bytes to allocate a canvas. */
export function decodeCaptureFrame(
  buffer: ArrayBuffer
): { width: number; height: number; pixels: Uint8ClampedArray<ArrayBuffer> } | null {
  if (buffer.byteLength === 0) return null;
  if (buffer.byteLength < 8) throw new Error('Truncated capture frame');
  const view = new DataView(buffer);
  const width = view.getUint32(0, true),
    height = view.getUint32(4, true);
  if (
    width < 2 ||
    height < 2 ||
    width > 3840 ||
    height > 3840 ||
    width * height > 3840 * 2160 ||
    buffer.byteLength !== 8 + width * height * 4
  )
    throw new Error('Invalid capture frame');
  return { width, height, pixels: new Uint8ClampedArray(buffer, 8) };
}

type GeneratedTrack = MediaStreamTrack & { writable: WritableStream<VideoFrame> };
type GeneratorConstructor = new (options: { kind: 'video' }) => GeneratedTrack;

/** Synthetic video tracks preserve WebRTC/Android compatibility without browser capture. */
export async function requestNativeScreen(
  quality: ScreenShareQuality,
  remote = false,
  signal?: AbortSignal,
  recording = false
): Promise<MediaStream> {
  const source = await selectSource(remote, signal, recording);
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
  const q = normalizeScreenQuality(quality);
  const info = await invoke<CaptureInfo>('native_capture_start', {
    sourceId: source.id,
    resolution: q.resolution,
    frameRate: q.frameRate,
    remote,
    recording,
  });
  let stopped = false;
  let stream: MediaStream | undefined;
  let track: MediaStreamTrack | undefined;
  let canvasTrack: CanvasCaptureMediaStreamTrack | undefined;
  let writer: WritableStreamDefaultWriter<VideoFrame> | undefined;
  let stopTrack: (() => void) | undefined;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { alpha: false, desynchronized: true });
  const stop = (notify = false) => {
    if (stopped) return;
    stopped = true;
    signal?.removeEventListener('abort', abort);
    window.removeEventListener('beforeunload', abort);
    stopTrack?.();
    void writer?.abort().catch(() => {});
    void invoke('native_capture_stop', { id: info.id }).catch(() => {});
    canvas.width = canvas.height = 0;
    if (notify) track?.dispatchEvent(new Event('ended'));
  };
  const abort = () => stop();
  const draw = (packet: ArrayBuffer) => {
    const frame = decodeCaptureFrame(packet);
    if (!frame) return false;
    if (canvas.width !== frame.width || canvas.height !== frame.height) {
      canvas.width = frame.width;
      canvas.height = frame.height;
    }
    context!.putImageData(new ImageData(frame.pixels, frame.width, frame.height), 0, 0);
    return true;
  };
  const deliver = async (packet: ArrayBuffer) => {
    if (writer) {
      const frame = decodeCaptureFrame(packet);
      if (!frame) return false;
      const video = new VideoFrame(frame.pixels, {
        format: 'RGBA',
        codedWidth: frame.width,
        codedHeight: frame.height,
        timestamp: Math.round(performance.now() * 1000),
      });
      try {
        await writer.write(video);
      } finally {
        video.close();
      }
      return true;
    }
    const drawn = draw(packet);
    // Canvas fallback is manually paced by the same native frame pump.
    if (drawn) canvasTrack?.requestFrame();
    return drawn;
  };
  try {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    signal?.addEventListener('abort', abort, { once: true });
    window.addEventListener('beforeunload', abort);
    const first = await invoke<ArrayBuffer>('native_capture_frame', { id: info.id });
    if (stopped) throw new DOMException('Cancelled', 'AbortError');
    const Generator = (
      globalThis as typeof globalThis & { MediaStreamTrackGenerator?: GeneratorConstructor }
    ).MediaStreamTrackGenerator;
    // Sharing and remote control must use the same frame bridge. The remote
    // flag grants native input access; it must not change how video is sent.
    // In particular, canvas capture depends on browser paint scheduling and
    // can stop producing frames when the controlled window is in the background.
    if (Generator && typeof VideoFrame !== 'undefined') {
      const generated = new Generator({ kind: 'video' });
      track = generated;
      stopTrack = generated.stop.bind(generated);
      writer = generated.writable.getWriter();
      stream = new MediaStream([generated]);
    } else {
      if (!context || !canvas.captureStream)
        throw new Error('Native capture video bridge unavailable');
      if (!draw(first)) throw new Error('No capture frame received');
      stream = canvas.captureStream(0);
      canvasTrack = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
      track = canvasTrack;
    }
    if (!track) throw new Error('Native capture track unavailable');
    stopTrack = track.stop.bind(track);
    if (canvasTrack && typeof canvasTrack.requestFrame !== 'function')
      throw new Error('Native capture track unavailable');
    // Consumers already stop MediaStream tracks on leave/error; also release native resources.
    track.stop = () => stop();
    track.contentHint = 'motion';
    if (writer) {
      if (!(await deliver(first))) throw new Error('No capture frame received');
    } else canvasTrack!.requestFrame();
    if (stopped) throw new DOMException('Cancelled', 'AbortError');
    let latestPacket = first;
    let lastDeliveredAt = Date.now();
    const pump = async () => {
      while (!stopped) {
        try {
          // Native worker paces to the requested FPS; never queue an unbounded stream of IPC frames.
          const packet = await invoke<ArrayBuffer>('native_capture_frame', { id: info.id });
          if (stopped) return;
          if (packet.byteLength) latestPacket = packet;
          // A new viewer still needs a first frame when the chosen window is entirely static.
          if (packet.byteLength || Date.now() - lastDeliveredAt >= 1000) {
            await deliver(latestPacket);
            lastDeliveredAt = Date.now();
          }
        } catch (error) {
          if (!stopped) {
            console.warn('Native screen capture ended', error);
            stop(true);
          }
        }
      }
    };
    void pump();
    return stream;
  } catch (error) {
    stop();
    throw error;
  }
}
