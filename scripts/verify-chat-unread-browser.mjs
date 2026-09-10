import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
const { chromium } = await import(pathToFileURL(path.join(process.argv[2], 'index.mjs')));
const compiled = await build({
  stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
    import {ChatRoom} from './src/components/ChatRoom/ChatRoom'; import {useAppStore} from './src/stores/appStore';
    window.store=useAppStore; useAppStore.setState({currentPlayerId:'me', players:[{id:'alice',name:'Alice'},{id:'bob',name:'Bob'}]});
    const root=createRoot(document.getElementById('root')); window.mount=()=>root.render(React.createElement(ChatRoom));
    window.hide=()=>root.render(null); window.mount();`, resolveDir: root, loader: 'jsx' },
  bundle: true, format: 'iife', write: false, define: { 'import.meta.env.DEV': 'false' },
  plugins: [{ name: 'native-fixture', setup(b) {
    b.onResolve({ filter: /\.css$/ }, args => ({ path: args.path, namespace: 'empty-css' }));
    b.onLoad({ filter: /.*/, namespace: 'empty-css' }, () => ({ contents: '', loader: 'js' }));
    b.onResolve({ filter: /^(\.\.\/services|react-i18next)$|P2PChatService$|avatarService$|\/i18n$/ }, args => ({ path: args.path, namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ loader: 'js', contents:
      args.path === '../services' ? 'export const webrtcClient={};'
      : args.path.endsWith('P2PChatService') ? 'export const p2pChatService={};'
      : args.path.endsWith('avatarService') ? 'export const saveAvatarData=async()=>{};'
      : args.path === 'react-i18next' ? 'export const useTranslation=()=>({});'
      : 'export const tl=(zh,en)=>en;' }));
  } }],
});
const browser = await chromium.launch({ headless: true, executablePath: process.argv[3] });
const output = path.join(root, 'docs/verification-chat-unread-20260910');
await fs.mkdir(output, { recursive: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  for (const width of [430, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await page.setContent('<html><body style="margin:0;background:#171923;color:white"><div id="root" style="height:800px"></div></body></html>');
    await page.addStyleTag({ content: await fs.readFile(path.join(root, 'src/components/ChatRoom/ChatRoom.css'), 'utf8') });
    await page.addStyleTag({ content: await fs.readFile(path.join(root, 'src/components/Avatar/Avatar.css'), 'utf8') });
    await page.addScriptTag({ content: compiled.outputFiles[0].text });
    await page.locator('.chat-tabs button').nth(1).click();
    await page.evaluate(() => {
      const s = window.store.getState();
      for (let i = 0; i < 101; i++) s.addChatMessage({ id: `l${i}`, playerId: 'alice', playerName: 'Alice', content: 'Lobby', timestamp: Date.now() });
      for (let i = 0; i < 12; i++) s.addChatMessage({ id: `a${i}`, playerId: 'alice', playerName: 'Alice', recipientId: 'me', content: 'Private', timestamp: Date.now() });
      s.addChatMessage({ id: 'b', playerId: 'bob', playerName: 'Bob', recipientId: 'me', content: 'Bob', timestamp: Date.now() });
    });
    await page.waitForFunction(() => document.querySelector('.chat-tab-badge')?.textContent === '99+');
    assert.deepEqual(await page.locator('.chat-tab-badge').allTextContents(), ['99+', '13']);
    assert.deepEqual(await page.locator('.private-peer-unread').allTextContents(), ['12', '1']);
    await page.screenshot({ path: path.join(output, `players-${width}.png`) });
    await page.locator('.private-peer-item').first().click();
    await page.waitForFunction(() => window.store.getState().activeChatConversation === 'private:alice');
    await page.evaluate(() => window.store.getState().addChatMessage({ id: 'live', playerId: 'alice', playerName: 'Alice', recipientId: 'me', content: 'Visible message', timestamp: 9999999999999 }));
    assert.equal(await page.locator('.chat-tabs button').nth(1).locator('.chat-tab-badge').innerText(), '1');
    await page.locator('.private-peer-current').click();
    assert.equal(await page.locator('.private-peer-item').first().locator('.private-peer-unread').count(), 0);
    await page.evaluate(() => window.hide());
    await page.waitForFunction(() => window.store.getState().activeChatConversation === null);
    await page.evaluate(() => window.mount());
    await page.locator('.chat-tabs button').nth(1).click();
    assert.equal(await page.locator('.private-peer-item').first().locator('.private-peer-unread').count(), 0, 'read messages must remain read after remount');
    assert.equal(await page.locator('.private-peer-item').nth(1).locator('.private-peer-unread').innerText(), '1');
    await page.locator('.private-peer-item').nth(1).click();
    await page.waitForFunction(() => Object.keys(window.store.getState().unreadChatMessages).length === 0);
    await page.evaluate(() => window.store.getState().updatePlayerStatus('bob', { name: 'A very long player name for narrow windows' }));
    const overflow = await page.evaluate(() => {
      const tab = document.querySelector('.chat-tabs').getBoundingClientRect();
      return [...document.querySelectorAll('.chat-tabs button')].some(e => e.getBoundingClientRect().right > tab.right + 1);
    });
    assert.equal(overflow, false);
    await page.screenshot({ path: path.join(output, `conversation-${width}.png`) });
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ widths: [430, 1280], counts: true, activeConversationRead: true, remountPreservesRead: true, longNameFits: true }));
} finally { await browser.close(); }
