import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

async function load(relative) {
  const result = await build({ entryPoints: [fileURLToPath(new URL(relative, import.meta.url))], bundle: true, format: 'esm', write: false, drop: ['console'] });
  return import(`data:text/javascript,${encodeURIComponent(result.outputFiles[0].text)}`);
}

test('microphone uses the negotiated audio m-line after joining muted', async () => {
  const { prepareAudioAnswer, sendingAudioTransceiver } = await load('../src/services/webrtc/audioTransceiver.ts');
  const placeholder = { mid: null, receiver: { track: { kind: 'audio' } }, sender: { replaceTrack: async () => assert.fail('unnegotiated sender') } };
  let outgoing;
  const offered = { mid: '0', direction: 'recvonly', currentDirection: 'recvonly', receiver: { track: { kind: 'audio' } }, sender: { replaceTrack: async track => { outgoing = track; } } };
  const pc = { getTransceivers: () => [placeholder, offered] };
  await prepareAudioAnswer(pc, null);
  assert.equal(offered.direction, 'sendrecv');
  assert.equal(outgoing, null);
  offered.currentDirection = 'sendrecv';
  const mic = { kind: 'audio' };
  await sendingAudioTransceiver(pc).sender.replaceTrack(mic);
  assert.equal(outgoing, mic);
  await prepareAudioAnswer(pc, { getAudioTracks: () => [mic] });
  assert.equal(outgoing, mic);
});

test('rapid messages and delayed retries display in sender order, including same-second messages', async () => {
  const { createChatMessageId, compareChatMessages, messageOrderTime } = await load('../src/services/chat/messageOrder.ts');
  const original = Date.now;
  Date.now = () => 1800000000000;
  try {
    const messages = Array.from({ length: 80 }, () => ({ id: createChatMessageId('a'.repeat(64)), playerId: 'a'.repeat(64), timestamp: 1800000000000 }));
    assert.equal(new Set(messages.map(m => m.id)).size, 80);
    assert.deepEqual([...messages].reverse().sort(compareChatMessages), messages);
    assert.equal(messageOrderTime(messages[1]) - messageOrderTime(messages[0]), 1);
    assert.equal(messageOrderTime({ id: 'old-id', playerId: 'p', timestamp: 42 }), 42);
  } finally { Date.now = original; }
});

test('screen ICE reaches outbound owner and inbound viewer, rejecting wrong peers and route versions', async () => {
  const { screenShareService: s } = await load('../src/services/screenShare/ScreenShareService.ts');
  globalThis.WebSocket = { OPEN: 1 };
  globalThis.RTCIceCandidate = class { constructor(value) { Object.assign(this, value); } };
  const candidate = { candidate: 'candidate:1 1 UDP 1 10.0.0.1 1234 typ host', sdpMid: '0', sdpMLineIndex: 0 };
  const received = [];
  const pc = { remoteDescription: {}, addIceCandidate: async c => received.push(c) };
  const share = 'share-owner-1800000000000';
  s.initialize('owner', 'Owner', { readyState: 1, send() {} });
  s.activeShares.set(share, { id: share, playerId: 'owner' });
  s.peerConnections.set(`${share}-out-viewer`, pc);
  s.connectionRouteVersions.set(`${share}-out-viewer`, undefined);
  await s.handleIceCandidate(share, candidate, 'viewer', 'out');
  assert.equal(received.length, 1, 'legacy owner uses out, never viewer-*');
  s.expectedDownstreams.set(share, new Map([['viewer', 2]]));
  s.connectionRouteVersions.set(`${share}-out-viewer`, 2);
  await s.handleIceCandidate(share, candidate, 'viewer', 'out', 2);
  await s.handleIceCandidate(share, candidate, 'viewer', 'out', 1);
  await s.handleIceCandidate(share, candidate, 'intruder', 'out', 2);
  assert.equal(received.length, 2);
  s.initialize('viewer', 'Viewer', { readyState: 1, send() {} });
  s.requestedUpstreams.set(share, 'relay');
  s.viewingRouteVersions.set(share, 3);
  s.peerConnections.set(`${share}-in-relay`, pc);
  s.connectionRouteVersions.set(`${share}-in-relay`, 3);
  await s.handleIceCandidate(share, candidate, 'relay', 'in', 3);
  await s.handleIceCandidate(share, candidate, 'intruder', 'in', 3);
  await s.handleIceCandidate(share, candidate, 'relay', 'in', 2);
  assert.equal(received.length, 3);
  s.peerConnections.set(`${share}-viewer-legacy`, pc);
  s.connectionRouteVersions.set(`${share}-viewer-legacy`, undefined);
  await s.handleIceCandidate(share, candidate, 'owner', 'in');
  assert.equal(received.length, 4, 'direct fallback ICE must survive an earlier relay assignment');
  s.peerConnections.clear();
});

test('screen signal authentication uses lobby identity, not a remote-control session ID', () => {
  const source = fs.readFileSync(new URL('../src/services/webrtc/WebRTCClient.ts', import.meta.url), 'utf8');
  const screenCases = source.slice(source.indexOf("case 'screen-share-offer':"), source.indexOf("case 'screen-share-viewer-left':"));
  assert.doesNotMatch(screenCases, /authenticatedSession\(/);
  assert.equal((screenCases.match(/authenticatedPeerId\(message\)/g) ?? []).length, 4);
  assert.match(source.slice(source.indexOf("case 'remote-control-request':")), /authenticatedSession\(/);
});

test('legacy screen fallback runs only when the owner has not assigned a route', async () => {
  const { screenShareService } = await load('../src/services/screenShare/ScreenShareService.ts');
  const originalWindow = globalThis.window;
  globalThis.WebSocket = { OPEN: 1 };
  try {
    for (const assigned of [false, true]) {
      const timers = [];
      globalThis.window = { setTimeout: (callback, delay) => { timers.push({ callback, delay }); return timers.length; }, clearTimeout() {} };
      const service = new screenShareService.constructor();
      const shareId = 'share-owner-1800000000000';
      service.initialize('viewer', 'Viewer', { readyState: 1, send() {} });
      service.activeShares.set(shareId, { id: shareId, playerId: 'owner' });
      let fallbackCalls = 0;
      service.requestViewScreenDirect = () => { fallbackCalls++; return new Promise(() => {}); };
      const request = service.requestViewScreen(shareId);
      if (assigned) service.requestedUpstreams.set(shareId, 'owner');
      timers.find(t => t.delay === 5000).callback();
      assert.equal(fallbackCalls, assigned ? 0 : 1);
      const rejected = assert.rejects(request, /路由超时/);
      timers.find(t => t.delay === 30000).callback();
      await rejected;
    }
  } finally { globalThis.window = originalWindow; }
});

test('real desktop signal dispatcher accepts Android screen join/offer/answer/ICE without sessionId', async () => {
  const entry = fileURLToPath(new URL('../src/services/webrtc/WebRTCClient.ts', import.meta.url));
  const source = fs.readFileSync(entry, 'utf8');
  const ast = ts.createSourceFile(entry, source, ts.ScriptTarget.Latest, true);
  const stubs = new Map();
  for (const stmt of ast.statements) {
    if (!ts.isImportDeclaration(stmt) || !stmt.importClause?.namedBindings || !ts.isNamedImports(stmt.importClause.namedBindings)) continue;
    const names = stmt.importClause.namedBindings.elements.filter(e => !e.isTypeOnly).map(e => (e.propertyName ?? e.name).text);
    stubs.set(stmt.moduleSpecifier.text, names.map(n => `export const ${n} = {};`).join('\n'));
  }
  const received = [];
  const local = 'a'.repeat(64), peer = 'b'.repeat(64), shareId = `share-${local}-1800000000000`;
  globalThis.screenDispatcherTest = {
    activeShares: new Map([[shareId, { id: shareId, playerId: local }]]),
    handleRelayControl: async m => received.push(['relay', m]),
    handleOffer: async m => received.push(['offer', m]),
    handleAnswer: async m => received.push(['answer', m]),
    handleIceCandidate: async (...args) => received.push(['ice', args]),
  };
  const result = await build({ entryPoints: [entry], bundle: true, format: 'esm', write: false, drop: ['console'], plugins: [{ name: 'isolate-dispatcher', setup(b) {
    b.onResolve({ filter: /.*/ }, args => {
      if (args.kind === 'entry-point' || args.path.endsWith('trustBoundary') || args.path === './audioTransceiver') return;
      return { path: args.path, namespace: 'test-dependency' };
    });
    b.onLoad({ filter: /.*/, namespace: 'test-dependency' }, args => ({ loader: 'js', contents:
      args.path.endsWith('/ScreenShareService') ? 'export const screenShareService = globalThis.screenDispatcherTest;'
        : (stubs.get(args.path) ?? 'export const useAppStore = {}; export const remoteControlService = {}; export const danmakuService = {};') }));
  } }] });
  const { WebRTCClient } = await import(`data:text/javascript,${encodeURIComponent(result.outputFiles[0].text)}`);
  const client = new WebRTCClient();
  client.localPlayerId = local;
  client.knownPlayers.add(peer);
  client.peerSessionGenerations.set(peer, '9');
  const base = { from: peer, to: local, shareId, sessionGeneration: 9 };
  await client.handleWebSocketMessage({ ...base, type: 'screen-share-relay', action: 'join', playerName: 'Android' });
  await client.handleWebSocketMessage({ ...base, type: 'screen-share-offer', playerName: 'Android', offer: { type: 'offer', sdp: 'v=0\r\n' } });
  await client.handleWebSocketMessage({ ...base, type: 'screen-share-answer', answer: { type: 'answer', sdp: 'v=0\r\n' } });
  await client.handleWebSocketMessage({ ...base, type: 'screen-share-ice-candidate', connectionRole: 'out', candidate: { candidate: 'candidate:1 1 UDP 1 10.0.0.1 1234 typ host' } });
  assert.deepEqual(received.map(r => r[0]), ['relay', 'offer', 'answer', 'ice']);
  const health = { ...base, type: 'screen-share-relay', action: 'health', routeVersion: 1,
    sequence: 53, sourceSequence: 53, sentSequence: 49, limited: false };
  await client.handleWebSocketMessage(health);
  assert.equal(received.length, 5, 'Android health with false bandwidth flag must be accepted');
  await client.handleWebSocketMessage({ ...health, limited: 'false' });
  await client.handleWebSocketMessage({ ...health, sentSequence: -1 });
  assert.equal(received.length, 5, 'malformed health stays rejected');
  for (const override of [{ sessionGeneration: 8 }, { from: 'c'.repeat(64) }, { to: peer }]) {
    await client.handleWebSocketMessage({ ...base, ...override, type: 'screen-share-relay', action: 'join', playerName: 'Intruder' });
  }
  assert.equal(received.length, 5, 'stale, unknown and misaddressed senders must still be rejected');
  delete globalThis.screenDispatcherTest;
});
