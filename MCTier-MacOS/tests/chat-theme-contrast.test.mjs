import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import postcss from 'postcss';
import vm from 'node:vm';

const css = postcss.parse(await readFile('src/components/EmojiPicker/EmojiPicker.css', 'utf8'));
function palette(selector) {
  const result = {};
  css.walkRules(selector, rule => rule.walkDecls(/^--emoji-/, d => { result[d.prop] = d.value; }));
  return result;
}
function luminance(hex) {
  let value = hex.slice(1);
  if (value.length === 3) value = [...value].map(c => c + c).join('');
  const rgb = [0, 2, 4].map(i => parseInt(value.slice(i, i + 2), 16) / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
  return rgb.reduce((s, v, i) => s + v * [.2126, .7152, .0722][i], 0);
}
const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);

for (const theme of ['dark', 'light']) test(`emoji ${theme} palette keeps labels legible on normal, selected, hover and danger fills`, () => {
  const tokens = { ...palette('.emoji-picker'), ...(theme === 'light' ? palette("html[data-theme='light'] .emoji-picker") : {}) };
  for (const [fg, bg] of [
    ['text', 'surface'], ['text', 'raised'], ['text', 'hover'], ['muted', 'surface'],
    ['muted', 'grid-bg'], ['accent', 'selected'], ['danger', 'danger-bg'], ['surface', 'danger'],
  ]) assert.ok(contrast(tokens[`--emoji-${fg}`], tokens[`--emoji-${bg}`]) >= 4.5, `${theme}: ${fg} on ${bg}`);
  assert.ok(contrast('#fff', '#327d1c') >= 4.5);
  assert.ok(contrast('#fff', '#286417') >= 4.5);
});

test('open document previews follow theme changes without reloading or accepting unrelated windows', async () => {
  const source = (await readFile('shared/file-preview/viewer.js', 'utf8')).replace(/^import .*;\r?$/gm, '');
  const document = { documentElement: { dataset: {} }, getElementById: () => ({ childElementCount: 0 }) };
  let onMessage;
  const parent = {};
  const context = vm.createContext({ document, window: { parent, addEventListener: (_type, cb) => { onMessage = cb; } }, location: { search: '' }, ArrayBuffer });
  vm.runInContext(source, context);
  const theme = dark => onMessage({ source: parent, data: { type: 'mctier-preview-theme', dark } });
  theme(false);
  onMessage({ source: parent, data: { type: 'mctier-preview', data: new ArrayBuffer(0), dark: true } });
  assert.equal(document.documentElement.dataset.theme, 'light');
  theme(true);
  assert.equal(document.documentElement.dataset.theme, 'dark');
  onMessage({ source: {}, data: { type: 'mctier-preview-theme', dark: false } });
  assert.equal(document.documentElement.dataset.theme, 'dark');
  theme(false);
  assert.equal(document.documentElement.dataset.theme, 'light');
});
