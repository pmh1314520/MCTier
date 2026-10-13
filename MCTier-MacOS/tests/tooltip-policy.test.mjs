import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldHandleGlobalTooltip } from '../src/components/GlobalTooltip/tooltipPolicy.ts';

test('global tooltip handles plain native titles', () => {
  assert.equal(shouldHandleGlobalTooltip({ title: 'Copy', componentOwned: false, optedOut: false }), true);
});

test('component-owned tooltips are not duplicated', () => {
  assert.equal(shouldHandleGlobalTooltip({ title: 'Use virtual domain', componentOwned: true, optedOut: false }), false);
});

test('blank and opted-out titles are ignored', () => {
  assert.equal(shouldHandleGlobalTooltip({ title: '   ', componentOwned: false, optedOut: false }), false);
  assert.equal(shouldHandleGlobalTooltip({ title: 'Filename', componentOwned: false, optedOut: true }), false);
});
