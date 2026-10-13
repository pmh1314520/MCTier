import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
const root = fileURLToPath(new URL('../', import.meta.url));
const runtime = createRequire(path.join(process.argv[2], 'package.json'));
const { chromium } = runtime('playwright-core');
const PptxGenJS = runtime('pptxgenjs');
const output = mkdtempSync(path.join(tmpdir(), 'mctier-media-verification-'));
const deck = new PptxGenJS(); deck.layout = 'LAYOUT_WIDE';
for (const [title, color] of [['MCTier Slide One', '31A86B'], ['MCTier Slide Two', 'D46A72']]) {
  const slide = deck.addSlide(); slide.background = { color: 'FFFFFF' };
  slide.addShape(deck.ShapeType.rect, { x: 1, y: 1, w: 4, h: 3, fill: { color }, line: { color } });
  slide.addText(title, { x: 6, y: 2, w: 5, h: 1, fontSize: 32, color: '252A30' });
  slide.addImage({ data: 'image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=', x: 1, y: 5, w: .5, h: .5 });
}
const pptx = await deck.write({ outputType: 'nodebuffer' });
const zip = new JSZip(); zip.file('folder/nested/readme.txt', 'Preview the hierarchy, never this content'); zip.folder('empty');
const zipBytes = await zip.generateAsync({ type: 'nodebuffer' });
// Public libarchive regression fixtures, BSD-licensed, decoded from the matching
// test_read_format_7zip_copy.7z.uu and test_read_format_rar.rar.uu in libarchive/test.
const archiveFixtures = {
  '/fixture.7z': ['application/octet-stream', Buffer.from('N3q8ryccAANBxn2IPAAAAAAAAABCAAAAAAAAAIPbi2MgICAgICAgICAgICAgICAgICAgICAgICAgIGZpbGUgMSBjb250ZW50cwpoZWxsbwpoZWxsbwpoZWxsbwoBBAYAAQk8AAcLAQABAQAMPAAICgGqHd4PAAAFARENAGYAaQBsAGUAMQAAABQKAQCA1kAAqLKdARUGAQAgAAAAAAA=', 'base64')],
  '/fixture.rar': ['application/octet-stream', Buffer.from('UmFyIRoHAM+QcwAADQAAAAAAAACEUnQgkDIAFAAAABQAAAADQqLIvrd22j4UMAgApIEAAHRlc3QudHh0gAi3dto+t3baPnRlc3QgdGV4dCBkb2N1bWVudA0KnS90IJAyAAgAAAAIAAAAA3tEybbRTNg+FDAIAP+hAAB0ZXN0bGlua8AI0UzYPlBf2j50ZXN0LnR4dM3gdCCQOgAUAAAAFAAAAANCosi+Y3faPhQwEACkgQAAdGVzdGRpclx0ZXN0LnR4dMDMY3faPmN32j50ZXN0IHRleHQgZG9jdW1lbnQNCqHIdOCQMQAAAAAAAAAAAAMAAAAAY3faPhQwBwDtQQAAdGVzdGRpcsDMY3faPmR32j7m53TgkDYAAAAAAAAAAAADAAAAAJ2r1T4UMAwA7UEAAHRlc3RlbXB0eWRpcoDMnavVPsVd2j7EPXsAQAcA', 'base64')],
};
mkdirSync(path.join(output, 'folder/nested'), { recursive: true });
writeFileSync(path.join(output, 'folder/nested/readme.txt'), 'Nested file');
for (const ext of ['tar', 'tgz']) {
  const destination = path.join(output, `fixture.${ext}`);
  execFileSync('tar', [ext === 'tar' ? '-cf' : '-czf', destination, '-C', output, 'folder']);
  archiveFixtures[`/fixture.${ext}`] = ['application/octet-stream', readFileSync(destination)];
}
const compiled = await build({ stdin: { contents: `
import React from 'react'; import {createRoot} from 'react-dom/client';
import {LocalFilePreview} from './src/components/ChatRoom/LocalFilePreview';
import {VoiceMessageBubble} from './src/components/ChatRoom/ChatRoom';
const query = new URLSearchParams(location.search); const kind = query.get('kind'); const ext = query.get('ext') || (kind === 'slides' ? 'pptx' : 'zip');
const voices = [1,4,10,60];
createRoot(document.getElementById('root')).render(kind ? <LocalFilePreview url={'/fixture.'+ext} name={'fixture.'+ext} kind={kind}/> :
<div className="chat-room"><div className="chat-messages">{voices.map(seconds=><div key={seconds} className="chat-message own"><div className="message-avatar">U</div><div className="message-bubble-stack"><div className="message-content message-content-voice"><VoiceMessageBubble src="" own duration={seconds}/></div></div></div>)}<div className="chat-message own"><div className="message-avatar">U</div><div className="message-bubble-stack"><div className="message-content message-content-file"><button className="chat-file-bubble"><span className="chat-file-icon">F</span><span className="chat-file-info"><strong>VeryLongFilenameWithNoWhitespace.pptx</strong><small>PowerPoint</small></span></button></div></div></div></div></div>);
`, resolveDir: root, loader: 'jsx' }, bundle: true, format: 'iife', write: false, define: { 'import.meta.env.DEV': 'false' },
plugins: [{ name: 'no-css', setup(b) { b.onResolve({ filter: /\.css$/ }, a => ({ path: a.path, namespace: 'empty' })); b.onLoad({filter: /.*/, namespace: 'empty'}, () => ({ contents: '' })); } }],
});
const server = createServer((request, response) => {
  const pathname = request.url.split('?')[0];
  const routes = {
    ...archiveFixtures,
    '/fixture.pptx': ['application/octet-stream', pptx], '/fixture.zip': ['application/octet-stream', zipBytes],
    '/app.js': ['text/javascript', compiled.outputFiles[0].text],
    '/style.css': ['text/css', readFileSync(path.join(root, 'src/components/ChatRoom/ChatRoom.css'))],
    '/file-preview/index.html': ['text/html', readFileSync(path.join(root, 'public/file-preview/index.html'))],
  };
  const [type, data] = routes[pathname] || ['text/html', '<html data-theme="dark"><head><link rel="stylesheet" href="/style.css"><style>html,body,#root{margin:0;width:100%;height:100%}.file-preview-pdf{height:100vh;width:100%;border:0}</style></head><body><div id="root"></div><script src="/app.js"></script></body></html>'];
  if (pathname === '/file-preview/index.html') {
    const script = String(data).match(/<script>([\s\S]*)<\/script>/)[1];
    const hash = createHash('sha256').update(script).digest('base64');
    response.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self' 'sha256-${hash}' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data: blob:; worker-src 'self' blob:; connect-src 'self' data: blob:; frame-src 'self' blob:; object-src 'none'`);
  }
  response.setHeader('Content-Type', type); response.end(data);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.argv[3] });
  const page = await browser.newPage();
  page.on('pageerror', error => console.log('PAGE ERROR:', error.message));
  page.on('console', msg => { if (msg.type() === 'error') console.log('BROWSER:', msg.text().slice(0,400)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const width of [390, 1100]) {
    await page.setViewportSize({ width, height: 820 });
    for (const theme of ['dark', 'light']) {
      await page.goto(base); await page.locator('.chat-file-bubble').waitFor();
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
      const layout = await page.evaluate(() => [...document.querySelectorAll('.chat-message')].map(message => {
        const avatar = message.querySelector('.message-avatar').getBoundingClientRect();
        const content = message.querySelector('.message-content');
        const box = content.getBoundingClientRect();
        const child = content.firstElementChild.getBoundingClientRect();
        return { gap: avatar.left - child.right, overflow: child.right - box.right, tail: getComputedStyle(content, '::after').display, width: child.width };
      }));
      for (const item of layout) { assert.ok(item.gap >= 8, JSON.stringify(layout)); assert.ok(item.overflow < 1); assert.notEqual(item.tail, 'none'); }
      assert.ok(layout[0].width < layout[1].width); assert.equal(layout[2].width, layout[3].width);
      await page.screenshot({ path: path.join(output, `bubbles-${width}-${theme}.png`) });
    }
    for (const ext of ['pptx', 'zip', '7z', 'rar', 'tar', 'tgz']) {
      const kind = ext === 'pptx' ? 'slides' : 'archive';
      await page.goto(`${base}/?kind=${kind}&ext=${ext}`);
      const frame = page.frameLocator('iframe');
      if (kind === 'slides') {
        try { await frame.getByText('MCTier Slide One', { exact: false }).waitFor({ timeout: 15000 }); }
        catch (error) {
          console.log('FRAME STATE:', await frame.locator('body').innerText());
          console.log('FRAME HTML:', (await frame.locator('#content').innerHTML()).slice(0, 3000));
          await page.screenshot({ path: path.join(output, 'failure.png') });
          console.log('Failure screenshot:', output); throw error;
        }
        await frame.getByText('MCTier Slide Two', { exact: false }).waitFor();
        assert.ok(await frame.locator('svg,img').count() >= 2, 'Slide visuals must be rendered');
      } else {
        const expectedName = ext === '7z' ? 'file1' : ext === 'rar' ? 'test.txt' : 'readme.txt';
        try { await frame.getByText(expectedName, { exact: false }).first().waitFor({ timeout: 25000 }); }
        catch (error) { console.log('ARCHIVE STATE:', ext, await frame.locator('body').innerText()); throw error; }
        assert.ok(await frame.locator('.archive-tree li').count() >= (ext === '7z' ? 1 : 3));
        assert.equal(await frame.getByText('Preview the hierarchy, never this content').count(), 0);
      }
      await page.screenshot({ path: path.join(output, `${ext}-${width}.png`) });
    }
  }
  console.log('PASS: desktop/mobile widths, dark/light bubbles, avatar spacing, tails, actual slide visuals and archive hierarchy. Screenshots:', output);
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
