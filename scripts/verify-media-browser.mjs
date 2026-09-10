import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// Pass the installed Playwright package path; no project dependency is added.
const { chromium } = await import(pathToFileURL(path.join(process.argv[2], 'index.mjs')));
const root = fileURLToPath(new URL('../', import.meta.url));
const out = path.join(root, 'docs', 'verification-20260910');
await fs.mkdir(out, { recursive: true });
const bundled = await build({ entryPoints: [path.join(root, 'src/services/screenShare/ScreenShareService.ts')], bundle: true, format: 'iife', globalName: 'screenModule', write: false });
const audio = await build({ entryPoints: [path.join(root, 'src/services/webrtc/audioTransceiver.ts')], bundle: true, format: 'iife', globalName: 'audioModule', write: false });
const browser = await chromium.launch({ headless: true, executablePath: process.argv[3], args: ['--autoplay-policy=no-user-gesture-required'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.setContent('<html><body style="margin:0;background:#15151e;color:white"><video id="view" autoplay muted playsinline style="width:100%;height:100vh;object-fit:contain"></video></body></html>');
  await page.addScriptTag({ content: bundled.outputFiles[0].text });
  await page.addScriptTag({ content: audio.outputFiles[0].text });
  const results = await page.evaluate(async () => {
    const pause = ms => new Promise(r => setTimeout(r, ms));
    const canvas = document.createElement('canvas');
    canvas.width = 640; canvas.height = 360;
    const ctx = canvas.getContext('2d');
    let frame = 0;
    const painter = setInterval(() => {
      ctx.fillStyle = frame++ % 2 ? '#209759' : '#256aad'; ctx.fillRect(0, 0, 640, 360);
      ctx.fillStyle = 'white'; ctx.font = '32px sans-serif'; ctx.fillText(`MCTier frame ${frame}`, 40, 90);
    }, 80);
    const captured = canvas.captureStream(15);
    const Service = screenModule.screenShareService.constructor;
    const owner = new Service(), viewer = new Service();
    const services = { owner, viewer };
    const errors = [];
    let delayIce = true;
    let legacyOffers = 0;
    const pendingCandidates = [];
    const route = async m => {
      if (m.type === 'screen-share-offer' && m.routeVersion == null) legacyOffers++;
      if (m.type === 'screen-share-ice-candidate' && delayIce) { pendingCandidates.push(m); return; }
      const target = services[m.to];
      if (!target) return;
      if (m.type === 'screen-share-relay') await target.handleRelayControl(m);
      if (m.type === 'screen-share-offer') await target.handleOffer({ shareId: m.shareId, playerId: m.from, playerName: m.playerName, sdp: m.offer.sdp, routeVersion: m.routeVersion, password: m.password });
      if (m.type === 'screen-share-answer') await target.handleAnswer({ shareId: m.shareId, sdp: m.answer.sdp, routeVersion: m.routeVersion }, m.from);
      if (m.type === 'screen-share-ice-candidate') await target.handleIceCandidate(m.shareId, m.candidate, m.from, m.connectionRole, m.routeVersion);
    };
    const socket = { readyState: 1, send: data => { queueMicrotask(() => route(JSON.parse(data)).catch(e => errors.push(String(e)))); } };
    owner.initialize('owner', 'Owner', socket); viewer.initialize('viewer', 'Viewer', socket);
    const shareId = 'share-owner-1800000000000';
    const share = { id: shareId, playerId: 'owner', playerName: 'Owner', requirePassword: false, status: 'active' };
    owner.activeShares.set(shareId, share); viewer.activeShares.set(shareId, { ...share });
    owner.localStream = captured;
    // Native Android/NAT may take longer than five seconds to deliver ICE.
    // The assigned route must survive that delay without a second offer.
    const viewing = viewer.requestViewScreen(shareId);
    await pause(7000);
    delayIce = false;
    for (const candidate of pendingCandidates) await route(candidate);
    const stream = await viewing;
    const video = document.getElementById('view'); video.srcObject = stream; await video.play();
    await pause(600);
    const check = document.createElement('canvas'); check.width = 32; check.height = 32;
    check.getContext('2d').drawImage(video, 0, 0, 32, 32);
    const pixels = [...check.getContext('2d').getImageData(0, 0, 32, 32).data];
    const nonBlack = pixels.filter((n, i) => i % 4 !== 3 && n > 20).length;
    const dimensions = [video.videoWidth, video.videoHeight];
    viewer.stopViewingScreen(shareId, false);
    const reopened = await viewer.requestViewScreen(shareId);
    video.srcObject = reopened; await video.play();
    await pause(500);

    // Reproduce a desktop answering an Android sendrecv offer while muted.
    const desktop = new RTCPeerConnection(), android = new RTCPeerConnection();
    const audioContext = new AudioContext(); await audioContext.resume();
    const oscillator = audioContext.createOscillator();
    const destination = audioContext.createMediaStreamDestination(); oscillator.connect(destination); oscillator.start();
    const mic = destination.stream.getAudioTracks()[0];
    android.addTrack(mic, destination.stream);
    desktop.addTransceiver('audio', { direction: 'sendrecv' });
    const iceErrors = [];
    const queues = new Map([[desktop, []], [android, []]]);
    for (const [a, b] of [[desktop, android], [android, desktop]]) a.onicecandidate = e => {
      if (!e.candidate) return;
      if (!b.remoteDescription) queues.get(b).push(e.candidate);
      else b.addIceCandidate(e.candidate).catch(e => iceErrors.push(String(e)));
    };
    const offer = await android.createOffer(); await android.setLocalDescription(offer); await desktop.setRemoteDescription(offer);
    await audioModule.prepareAudioAnswer(desktop, null);
    const answer = await desktop.createAnswer(); await desktop.setLocalDescription(answer); await android.setRemoteDescription(answer);
    for (const [pc, pending] of queues) for (const c of pending) await pc.addIceCandidate(c);
    await audioModule.sendingAudioTransceiver(desktop).sender.replaceTrack(mic);
    let packets = 0;
    for (let i = 0; i < 40 && packets < 5; i++) {
      await pause(100);
      (await android.getStats()).forEach(r => { if (r.type === 'inbound-rtp' && r.kind === 'audio') packets = Math.max(packets, r.packetsReceived ?? 0); });
    }
    desktop.close(); android.close(); oscillator.stop(); await audioContext.close();
    window.stopMediaVerification = () => { clearInterval(painter); viewer.cleanup(); owner.cleanup(); };
    return { dimensions, nonBlack, packets, errors, iceErrors, legacyOffers, delayedIceMs: 7000, reopened: video.videoWidth > 0 };
  });
  assert.deepEqual(results.dimensions, [640, 360]);
  assert.ok(results.nonBlack > 1000, JSON.stringify(results));
  assert.ok(results.packets >= 5, JSON.stringify(results));
  assert.ok(results.reopened);
  assert.deepEqual(results.errors, []);
  assert.equal(results.legacyOffers, 0, 'assigned route must not be replaced by legacy fallback');
  await page.screenshot({ path: path.join(out, 'webrtc-video.png') });
  await page.evaluate(() => window.stopMediaVerification());

  const css = await fs.readFile(path.join(root, 'src/components/SettingsWindow/SettingsWindow.css'), 'utf8');
  const gaps = [];
  for (const width of [320, 430, 1280]) {
    await page.setViewportSize({ width, height: 600 });
    await page.setContent('<html><body style="margin:10px;background:#15151e;color:white"><section class="settings-card"><div class="settings-card-header">File Sharing Downloads</div><div class="settings-card-desc">Download folder</div><div class="settings-download-path-row"><input class="settings-download-path-input" readonly value="C:\\Users\\Player\\Downloads\\MCTier"><div class="settings-download-actions"><button>Choose folder</button></div></div></section></body></html>');
    await page.addStyleTag({ content: css });
    const gap = await page.evaluate(() => {
      const card = document.querySelector('.settings-card').getBoundingClientRect();
      const input = document.querySelector('input').getBoundingClientRect();
      return [input.left - card.left, card.right - input.right];
    });
    assert.ok(gap.every(n => n >= 14), `${width}: ${gap}`);
    gaps.push({ width, gap });
    await page.screenshot({ path: path.join(out, `download-${width}.png`) });
  }
  const ui = await build({
    stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {ScreenShareManager} from './src/components/ScreenShareManager/ScreenShareManager'; createRoot(document.getElementById('root')).render(React.createElement(ScreenShareManager));`, resolveDir: root, loader: 'jsx' },
    bundle: true, format: 'iife', write: false, plugins: [{ name: 'viewer-fixture', setup(b) {
      b.onResolve({ filter: /\.css$/ }, args => ({ path: args.path, namespace: 'empty-css' }));
      b.onLoad({ filter: /.*/, namespace: 'empty-css' }, () => ({ contents: '', loader: 'js' }));
      b.onResolve({ filter: /^\.\.\/\.\.\/stores$|^\.\.\/\.\.\/i18n$|^react-i18next$|ScreenShareService$/ }, args => ({ path: args.path, namespace: 'viewer-stub' }));
      b.onLoad({ filter: /.*/, namespace: 'viewer-stub' }, args => ({ loader: 'js', contents:
        args.path.endsWith('/stores') ? 'export const useAppStore = () => ({currentPlayerId:"viewer"});'
        : args.path.endsWith('/i18n') ? 'export const tl = (zh,en) => zh;'
        : args.path === 'react-i18next' ? 'export const useTranslation = () => ({});'
        : `const share={id:'share-owner-1800000000000',playerId:'owner',playerName:'Android',requirePassword:false,startTime:Date.now(),status:'active'};
          export const screenShareService={getActiveShares:()=>[share],stopViewingScreen:()=>{window.stopped=true},requestViewScreen:()=>new Promise((resolve,reject)=>{window.finishView=resolve;window.failView=reject})};` }));
    } }],
  });
  const viewerChecks = [];
  for (const width of [430, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await page.setContent('<html><body style="margin:0;background:#15151e;color:white"><div id="root"></div></body></html>');
    await page.addStyleTag({ content: await fs.readFile(path.join(root, 'src/components/ScreenShareManager/ScreenShareManager.css'), 'utf8') });
    await page.addScriptTag({ content: ui.outputFiles[0].text });
    await page.locator('.view-screen-btn').click();
    await page.locator('.viewer-status').waitFor();
    assert.match(await page.locator('.viewer-status').innerText(), /正在连接/);
    await page.evaluate(() => window.failView(new Error('Connection timed out')));
    await page.locator('.viewer-status button').waitFor();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.fullscreen-viewer')).opacity === '1');
    await page.screenshot({ path: path.join(out, `viewer-${width}.png`) });
    await page.locator('.viewer-status button').click();
    await page.locator('.stop-viewing-btn').click();
    await page.locator('.fullscreen-viewer').waitFor({ state: 'detached' });
    await page.evaluate(() => window.finishView(new MediaStream()));
    assert.equal(await page.locator('.fullscreen-viewer').count(), 0, 'cancelled requests must not reopen the viewer');
    viewerChecks.push({ width, connecting: true, retry: true, cancelledRequestIgnored: true });
  }
  await fs.writeFile(path.join(out, 'results.json'), JSON.stringify({ ...results, gaps, viewerChecks }, null, 2));
  console.log(JSON.stringify({ ...results, gaps, viewerChecks }));
} finally { await browser.close(); }
