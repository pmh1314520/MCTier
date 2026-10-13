import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const { chromium } = await import(pathToFileURL(path.join(process.argv[2], 'index.mjs')));
const compiled = await build({
  stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
    import {MainWindow} from './src/components/MainWindow/MainWindow';
    window.reads=0; createRoot(document.getElementById('root')).render(<React.StrictMode><MainWindow/></React.StrictMode>);`, resolveDir: root, loader: 'jsx' },
  bundle: true, format: 'iife', write: false, define: { 'import.meta.env.DEV': 'false' },
  plugins: [{ name: 'fixture', setup(b) {
    b.onResolve({ filter: /\.css$/ }, args => ({ path: args.path, namespace: 'empty' }));
    b.onLoad({ filter: /.*/, namespace: 'empty' }, () => ({ contents: '' }));
    b.onResolve({ filter: /LobbyForm\/LobbyForm$/ }, () => ({ path: 'form', namespace: 'ui' }));
    b.onResolve({ filter: /AboutWindow\/AboutWindow$|SettingsWindow$|OnboardingWizard\/OnboardingWizard$/ }, () => ({ path: 'other', namespace: 'ui' }));
    b.onLoad({ filter: /.*/, namespace: 'ui' }, args => ({ loader: 'jsx', resolveDir: root, contents: args.path === 'form'
      ? `import React from 'react'; export const LobbyForm=({mode})=><div role="status">{mode}:{window.__autoLobbyConfig?'auto':'manual'}</div>;`
      : `import React from 'react'; export const SettingsWindow=()=> <div role="status">settings</div>; export const AboutWindow=()=>null; export const OnboardingWizard=()=>null; export const isOnboardingDone=()=>true;` }));
    b.onResolve({ filter: /^@tauri-apps\// }, args => ({ path: args.path, namespace: 'native' }));
    b.onLoad({ filter: /.*/, namespace: 'native' }, () => ({ contents: `export const invoke=async command=>{if(command==='get_settings'){window.reads++;return new Promise(resolve=>window.resolveSettings=()=>resolve({autoLobbyEnabled:true,lobbyName:'SavedLobby',playerName:'Alice',lobbyPassword:'mctier-local-v1:AAAA'}))}return {}};
      export const getVersion=async()=> '3.3.0'; export const getCurrentWindow=()=>({}); export const open=async()=>{};
      export const convertFileSrc=x=>x; export const listen=async()=>()=>{};` }));
    b.onResolve({ filter: /react-i18next$|\/i18n$/ }, args => ({ path: args.path, namespace: 'i18n' }));
    b.onLoad({ filter: /.*/, namespace: 'i18n' }, () => ({ contents: `export const useTranslation=()=>({t:x=>x,i18n:{language:'en'}}); export const tl=(zh,en)=>en; export const getLanguage=()=> 'en';` }));
  } }],
});
const server = createServer((req, res) => {
  res.setHeader('Content-Type', req.url === '/app.js' ? 'text/javascript' : 'text/html');
  res.end(req.url === '/app.js' ? compiled.outputFiles[0].text : '<div id="root"></div><script src="/app.js"></script>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.argv[3] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const action of ['lobby.create', 'lobby.join', 'Settings', 'auto']) {
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => typeof window.resolveSettings === 'function');
    if (action !== 'auto') await page.getByRole('button', { name: action, exact: true }).click();
    await page.evaluate(() => window.resolveSettings());
    const expected = action === 'Settings' ? 'settings' : action === 'lobby.join' ? 'join:manual' : action === 'auto' ? 'join:auto' : 'create:manual';
    await page.waitForFunction(expected => document.querySelector('[role=status]')?.textContent === expected, expected);
    assert.equal(await page.evaluate(() => window.reads), 1, 'StrictMode must not duplicate startup reads');
    assert.equal(await page.evaluate(() => !!window.__autoLobbyConfig), action === 'auto');
  }
  assert.deepEqual(errors, []);
  console.log('PASS: delayed auto-lobby settings cannot override manual create, manual join or settings; StrictMode startup runs once.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
