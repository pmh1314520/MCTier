import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isBypassPreset,
  requiresOutputRebuild,
} from '../src/services/voice/voicePresetPolicy.ts';

const EFFECT_PRESETS = ['uncle', 'male', 'female', 'loli', 'chipmunk', 'robot', 'telephone'];

test('原声 bypasses the WebAudio graph entirely', () => {
  // 纯原声通话不应插入任何中间处理层，发出去的必须是采集到的原始轨道。
  assert.equal(isBypassPreset('none'), true);
});

test('every effect preset still goes through the graph', () => {
  for (const preset of EFFECT_PRESETS) {
    assert.equal(isBypassPreset(preset), false, preset);
  }
});

test('crossing the bypass boundary rebuilds the outgoing track', () => {
  // 原声态下引擎没有图，只改 preset 不会产出新轨道，必须重建并 replaceTrack。
  for (const preset of EFFECT_PRESETS) {
    assert.equal(requiresOutputRebuild('none', preset), true, 'none -> ' + preset);
    assert.equal(requiresOutputRebuild(preset, 'none'), true, preset + ' -> none');
  }
});

test('switching between two effects keeps the same output track', () => {
  // 变声内部换音色由引擎原地改图，输出轨道不变，因此不需要重协商。
  assert.equal(requiresOutputRebuild('loli', 'uncle'), false);
  assert.equal(requiresOutputRebuild('robot', 'telephone'), false);
});

test('selecting the same preset never forces a rebuild', () => {
  for (const preset of ['none', ...EFFECT_PRESETS]) {
    assert.equal(requiresOutputRebuild(preset, preset), false, preset);
  }
});
