import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: ['src/hooks/useHoldVoice.ts'], bundle: true, format: 'iife', globalName: 'VoiceHook', write: false,
  plugins: [{ name: 'recording-platform', setup(b) {
    b.onResolve({ filter: /^(react|.*nvidiaNoise|.*lobbyCaptureGate)$/ }, args => ({ path: args.path, namespace: 'platform' }));
    b.onLoad({ filter: /.*/, namespace: 'platform' }, ({ path }) => ({ contents: path === 'react'
      ? 'export const useRef=v=>({current:v}); export const useState=v=>[v,()=>{}]; export const useEffect=f=>{globalThis.cleanups.push(f());};'
      : path.endsWith('nvidiaNoise') ? 'export const captureVoiceStream=async()=>globalThis.stream;'
      : 'export const lobbyCaptureGate={suspend:()=>()=>{globalThis.releases++;}};' }));
  } }],
});

function fixture({ opus = true, constraints, delayedStop = false } = {}) {
  const recordings = [], sent = [], requested = [];
  const context = vm.createContext({ Blob, cleanups: [], releases: 0, now: 0,
    window: new EventTarget(), document: new EventTarget(),
    setTimeout(fn) { context.begin = fn; return 1; }, clearTimeout() {}, setInterval() { return 2; }, clearInterval() {},
    performance: { now: () => context.now },
  });
  const track = { stops: 0, stop() { this.stops++; }, applyConstraints(value) { requested.push(value); return constraints?.() ?? Promise.resolve(); } };
  context.stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  context.MediaRecorder = class {
    static isTypeSupported(type) { return opus ? type.includes('webm') : type === 'audio/mp4'; }
    constructor(stream, options) { this.stream = stream; this.options = options; recordings.push(this); }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; this.ondataavailable({ data: new Blob(['encoded-audio']) }); if (!delayedStop) this.onstop(); }
  };
  vm.runInContext(bundle.outputFiles[0].text, context);
  const hook = context.VoiceHook.useHoldVoice(true, async (blob, duration) => sent.push({ blob, duration }), () => assert.fail('Unexpected recording failure'), 'lobby');
  hook.handlers.onPointerDown({ button: 0, pointerId: 1, clientY: 100, currentTarget: { setPointerCapture() {} } });
  return { context, hook, recordings, sent, requested, track };
}

test('records mono speech at 16 kbps Opus and transmits the encoded bytes', async () => {
  const f = fixture(); await f.context.begin();
  assert.equal(f.requested[0].channelCount, 1);
  assert.equal(f.recordings[0].options.audioBitsPerSecond, 16000);
  f.context.now = 2000; f.hook.handlers.onPointerUp();
  assert.equal(f.sent[0].blob.type, 'audio/webm');
  assert.equal(await f.sent[0].blob.text(), 'encoded-audio');
  assert.equal(f.sent[0].duration, 2);
  assert.ok(f.track.stops > 0 && f.context.releases > 0);
});

test('AAC fallback uses 24 kbps and cancelling sends nothing', async () => {
  const f = fixture({ opus: false }); await f.context.begin();
  assert.equal(f.recordings[0].options.mimeType, 'audio/mp4');
  assert.equal(f.recordings[0].options.audioBitsPerSecond, 24000);
  f.context.now = 2000; f.hook.cancel();
  assert.equal(f.sent.length, 0);
});

test('release while applying mono constraints cannot start a late recording', async () => {
  let ready;
  const f = fixture({ constraints: () => new Promise(resolve => { ready = resolve; }) });
  const starting = f.context.begin();
  await Promise.resolve(); await Promise.resolve();
  f.hook.handlers.onPointerUp(); ready(); await starting;
  assert.equal(f.recordings.length, 0);
  assert.equal(f.sent.length, 0);
  assert.ok(f.track.stops > 0 && f.context.releases > 0);
});

test('a deferred recorder stop after leaving the conversation cannot send to a new session', async () => {
  const f = fixture({ delayedStop: true }); await f.context.begin();
  f.context.now = 2000; f.hook.handlers.onPointerUp();
  f.context.cleanups.forEach(cleanup => cleanup());
  f.recordings[0].onstop();
  assert.equal(f.sent.length, 0);
});
