import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import ts from 'typescript';

const entry = fileURLToPath(new URL('../src/services/webrtc/WebRTCClient.ts', import.meta.url));
const ast = ts.createSourceFile(entry, fs.readFileSync(entry, 'utf8'), ts.ScriptTarget.Latest, true);
const stubs = new Map();
for (const stmt of ast.statements) {
  if (!ts.isImportDeclaration(stmt) || !stmt.importClause?.namedBindings || !ts.isNamedImports(stmt.importClause.namedBindings)) continue;
  const names = stmt.importClause.namedBindings.elements.filter(e => !e.isTypeOnly).map(e => (e.propertyName ?? e.name).text);
  stubs.set(stmt.moduleSpecifier.text, names.map(n => `export const ${n} = {};`).join('\n'));
}
const bundle = await build({ entryPoints: [entry], bundle: true, format: 'esm', write: false, drop: ['console'], plugins: [{ name: 'registration-fixture', setup(b) {
  b.onResolve({ filter: /.*/ }, args => {
    if (args.kind === 'entry-point' || /trustBoundary$|registeredSocket$|registrationRecovery$|audioTransceiver$/.test(args.path)) return;
    return { path: args.path, namespace: 'fixture' };
  });
  b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'js', contents:
    args.path.endsWith('signalingIdentity') ? 'export const isServerChallenge=x=>/^[a-f0-9]{64}$/.test(x); export const prepareSignalingIdentity=async()=>globalThis.registrationTestIdentity; export const signSignalingRegistration=async()=>({});'
    : args.path.endsWith('P2PChatService') ? 'export const p2pChatService={setChatToken(){},reset(){},initialize(){}};'
    : args.path.endsWith('LobbySessionCoordinator') ? 'export const lobbySessionCoordinator={assertCurrent(ticket){if(ticket?.signal?.aborted) throw new DOMException("cancelled", "AbortError");},isCurrent(ticket){return !ticket?.signal?.aborted;}};'
    : args.path === '@tauri-apps/api/core' ? 'export const invoke=async(...args)=>globalThis.registrationTestInvoke?.(...args);'
    : stubs.get(args.path) ?? 'export const useAppStore={}; export const remoteControlService={}; export const screenShareService={}; export const danmakuService={};'
  }));
} }] });
const { WebRTCClient } = await import(`data:text/javascript,${encodeURIComponent(bundle.outputFiles[0].text + '\n//# sourceURL=registration-fixture.js')}`);
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

function fixture() {
  const oldWindow = globalThis.window, oldSocket = globalThis.WebSocket;
  const oldInvoke = globalThis.registrationTestInvoke;
  const oldIdentity = globalThis.registrationTestIdentity;
  const timers = new Map();
  let serial = 0;
  class Socket {
    static OPEN = 1;
    static CONNECTING = 0;
    static CLOSING = 2;
    readyState = 0;
    sent = [];
    open() { this.readyState = 1; this.onopen?.(); }
    receive(message) { this.onmessage?.({ data: JSON.stringify(message) }); }
    send(message) { assert.equal(this.readyState, 1); this.sent.push(JSON.parse(message)); }
    close(code = 1000) {
      if (code !== 1000 && (code < 3000 || code > 4999)) {
        throw new DOMException('Invalid browser WebSocket close code', 'InvalidAccessError');
      }
      if (this.readyState >= 2) return;
      this.readyState = 3;
      queueMicrotask(() => this.onclose?.({ code, reason: '' }));
    }
  }
  globalThis.WebSocket = Socket;
  globalThis.window = {
    setTimeout(fn, delay) { const id = ++serial; timers.set(id, { fn, delay }); return id; },
    setInterval(fn, delay) { const id = ++serial; timers.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timers.delete(id); }, clearInterval(id) { timers.delete(id); },
  };
  const client = new WebRTCClient();
  client.localPlayerId = 'a'.repeat(64);
  globalThis.registrationTestIdentity = { clientId: client.localPlayerId, identityPublicKey: 'prepared-key' };
  client.knownPlayers.add('b'.repeat(64));
  client.resetRemoteControlOnSignalingDisconnect = () => {};
  client.sendV3Registration = async socket => socket.send(JSON.stringify({ type: 'register-v3' }));
  client.configureChatSession = async () => {};
  const success = { type: 'register-success', clientId: client.localPlayerId, sessionGeneration: 1234567890123456,
    chatToken: 'a'.repeat(64), chatTokenEpoch: 1 };
  const challenge = { type: 'server-challenge', protocolVersion: 3, challenge: 'a'.repeat(64) };
  return { client, success, challenge, timers, async dispose() {
    client.isIntentionalDisconnect = true;
    client.cancelPendingRegistration?.();
    client.websocket?.close();
    await flush();
    globalThis.window = oldWindow; globalThis.WebSocket = oldSocket;
    globalThis.registrationTestInvoke = oldInvoke;
    globalThis.registrationTestIdentity = oldIdentity;
  } };
}

test('business traffic waits for registration and local auth; reconnect revokes the old readiness', async () => {
  const f = fixture();
  try {
    const auth = deferred();
    f.client.configureChatSession = () => auth.promise;
    let completed = false;
    const pending = f.client.connectToSignalingServer().then(() => { completed = true; });
    const socket = f.client.websocket;
    socket.open();
    assert.equal(f.client.requestPlayersList(), false);
    socket.receive(f.challenge);
    await flush();
    assert.deepEqual(socket.sent.map(m => m.type), ['register-v3']);
    assert.equal(completed, false);
    socket.receive(f.success);
    await flush();
    assert.equal(f.client.requestPlayersList(), false);
    assert.equal(completed, false, 'local auth is still pending');
    auth.resolve();
    await pending;
    assert.equal(f.client.requestPlayersList(), true);
    assert.equal(socket.sent.at(-1).sessionGeneration, '1234567890123456');

    const next = f.client.connectToSignalingServer();
    const replacement = f.client.websocket;
    replacement.open();
    assert.equal(f.client.serverSessionGeneration, '');
    assert.equal(f.client.requestPlayersList(), false);
    replacement.receive(f.challenge);
    await flush();
    socket.receive(f.success);
    await flush();
    assert.equal(f.client.requestPlayersList(), false, 'stale success cannot unlock replacement');
    replacement.receive({ ...f.success, sessionGeneration: 2234567890123456 });
    await next;
    assert.equal(f.client.requestPlayersList(), true);
    assert.equal(replacement.sent.at(-1).sessionGeneration, '2234567890123456');
    f.client.isIntentionalDisconnect = true;
    replacement.close();
    await flush();
    assert.equal(f.client.requestPlayersList(), false);
    assert.equal(f.client.serverSessionGeneration, '');
  } finally { await f.dispose(); }
});

test('registration retries prepare the signer again after local authentication failed', async () => {
  const f = fixture();
  try {
    f.client.lobbySessionTicket = {};
    let preparations = 0;
    let attempts = 0;
    f.client.ensureChatSigningKey = async () => {
      preparations++;
      f.client.chatPublicKey = 'prepared-key';
    };
    f.client.connectToSignalingServer = async () => {
      attempts++;
      assert.equal(f.client.chatPublicKey, 'prepared-key');
      if (attempts === 1) {
        await f.client.failClosedChatSession('local authentication failed');
        throw new Error('temporary local failure');
      }
    };
    await f.client.connectToSignalingServerWithRetry(2);
    assert.equal(preparations, 2);
    assert.equal(attempts, 2);
  } finally { await f.dispose(); }
});

test('joining installs local credentials before the roster without granting an unknown host', async () => {
  const f = fixture();
  try {
    const client = f.client;
    client.localPlayerName = 'Joining player';
    client.virtualIp = '10.126.126.2';
    client.chatToken = f.success.chatToken;
    client.chatTokenEpoch = 1;
    client.chatHostId = 'b'.repeat(64);
    const configurations = [];
    globalThis.registrationTestInvoke = async (command, args) => {
      if (command !== 'configure_p2p_chat') return;
      if (args.hostId && args.hostId !== args.playerId && !args.peers.some(p => p.player_id === args.hostId)) {
        throw new Error('host is missing from authoritative roster');
      }
      configurations.push(args);
    };
    delete client.configureChatSession;
    await client.configureChatSession(true);
    assert.equal(configurations[0].hostId, undefined);
    assert.equal(client.chatHostId, 'b'.repeat(64));
    client.chatPeers.set(client.chatHostId, { player_id: client.chatHostId, player_name: 'Host', virtual_ip: '10.126.126.1' });
    await client.configureChatSession();
    assert.equal(configurations[1].hostId, client.chatHostId);
    client.chatPeers.clear();
    await assert.rejects(client.configureChatSession(), /missing from authoritative roster/);
  } finally { await f.dispose(); }
});

test('local registration failures retain their cause for the caller', async () => {
  const f = fixture();
  try {
    f.client.configureChatSession = async () => { throw new Error('chat listener bind failed'); };
    const pending = f.client.connectToSignalingServer();
    const rejected = assert.rejects(pending, /chat listener bind failed/);
    const socket = f.client.websocket;
    socket.open();
    socket.receive(f.challenge);
    await flush();
    socket.receive(f.success);
    await rejected;
  } finally { await f.dispose(); }
});

test('a failed local bind revokes authorization but a retry keeps the registered fingerprint', async () => {
  const f = fixture();
  try {
    f.client.lobbySessionTicket = {};
    const commands = [];
    globalThis.registrationTestInvoke = async (command, args) => {
      commands.push({ command, args });
      if (command === 'stop_p2p_chat' && !args?.preserveSigningIdentity) {
        globalThis.registrationTestIdentity = { clientId: 'c'.repeat(64), identityPublicKey: 'changed-key' };
      }
    };
    let attempts = 0;
    const connect = f.client.connectToSignalingServer.bind(f.client);
    f.client.connectToSignalingServer = () => {
      attempts++;
      const pending = connect();
      const socket = f.client.websocket;
      socket.open();
      socket.receive(f.challenge);
      void flush().then(() => socket.receive(f.success));
      return pending;
    };
    f.client.configureChatSession = async () => {
      if (attempts === 1) throw new Error('address not ready (10049)');
    };
    const states = [];
    f.client.onSignalingStatus(status => states.push(status));
    await f.client.connectToSignalingServerWithRetry(2);
    assert.equal(attempts, 2);
    assert.equal(globalThis.registrationTestIdentity.clientId, f.client.localPlayerId);
    assert.equal(f.client.requestPlayersList(), true);
    assert.deepEqual(commands, [{ command: 'stop_p2p_chat', args: { preserveSigningIdentity: true } }]);
    assert.equal(states.at(-1), 'connected');
  } finally { await f.dispose(); }
});

test('registration publishes authoritative host and readiness before completing initialization', async () => {
  const f = fixture();
  try {
    const events = [];
    f.client.onLobbyMeta(meta => events.push(['host', meta.hostId]));
    f.client.onSignalingStatus(status => events.push(['status', status]));
    const pending = f.client.connectToSignalingServer().then(() => events.push(['complete']));
    const socket = f.client.websocket;
    socket.open();
    socket.receive(f.challenge);
    await flush();
    socket.receive({ ...f.success, hostId: f.client.localPlayerId });
    await pending;
    assert.deepEqual(events, [
      ['status', 'connecting'], ['status', 'connected'],
      ['host', f.client.localPlayerId], ['complete'],
    ]);
  } finally { await f.dispose(); }
});

test('rejection, timeout, cancellation and invalid success reject the pending connect', async () => {
  for (const kind of ['register-error', 'timeout', 'cancel', 'invalid', 'early-close']) {
    const f = fixture();
    try {
      const pending = f.client.connectToSignalingServer();
      const rejected = assert.rejects(pending);
      const socket = f.client.websocket;
      socket.open();
      socket.receive(f.challenge);
      await flush();
      if (kind === 'timeout') [...f.timers.values()].find(t => t.delay === 15000).fn();
      else if (kind === 'cancel') f.client.cancelPendingRegistration();
      else if (kind === 'early-close') socket.close();
      else socket.receive(kind === 'invalid' ? { ...f.success, clientId: 'b'.repeat(64) } : { type: kind, message: 'Rejected' });
      await rejected;
      await flush();
      assert.equal(f.client.requestPlayersList(), false);
      assert.equal(f.client.serverSessionGeneration, '');
      assert.equal([...f.timers.values()].some(t => t.delay === 1000), false, 'initial retry owner handles registration failures');
    } finally { await f.dispose(); }
  }
});

test('concurrent initialization of the same lobby runs once', async () => {
  const f = fixture();
  try {
    const ticket = { signal: new AbortController().signal };
    const work = deferred();
    let calls = 0;
    f.client.initializeSession = async () => { calls++; await work.promise; };
    const args = ['player', 'name', 'room', '', undefined, false, undefined, ticket];
    const first = f.client.initialize(...args);
    const second = f.client.initialize(...args);
    await flush();
    assert.equal(calls, 1);
    work.resolve();
    await Promise.all([first, second]);
  } finally { await f.dispose(); }
});

test('replacement initialization waits for the old task and survives its failure', async () => {
  const f = fixture();
  try {
    const old = new AbortController();
    const next = new AbortController();
    const work = deferred();
    const calls = [];
    f.client.initializeSession = async (...args) => {
      calls.push(args[0]);
      if (args[0] === 'old') {
        await work.promise;
        throw new Error('old registration failed');
      }
    };
    const first = f.client.initialize('old', 'name', 'room', '', undefined, false, undefined, { signal: old.signal });
    const rejected = assert.rejects(first, /old registration failed/);
    old.abort();
    const second = f.client.initialize('new', 'name', 'room', '', undefined, false, undefined, { signal: next.signal });
    await flush();
    assert.deepEqual(calls, ['old']);
    work.resolve();
    await Promise.all([rejected, second]);
    assert.deepEqual(calls, ['old', 'new']);
    assert.equal(f.client.initialization, null);
  } finally { await f.dispose(); }
});

test('retry loop stops at the total deadline even if attempts remain', async () => {
  const f = fixture();
  const originalNow = Date.now;
  try {
    let now = 0;
    Date.now = () => now;
    f.client.lobbySessionTicket = { signal: new AbortController().signal };
    f.client.ensureChatSigningKey = async () => {};
    let attempts = 0;
    f.client.connectToSignalingServer = async () => { attempts++; now = 75000; throw new Error('timeout'); };
    await assert.rejects(f.client.connectToSignalingServerWithRetry(), /timeout/);
    assert.equal(attempts, 1);
  } finally { Date.now = originalNow; await f.dispose(); }
});

test('server rejection survives an immediate transport failure and is not retried', async () => {
  const f = fixture();
  try {
    f.client.lobbySessionTicket = { signal: new AbortController().signal };
    f.client.ensureChatSigningKey = async () => {};
    let attempts = 0;
    const connect = f.client.connectToSignalingServer.bind(f.client);
    f.client.connectToSignalingServer = () => {
      attempts++;
      const pending = connect();
      const socket = f.client.websocket;
      socket.open();
      socket.receive({ type: 'register-error', message: '大厅密码错误' });
      socket.onerror?.({});
      return pending;
    };
    await assert.rejects(f.client.connectToSignalingServerWithRetry(), /大厅密码错误/);
    assert.equal(attempts, 1);
  } finally { await f.dispose(); }
});

test('connection errors identify the registration stage without claiming a DNS diagnosis', async () => {
  for (const opened of [false, true]) {
    const f = fixture();
    try {
      const pending = f.client.connectToSignalingServer();
      const rejected = assert.rejects(pending, opened ? /等待服务器协议挑战/ : /浏览器未提供/);
      if (opened) f.client.websocket.open();
      f.client.websocket.onerror({});
      await rejected;
    } finally { await f.dispose(); }
  }
});

test('session abort immediately cancels a connecting socket', async () => {
  const f = fixture();
  try {
    const controller = new AbortController();
    f.client.lobbySessionTicket = { signal: controller.signal };
    const pending = f.client.connectToSignalingServer();
    const rejected = assert.rejects(pending, /取消/);
    controller.abort();
    await rejected;
    assert.equal(f.client.websocket?.readyState === WebSocket.OPEN, false);
  } finally { await f.dispose(); }
});

test('transient startup failures recover beyond the old three-attempt limit', async () => {
  const f = fixture();
  const original = globalThis.setTimeout;
  try {
    const delays = [];
    globalThis.setTimeout = (fn, delay) => { delays.push(delay); return original(fn, 0); };
    f.client.lobbySessionTicket = { signal: new AbortController().signal };
    f.client.ensureChatSigningKey = async () => {};
    let attempts = 0;
    f.client.connectToSignalingServer = async () => {
      if (++attempts < 5) throw new Error('temporary transport failure');
    };
    await f.client.connectToSignalingServerWithRetry();
    assert.equal(attempts, 5);
    assert.deepEqual(delays, [1000, 2000, 4000, 6000]);
  } finally { globalThis.setTimeout = original; await f.dispose(); }
});

test('a manual voice reconnect does not tear down a peer when signaling is unavailable', async () => {
  const f = fixture();
  try {
    f.client.clearPeerReconnectState = () => { throw new Error('must not tear down'); };
    assert.equal(await f.client.reconnectPeerVoice('b'.repeat(64)), false);
  } finally { await f.dispose(); }
});

test('voice reconnect receiver checks the intended target and current peer session', async () => {
  const f = fixture();
  try {
    const peer = 'b'.repeat(64);
    f.client.peerSessionGenerations.set(peer, '1234567890123456');
    const removed = [];
    f.client.clearPeerReconnectState = () => {};
    f.client.removePeerConnection = id => removed.push(id);
    const message = { type: 'voice-reconnect', from: peer, to: f.client.localPlayerId, sessionGeneration: 1234567890123456 };
    for (const override of [{ sessionGeneration: 1 }, { to: peer }, { from: 'c'.repeat(64) }]) {
      await f.client.handleWebSocketMessage({ ...message, ...override });
    }
    assert.deepEqual(removed, []);
    await f.client.handleWebSocketMessage(message);
    assert.deepEqual(removed, [peer]);
  } finally { await f.dispose(); }
});
