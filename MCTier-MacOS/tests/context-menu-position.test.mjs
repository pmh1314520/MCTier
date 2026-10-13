import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const bundle = await build({ entryPoints: [fileURLToPath(new URL('../src/utils/contextMenuPosition.ts', import.meta.url))], bundle: true, format: 'esm', write: false });
const { contextMenuPosition: position } = await import(`data:text/javascript,${encodeURIComponent(bundle.outputFiles[0].text)}`);
test('short menus stay at the cursor instead of reserving a 428px phantom menu', () => {
  assert.deepEqual(position(200, 500, 170, 100, 1000, 700), { left: 200, top: 500 });
});
test('only actual overflow moves a menu and tiny windows remain bounded', () => {
  assert.deepEqual(position(980, 690, 170, 100, 1000, 700), { left: 822, top: 592 });
  assert.deepEqual(position(-1, -1, 170, 100, 200, 150), { left: 8, top: 8 });
});
