import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
const result = await build({
  entryPoints: ['src/services/webrtc/voiceHealth.ts'],
  bundle: true,
  format: 'esm',
  write: false,
});
const { VoiceHealth, parseVoiceHealth } = await import(
  `data:text/javascript,${encodeURIComponent(result.outputFiles[0].text)}`
);

test('one minute of healthy reception clears previous recovery backoff', () => {
  const h = new VoiceHealth();
  for (let t = 0; t <= 100000; t += 2000) h.observe(t, 0, null, true);
  for (let t = 102000; t <= 164000; t += 2000) assert.equal(h.observe(t, t, t, false), null);
  for (let t = 166000; t < 174000; t += 2000) assert.equal(h.observe(t, 164000, null, true), null);
  assert.equal(h.observe(174000, 164000, null, true), 'audio-track-or-negotiation');
});

test('voice health accepts bidirectional RTP, silence, DTX, absent and stale telemetry', () => {
  for (const mode of ['flowing', 'silent', 'missing', 'stale']) {
    const h = new VoiceHealth();
    for (let t = 0; t < 180000; t += 2000) {
      const remote =
        mode === 'missing'
          ? null
          : mode === 'silent'
            ? 0
            : mode === 'stale'
              ? Math.min(t, 4000)
              : t;
      assert.equal(
        h.observe(t, mode === 'flowing' ? t : 0, remote, false),
        null,
        `${mode} at ${t}`
      );
    }
  }
});

test('continuous remote RTP with stalled receive repairs after eight seconds, not immediately', () => {
  const h = new VoiceHealth();
  for (let t = 0; t < 10000; t += 2000) assert.equal(h.observe(t, 0, t, false), null);
  assert.equal(h.observe(10000, 0, 10000, false), 'inbound-audio-stalled');
});

test('transient loss resets suspicion when inbound recovers', () => {
  const h = new VoiceHealth();
  for (let t = 0; t < 180000; t += 2000)
    assert.equal(h.observe(t, Math.floor(t / 6000), t, false), null);
});

test('broken negotiation repairs even without telemetry; cooldown survives replacement', () => {
  const h = new VoiceHealth();
  for (let t = 0; t < 8000; t += 2000) assert.equal(h.observe(t, 0, null, true), null);
  assert.equal(h.observe(8000, 0, null, true), 'audio-track-or-negotiation');
  h.resetSample();
  for (let t = 10000; t < 38000; t += 2000) assert.equal(h.observe(t, 0, null, true), null);
  assert.equal(h.observe(38000, 0, null, true), 'audio-track-or-negotiation');
  for (let t = 40000; t < 98000; t += 2000) assert.equal(h.observe(t, 0, null, true), null);
  assert.equal(h.observe(98000, 0, null, true), 'audio-track-or-negotiation');
});

test('counter resets and telemetry disappearance never count as a stalled receiver', () => {
  const h = new VoiceHealth();
  for (const [t, rx, tx] of [
    [0, 100, 100],
    [2000, 100, 200],
    [4000, 0, 0],
    [6000, 0, null],
    [30000, 0, null],
  ]) {
    assert.equal(h.observe(t, rx, tx, false), null);
  }
});

test('bounded counter protocol rejects malformed, negative, fractional and unsafe values', () => {
  assert.equal(parseVoiceHealth('{"v":1,"packets":123}'), 123);
  assert.equal(parseVoiceHealth('{"v":1,"packets":0}'), 0);
  for (const input of [
    null,
    {},
    '',
    'null',
    '{',
    ' '.repeat(129),
    '{"v":2,"packets":1}',
    '{"v":1,"packets":-1}',
    '{"v":1,"packets":"1"}',
    '{"v":1,"packets":0.5}',
    '{"v":1,"packets":9007199254740992}',
  ]) {
    assert.equal(parseVoiceHealth(input), null);
  }
});
