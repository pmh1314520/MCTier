// Test-only loopback signaling. Android: adb reverse tcp:47839 tcp:47839.
// No production signaling server or remote input injection is used.
import { WebSocketServer } from 'ws';
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
const dir = '.artifacts/remote-video-check';
await mkdir(dir, { recursive: true });
await build({
  entryPoints: ['tests/fixtures/remote-android-check.ts'], bundle: true, format: 'iife', outfile: `${dir}/check.js`,
  plugins: [{ name: 'safe-test-input', setup(b) {
    b.onResolve({ filter: /^@tauri-apps\/api\/core$/ }, () => ({ path: 'ipc', namespace: 'check' }));
    b.onLoad({ filter: /.*/, namespace: 'check' }, () => ({ contents: `
      export async function invoke(name,args) {
        if(name==='authorize_remote_input'||name==='revoke_remote_input') return;
        if(name==='remote_inject_input') { globalThis.remoteCheckInputs=(globalThis.remoteCheckInputs||0)+args.events.length; return; }
        if(name==='voice_ice_server') return 'stun:stun.miwifi.com:3478';
        return window.__TAURI_INTERNALS__.invoke(name,args);
      }` }));
  } }],
});
await writeFile(`${dir}/index.html`, '<!doctype html><meta charset="utf-8"><title>Remote video integration check</title><script src="check.js"></script>');
await writeFile(`${dir}/check.css`, '');
const clients = new Map();
const ready = new Set();
const server = new WebSocketServer({ host: '127.0.0.1', port: 47839 });
server.on('connection', (ws, request) => {
  const side = request.url.slice(1);
  if (!['android', 'desktop'].includes(side)) return ws.close();
  clients.set(side, ws);
  ws.on('message', async raw => {
    const data = JSON.parse(raw.toString());
    if (data.type === 'test-ready') {
      ready.add(side);
      console.log(`${side} ready`);
      if (ready.size === 2) clients.get('android').send(JSON.stringify({ type: 'test-start' }));
      return;
    }
    if (data.type === 'test-complete') {
      await writeFile(`${dir}/android-report.json`, JSON.stringify(data, null, 2));
      console.log('Android report', data);
    }
    if (data.type === 'test-desktop-report') {
      await writeFile(`${dir}/desktop-report.json`, JSON.stringify(data.report, null, 2));
      console.log('Desktop report', data.report);
      return;
    }
    clients.get(side === 'android' ? 'desktop' : 'android')?.send(raw.toString());
  });
  ws.on('close', () => { ready.delete(side); if (clients.get(side) === ws) clients.delete(side); });
});
console.log('Remote Android check bridge listening on 127.0.0.1:47839');
