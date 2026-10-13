import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// Run the actual component's measurement effect with controllable layout and resize events.
const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/components/MiniWindow/AnnouncementBar.tsx', import.meta.url))],
  bundle: true, format: 'esm', write: false, jsx: 'automatic',
  plugins: [{ name: 'layout-fixture', setup(b) {
    b.onResolve({ filter: /^(react(?:\/jsx-runtime)?|\.\.\/\.\.\/i18n)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents:
      path === 'react' ? 'export const useRef=()=>globalThis.layout.refs[globalThis.layout.index++]; export const useState=()=>[globalThis.layout.overflow,v=>globalThis.layout.overflow=v]; export const useLayoutEffect=f=>globalThis.layout.effect=f;'
      : path === 'react/jsx-runtime' ? 'export const jsx=(type,props)=>({type,props}); export const jsxs=jsx;'
      : 'export const tl=(zh)=>zh;'
    }));
  } }],
});
const { AnnouncementBar } = await import(`data:text/javascript,${encodeURIComponent(bundle.outputFiles[0].text)}`);

test('announcement responds to overflow, window resizing, text and delayed font layout', async () => {
  const originalObserver = globalThis.ResizeObserver, originalDocument = globalThis.document;
  let resize, disconnected = false, fontsReady;
  const box = { clientWidth: 240 }, label = { scrollWidth: 120 }, observed = [];
  globalThis.layout = { refs: [{ current: box }, { current: label }], index: 0, overflow: 0 };
  globalThis.ResizeObserver = class {
    constructor(callback) { resize = callback; }
    observe(element) { observed.push(element); }
    disconnect() { disconnected = true; }
  };
  globalThis.document = { fonts: { ready: new Promise(resolve => { fontsReady = resolve; }) } };
  function render(text = '公告') {
    globalThis.layout.index = 0;
    return AnnouncementBar({ text }).props.children[1].props.children.props;
  }
  let cleanup;
  try {
    render(); cleanup = globalThis.layout.effect();
    assert.deepEqual(observed, [box, label]);
    assert.equal(render().className, 'mini-announce-marquee');
    box.clientWidth = 80; resize();
    assert.match(render().className, /is-overflowing/);
    assert.equal(render().style['--announce-offset'], '-40px');
    box.clientWidth = 300; resize();
    assert.equal(render().className, 'mini-announce-marquee');
    label.scrollWidth = 400; resize();
    assert.match(render('较长公告').className, /is-overflowing/);
    label.scrollWidth = 300; fontsReady(); await Promise.resolve();
    assert.equal(render().className, 'mini-announce-marquee'); // Exact fit stays still.
    cleanup(); cleanup = null;
    assert.ok(disconnected);
    label.scrollWidth = 500; resize();
    assert.equal(globalThis.layout.overflow, 0); // No state update after unmount.
  } finally {
    cleanup?.(); delete globalThis.layout;
    globalThis.ResizeObserver = originalObserver; globalThis.document = originalDocument;
  }
});
