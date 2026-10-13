import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';

const code = await build({ entryPoints: ['src/components/Danmaku/DanmakuSettings.tsx'], bundle: true, write: false,
  format: 'iife', globalName: 'Settings', jsx: 'transform', tsconfigRaw: { compilerOptions: { jsx: 'react' } }, plugins: [{ name: 'ui-boundaries', setup(b) {
    b.onResolve({ filter: /^(react|antd|@ant-design\/icons|react-i18next|.*\/i18n|.*danmakuService|.*\.css)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents:
      path === 'react' ? 'export default { createElement: (type,props,...children)=>({type,props:props||{},children}) }; export const useState=globalThis.hooks.useState;'
      : path === 'antd' ? 'export const Switch="Switch",Slider="Slider",ColorPicker="ColorPicker",App={useApp:()=>({message:{success(){}}})};'
      : path === '@ant-design/icons' ? 'export const CheckOutlined="Check",BgColorsOutlined="Colors";'
      : path === 'react-i18next' ? 'export const useTranslation=()=>{};'
      : path.endsWith('/i18n') ? 'export const tl=zh=>zh;'
      : path.endsWith('danmakuService') ? 'export const danmakuService={ getConfig:()=>globalThis.config, setConfig:async patch=>Object.assign(globalThis.config,patch) };'
      : '' }));
  } }] });
function fixture() {
  const state = []; let cursor = 0; let random = 0;
  const context = vm.createContext({ config: { color: '#ffffff', enabled: true, speed: 140, fontSize: 24, opacity: 1, tracks: 4 },
    Math: Object.assign(Object.create(Math), { random: () => (random++ % 10) / 10 }),
    hooks: { useState(initial) { const i = cursor++; if (!(i in state)) state[i] = typeof initial === 'function' ? initial() : initial;
      return [state[i], value => { state[i] = typeof value === 'function' ? value(state[i]) : value; }]; } },
  });
  vm.runInContext(code.outputFiles[0].text, context);
  return { render() { cursor = 0; return context.Settings.DanmakuSettings(); } };
}
function nodes(node) { return !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.children)]; }
test('white and random swatches have an explicit selected state and check mark', () => {
  const f = fixture(); let all = nodes(f.render());
  const white = all.find(n => n.props?.['aria-label'] === '#ffffff');
  assert.equal(white.type, 'button'); assert.equal(white.props['aria-pressed'], true);
  assert.ok(nodes(white).some(n => n.type === 'Check'));
  const rainbow = all.find(n => n.props?.['aria-label']?.includes('每条随机'));
  rainbow.props.onClick(); all = nodes(f.render());
  assert.equal(all.find(n => n.props?.['aria-label'] === '#ffffff').props['aria-pressed'], false);
  assert.ok(nodes(all.find(n => n.props?.['aria-pressed'] && n.props?.['aria-label']?.includes('每条随机'))).some(n => n.type === 'Check'));
});
test('custom color uses themed picker and updates actual preview and selected state', () => {
  const f = fixture(); let all = nodes(f.render());
  assert.ok(!all.some(n => n.type === 'input' && n.props.type === 'color'));
  const picker = all.find(n => n.type === 'ColorPicker');
  assert.equal(picker.props.disabledAlpha, true);
  picker.props.onChange({ toHexString: () => '#aabbcc' });
  all = nodes(f.render());
  assert.equal(all.find(n => n.props?.className === 'danmaku-color-custom').props['aria-pressed'], true);
  assert.equal(all.find(n => n.props?.className === 'danmaku-preview-bullet').props.style['--danmaku-preview-color'], '#aabbcc');
});
test('random preview sets explicit color and changes on the next pass without restarting animation', () => {
  const f = fixture(); nodes(f.render()).find(n => n.props?.['aria-label']?.includes('每条随机')).props.onClick();
  const first = nodes(f.render()).find(n => n.props?.className === 'danmaku-preview-bullet');
  first.props.onAnimationIteration();
  const second = nodes(f.render()).find(n => n.props?.className === 'danmaku-preview-bullet');
  assert.notEqual(first.props.style.color, second.props.style.color);
  assert.match(second.props.style['--danmaku-preview-color'], /^hsl\(/);
  assert.equal(first.props.key, second.props.key);
});
