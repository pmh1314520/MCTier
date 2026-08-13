import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { audioDevices } from './audioDevices';

/**
 * Native Sonora enhancement for the desktop microphone path.
 *
 * Sonora runs AEC3/NS in the Tauri process, then the bundled LocalVQE model
 * removes residual steady noise in a Worker. A lightweight post-model gain
 * stage restores speech level. Chromium's capture AEC/NS/AGC are disabled so
 * the signal is not processed twice by competing echo cancellers.
 */
class LocalVqeService {
  private context: AudioContext | null = null;
  private inputSource: MediaStreamAudioSourceNode | null = null;
  private node: AudioWorkletNode | null = null;
  private destination: MediaStreamAudioDestinationNode | null = null;
  private referenceStreams: MediaStream[] = [];
  private referenceSources: MediaStreamAudioSourceNode[] = [];
  private systemReferenceUnlisten: (() => void) | null = null;
  private systemLoopbackStart: Promise<void> | null = null;
  private nativeFrameChain: Promise<void> = Promise.resolve();
  private graphGeneration = 0;
  private worker: Worker | null = null;
  private workerReady: Promise<void> | null = null;
  private workerReadyResolve: (() => void) | null = null;
  private workerReadyReject: ((error: Error) => void) | null = null;
  private workerFrameId = 1;
  private workerPending = new Map<number, { resolve: (frame: Float32Array) => void; reject: (error: Error) => void }>();
  private postGain = 1;

  /** Load the bundled model before the user opens the microphone. */
  async preload(): Promise<void> {
    if (this.workerReady) return this.workerReady;
    const worker = new Worker('/localvqe/localvqe-worker.js');
    this.worker = worker;
    this.workerReady = new Promise<void>((resolve, reject) => {
      this.workerReadyResolve = resolve;
      this.workerReadyReject = reject;
    });
    worker.onmessage = (event: MessageEvent) => {
      if (event.data.type === 'ready') {
        this.workerReadyResolve?.();
        this.workerReadyResolve = null;
        this.workerReadyReject = null;
        return;
      }
      const frameId = Number(event.data.frameId);
      const pending = this.workerPending.get(frameId);
      if (!pending) return;
      this.workerPending.delete(frameId);
      if (event.data.type === 'error') {
        pending.reject(new Error(event.data.message || 'LocalVQE processing failed'));
      } else {
        pending.resolve(new Float32Array(event.data.frame));
      }
    };
    worker.onerror = (event) => {
      const error = new Error(event.message || 'LocalVQE Worker failed');
      this.workerReadyReject?.(error);
      this.workerPending.forEach(({ reject }) => reject(error));
      this.workerPending.clear();
      this.destroyWorker();
    };
    worker.postMessage({ type: 'init' });
    return this.workerReady;
  }

  private destroyWorker(): void {
    this.worker?.terminate();
    this.worker = null;
    this.workerReady = null;
    this.workerReadyResolve = null;
    this.workerReadyReject = null;
  }

  private async enhanceWithLocalVqe(input48k: Float32Array): Promise<Float32Array> {
    await this.preload();
    const worker = this.worker;
    if (!worker) throw new Error('LocalVQE Worker is unavailable');

    const input16k = new Float32Array(Math.ceil(input48k.length / 3));
    for (let index = 0; index < input16k.length; index += 1) {
      const source = index * 3;
      input16k[index] = (
        input48k[source] +
        (input48k[source + 1] ?? input48k[source]) +
        (input48k[source + 2] ?? input48k[source])
      ) / 3;
    }

    const frameId = this.workerFrameId++;
    const enhanced16k = await new Promise<Float32Array>((resolve, reject) => {
      this.workerPending.set(frameId, { resolve, reject });
      worker.postMessage({ type: 'batch', frameId, frame: input16k.buffer }, [input16k.buffer]);
    });

    const output = new Float32Array(input48k.length);
    for (let index = 0; index < output.length; index += 1) {
      const position = index / 3;
      const left = Math.min(enhanced16k.length - 1, Math.floor(position));
      const right = Math.min(enhanced16k.length - 1, left + 1);
      const fraction = position - left;
      output[index] = enhanced16k[left] * (1 - fraction) + enhanced16k[right] * fraction;
    }

    let energy = 0;
    for (const sample of output) energy += sample * sample;
    const rms = Math.sqrt(energy / Math.max(1, output.length));
    const desiredGain = rms > 0.006 ? Math.min(2.5, Math.max(0.9, 0.1 / rms)) : 1;
    this.postGain += (desiredGain - this.postGain) * (desiredGain > this.postGain ? 0.12 : 0.35);
    for (let index = 0; index < output.length; index += 1) {
      output[index] = Math.max(-0.98, Math.min(0.98, output[index] * this.postGain));
    }
    return output;
  }

  private resample(input: Float32Array, fromRate: number, toRate: number, length: number): Float32Array {
    const result = new Float32Array(length);
    const scale = fromRate / toRate;
    for (let i = 0; i < length; i += 1) {
      const position = i * scale;
      const left = Math.min(input.length - 1, Math.floor(position));
      const right = Math.min(input.length - 1, left + 1);
      const fraction = position - left;
      result[i] = input[left] * (1 - fraction) + input[right] * fraction;
    }
    return result;
  }

  private attachReferenceStreams(): void {
    this.referenceSources.forEach((source) => source.disconnect());
    this.referenceSources = [];
    if (!this.context || !this.node) return;

    this.referenceSources = this.referenceStreams.flatMap((stream) => {
      if (!stream.getAudioTracks().some((track) => track.readyState === 'live')) return [];
      try {
        const source = this.context!.createMediaStreamSource(stream);
        source.connect(this.node!, 0, 1);
        return [source];
      } catch (error) {
        console.warn('Unable to attach a LocalVQE far-end reference stream', error);
        return [];
      }
    });
  }

  /** Save far-end call audio even when the microphone graph does not exist yet. */
  setReferenceStreams(streams: MediaStream[]): void {
    this.referenceStreams = [...streams];
    this.attachReferenceStreams();
  }

  private async startSystemLoopback(node: AudioWorkletNode, generation: number, context: AudioContext): Promise<void> {
    if (this.systemLoopbackStart) return this.systemLoopbackStart;
    this.systemLoopbackStart = (async () => {
      const clockOriginMs = Date.now() - context.currentTime * 1000;
      const unlisten = await listen<{
        data: string;
        sample_rate: number;
        channels: number;
        captured_at_unix_ms: number;
      }>(
        'system-audio-reference',
        (event) => {
          if (this.graphGeneration !== generation || this.node !== node) return;
          try {
            const encoded = event.payload?.data;
            const channels = Math.max(1, Math.floor(event.payload?.channels || 1));
            const sampleRate = Math.max(1, Math.floor(event.payload?.sample_rate || context.sampleRate));
            if (!encoded) return;
            const binary = atob(encoded);
            const bytes = new Uint8Array(binary.length);
            for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
            const samples = new DataView(bytes.buffer);
            const frameCount = Math.floor(bytes.byteLength / 4 / channels);
            const mono = new Float32Array(frameCount);
            for (let frame = 0; frame < frameCount; frame += 1) {
              let sum = 0;
              for (let channel = 0; channel < channels; channel += 1) {
                sum += samples.getFloat32((frame * channels + channel) * 4, true);
              }
              mono[frame] = sum / channels;
            }
            const reference = sampleRate === context.sampleRate
              ? mono
              : this.resample(mono, sampleRate, context.sampleRate, Math.max(1, Math.round(frameCount * context.sampleRate / sampleRate)));
            const capturedAtMs = Number(event.payload?.captured_at_unix_ms);
            const endFrame = Number.isFinite(capturedAtMs)
              ? Math.round((capturedAtMs - clockOriginMs) * context.sampleRate / 1000)
              : null;
            node.port.postMessage({ type: 'system-reference', frame: reference.buffer, endFrame }, [reference.buffer]);
          } catch (error) {
            console.warn('Unable to decode WASAPI loopback reference', error);
          }
        },
      );
      if (this.graphGeneration !== generation || this.node !== node) {
        unlisten();
        return;
      }
      this.systemReferenceUnlisten = unlisten;
      await invoke('start_system_audio_loopback', {
        deviceId: audioDevices.getOutputDeviceId() || null,
        deviceName: audioDevices.getOutputDeviceName() || null,
      });
    })().catch((error) => {
      console.warn('WASAPI loopback is unavailable; using WebRTC/MCTier reference audio', error);
    }).finally(() => {
      this.systemLoopbackStart = null;
    });
    return this.systemLoopbackStart;
  }

  private async stopSystemLoopback(): Promise<void> {
    const pendingStart = this.systemLoopbackStart;
    if (pendingStart) await pendingStart.catch(() => {});
    this.systemReferenceUnlisten?.();
    this.systemReferenceUnlisten = null;
    await invoke('stop_system_audio_loopback').catch(() => {});
  }

  /** Rebind the native render reference after the user changes the speaker. */
  async refreshOutputReference(): Promise<void> {
    const node = this.node;
    const context = this.context;
    if (!node || !context) return;
    const generation = this.graphGeneration;
    await this.stopSystemLoopback();
    if (this.graphGeneration === generation && this.node === node && this.context === context) {
      await this.startSystemLoopback(node, generation, context);
    }
  }

  async processStream(input: MediaStream): Promise<MediaStream> {
    await this.deactivate();
    await this.preload();
    const generation = ++this.graphGeneration;

    try {
      const AudioContextCtor = window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const context = new AudioContextCtor({ latencyHint: 'interactive', sampleRate: 48000 });
      await context.audioWorklet.addModule('/localvqe/localvqe-bridge-worklet.js');

      const source = context.createMediaStreamSource(input);
      const node = new AudioWorkletNode(context, 'mctier-localvqe-bridge', {
        numberOfInputs: 2,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        channelCount: 1,
        channelCountMode: 'explicit',
      });
      const destination = context.createMediaStreamDestination();

      this.context = context;
      this.inputSource = source;
      this.node = node;
      this.destination = destination;
      source.connect(node, 0, 0);
      node.connect(destination);
      this.attachReferenceStreams();
      console.info('[MCTier voice] native Sonora AEC/NS graph active');
      void this.startSystemLoopback(node, generation, context);

      this.nativeFrameChain = Promise.resolve();
      node.port.onmessage = (event: MessageEvent) => {
        if (this.graphGeneration !== generation) return;
        const isBatch = event.data.type === 'input-batch';
        if (!isBatch && event.data.type !== 'input') return;
        const frameIds = isBatch
          ? (event.data.frameIds as unknown[]).map(Number)
          : [Number(event.data.frameId)];
        const mic = Array.from(new Float32Array(event.data.frame));
        const render = Array.from(new Float32Array(event.data.reference));
        // Keep native AEC3 calls strictly ordered. Its adaptive filter must
        // receive every render/capture frame in chronological order.
        this.nativeFrameChain = this.nativeFrameChain
          .then(async () => {
            if (this.graphGeneration !== generation || this.node !== node) return;
            try {
              const enhanced = await invoke<number[]>(
                isBatch ? 'process_voice_frames' : 'process_voice_frame',
                { mic, render },
              );
              const output = await this.enhanceWithLocalVqe(Float32Array.from(enhanced));
              node.port.postMessage(
                {
                  type: isBatch ? 'output-batch' : 'output',
                  frameIds,
                  frameId: frameIds[0],
                  frame: output.buffer,
                },
                [output.buffer],
              );
            } catch (error) {
              // Do not send the raw microphone when native processing fails.
              // The worklet converts this error into silence to prevent
              // unprocessed fan or playback audio from leaking to peers.
              console.warn('Sonora voice processing failed; muting frame', error);
              node.port.postMessage({
                type: isBatch ? 'processor-error-batch' : 'processor-error',
                frameIds,
                frameId: frameIds[0],
              });
            }
          })
          .catch(() => { /* keep subsequent frames flowing */ });
      };
      node.port.postMessage({ type: 'processor-ready' });

      await context.resume();
      return destination.stream;
    } catch (error) {
      console.error('Native Sonora voice graph unavailable; refusing to send raw microphone audio', error);
      await this.deactivate();
      input.getTracks().forEach((track) => track.stop());
      throw error;
    }
  }

  /** Tear down the active microphone graph and reset adaptive AEC state. */
  async deactivate(): Promise<void> {
    this.graphGeneration += 1;
    await this.stopSystemLoopback();
    this.node?.disconnect();
    this.node = null;
    this.inputSource?.disconnect();
    this.inputSource = null;
    this.referenceSources.forEach((source) => source.disconnect());
    this.referenceSources = [];
    this.destination?.stream.getTracks().forEach((track) => track.stop());
    this.destination = null;
    if (this.context) {
      await this.context.close().catch(() => {});
      this.context = null;
    }
    this.nativeFrameChain = Promise.resolve();
    this.postGain = 1;
    this.worker?.postMessage({ type: 'reset' });
    await invoke('reset_voice_processor').catch(() => {});
  }

  /** Fully release the active voice graph when leaving the lobby. */
  async dispose(): Promise<void> {
    await this.deactivate();
    this.referenceStreams = [];
    this.destroyWorker();
  }
}

export const localVqeService = new LocalVqeService();
