import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const result = await build({ entryPoints: [fileURLToPath(new URL('../src/services/chat/mediaLayout.ts', import.meta.url))], bundle: true, format: 'esm', write: false });
const { voiceBubbleWidth, nonEmptySheets } = await import(`data:text/javascript,${encodeURIComponent(result.outputFiles[0].text)}`);
test('voice width grows until ten seconds and reserves room for controls', () => {
  assert.equal(voiceBubbleWidth(0), 144);
  assert.ok(voiceBubbleWidth(4) > voiceBubbleWidth(1));
  assert.equal(voiceBubbleWidth(10), 240);
  assert.equal(voiceBubbleWidth(60), voiceBubbleWidth(10));
  for (const invalid of [-1, NaN, Infinity]) assert.equal(voiceBubbleWidth(invalid), 144);
});
test('blank sheets are hidden without losing populated sheet numbers or zero cells', () => {
  const sheets = ['--- 1 ---\n\t\n', '--- 2 ---\n0\tvalue', '--- 3 ---\n', '--- 4 ---\nFALSE'];
  assert.deepEqual(nonEmptySheets(sheets), [sheets[1], sheets[3]]);
});
