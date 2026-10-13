// Voice buffers 60 ms of jitter; both paths accept bounded batches across busy renderer IPC.
class NativeMicrophoneProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.recording = options?.processorOptions?.recording === true;
    // Recording: 19 outstanding + 10 incoming packets; voice: 5 + 5.
    this.buffer = new Float32Array(this.recording ? 28800 : 9600);
    this.primed = false;
    this.read = 0;
    this.length = 0;
    this.consumed = 0;
    this.rendered = 0;
    this.underrun = 0;
    this.port.onmessage = ({ data }) => {
      if (!(data instanceof ArrayBuffer) || data.byteLength < 3840 || data.byteLength % 3840 !== 0 || data.byteLength > (this.recording ? 38400 : 19200)) return;
      const samples = new Float32Array(data);
      for (const value of samples) {
        if (this.length === this.buffer.length) {
          this.read = (this.read + 1) % this.buffer.length;
          this.length--;
          this.consumed++; // Discarded PCM must also release producer backpressure.
        }
        this.buffer[(this.read + this.length++) % this.buffer.length] = Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
      }
    };
  }
  process(_inputs, outputs) {
    const output = outputs[0]?.[0];
    // Voice uses 60 ms rather than recording's 300 ms to keep calls responsive.
    // Do not start the audio clock on a single 20 ms IPC packet then repeatedly
    // underrun while 1080p/60 screen frames occupy the renderer thread.
    if (!this.primed && this.length >= (this.recording ? 14400 : 2880)) this.primed = true;
    if (!this.primed) { output?.fill(0); return true; }
    if (output) for (let index = 0; index < output.length; index++) {
      if (!this.length) { this.underrun++; if (!this.recording) this.primed = false; }
      output[index] = this.length ? this.buffer[this.read] : 0;
      if (this.length) { this.read = (this.read + 1) % this.buffer.length; this.length--; this.consumed++; }
    }
    while (this.consumed >= 960) { this.consumed -= 960; this.port.postMessage('consumed'); }
    this.rendered += output?.length || 0;
    if (this.rendered >= 48000) {
      this.port.postMessage({ underrun: this.underrun, buffered: this.length });
      this.rendered = 0; this.underrun = 0;
    }
    return true;
  }
}
registerProcessor('mctier-native-microphone', NativeMicrophoneProcessor);
