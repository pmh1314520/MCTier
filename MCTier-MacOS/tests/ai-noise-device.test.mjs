import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = ts.transpileModule(fs.readFileSync('src/services/voice/nvidiaNoise.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const amd = { kind: 'audioinput', label: 'Microphone (AMD Streaming Audio Device)', deviceId: 'amd' };
const nvidia = { kind: 'audioinput', label: 'Microphone (NVIDIA Broadcast)', deviceId: 'nvidia' };
function fixture(mode = 'auto', preferred = '', devices = [nvidia, amd]) {
  const calls = [], tracks = [];
  const context = vm.createContext({ exports: {}, DOMException, Event,
    require: path => path.endsWith('nativeMicrophone') ? {
      nativeMicrophoneSupported: async () => false,
      microphoneDevices: () => context.navigator.mediaDevices.enumerateDevices(),
      openMicrophone: (id, systemProcessing = true) => context.navigator.mediaDevices.getUserMedia({ audio: {
        ...(id ? { deviceId: systemProcessing ? { ideal: id } : { exact: id } } : {}), noiseSuppression: systemProcessing,
      } }),
    } : ({ audioDevices: { getInputDeviceId: () => preferred } }),
    localStorage: { getItem: () => mode, setItem: (_, value) => { mode = value; } },
    window: { dispatchEvent() {} },
    navigator: { mediaDevices: {
      enumerateDevices: async () => devices,
      getUserMedia: async constraints => {
        calls.push(constraints);
        const track = { stop() { this.stopped = true; }, getSettings: () => ({ deviceId: constraints.audio.deviceId?.exact ?? 'ordinary' }) };
        tracks.push(track);
        return { getTracks: () => [track], getAudioTracks: () => [track] };
      },
    } },
  });
  vm.runInContext(source, context);
  return { api: context.exports, context, calls, tracks };
}

test('AMD and NVIDIA virtual inputs are recognized; output devices are excluded', () => {
  const { api } = fixture();
  assert.equal(api.noiseProvider(amd), 'amd');
  assert.equal(api.noiseProvider(nvidia), 'nvidia');
  assert.equal(api.noiseProvider({ ...amd, kind: 'audiooutput' }), null);
  assert.equal(api.noiseProvider({ ...amd, label: 'Realtek Audio' }), null);
});
test('automatic mode respects selected AMD input and avoids double noise suppression', async () => {
  const { api } = fixture('auto', 'amd');
  const constraints = await api.microphoneConstraints();
  assert.equal(constraints.deviceId.exact, 'amd');
  assert.equal(constraints.noiseSuppression, false);
});
test('explicit provider overrides device order; unavailable provider and old off setting retain ordinary mic', async () => {
  assert.equal((await fixture('amd').api.aiNoiseDevice()).deviceId, 'amd');
  assert.equal((await fixture('nvidia', 'amd').api.aiNoiseDevice()).deviceId, 'nvidia');
  for (const f of [fixture('off', 'mic'), fixture('amd', 'mic', [nvidia])]) {
    const c = await f.api.microphoneConstraints();
    assert.equal(c.deviceId.ideal, 'mic');
    assert.equal(c.noiseSuppression, true);
  }
});
test('device removal falls back while permission rejection is not retried', async () => {
  const f = fixture('amd'); let attempts = 0;
  f.context.navigator.mediaDevices.getUserMedia = async constraints => {
    attempts++;
    if (constraints.audio.deviceId?.exact) throw new DOMException('removed', 'NotFoundError');
    return { getTracks: () => [], getAudioTracks: () => [] };
  };
  await f.api.captureVoiceStream();
  assert.ok(attempts >= 2);
  attempts = 0;
  f.context.navigator.mediaDevices.getUserMedia = async () => { attempts++; throw new DOMException('denied', 'NotAllowedError'); };
  await assert.rejects(f.api.captureVoiceStream(), { name: 'NotAllowedError' });
  assert.equal(attempts, 1);
});
test('labels revealed after permission select AMD and release the temporary stream', async () => {
  const f = fixture('amd'); let enumerations = 0;
  f.context.navigator.mediaDevices.enumerateDevices = async () => ++enumerations === 1 ? [] : [amd];
  await f.api.captureVoiceStream();
  assert.equal(f.calls.length, 2);
  assert.equal(f.tracks[0].stopped, true);
  assert.equal(f.calls[1].audio.deviceId.exact, 'amd');
});
