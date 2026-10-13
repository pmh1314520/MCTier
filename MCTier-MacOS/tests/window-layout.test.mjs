import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const projectRoot = new URL('../', import.meta.url);

// windowLayout 在模块作用域读取 navigator.platform，必须在导入打包结果之前打桩，
// 让用例无论跑在哪个平台上都走 macOS 这条分支。
Object.defineProperty(globalThis, 'navigator', {
  value: { platform: 'MacIntel' },
  configurable: true,
});

const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/utils/windowLayout.ts', import.meta.url))],
  bundle: true,
  format: 'esm',
  write: false,
});
const { LAYOUT_BREAKPOINT, resolveWindowLayout, expandedWindowSize, collapsedWindowSize } =
  await import(`data:text/javascript,${encodeURIComponent(bundle.outputFiles[0].text)}`);

/** 取出一份 CSS 里所有 @media 块的查询条件与块体。 */
function mediaBlocks(css) {
  const blocks = [];
  const opening = /@media\s*\(([^)]*)\)\s*\{/g;
  let match;
  while ((match = opening.exec(css)) !== null) {
    let depth = 1;
    let cursor = opening.lastIndex;
    while (cursor < css.length && depth > 0) {
      if (css[cursor] === '{') depth += 1;
      else if (css[cursor] === '}') depth -= 1;
      cursor += 1;
    }
    blocks.push({ query: match[1], body: css.slice(opening.lastIndex, cursor - 1) });
    opening.lastIndex = cursor;
  }
  return blocks;
}

test('竖屏与横排按同一个断点判定，边界不重叠也不留空隙', () => {
  assert.equal(resolveWindowLayout(LAYOUT_BREAKPOINT - 1), 'portrait');
  assert.equal(resolveWindowLayout(LAYOUT_BREAKPOINT), 'landscape');
  assert.equal(resolveWindowLayout(240), 'portrait');
  assert.equal(resolveWindowLayout(2560), 'landscape');
});

test('两种形态的窗口尺寸跨过断点，CSS 的媒体查询才会给出对应布局', () => {
  const portrait = expandedWindowSize('portrait');
  const landscape = expandedWindowSize('landscape');
  assert.ok(
    portrait.width < LAYOUT_BREAKPOINT,
    `竖屏窗口宽度 ${portrait.width} 必须小于断点 ${LAYOUT_BREAKPOINT}，否则会渲染成横排`
  );
  assert.ok(
    landscape.width >= LAYOUT_BREAKPOINT,
    `横排窗口宽度 ${landscape.width} 必须达到断点 ${LAYOUT_BREAKPOINT}`
  );
  // 收起时只留标题栏，高度必须低于任一展开尺寸。
  const collapsed = collapsedWindowSize();
  assert.ok(collapsed.height < portrait.height && collapsed.height < landscape.height);
});

test('macOS 桌面布局的媒体查询断点与 JS 判定保持一致', () => {
  const cssFiles = readdirSync(fileURLToPath(projectRoot), { recursive: true })
    .filter((file) => file.endsWith('.css') && file.startsWith('src'))
    .map((file) => ({ file, css: readFileSync(fileURLToPath(new URL(file, projectRoot)), 'utf8') }))
    .filter(({ css }) => css.includes("data-platform='macos'"));

  assert.ok(cssFiles.length > 0, '应至少有一份 CSS 为 macOS 定制样式');

  for (const { file, css } of cssFiles) {
    for (const { query, body } of mediaBlocks(css)) {
      if (!body.includes("data-platform='macos'")) continue;
      const minWidth = /min-width:\s*(\d+)px/.exec(query);
      assert.ok(minWidth, `${file} 的 macOS 媒体查询使用了无法识别的断点: ${query}`);
      assert.equal(
        Number(minWidth[1]),
        LAYOUT_BREAKPOINT,
        `${file} 的 macOS 媒体查询断点 ${minWidth[1]}px 与 JS 判定 ${LAYOUT_BREAKPOINT} 不一致，` +
          '窗口拖到两者之间时 JS 与 CSS 会给出不同的形态'
      );
    }
  }
});

test('macOS 窗口默认按竖屏打开', () => {
  const config = JSON.parse(
    readFileSync(fileURLToPath(new URL('src-tauri/tauri.macos.conf.json', projectRoot)), 'utf8')
  );
  const window = config.app.windows[0];
  const portrait = expandedWindowSize('portrait');
  assert.equal(window.width, portrait.width, 'macOS 默认窗口宽度应为竖屏宽度');
  assert.equal(window.height, portrait.height, 'macOS 默认窗口高度应为竖屏高度');
  assert.ok(
    window.minWidth <= portrait.width && window.minHeight <= portrait.height,
    '最小尺寸不能大于默认竖屏尺寸，否则窗口一打开就被撑大'
  );
});
