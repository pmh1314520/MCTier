import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

let instance = 0;
async function loadUtil() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../src/utils/protectedPasswordEdit.ts', import.meta.url))],
    bundle: true, format: 'esm', write: false,
  });
  const mod = await import(`data:text/javascript,${encodeURIComponent(result.outputFiles[0].text)}#${instance++}`);
  return mod;
}

test('protected password mask is exactly eight asterisks', async () => {
  const { SAVED_PASSWORD_MASK } = await loadUtil();
  assert.equal(SAVED_PASSWORD_MASK, '********');
});

test('any printable key atomically replaces the whole masked placeholder', async () => {
  const { nextProtectedEditValue } = await loadUtil();
  const none = { altKey: false, ctrlKey: false, metaKey: false };
  assert.equal(nextProtectedEditValue('a', none), 'a');
  assert.equal(nextProtectedEditValue('Z', none), 'Z');
  assert.equal(nextProtectedEditValue('3', none), '3');
  assert.equal(nextProtectedEditValue('!', none), '!');
  // 星号本身也是合法的密码字符：占位替换后不会再被剥星逻辑误伤。
  assert.equal(nextProtectedEditValue('*', none), '*');
  assert.equal(nextProtectedEditValue(' ', none), ' ');
});

test('backspace and delete clear the placeholder instead of editing inside it', async () => {
  const { nextProtectedEditValue } = await loadUtil();
  const none = { altKey: false, ctrlKey: false, metaKey: false };
  assert.equal(nextProtectedEditValue('Backspace', none), '');
  assert.equal(nextProtectedEditValue('Delete', none), '');
});

test('modifier combos and navigation keys fall through to the browser', async () => {
  const { nextProtectedEditValue } = await loadUtil();
  const none = { altKey: false, ctrlKey: false, metaKey: false };
  // Cmd/Ctrl+V、Cmd+A 等组合不拦截（粘贴由 onPaste 专门处理）。
  assert.equal(nextProtectedEditValue('v', { altKey: false, ctrlKey: true, metaKey: false }), null);
  assert.equal(nextProtectedEditValue('a', { altKey: false, ctrlKey: false, metaKey: true }), null);
  assert.equal(nextProtectedEditValue('a', { altKey: true, ctrlKey: false, metaKey: false }), null);
  // 导航与功能键。
  assert.equal(nextProtectedEditValue('ArrowLeft', none), null);
  assert.equal(nextProtectedEditValue('Enter', none), null);
  assert.equal(nextProtectedEditValue('Tab', none), null);
  assert.equal(nextProtectedEditValue('Shift', none), null);
  assert.equal(nextProtectedEditValue('Process', none), null);
});
