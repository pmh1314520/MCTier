import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const code = ts.transpileModule(fs.readFileSync('src/services/voice/nativeMicrophone.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
// 平台判定在模块作用域读取 navigator.platform，必须按用例注入，否则 macOS 分支永远走不到。
const platformCode = ts.transpileModule(fs.readFileSync('src/utils/platform.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
const levelContext = vm.createContext({ exports: {} });
vm.runInContext(ts.transpileModule(fs.readFileSync('src/services/voice/microphoneLevel.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, levelContext);
function setup({ native = true, moduleFailure = false, startFailure = null, resumeMode = 'running', platform = 'Linux x86_64', timers = { setTimeout, clearTimeout } } = {}) {
  const calls = [], reads = [], nodes = [], contexts = [], browser = [];
  const window = new EventTarget();
  class Track extends EventTarget {
    readyState = 'live';
    stop() { this.readyState = 'ended'; }
    getSettings() { return {}; }
  }
  const track = new Track();
  const stream = { getAudioTracks: () => [track], getTracks: () => [track] };
  class Context {
    sampleRate = 48000;
    state = 'suspended';
    constructor() { contexts.push(this); }
    audioWorklet = { addModule: async () => { if (moduleFailure) throw new Error('worklet'); } };
    createMediaStreamDestination() { return { stream }; }
    async resume() {
      if (resumeMode === 'reject') throw new Error('resume denied');
      if (resumeMode === 'hang') return new Promise(() => {});
      if (resumeMode === 'running') this.state = 'running';
    }
    async close() { this.state = 'closed'; }
  }
  class Worklet {
    port = { messages: [], postMessage: bytes => this.port.messages.push(bytes), close: () => { this.closed = true; } };
    constructor() { nodes.push(this); }
    connect() {}
    disconnect() {}
  }
  const api = { isTauri: () => true, invoke: async (command, args) => {
    calls.push([command, args]);
    if (command === 'native_microphone_supported') return native;
    if (command === 'native_microphone_devices') return [{ deviceId: 'wasapi:mic', kind: 'audioinput', label: 'Mic' }];
    if (command === 'native_microphone_start' || command === 'recording_system_audio_start') {
      if (startFailure) throw startFailure;
      return { id: 'capture', deviceId: 'wasapi:mic', sampleRate: 48000 };
    }
    if (command === 'native_microphone_read') return new Promise((resolve, reject) => reads.push({ resolve, reject }));
  } };
  const platformContext = vm.createContext({ exports: {}, navigator: { platform } });
  vm.runInContext(platformCode, platformContext);
  const context = vm.createContext({ exports: {}, require: path => path.includes('microphoneLevel') ? levelContext.exports : path.includes('platform') ? platformContext.exports : path.includes('worklet') || path.includes('Worklet') ? { default: 'worklet.js' } : api,
    AudioContext: Context, AudioWorkletNode: Worklet, ArrayBuffer, DOMException, Event, window, console, ...timers,
    navigator: { platform, mediaDevices: { getUserMedia: async options => { browser.push(options); return stream; } } },
  });
  vm.runInContext(code, context);
  return { api: context.exports, calls, reads, nodes, contexts, browser, track, window };
}
test('native enumeration never starts recording; Windows capture never asks the browser', async () => {
  const f = setup();
  const devices = await f.api.microphoneDevices();
  assert.equal(devices[0].deviceId, 'wasapi:mic');
  assert.ok(!f.calls.some(([name]) => name === 'native_microphone_start'));
  const stream = await f.api.openMicrophone('wasapi:mic', false);
  assert.equal(f.browser.length, 0);
  assert.equal(f.calls.find(([name]) => name === 'native_microphone_start')[1].systemProcessing, false);
  assert.equal(stream.getAudioTracks()[0].getSettings().sampleRate, 48000);
  stream.getTracks()[0].stop(); stream.getTracks()[0].stop(); await flush();
  assert.equal(f.calls.filter(([name]) => name === 'native_microphone_stop').length, 1);
  assert.equal(f.contexts[0].state, 'closed');
  assert.equal(f.nodes[0].closed, true);
});
test('device failure allows a fresh later attempt without browser fallback', async () => {
  const f = setup({ startFailure: 'Windows privacy blocked' });
  await assert.rejects(f.api.openMicrophone(), /Windows privacy blocked/);
  await assert.rejects(f.api.openMicrophone(), /Windows privacy blocked/);
  assert.equal(f.calls.filter(([name]) => name === 'native_microphone_start').length, 2);
  assert.equal(f.browser.length, 0);
});

test('native test meter reports quiet PCM without a second audio graph, and clears on stop', async () => {
  const f = setup();
  const stream = await f.api.openMicrophone();
  assert.equal(f.api.nativeMicrophoneLevel(stream), 0);
  const quiet = new Float32Array(960).fill(0.0013);
  // Previous linear display rounded this genuine signal to zero.
  assert.equal(Math.round(0.0013 * 300), 0);
  f.reads[0].resolve(quiet.buffer); await flush();
  assert.ok(f.api.nativeMicrophoneLevel(stream) > 0.0012);
  assert.ok(levelContext.exports.microphoneLevelPercent(f.api.nativeMicrophoneLevel(stream)) >= 3);
  f.reads[1].resolve(new Float32Array(960).fill(0.1).buffer); await flush();
  assert.ok(levelContext.exports.microphoneLevelPercent(f.api.nativeMicrophoneLevel(stream)) >= 66);
  stream.getTracks()[0].stop();
  assert.equal(f.api.nativeMicrophoneLevel(stream), 0);
  assert.equal(f.contexts.length, 1);
  const { pcmRms, microphoneLevelPercent } = levelContext.exports;
  assert.equal(microphoneLevelPercent(pcmRms(new Float32Array(960))), 0);
  assert.equal(microphoneLevelPercent(NaN), 0);
  assert.equal(microphoneLevelPercent(5), 100);
});
test('worklet initialization failure releases the native device', async () => {
  const f = setup({ moduleFailure: true });
  await assert.rejects(f.api.openMicrophone(), /worklet/);
  assert.equal(f.calls.filter(([name]) => name === 'native_microphone_stop').length, 1);
  assert.equal(f.contexts[0].state, 'closed');
});

test('suspended, rejected and timed out audio engines release capture instead of returning a silent stream', async () => {
  for (const resumeMode of ['suspended', 'reject', 'hang']) {
    const callbacks = new Map(); let next = 0;
    const f = setup({ resumeMode, timers: {
      setTimeout(callback) { callbacks.set(++next, callback); return next; },
      clearTimeout(id) { callbacks.delete(id); },
    } });
    const pending = assert.rejects(f.api.openMicrophone(), /音频引擎|resume denied/);
    await flush();
    if (resumeMode === 'hang') for (const callback of callbacks.values()) callback();
    await pending;
    assert.equal(f.contexts[0].state, 'closed');
    assert.equal(f.calls.filter(([name]) => name === 'native_microphone_stop').length, 1);
    assert.equal(f.reads.length, 0);
    assert.equal(callbacks.size, 0);
  }
});
test('queued PCM stays bounded until the audio thread consumes it', async () => {
  const f = setup(); await f.api.openMicrophone();
  for (let i = 0; i < 6; i++) { f.reads[i].resolve(new ArrayBuffer(3840)); await flush(); }
  assert.equal(f.reads.length, 6);
  assert.equal(f.nodes[0].port.messages.length, 6);
  f.nodes[0].port.onmessage(); await flush();
  assert.equal(f.reads.length, 7);
  f.window.dispatchEvent(new Event('beforeunload')); await flush();
  f.reads[6].resolve(new ArrayBuffer(3840)); await flush();
  assert.equal(f.nodes[0].port.messages.length, 6);
  assert.equal(f.track.readyState, 'ended');
});
test('malformed packets or unplugging ends the track once and releases capture', async () => {
  for (const malformed of [false, true]) {
    const f = setup(); await f.api.openMicrophone(); let ended = 0;
    f.track.addEventListener('ended', () => ended++);
    if (malformed) f.reads[0].resolve(new ArrayBuffer(7)); else f.reads[0].reject(new Error('unplugged'));
    await flush();
    assert.equal(ended, 1); assert.equal(f.track.readyState, 'ended');
    assert.equal(f.calls.filter(([name]) => name === 'native_microphone_stop').length, 1);
  }
});
test('other desktop backends retain their browser media path', async () => {
  const f = setup({ native: false }); await f.api.openMicrophone('linux-mic');
  assert.equal(f.browser[0].audio.deviceId.ideal, 'linux-mic');
  assert.ok(!f.calls.some(([name]) => name === 'native_microphone_start'));
});

test('macOS uses the browser path for microphone capture, bypassing the native unit', async () => {
  // 未签名/ad-hoc 打包版里原生 AUHAL 输入回调不触发（coreaudiod 不认 TCC 授权），
  // 所以 macOS 麦克风直接走 WKWebView getUserMedia，根本不碰原生单元。
  // startFailure 即使设了也无所谓——原生路径不会被调用。
  const f = setup({ platform: 'MacIntel', startFailure: new Error('不应触发：原生路径已跳过') });
  const stream = await f.api.openMicrophone('coreaudio:BuiltInMicrophoneDevice', true);
  assert.equal(f.browser.length, 1, 'macOS 麦克风应直接走浏览器采集');
  assert.ok(!f.calls.some(([name]) => name === 'native_microphone_start'), '不应调用原生采集');
  // coreaudio: 前缀是 CoreAudio 的 UID，浏览器不认识，回退时置空用系统默认设备。
  assert.equal(f.browser[0].audio.deviceId, undefined);
  assert.equal(stream.getAudioTracks()[0].readyState, 'live');
});

test('macOS never falls back for system audio, which only the native path can capture', async () => {
  const f = setup({ platform: 'MacIntel', startFailure: new Error('需要虚拟音频设备（如 BlackHole）') });
  await assert.rejects(f.api.openMicrophone('', true, true, true), /BlackHole/);
  assert.equal(f.browser.length, 0);
});

test('macOS never opens the native microphone unit even when it would succeed', async () => {
  // 契约变更：macOS 不再走原生采集单元，一律用浏览器 getUserMedia。
  const f = setup({ platform: 'MacIntel' });
  const stream = await f.api.openMicrophone('coreaudio:BuiltInMicrophoneDevice');
  assert.equal(f.browser.length, 1, 'macOS 应直接用浏览器采集');
  assert.ok(!f.calls.some(([name]) => name === 'native_microphone_start'), '不应调用原生采集');
  assert.equal(stream.getAudioTracks()[0].readyState, 'live');
});

test('Windows never falls back to the browser on a native failure', async () => {
  const f = setup({ platform: 'Win32', startFailure: 'Windows privacy blocked' });
  await assert.rejects(f.api.openMicrophone(), /Windows privacy blocked/);
  assert.equal(f.browser.length, 0);
});

test('recording accepts batched PCM and backpressures by audio duration, not IPC count', async () => {
  const f = setup();
  const stream = await f.api.openMicrophone('', true, false, true);
  assert.equal(f.calls.find(([name]) => name === 'native_microphone_start')[1].recording, true);
  for (let i = 0; i < 2; i++) { f.reads[i].resolve(new ArrayBuffer(38400)); await flush(); }
  assert.equal(f.reads.length, 2);
  assert.equal(f.nodes[0].port.messages.length, 2);
  f.nodes[0].port.onmessage({ data: { underrun: 0, buffered: 9600 } }); await flush();
  assert.equal(f.reads.length, 2, 'diagnostic messages must not acknowledge PCM');
  f.nodes[0].port.onmessage({ data: 'consumed' }); await flush();
  assert.equal(f.reads.length, 3);
  stream.getTracks()[0].stop(); await flush();
});

test('recording worklet absorbs batched delivery jitter without dropping samples', () => {
  let Processor;
  const messages = [];
  class Base { port = { postMessage: message => messages.push(message) }; }
  const context = vm.createContext({ AudioWorkletProcessor: Base, Float32Array, ArrayBuffer,
    registerProcessor: (_, type) => { Processor = type; } });
  vm.runInContext(fs.readFileSync('src/services/voice/nativeMicrophoneWorklet.js', 'utf8'), context);
  const p = new Processor({ processorOptions: { recording: true } });
  const output = new Float32Array(128);
  p.port.onmessage({ data: new Float32Array(9600).fill(0.25).buffer });
  p.process([], [[output]]);
  assert.ok(output.every(value => value === 0), 'wait for the initial jitter buffer');
  p.port.onmessage({ data: new Float32Array(4800).fill(0.25).buffer });
  for (let i = 0; i < 1500; i++) {
    // 200 ms arrives in one IPC response, despite the audio renderer's 128-sample blocks.
    if (i > 0 && i % 75 === 0) p.port.onmessage({ data: new Float32Array(9600).fill(0.25).buffer });
    p.process([], [[output]]);
    assert.ok(output.every(value => value === 0.25), `PCM gap at render quantum ${i}`);
  }
  assert.ok(messages.filter(m => typeof m === 'object').every(m => m.underrun === 0));
  assert.equal(messages.filter(m => m === 'consumed').length, 200);
  assert.equal(p.buffer.length, 28800);
});

test('audio worklet renders PCM, sanitizes invalid samples, bounds latency and emits silence on underrun', () => {
  let Processor;
  class Base { port = { postMessage() {} }; }
  const context = vm.createContext({ AudioWorkletProcessor: Base, Float32Array, ArrayBuffer,
    registerProcessor: (_, type) => { Processor = type; } });
  vm.runInContext(fs.readFileSync('src/services/voice/nativeMicrophoneWorklet.js', 'utf8'), context);
  const p = new Processor();
  const samples = new Float32Array(960).fill(0.25); samples[0] = NaN; samples[1] = 2;
  p.port.onmessage({ data: samples.buffer });
  const output = new Float32Array(960); p.process([], [[output]]);
  assert.ok(output.every(value => value === 0));
  p.port.onmessage({ data: new Float32Array(1920).fill(0.25).buffer });
  p.process([], [[output]]);
  assert.equal(output[0], 0); assert.equal(output[1], 1); assert.equal(output[2], 0.25);
  p.process([], [[output]]); p.process([], [[output]]);
  p.process([], [[output]]); assert.ok(output.every(value => value === 0));
  p.port.onmessage({ data: samples.buffer }); p.process([], [[output]]);
  assert.ok(output.every(value => value === 0), 'rebuffer after a stall rather than chop every arriving packet');
  for (let i = 0; i < 20; i++) p.port.onmessage({ data: samples.buffer });
  assert.equal(p.length, 9600);
});

test('voice accepts catch-up batches while bounding all queued PCM by duration', async () => {
  const f = setup(); const stream = await f.api.openMicrophone();
  try {
    f.reads[0].resolve(new ArrayBuffer(19200)); await flush();
    f.reads[1].resolve(new ArrayBuffer(19200)); await flush();
    assert.equal(f.nodes[0].port.messages.length, 2);
    assert.equal(f.reads.length, 2);
    for (let i = 0; i < 4; i++) f.nodes[0].port.onmessage({ data: 'consumed' });
    await flush(); assert.equal(f.reads.length, 2);
    f.nodes[0].port.onmessage({ data: { underrun: 0, buffered: 5760 } });
    await flush(); assert.equal(f.reads.length, 2);
    f.nodes[0].port.onmessage({ data: 'consumed' });
    await flush(); assert.equal(f.reads.length, 3);
    assert.equal(f.track.readyState, 'live');
  } finally { stream.getTracks()[0].stop(); }
});

test('voice PCM remains continuous under 40 ms screen-sharing IPC stalls', () => {
  let Processor;
  const messages = [];
  class Base { port = { postMessage: message => messages.push(message) }; }
  const context = vm.createContext({ AudioWorkletProcessor: Base, Float32Array, ArrayBuffer,
    registerProcessor: (_, type) => { Processor = type; } });
  vm.runInContext(fs.readFileSync('src/services/voice/nativeMicrophoneWorklet.js', 'utf8'), context);
  const p = new Processor();
  const source = Float32Array.from({ length: 2880 + 128 * 1500 }, (_, i) => Math.sin(i * 2 * Math.PI * 440 / 48000) * 0.4);
  let sent = 2880;
  p.port.onmessage({ data: source.slice(0, sent).buffer });
  const output = new Float32Array(128);
  for (let quantum = 0; quantum < 1500; quantum++) {
    if (quantum > 0 && quantum % 15 === 0) {
      // Main-thread IPC returns two 20 ms packets together after each 40 ms stall.
      p.port.onmessage({ data: source.slice(sent, sent + 1920).buffer }); sent += 1920;
    }
    p.process([], [[output]]);
    assert.deepEqual(output, source.slice(quantum * 128, (quantum + 1) * 128), `audio discontinuity at quantum ${quantum}`);
  }
  assert.ok(messages.filter(m => typeof m === 'object').every(m => m.underrun === 0));
  assert.equal(messages.filter(m => m === 'consumed').length, 200);
});
