import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
const bundle = await build({ entryPoints: ['src/services/voice/lobbyCaptureGate.ts'], bundle: true, format: 'esm', write: false });
const { LobbyCaptureGate } = await import(`data:text/javascript,${encodeURIComponent(bundle.outputFiles[0].text)}`);
const track = () => Object.assign(new EventTarget(), { enabled: true, readyState: 'live' });

test('recording suppresses existing and replacement lobby tracks, not the recorder', () => {
  const gate = new LobbyCaptureGate(), current = track(), replacement = track(), recorder = track();
  gate.register(current, () => true);
  const release = gate.suspend();
  gate.register(replacement, () => true);
  assert.equal(current.enabled, false);
  assert.equal(replacement.enabled, false);
  assert.equal(recorder.enabled, true);
  release();
  assert.equal(current.enabled, true);
  assert.equal(replacement.enabled, true);
});

test('release respects latest mic intent and nested asynchronous recordings', () => {
  const gate = new LobbyCaptureGate(), audio = track();
  let intent = true;
  gate.register(audio, () => intent);
  const first = gate.suspend(), second = gate.suspend();
  first(); first();
  assert.equal(audio.enabled, false);
  intent = false;
  second();
  assert.equal(audio.enabled, false);
  const third = gate.suspend();
  intent = true;
  third();
  assert.equal(audio.enabled, true);
});

test('ended tracks are not reactivated', () => {
  const gate = new LobbyCaptureGate(), audio = track();
  gate.register(audio, () => true);
  const release = gate.suspend();
  audio.readyState = 'ended';
  audio.dispatchEvent(new Event('ended'));
  release();
  assert.equal(audio.enabled, false);
});
