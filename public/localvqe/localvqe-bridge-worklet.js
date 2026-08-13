class LocalVqeBridgeProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // Sonora AEC3 consumes standard 10 ms frames.
    this.inputFrameSize = Math.max(128, Math.round(sampleRate / 100));
    // Wait for timestamped WASAPI chunks before pairing render and capture.
    this.latencyFrames = 8;
    this.inputBuffer = [];
    this.referenceBuffer = [];
    this.outputBuffer = [];
    this.systemReferenceCapacity = Math.round(sampleRate * 4);
    this.systemReference = new Float32Array(this.systemReferenceCapacity);
    this.systemReferenceStartFrame = null;
    this.systemReferenceEndFrame = null;
    this.inputBufferStartFrame = null;
    this.pendingFrames = [];
    this.framesById = new Map();
    this.nextFrameId = 1;
    this.inFlightFrameIds = [];
    this.nativeBatchSize = 4;
    // Native Sonora is ready synchronously on the first IPC frame. Keeping
    // this flag avoids changing the worklet protocol used by older builds.
    this.processorReady = true;

    this.port.onmessage = (event) => {
      if (event.data.type === 'processor-ready') {
        this.processorReady = true;
        this.dispatchNextFrame();
      } else if (event.data.type === 'output-batch') {
        const frameIds = Array.isArray(event.data.frameIds) ? event.data.frameIds.map(Number) : [];
        const enhanced = new Float32Array(event.data.frame);
        this.inFlightFrameIds = [];
        for (let index = 0; index < frameIds.length; index += 1) {
          const pending = this.framesById.get(frameIds[index]);
          if (!pending) continue;
          const start = index * this.inputFrameSize;
          const frame = enhanced.slice(start, start + this.inputFrameSize);
          if (frame.length === this.inputFrameSize) pending.enhanced = frame;
          pending.processed = true;
        }
        this.dispatchNextFrame();
      } else if (event.data.type === 'output') {
        const frameId = Number(event.data.frameId);
        this.inFlightFrameIds = [];
        const pending = this.framesById.get(frameId);
        if (pending) {
          const enhanced = new Float32Array(event.data.frame);
          if (enhanced.length === this.inputFrameSize) pending.enhanced = enhanced;
          pending.processed = true;
        }
        this.dispatchNextFrame();
      } else if (event.data.type === 'processor-error-batch') {
        const frameIds = Array.isArray(event.data.frameIds) ? event.data.frameIds.map(Number) : [];
        this.inFlightFrameIds = [];
        for (const frameId of frameIds) {
          const pending = this.framesById.get(frameId);
          if (pending) {
            pending.failed = true;
            pending.processed = true;
          }
        }
        this.dispatchNextFrame();
      } else if (event.data.type === 'processor-error') {
        const frameId = Number(event.data.frameId);
        this.inFlightFrameIds = [];
        const pending = this.framesById.get(frameId);
        if (pending) {
          pending.failed = true;
          pending.processed = true;
        }
        this.dispatchNextFrame();
      } else if (event.data.type === 'system-reference') {
        const frame = new Float32Array(event.data.frame);
        const endFrame = Number(event.data.endFrame);
        if (Number.isFinite(endFrame)) {
          this.writeSystemReference(endFrame - frame.length, frame);
        }
      }
    };
  }

  writeSystemReference(startFrame, frame) {
    if (!frame.length) return;
    if (this.systemReferenceStartFrame == null) {
      this.systemReferenceStartFrame = startFrame;
      this.systemReferenceEndFrame = startFrame;
    }
    const minimumFrame = Math.max(0, (this.systemReferenceEndFrame || startFrame) - this.systemReferenceCapacity);
    if (startFrame + frame.length <= minimumFrame) return;
    if (startFrame < minimumFrame) {
      frame = frame.slice(minimumFrame - startFrame);
      startFrame = minimumFrame;
    }
    if (startFrame > this.systemReferenceEndFrame) {
      for (let index = this.systemReferenceEndFrame; index < startFrame; index += 1) {
        this.systemReference[index % this.systemReferenceCapacity] = 0;
      }
    }
    for (let index = 0; index < frame.length; index += 1) {
      this.systemReference[(startFrame + index) % this.systemReferenceCapacity] = frame[index];
    }
    this.systemReferenceStartFrame = Math.max(minimumFrame, this.systemReferenceStartFrame);
    this.systemReferenceEndFrame = Math.max(this.systemReferenceEndFrame, startFrame + frame.length);
  }

  readSystemReference(startFrame, length) {
    if (this.systemReferenceStartFrame == null || this.systemReferenceEndFrame == null) return null;
    if (startFrame < this.systemReferenceStartFrame || startFrame + length > this.systemReferenceEndFrame) return null;
    const result = new Float32Array(length);
    for (let index = 0; index < length; index += 1) {
      result[index] = this.systemReference[(startFrame + index) % this.systemReferenceCapacity];
    }
    return result;
  }

  calculateRms(frame) {
    let energy = 0;
    for (let i = 0; i < frame.length; i += 1) energy += frame[i] * frame[i];
    return Math.sqrt(energy / Math.max(1, frame.length));
  }

  calculateCorrelation(input, reference, inputRms, referenceRms) {
    if (inputRms < 0.0001 || referenceRms < 0.0001) return 0;
    let dot = 0;
    for (let i = 0; i < input.length; i += 1) dot += input[i] * reference[i];
    return Math.min(1, Math.abs(dot / (input.length * inputRms * referenceRms)));
  }

  chooseReference(frame, fallback, startFrame) {
    // AEC3 maintains its own render history and delay estimator. It must see
    // every render frame in chronological order; selecting a different offset
    // per frame breaks its adaptive filter and makes speech sound metallic.
    return this.readSystemReference(startFrame, frame.length) || fallback;
  }

  dispatchNextFrame() {
    if (!this.processorReady || this.inFlightFrameIds.length) return;
    // Do not send a frame until the bounded look-ahead has accumulated. This
    // gives the timestamped render stream time to reach the worklet.
    if (this.pendingFrames.length <= this.latencyFrames) return;
    const eligibleCount = this.pendingFrames.length - this.latencyFrames;
    const batch = this.pendingFrames
      .slice(0, eligibleCount)
      .filter((frame) => !frame.sent)
      .slice(0, this.nativeBatchSize);
    if (!batch.length) return;
    // Wait for a full batch during normal operation. This adds at most 30 ms
    // while cutting IPC traffic to one quarter of the previous rate.
    if (batch.length < this.nativeBatchSize) return;

    const frameIds = [];
    const inputBatch = new Float32Array(batch.length * this.inputFrameSize);
    const referenceBatch = new Float32Array(batch.length * this.inputFrameSize);
    batch.forEach((pending, batchIndex) => {
      pending.sent = true;
      frameIds.push(pending.frameId);
      const reference = this.chooseReference(pending.original, pending.reference, pending.startFrame);
      pending.reference = reference;
      pending.referenceRms = this.calculateRms(reference);
      pending.correlation = this.calculateCorrelation(
        pending.original,
        reference,
        pending.inputRms,
        pending.referenceRms,
      );
      inputBatch.set(pending.original, batchIndex * this.inputFrameSize);
      referenceBatch.set(reference, batchIndex * this.inputFrameSize);
    });
    this.inFlightFrameIds = frameIds;
    this.port.postMessage(
      { type: 'input-batch', frameIds, frame: inputBatch.buffer, reference: referenceBatch.buffer },
      [inputBatch.buffer, referenceBatch.buffer],
    );
  }

  selectFrameOutput(frame) {
    if (frame.failed) {
      // Never fall back to an unprocessed microphone frame.
      return new Float32Array(frame.original.length);
    }
    if (!frame.enhanced) {
      // Preserve intelligible speech if native processing misses a deadline.
      // The old 12% attenuation made entire words nearly inaudible.
      return frame.original;
    }

    const result = new Float32Array(this.inputFrameSize);
    for (let i = 0; i < result.length; i += 1) {
      result[i] = Math.max(-1, Math.min(1, frame.enhanced[i]));
    }
    return result;
  }

  queueFrame(original, reference, startFrame) {
    const inputRms = this.calculateRms(original);
    const referenceRms = this.calculateRms(reference);
    const pending = {
      frameId: this.nextFrameId,
      original,
      reference,
      startFrame,
      inputRms,
      referenceRms,
      correlation: this.calculateCorrelation(original, reference, inputRms, referenceRms),
      enhanced: null,
      sent: false,
      processed: false,
    };
    this.nextFrameId += 1;
    this.pendingFrames.push(pending);
    this.framesById.set(pending.frameId, pending);
    this.dispatchNextFrame();

    // Native processing is intentionally off the audio render thread. If the
    // IPC processor is unavailable, keep a bounded latency and pass Chromium's
    // AEC result through instead of buffering seconds of speech.
    if (!this.processorReady) {
      while (this.pendingFrames.length > this.latencyFrames) {
        const due = this.pendingFrames.shift();
        this.framesById.delete(due.frameId);
        due.processed = true;
        this.outputBuffer.push(...due.original);
      }
      return;
    }

    // Emit one whole, matching frame after a fixed delay. If the processor
    // missed the deadline, use this frame's original audio instead of stale output.
    while (this.pendingFrames.length > this.latencyFrames && this.pendingFrames[0].processed) {
      const due = this.pendingFrames.shift();
      this.framesById.delete(due.frameId);
      this.outputBuffer.push(...this.selectFrameOutput(due));
    }
  }

  process(inputs, outputs) {
    const input = inputs[0] && inputs[0][0];
    const reference = inputs[1] && inputs[1][0];
    const output = outputs[0] && outputs[0][0];
    if (!output) return true;
    if (!input) {
      output.fill(0);
      return true;
    }

    if (this.inputBufferStartFrame == null) this.inputBufferStartFrame = currentFrame;
    for (let i = 0; i < input.length; i += 1) this.inputBuffer.push(input[i]);
    for (let i = 0; i < input.length; i += 1) {
      this.referenceBuffer.push(reference ? reference[i] : 0);
    }

    while (this.inputBuffer.length >= this.inputFrameSize) {
      const frame = new Float32Array(this.inputBuffer.splice(0, this.inputFrameSize));
      const ref = new Float32Array(this.referenceBuffer.splice(0, this.inputFrameSize));
      const startFrame = this.inputBufferStartFrame;
      this.inputBufferStartFrame += this.inputFrameSize;
      this.queueFrame(frame, ref, startFrame);
    }

    for (let i = 0; i < output.length; i += 1) {
      output[i] = this.outputBuffer.length ? this.outputBuffer.shift() : 0;
    }
    return true;
  }
}

registerProcessor('mctier-localvqe-bridge', LocalVqeBridgeProcessor);
