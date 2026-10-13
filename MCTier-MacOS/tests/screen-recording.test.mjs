import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const bundle = await build({ entryPoints: [fileURLToPath(new URL('../src/services/screenRecording.ts', import.meta.url))], bundle: true, format: 'esm', write: false,
  plugins: [{ name: 'recording-devices', setup(b) {
    b.onResolve({ filter: /\/i18n$|\/ui\/feedback$/ }, args => ({ path: args.path, namespace: 'ui-mock' }));
    b.onLoad({ filter: /.*/, namespace: 'ui-mock' }, () => ({ contents: 'export const tl=(zh)=>zh; export const showFeedback=(...args)=>globalThis.recordTest.feedback.push(args);' }));
    b.onResolve({ filter: /^@tauri-apps\/api\/core$|\/nativeCapture$|\/nativeMicrophone$/ }, args => ({ path: args.path, namespace: 'recording-mock' }));
    b.onLoad({ filter: /.*/, namespace: 'recording-mock' }, () => ({ contents: 'export const invoke=(...a)=>globalThis.recordTest.invoke(...a); export const requestNativeScreen=(...a)=>globalThis.recordTest.capture(...a); export const openMicrophone=()=>{throw Error("Unexpected audio")}; export const resumeAudioContext=async()=>{};' }));
  } }] });
const { screenRecording } = await import(`data:text/javascript,${encodeURIComponent(bundle.outputFiles[0].text)}`);
const options = { resolution: 720, frameRate: 30, bitrateMbps: 4, systemAudio: false, microphone: false, countdown: 0 };
class FakeRecorder extends EventTarget {
  static isTypeSupported() { return true; }
  state = 'inactive';
  start() { this.state = 'recording'; }
  pause() { this.state = 'paused'; }
  resume() { this.state = 'recording'; }
  data(bytes) { this.ondataavailable?.({ data: new Blob([bytes]) }); }
  stop() { this.state = 'inactive'; setTimeout(() => { this.data(new Uint8Array([3])); this.dispatchEvent(new Event('stop')); }, 0); }
}
function setup() {
  const calls = [];
  const track = new EventTarget(); track.readyState = 'live'; track.stop = () => { track.readyState = 'ended'; };
  globalThis.MediaRecorder = FakeRecorder;
  globalThis.MediaStream = class { constructor(tracks) { this.tracks = tracks; } getVideoTracks() { return this.tracks; } getTracks() { return this.tracks; } };
  globalThis.recordTest = {
    feedback: [],
    capture: async () => new MediaStream([track]),
    invoke: async (name, args) => { calls.push([name, args]); if (name === 'recording_create') return { id: 'test', path: 'output.webm' }; if (name === 'recording_finish') return args.discard ? '' : 'output.webm'; },
  };
  return { service: new screenRecording.constructor(), calls, track };
}
test('recording writes final chunk before finishing and repeated stop is idempotent', async () => {
  const { service, calls, track } = setup();
  await service.start(options);
  service.recorder.data(new Uint8Array([1, 2]));
  service.pause(); assert.equal(service.getSnapshot().phase, 'paused');
  service.pause(); assert.equal(service.getSnapshot().phase, 'recording');
  await Promise.all([service.stop(), service.stop()]);
  assert.deepEqual(calls.map(c => c[0]), ['recording_create', 'recording_write', 'recording_write', 'recording_finish']);
  assert.equal(service.getSnapshot().bytes, 3); assert.equal(track.readyState, 'ended');
  assert.equal(service.getSnapshot().phase, 'idle');
  assert.deepEqual(recordTest.feedback, [['success', '视频已保存至： output.webm']]);
});
test('cancel during source selection discards the file and releases the capture', async () => {
  const { service, calls, track } = setup();
  let choose;
  recordTest.capture = () => new Promise(resolve => { choose = resolve; });
  const started = service.start(options);
  await new Promise(resolve => setImmediate(resolve));
  service.cancel(); choose(new MediaStream([track])); await started;
  assert.equal(service.getSnapshot().error, ''); assert.equal(track.readyState, 'ended');
  assert.deepEqual(recordTest.feedback, []);
  assert.equal(calls.at(-1)[1].discard, true); assert.equal(service.getSnapshot().phase, 'idle');
});
test('encoder error waits for its trailing data and stop event even after becoming inactive', async () => {
  const { service, calls } = setup(); await service.start(options);
  const recorder = service.recorder;
  recorder.state = 'inactive'; recorder.onerror();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.filter(c => c[0] === 'recording_finish').length, 0);
  recorder.data(new Uint8Array([7, 8])); recorder.dispatchEvent(new Event('stop'));
  await service.stop();
  assert.equal(service.getSnapshot().bytes, 2); assert.match(service.getSnapshot().error, /编码失败/);
});
test('disk write failure stops recording, releases tracks and reports incomplete output', async () => {
  const { service, track } = setup();
  const invoke = recordTest.invoke;
  recordTest.invoke = async (name, args) => { if (name === 'recording_write') throw Error('disk full'); return invoke(name, args); };
  await service.start(options); service.recorder.data(new Uint8Array([1]));
  await new Promise(resolve => setTimeout(resolve, 20)); await service.stop();
  assert.match(service.getSnapshot().error, /disk full/); assert.equal(track.readyState, 'ended'); assert.equal(service.getSnapshot().phase, 'idle');
});
test('large encoder chunks are streamed through bounded IPC requests', async () => {
  const { service, calls } = setup(); await service.start(options);
  service.recorder.data(new Uint8Array(3 * 1024 * 1024 + 5)); await service.stop();
  const writes = calls.filter(c => c[0] === 'recording_write');
  assert.equal(writes.length, 5); assert.ok(writes.every(c => c[1].byteLength <= 1024 * 1024));
});
