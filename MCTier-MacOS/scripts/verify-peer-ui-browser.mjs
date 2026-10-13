import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const runtime = createRequire(path.join(process.argv[2], 'package.json'));
const { chromium } = runtime('playwright-core');
const output = process.argv[4]; mkdirSync(output, { recursive: true });
const bundle = await build({ stdin: { contents: `
import React from 'react'; import {createRoot} from 'react-dom/client';
import {ChatRoom} from './src/components/ChatRoom/ChatRoom';
import {Avatar} from './src/components/Avatar/Avatar';
import {useAppStore} from './src/stores/appStore';
import './src/i18n';
const canvas=document.createElement('canvas'); canvas.width=96; canvas.height=96; const ctx=canvas.getContext('2d'); ctx.fillStyle='#30a365'; ctx.fillRect(0,0,96,96); ctx.fillStyle='#fff'; ctx.font='bold 60px sans-serif'; ctx.fillText('M',20,70);
const image=canvas.toDataURL('image/png');
const peers=[{id:'b'.repeat(64),name:'Bob'},{id:'a'.repeat(64),name:'Alice',avatarData:image}];
useAppStore.setState({currentPlayerId:'c'.repeat(64),players:peers,config:{...useAppStore.getState().config,playerName:'Me'},chatMessages:[],activeChatConversation:null});
window.store=useAppStore; window.peers=peers;
createRoot(document.getElementById('root')).render(<><div id="avatar-fixture" style={{transform:'translateX(80px)'}}><Avatar name="Initial"/><Avatar name="Standalone" avatarData={image}/><Avatar name="Me" avatarData={image} editable onChange={()=>{}}/></div><ChatRoom/></>);
`, resolveDir: root, loader: 'jsx' }, bundle: true, format: 'iife', write: false, define: {'import.meta.env.DEV':'false'}, plugins:[{name:'styles',setup(b){b.onResolve({filter:/\.css$/},a=>({path:a.path,namespace:'css'}));b.onLoad({filter:/.*/,namespace:'css'},()=>({contents:''}));}}] });
const css=['src/components/ChatRoom/ChatRoom.css','src/components/Avatar/Avatar.css'].map(p=>readFileSync(path.join(root,p),'utf8')).join('\n');
const server=createServer((req,res)=>{
  if(req.url==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text);}
  else if(req.url==='/style.css'){res.setHeader('Content-Type','text/css');res.end(css);}
  else{res.setHeader('Content-Type','text/html');res.end('<html data-theme="dark"><head><link rel="stylesheet" href="/style.css"></head><body style="margin:0;--text-color:#eee;--bg-color:#202329;background:var(--bg-color)"><div id="root" style="height:95vh"></div><script src="/app.js"></script></body></html>');}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
try{
 browser=await chromium.launch({headless:true,executablePath:process.argv[3]});
 for(const theme of ['dark','light']) for(const width of [1100,390]){
  const page=await browser.newPage({viewport:{width,height:820}}); const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.evaluate(t=>{document.documentElement.dataset.theme=t;if(t==='light'){document.body.style.setProperty('--text-color','#18202b');document.body.style.setProperty('--bg-color','#fff');}},theme);
  await page.getByLabel('Initial的头像').click(); assert.equal(await page.getByRole('dialog').count(),0);
  await page.getByLabel('Standalone的头像').click(); await page.getByRole('dialog').waitFor();
  const box=await page.getByRole('dialog').boundingBox(); assert.ok(Math.abs(box.width-width)<1 && Math.abs(box.x)<1);
  const bitmap=await page.getByRole('dialog').locator('img').evaluate(i=>({loaded:i.naturalWidth>0,x:i.getBoundingClientRect().x,w:i.getBoundingClientRect().width}));assert.ok(bitmap.loaded); assert.ok(Math.abs(bitmap.x+bitmap.w/2-width/2)<1);
  await page.screenshot({path:path.join(output,'avatar-'+theme+'-'+width+'.png')});
  await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);
  const chooserPromise=page.waitForEvent('filechooser');await page.getByLabel('上传头像').click();await chooserPromise;assert.equal(await page.getByRole('dialog').count(),0);
  await page.getByRole('button',{name:/^(私聊|Private)$/}).click();
  const alice=page.locator('.private-peer-item').filter({hasText:'Alice'});
  await alice.locator('.mct-avatar').click();await page.getByRole('dialog').waitFor();assert.equal(await page.locator('.private-peer-current').count(),0);await page.keyboard.press('Escape');
  async function action(label){
    await alice.click({button:'right'});
    await page.waitForFunction(()=>Array.from(document.querySelectorAll('.ant-dropdown')).some(n=>!/(hidden|appear|enter|leave)/.test(n.className)));
    await page.screenshot({path:path.join(output,'menu-'+label+'-'+theme+'-'+width+'.png')});
    await page.getByRole('menuitem').filter({hasText:label}).click();
    await page.getByRole('menu').waitFor({state:'hidden'});
  }
  await action('置顶');assert.equal(await page.locator('.private-peer-item').first().locator('.private-peer-open').innerText(),'Alice');
  await action('设置免打扰');await action('标记未读');
  assert.equal(await alice.locator('.private-peer-marked').count(),1);
  const id='a'.repeat(64);
  assert.deepEqual(await page.evaluate(id=>window.store.getState().peerPreferences[id],id),{pinned:true,muted:true,markedUnread:true});
  await page.evaluate(()=>{window.store.getState().removePlayer('a'.repeat(64));window.store.getState().addPlayer(window.peers[1]);});
  assert.equal(await page.locator('.private-peer-item').first().locator('.private-peer-open').innerText(),'Alice');
  await page.screenshot({path:path.join(output,'peers-'+theme+'-'+width+'.png')});
  await alice.locator('.private-peer-open').click();await page.waitForFunction(()=>window.store.getState().peerPreferences['a'.repeat(64)].markedUnread===false);
  await page.reload();assert.equal(await page.evaluate(()=>window.store.getState().peerPreferences['a'.repeat(64)].muted),true);
  assert.deepEqual(errors,[]);await page.close();
 }
 console.log('PASS: avatar bounds/bitmap, initial inert, own picker, propagation, menus, pin/rejoin, mute, unread/read, reload; dark/light x desktop/mobile');
}finally{await browser?.close();await new Promise(r=>server.close(r));}
