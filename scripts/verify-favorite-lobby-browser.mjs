import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const { chromium } = await import(pathToFileURL(path.join(process.argv[2], 'index.mjs')));
const compiled = await build({
  stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
    import {App} from 'antd'; import {LobbyForm} from './src/components/LobbyForm/LobbyForm';
    import {useAppStore} from './src/stores/appStore';
    useAppStore.setState({config:{...useAppStore.getState().config,playerName:'Alice'}});
    createRoot(document.getElementById('root')).render(<App><LobbyForm mode="join" onClose={()=>{}} /></App>);`,
    resolveDir: root, loader: 'jsx' },
  bundle: true, format: 'iife', write: false, define: { 'import.meta.env.DEV': 'false' },
  plugins: [{ name: 'native-fixture', setup(b) {
    b.onResolve({ filter: /\.css$/ }, args => ({ path: args.path, namespace: 'empty-css' }));
    b.onLoad({ filter: /.*/, namespace: 'empty-css' }, () => ({ contents: '', loader: 'js' }));
    b.onResolve({ filter: /^@tauri-apps\// }, args => ({ path: args.path, namespace: 'native' }));
    b.onLoad({ filter: /.*/, namespace: 'native' }, () => ({ loader: 'js', contents:
      `export const invoke=async()=>({}); export const readText=async()=>'';
       export const listen=async()=>()=>{}; export const emit=async()=>{};
       export const getCurrentWindow=()=>({}); export const convertFileSrc=x=>x;
       export const getVersion=async()=> '3.0.0';` }));
    b.onResolve({ filter: /react-i18next$|\/i18n$/ }, args => ({ path: args.path, namespace: 'i18n-stub' }));
    b.onLoad({ filter: /.*/, namespace: 'i18n-stub' }, () => ({ loader: 'js', contents:
      `export const useTranslation=()=>({i18n:{language:'en'}}); export const tl=(zh,en)=>en;
       export const getLanguage=()=> 'en';` }));
  } }],
});
const server = createServer((req, res) => {
  res.setHeader('Content-Type', req.url === '/app.js' ? 'text/javascript' : 'text/html');
  res.end(req.url === '/app.js' ? compiled.outputFiles[0].text : '<div id="root"></div><script src="/app.js"></script>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.argv[3] ? { executablePath: process.argv[3] } : {}) });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('mctier_favorite_lobbies', JSON.stringify([
    { id: 'old', name: 'TestLobby', password: 'Secret12', playerName: 'Secret12', createdAt: 1 },
  ])));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator('#lobby-connection_playerName').fill('Bob');
  await page.locator('#lobby-connection_password').fill('Other123');
  await page.getByTitle('Favorite lobbies', { exact: true }).click();
  await page.locator('.favorite-card').first().click();
  assert.equal(await page.locator('#lobby-connection_lobbyName').inputValue(), 'TestLobby');
  assert.equal(await page.locator('#lobby-connection_password').inputValue(), '');
  assert.equal(await page.locator('#lobby-connection_playerName').inputValue(), 'Bob');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('mctier_favorite_lobbies')));
  assert.equal(saved[0].password, undefined);
  assert.equal(saved[0].playerName, undefined);
  await page.getByTitle('Favorite lobbies', { exact: true }).click();
  await page.getByRole('button', { name: '+ Add favorite lobby', exact: true }).click();
  await page.locator('#favorite-lobby_name').fill('NewLobby');
  await page.locator('#favorite-lobby_playerName').fill('Carol');
  assert.equal(await page.locator('#lobby-connection_playerName').inputValue(), 'Bob');
  const duplicates = await page.evaluate(() => {
    const ids = [...document.querySelectorAll('input[id]')].map(el => el.id);
    return ids.filter((id, index) => ids.indexOf(id) !== index);
  });
  assert.deepEqual(duplicates, []);
  assert.deepEqual(errors, []);
  console.log('PASS: legacy favorite migration, actual lobby selection, active nickname preservation, isolated form inputs.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
