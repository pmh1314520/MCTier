import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const sourceFile = fileURLToPath(new URL('../src/services/remoteControl/RemoteControlService.ts', import.meta.url));
const serviceSource = fs.readFileSync(sourceFile, 'utf8');
const androidRepository = fs.readFileSync(new URL('../../MCTier-Android/app/src/main/java/top/pmh13/mctier/MctierRepository.kt', import.meta.url), 'utf8');
let moduleVersion = 0;

async function loadService(websocket, invoke = async () => undefined) {
  globalThis.__remoteControlTestInvoke = invoke;
  const result = await build({
    stdin: {
      contents: `export * from ${JSON.stringify(sourceFile)}; export * from ${JSON.stringify(fileURLToPath(new URL('../src/services/signaling/registeredSocket.ts', import.meta.url)))};`,
      resolveDir: fileURLToPath(new URL('..', import.meta.url)),
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'browser',
    write: false,
    plugins: [{
      name: 'tauri-core-stub',
      setup(pluginBuild) {
        pluginBuild.onResolve({ filter: /\/screenShare\/nativeCapture$/ }, () => ({ path: 'native-capture', namespace: 'capture-stub' }));
        pluginBuild.onLoad({ filter: /.*/, namespace: 'capture-stub' }, () => ({ contents: 'export const requestNativeScreen = (...args) => globalThis.__remoteControlCapture(...args);' }));
        pluginBuild.onResolve({ filter: /^@tauri-apps\/api\/core$/ }, () => ({ path: 'tauri-core', namespace: 'stub' }));
        pluginBuild.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
          contents: 'export const invoke = (...args) => globalThis.__remoteControlTestInvoke(...args);',
          loader: 'js',
        }));
      },
    }],
  });
  const version = ++moduleVersion;
  const module = await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(result.outputFiles[0].text)}#test-${version}`);
  if (websocket) module.markSignalingSocketRegistered(websocket);
  return module;
}

function installBrowserMocks({ capture, randomUUID = () => 'test-uuid', peerConnections = [] } = {}) {
  const events = [];
  const sent = [];
  const captureFn = capture || (async () => ({ getVideoTracks: () => [], getTracks: () => [] }));
  globalThis.__remoteControlCapture = captureFn;
  Object.defineProperty(globalThis, 'WebSocket', {
    configurable: true,
    value: class MockWebSocket {},
  });
  globalThis.WebSocket.OPEN = 1;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      dispatchEvent(event) { events.push(event); },
    },
  });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { mediaDevices: { getDisplayMedia: () => { throw new Error('Browser capture is forbidden'); } } },
  });
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: { randomUUID },
  });
  if (peerConnections) {
    Object.defineProperty(globalThis, 'RTCPeerConnection', {
      configurable: true,
      value: class MockPeerConnection {
        constructor(config) {
          this.config = config;
          this.connectionState = 'new';
          this.signalingState = 'stable';
          this.remoteDescription = null;
          peerConnections.push(this);
        }

        createDataChannel() {
          return {
            readyState: 'connecting',
            send() {},
            close() { this.readyState = 'closed'; },
          };
        }

        addTransceiver() {}

        async createOffer() {
          return { type: 'offer', sdp: `offer-${peerConnections.length}` };
        }

        async setLocalDescription(description) {
          this.localDescription = description;
          this.signalingState = 'have-local-offer';
        }

        close() {
          this.connectionState = 'closed';
        }
      },
    });
  }
  return {
    events,
    sent,
    websocket: {
      readyState: globalThis.WebSocket.OPEN,
      send(raw) { sent.push(JSON.parse(raw)); },
    },
  };
}

test('capture denial rolls back and allows a later request', async () => {
  const tracks = [{ contentHint: '', onended: null, stopped: false, stop() { this.stopped = true; } }];
  let capture = async () => { throw new Error('permission denied'); };
  const mocks = installBrowserMocks({ capture: (...args) => capture(...args) });
  const { remoteControlService } = await loadService(mocks.websocket);
  remoteControlService.initialize('local', 'Local', mocks.websocket);

  remoteControlService.handleRequest('sid-1', 'controller', 'Controller', 'local');
  await assert.rejects(
    remoteControlService.acceptControl('sid-1', 'controller', 'Controller'),
    /permission denied/,
  );
  assert.equal(remoteControlService.getRole(), 'idle');
  assert.deepEqual(mocks.sent.at(-1), {
    type: 'remote-control-reject',
    from: 'local',
    to: 'controller',
    sessionId: 'sid-1',
    reason: 'capture-failed',
  });

  capture = async () => ({ getVideoTracks: () => tracks, getTracks: () => tracks });
  remoteControlService.handleRequest('sid-2', 'controller', 'Controller', 'local');
  await remoteControlService.acceptControl('sid-2', 'controller', 'Controller');
  assert.equal(remoteControlService.getRole(), 'controlled');
  assert.equal(mocks.sent.at(-1).type, 'remote-control-accept');
  assert.equal(mocks.sent.at(-1).sessionId, 'sid-2');
  remoteControlService.stopControl(false);
  assert.equal(remoteControlService.getRole(), 'idle');
  assert.equal(mocks.events.filter((event) => event.type === 'rc-incoming-request').length, 2);
});

test('pending request stop invalidates delayed accept', async () => {
  const mocks = installBrowserMocks();
  const { remoteControlService } = await loadService(mocks.websocket);
  remoteControlService.initialize('local', 'Local', mocks.websocket);

  remoteControlService.handleRequest('sid-stop', 'controller', 'Controller', 'local');
  remoteControlService.handleStop('sid-stop', 'controller', 'local');
  await assert.rejects(
    remoteControlService.acceptControl('sid-stop', 'controller', 'Controller'),
    /请求已失效/,
  );
  assert.equal(remoteControlService.getRole(), 'idle');
  assert.equal(mocks.sent.length, 0);
});

test('ending control while native authorization is pending cannot send a stale acceptance', async () => {
  const mocks = installBrowserMocks();
  const calls = [];
  let finishAuthorization;
  const { remoteControlService } = await loadService(mocks.websocket, (command, args) => {
    calls.push({ command, args });
    if (command === 'authorize_remote_input') {
      return new Promise((resolve) => { finishAuthorization = resolve; });
    }
    return Promise.resolve();
  });
  remoteControlService.initialize('local', 'Local', mocks.websocket);
  remoteControlService.handleRequest('sid-old', 'controller', 'Controller', 'local');
  const accepting = remoteControlService.acceptControl('sid-old', 'controller', 'Controller');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(typeof finishAuthorization, 'function');
  remoteControlService.stopControl(false);
  const callsBeforeCompletion = calls.length;
  finishAuthorization();
  await accepting;
  assert.equal(remoteControlService.getRole(), 'idle');
  assert.equal(mocks.sent.some((message) => message.type === 'remote-control-accept'), false);
  assert.ok(calls.slice(callsBeforeCompletion).some(({ command, args }) =>
    command === 'revoke_remote_input' && args.sessionId === 'sid-old'));
});

test('old PC callbacks cannot stop or signal a second session', async () => {
  const peerConnections = [];
  const uuids = ['session-one', 'session-two'];
  const mocks = installBrowserMocks({ randomUUID: () => uuids.shift(), peerConnections });
  const { remoteControlService } = await loadService(mocks.websocket);
  remoteControlService.initialize('local', 'Local', mocks.websocket);

  remoteControlService.requestControl('peer', 'Peer');
  const firstSession = mocks.sent.at(-1).sessionId;
  await remoteControlService.handleAccept(firstSession, 'peer', 'local');
  const firstPc = peerConnections[0];
  const staleConnectionState = firstPc.onconnectionstatechange;
  const staleIce = firstPc.onicecandidate;
  remoteControlService.stopControl(false);

  remoteControlService.requestControl('peer', 'Peer');
  const secondSession = mocks.sent.at(-1).sessionId;
  await remoteControlService.handleAccept(secondSession, 'peer', 'local');
  const sentBeforeStaleCallbacks = mocks.sent.length;

  firstPc.connectionState = 'failed';
  staleConnectionState();
  staleIce({ candidate: { candidate: 'stale', sdpMLineIndex: 0, sdpMid: '0' } });

  assert.equal(remoteControlService.getRole(), 'controller');
  assert.equal(mocks.sent.length, sentBeforeStaleCallbacks);
  assert.equal(mocks.sent.at(-1).sessionId, secondSession);
  remoteControlService.stopControl(false);
});

test('local ICE failure tells the peer to close the same remote-control session', async () => {
  const peerConnections = [];
  const mocks = installBrowserMocks({ peerConnections });
  const { remoteControlService } = await loadService(mocks.websocket);
  remoteControlService.initialize('local', 'Local', mocks.websocket);
  remoteControlService.requestControl('peer', 'Peer');
  const sessionId = mocks.sent.at(-1).sessionId;
  await remoteControlService.handleAccept(sessionId, 'peer', 'local');
  peerConnections[0].connectionState = 'failed';
  peerConnections[0].onconnectionstatechange();
  assert.equal(remoteControlService.getRole(), 'idle');
  assert.deepEqual(mocks.sent.at(-1), {
    type: 'remote-control-stop', from: 'local', to: 'peer', sessionId,
  });
  assert.equal(mocks.events.at(-1).type, 'rc-ended');
});

test('remote control discovers the EasyTier ICE route before creating a peer connection', async () => {
  const peerConnections = [];
  const calls = [];
  const mocks = installBrowserMocks({ peerConnections });
  const { remoteControlService } = await loadService(mocks.websocket, async (command) => {
    calls.push(command);
    return command === 'voice_ice_server' ? 'stun:10.42.0.3:45678' : undefined;
  });
  remoteControlService.initialize('local', 'Local', mocks.websocket);
  remoteControlService.requestControl('peer', 'Peer');
  await remoteControlService.handleAccept(mocks.sent.at(-1).sessionId, 'peer', 'local');
  assert.ok(calls.includes('voice_ice_server'));
  assert.deepEqual(peerConnections[0].config.iceServers, [{ urls: 'stun:10.42.0.3:45678' }]);
  remoteControlService.stopControl(false);
});

test('a connected control channel without a video track still times out on both peers', async () => {
  const peerConnections = [];
  const mocks = installBrowserMocks({ peerConnections });
  let connectionTimeout;
  window.setTimeout = (callback, delay) => {
    if (delay === 30000) connectionTimeout = callback;
    return setTimeout(() => {}, 100000);
  };
  const { remoteControlService } = await loadService(mocks.websocket);
  remoteControlService.initialize('local', 'Local', mocks.websocket);
  remoteControlService.requestControl('peer', 'Peer');
  const sessionId = mocks.sent.at(-1).sessionId;
  await remoteControlService.handleAccept(sessionId, 'peer', 'local');
  peerConnections[0].connectionState = 'connected';
  peerConnections[0].onconnectionstatechange();
  connectionTimeout();
  assert.equal(remoteControlService.getRole(), 'idle');
  assert.deepEqual(mocks.sent.at(-1), {
    type: 'remote-control-stop', from: 'local', to: 'peer', sessionId,
  });
});

test('a streamless video track opens the desktop viewer', async () => {
  const peerConnections = [];
  const mocks = installBrowserMocks({ peerConnections });
  globalThis.MediaStream = class MockMediaStream {
    constructor(tracks) { this.tracks = tracks; }
  };
  const { remoteControlService } = await loadService(mocks.websocket);
  remoteControlService.initialize('local', 'Local', mocks.websocket);
  remoteControlService.requestControl('peer', 'Peer');
  await remoteControlService.handleAccept(mocks.sent.at(-1).sessionId, 'peer', 'local');
  const track = { kind: 'video' };
  peerConnections[0].ontrack({ track, streams: [] });
  const streamEvent = mocks.events.find((event) => event.type === 'rc-stream');
  assert.deepEqual(streamEvent.detail.stream.tracks, [track]);
  remoteControlService.stopControl(false);
});

test('late EasyTier discovery cannot create a peer connection for a stopped session', async () => {
  const peerConnections = [];
  const uuids = ['old', 'new'];
  const mocks = installBrowserMocks({ randomUUID: () => uuids.shift(), peerConnections });
  let finishOldDiscovery;
  let discoveries = 0;
  const { remoteControlService } = await loadService(mocks.websocket, (command) => {
    if (command !== 'voice_ice_server') return Promise.resolve();
    discoveries += 1;
    if (discoveries === 1) return new Promise((resolve) => { finishOldDiscovery = resolve; });
    return Promise.resolve('stun:10.42.0.3:45678');
  });
  remoteControlService.initialize('local', 'Local', mocks.websocket);
  remoteControlService.requestControl('peer', 'Peer');
  const oldSessionId = mocks.sent.at(-1).sessionId;
  const oldAccept = remoteControlService.handleAccept(oldSessionId, 'peer', 'local');
  remoteControlService.stopControl(false);
  remoteControlService.requestControl('peer', 'Peer');
  const newSessionId = mocks.sent.at(-1).sessionId;
  await remoteControlService.handleAccept(newSessionId, 'peer', 'local');
  finishOldDiscovery('stun:10.42.0.3:45678');
  await oldAccept;
  assert.equal(peerConnections.length, 1);
  assert.equal(remoteControlService.getRole(), 'controller');
  assert.equal(mocks.sent.at(-1).sessionId, newSessionId);
  remoteControlService.stopControl(false);
});

test('randomUUID failure leaves request state idle', async () => {
  const mocks = installBrowserMocks({ randomUUID: () => { throw new Error('uuid unavailable'); } });
  const { remoteControlService } = await loadService(mocks.websocket);
  remoteControlService.initialize('local', 'Local', mocks.websocket);

  assert.throws(() => remoteControlService.requestControl('peer', 'Peer'), /uuid unavailable/);
  assert.equal(remoteControlService.getRole(), 'idle');
  assert.equal(remoteControlService.isActive(), false);
  assert.equal(mocks.sent.length, 0);
});

test('request timeout notifies the pending peer before local cleanup', () => {
  const timerBlock = serviceSource.slice(
    serviceSource.indexOf('this.requestTimer = window.setTimeout'),
    serviceSource.indexOf('// ==================== 被控端'),
  );
  assert.match(timerBlock, /type: 'remote-control-stop'/);
  assert.match(timerBlock, /sessionId: nextSessionId/);
  assert.ok(timerBlock.indexOf("type: 'remote-control-stop'") < timerBlock.indexOf("this.finishReject('timeout')"));
});

test('controlled input is authorized for the accepted session and revoked on cleanup', () => {
  const acceptBlock = serviceSource.slice(
    serviceSource.indexOf('async acceptControl'),
    serviceSource.indexOf('rejectControl'),
  );
  const authorizeCall = acceptBlock.indexOf("invoke('authorize_remote_input'");
  const acceptSignal = acceptBlock.indexOf("type: 'remote-control-accept'");
  assert.ok(authorizeCall >= 0 && authorizeCall < acceptSignal);

  const cleanupBlock = serviceSource.slice(
    serviceSource.indexOf('private cleanup'),
    serviceSource.indexOf('// ==================== 信令处理'),
  );
  assert.match(cleanupBlock, /invoke\('revoke_remote_input'/);
  assert.match(cleanupBlock, /sessionId: endedSessionId/);
  assert.match(cleanupBlock, /controllerId: endedControllerId/);

  const inputBlock = serviceSource.slice(
    serviceSource.indexOf('private async onInputMessage'),
    serviceSource.indexOf('handlePeerLeft'),
  );
  assert.match(inputBlock, /events\.length <= MAX_REMOTE_INPUT_EVENTS/);
  assert.match(inputBlock, /sessionId,/);
  assert.match(inputBlock, /controllerId: peerId/);
});

test('Android delayed accept is invalidated across lobby lifecycle changes', () => {
  const acceptBlock = androidRepository.slice(
    androidRepository.indexOf('fun acceptRemoteControl'),
    androidRepository.indexOf('/** 停止被远程控制'),
  );
  assert.match(androidRepository, /private var remoteControlAcceptJob: Job\? = null/);
  assert.match(androidRepository, /private var remoteControlAcceptGeneration = 0L/);
  assert.match(androidRepository, /private fun invalidatePendingRemoteControlAccept\(\)/);
  assert.match(acceptBlock, /val generation = \+\+remoteControlAcceptGeneration/);
  assert.match(acceptBlock, /generation != remoteControlAcceptGeneration/);
  assert.match(acceptBlock, /pendingRcRequest != req/);
  assert.match(acceptBlock, /_state\.value\.state != AppConnectionState\.InLobby/);
  const leaveBlock = androidRepository.slice(androidRepository.indexOf('fun leaveLobby'), androidRepository.indexOf('fun reloadLobby'));
  assert.match(leaveBlock, /invalidatePendingRemoteControlAccept\(\)/);
});
