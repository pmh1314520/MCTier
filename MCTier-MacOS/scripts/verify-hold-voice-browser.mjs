import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const { chromium } = await import(pathToFileURL(path.join(process.argv[2], 'index.mjs')));
const compiled = await build({
  stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
    import {useHoldVoice} from './src/hooks/useHoldVoice';
    import {lobbyCaptureGate} from './src/services/voice/lobbyCaptureGate';
    window.sent=[]; window.failed=0;
    window.micIntent=true;
    navigator.mediaDevices.getUserMedia({audio:true}).then(stream=>{
      window.lobbyTrack=stream.getAudioTracks()[0];
      lobbyCaptureGate.register(window.lobbyTrack,()=>window.micIntent);
    });
    function App(){const [text,setText]=React.useState(''); const [context,setContext]=React.useState('lobby');
      const voice=useHoldVoice(!text,async(blob,duration)=>window.sent.push({size:blob.size,mime:blob.type,duration,context}),()=>window.failed++,context);
      return <><textarea aria-label="Message" placeholder="Hold to record voice" value={text} onChange={e=>setText(e.target.value)} {...voice.handlers}/>
      <p role="status">{voice.seconds===null?'Idle':(voice.cancelling?'Cancel':'Recording')+' '+voice.seconds}</p>
      <button onClick={()=>setContext('private')}>Private</button><button onClick={voice.cancel}>Cancel</button></>;
    } createRoot(document.getElementById('root')).render(<App/>);`, resolveDir: root, loader: 'jsx' },
  bundle: true, format: 'iife', write: false,
});
const server = createServer((req, res) => {
  res.setHeader('Content-Type', req.url === '/app.js' ? 'text/javascript' : 'text/html');
  res.end(req.url === '/app.js' ? compiled.outputFiles[0].text : '<div id="root"></div><script src="/app.js"></script>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.argv[3], args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => window.lobbyTrack?.enabled);
  const box = await page.getByRole('textbox').boundingBox();
  const hold = async () => { await page.mouse.move(box.x + 40, box.y + 20); await page.mouse.down(); await page.waitForFunction(() => document.querySelector('[role=status]').textContent.startsWith('Recording')); };
  await hold();
  assert.equal(await page.evaluate(() => window.lobbyTrack.enabled), false);
  await page.waitForTimeout(850);
  await page.mouse.up();
  await page.waitForFunction(() => window.sent.length === 1);
  assert.equal(await page.evaluate(() => window.lobbyTrack.enabled), true);
  assert.ok((await page.evaluate(() => window.sent[0].size)) > 0);
  await hold();
  await page.evaluate(() => { window.micIntent = false; });
  await page.waitForTimeout(600);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => window.sent.length), 1);
  assert.equal(await page.evaluate(() => window.lobbyTrack.enabled), false);
  await page.evaluate(() => { window.micIntent = true; });
  await hold();
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: 'Private', exact: true }).evaluate(el => el.click());
  await page.mouse.up();
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => window.sent.length), 1);
  assert.equal(await page.evaluate(() => window.lobbyTrack.enabled), true);
  await hold();
  await page.waitForTimeout(650);
  await page.mouse.up();
  await page.waitForFunction(() => window.sent.length === 2);
  assert.equal(await page.evaluate(() => window.sent[1].context), 'private');
  await page.getByRole('textbox').fill('text');
  await page.mouse.move(box.x + 40, box.y + 20); await page.mouse.down();
  await page.waitForTimeout(600); await page.mouse.up();
  assert.equal(await page.getByRole('status').innerText(), 'Idle');
  assert.equal(await page.evaluate(() => window.failed), 0);
  await page.getByRole('textbox').fill('');
  await page.evaluate(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    window.restoreCapture = () => { navigator.mediaDevices.getUserMedia = original; };
    navigator.mediaDevices.getUserMedia = () => new Promise(resolve => { window.resolveCapture = async () => {
      window.delayedStream = await original({ audio: true }); resolve(window.delayedStream);
    }; });
  });
  await page.mouse.move(box.x + 40, box.y + 20); await page.mouse.down();
  await page.waitForFunction(() => window.resolveCapture);
  assert.equal(await page.evaluate(() => window.lobbyTrack.enabled), false);
  await page.mouse.up();
  assert.equal(await page.evaluate(() => window.lobbyTrack.enabled), true);
  await page.evaluate(() => window.resolveCapture());
  await page.waitForFunction(() => window.delayedStream.getTracks().every(track => track.readyState === 'ended'));
  assert.equal(await page.evaluate(() => window.sent.length), 2);
  await page.evaluate(() => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Denied', 'NotAllowedError'); }; });
  await page.mouse.down();
  await page.waitForFunction(() => window.failed === 1);
  await page.mouse.up();
  assert.equal(await page.evaluate(() => window.lobbyTrack.enabled), true);
  await page.evaluate(() => window.restoreCapture());
  assert.deepEqual(errors, []);
  console.log('PASS: real MediaRecorder payload, release to send, Escape/conversation cancellation, private context, nonempty input, lobby isolation, latest mic intent, release before permission and permission denial.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
