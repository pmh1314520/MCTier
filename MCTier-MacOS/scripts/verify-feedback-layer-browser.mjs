import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const { chromium } = await import(pathToFileURL(path.join(process.argv[2], 'index.mjs')));
const compiled = await build({
  stdin: {
    contents: `import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { FeedbackHost } from './src/components/FeedbackHost/FeedbackHost';
      import { showFeedback } from './src/services/ui/feedback';
      createRoot(document.getElementById('root')).render(<>
        <FeedbackHost />
        <div className="chat-tabs"><button className="chat-search-toggle"><span className="anticon"><svg width="16" height="16" /></span></button></div>
        <div className="voice-message-stack"><div className="voice-message-bubble other">Voice</div><div className="voice-transcript-inline">Transcript</div></div>
        <div className="file-preview-modal"><section className="file-preview-panel"><header>Preview</header><div /></section></div>
      </>);
      setTimeout(() => showFeedback('success', '已添加到表情库'), 50);`,
    resolveDir: root,
    loader: 'jsx',
  },
  bundle: true,
  format: 'iife',
  write: false,
  plugins: [{
    name: 'styles',
    setup(context) {
      context.onResolve({ filter: /\.css$/ }, (args) => ({ path: args.path, namespace: 'empty-style' }));
      context.onLoad({ filter: /.*/, namespace: 'empty-style' }, () => ({ contents: '' }));
    },
  }],
});
const styles = [
  readFileSync(path.join(root, 'src/components/FeedbackHost/FeedbackHost.css'), 'utf8'),
  readFileSync(path.join(root, 'src/components/ChatRoom/ChatRoom.css'), 'utf8'),
].join('\n');
const server = createServer((request, response) => {
  if (request.url === '/app.js') {
    response.setHeader('Content-Type', 'text/javascript');
    response.end(compiled.outputFiles[0].text);
  } else if (request.url === '/styles.css') {
    response.setHeader('Content-Type', 'text/css');
    response.end(styles);
  } else {
    response.setHeader('Content-Type', 'text/html');
    response.end('<html data-theme="dark"><head><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.argv[3] });
  const page = await browser.newPage({ viewport: { width: 1000, height: 720 } });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const feedback = page.locator('.mctier-feedback');
  await feedback.waitFor();
  const result = await page.evaluate(() => {
    const item = document.querySelector('.mctier-feedback');
    const host = document.querySelector('.mctier-feedback-host');
    const panel = document.querySelector('.file-preview-panel');
    const searchButton = document.querySelector('.chat-search-toggle');
    const searchIcon = document.querySelector('.chat-search-toggle svg');
    const voiceBubble = document.querySelector('.voice-message-bubble');
    const voiceTranscript = document.querySelector('.voice-transcript-inline');
    if (!(item instanceof HTMLElement) || !(host instanceof HTMLElement) || !(panel instanceof HTMLElement) || !(searchButton instanceof HTMLElement) || !(searchIcon instanceof SVGElement) || !(voiceBubble instanceof HTMLElement) || !(voiceTranscript instanceof HTMLElement)) throw new Error('Fixture did not render');
    const itemBox = item.getBoundingClientRect();
    const panelBox = panel.getBoundingClientRect();
    const searchButtonBox = searchButton.getBoundingClientRect();
    const searchIconBox = searchIcon.getBoundingClientRect();
    const voiceBubbleBox = voiceBubble.getBoundingClientRect();
    const voiceTranscriptBox = voiceTranscript.getBoundingClientRect();
    return {
      feedbackText: item.textContent,
      hostParent: host.parentElement?.tagName,
      hostZIndex: Number(getComputedStyle(host).zIndex),
      previewZIndex: Number(getComputedStyle(panel.parentElement).zIndex),
      feedbackCenterOffset: Math.abs(itemBox.left + itemBox.width / 2 - innerWidth / 2),
      previewCenterOffsetX: Math.abs(panelBox.left + panelBox.width / 2 - innerWidth / 2),
      previewCenterOffsetY: Math.abs(panelBox.top + panelBox.height / 2 - innerHeight / 2),
      searchOffsetX: Math.abs(searchButtonBox.left + searchButtonBox.width / 2 - searchIconBox.left - searchIconBox.width / 2),
      searchOffsetY: Math.abs(searchButtonBox.top + searchButtonBox.height / 2 - searchIconBox.top - searchIconBox.height / 2),
      transcriptBelowVoice: voiceTranscriptBox.top >= voiceBubbleBox.bottom,
    };
  });
  assert.equal(result.feedbackText?.includes('已添加到表情库'), true);
  assert.equal(result.hostParent, 'BODY');
  assert.ok(result.hostZIndex > result.previewZIndex);
  assert.ok(result.feedbackCenterOffset < 1);
  assert.ok(result.previewCenterOffsetX < 1);
  assert.ok(result.previewCenterOffsetY < 1);
  assert.ok(result.searchOffsetX < 1);
  assert.ok(result.searchOffsetY < 1);
  assert.equal(result.transcriptBelowVoice, true);
  console.log('PASS: feedback and preview are centered, the search icon is centered, and voice text renders below its bubble.');
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
