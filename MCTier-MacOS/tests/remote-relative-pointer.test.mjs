import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: ['src/services/remoteControl/relativePointer.ts'], bundle: true, write: false, format: 'esm' });
const { RelativePointer } = await import(`data:text/javascript,${encodeURIComponent(bundle.outputFiles[0].text)}`);

test('game movement preserves direction and accumulates fractional movement without screen coordinates', () => {
  const events = [], pointer = new RelativePointer(e => events.push(e));
  pointer.move(0.5, -0.5);
  assert.equal(events.length, 0);
  pointer.move(0.75, -0.75);
  pointer.move(-7, 4);
  assert.deepEqual(events, [
    { kind: 'relative-move', dx: 1, dy: -1 },
    { kind: 'relative-move', dx: -6, dy: 3 },
  ]);
});

test('clicks and release on pointer unlock never send absolute cursor positions', () => {
  const events = [], pointer = new RelativePointer(e => events.push(e));
  pointer.button(0, false); // Mouse-up from the click that acquired pointer lock.
  assert.equal(events.length, 0);
  pointer.button(0, true);
  pointer.button(2, true);
  pointer.button(0, false);
  pointer.release();
  pointer.release();
  assert.deepEqual(events, [
    { kind: 'relative-button', button: 0, down: true },
    { kind: 'relative-button', button: 2, down: true },
    { kind: 'relative-button', button: 0, down: false },
    { kind: 'relative-button', button: 2, down: false },
  ]);
});

test('invalid input is ignored; unlock resets accumulated motion before another session', () => {
  const events = [], pointer = new RelativePointer(e => events.push(e));
  pointer.move(NaN, 1);
  pointer.move(1, Infinity);
  pointer.button(3, true);
  pointer.button(-1, true);
  pointer.move(0.75, 0.75);
  pointer.release();
  pointer.move(0.5, 0.5);
  assert.equal(events.length, 0);
  pointer.move(1e10, -1e10);
  assert.deepEqual(events, [{ kind: 'relative-move', dx: 32767, dy: -32766 }]);
});
