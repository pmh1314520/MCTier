import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import ts from 'typescript';

// Exercise production orchestration; only OS/media implementations are fakes.
const entry = fileURLToPath(new URL('../src/services/webrtc/WebRTCClient.ts', import.meta.url));
const ast = ts.createSourceFile(
  entry,
  fs.readFileSync(entry, 'utf8'),
  ts.ScriptTarget.Latest,
  true
);
const stubs = new Map();
for (const stmt of ast.statements) {
  if (
    !ts.isImportDeclaration(stmt) ||
    !stmt.importClause?.namedBindings ||
    !ts.isNamedImports(stmt.importClause.namedBindings)
  )
    continue;
  stubs.set(
    stmt.moduleSpecifier.text,
    stmt.importClause.namedBindings.elements
      .filter((e) => !e.isTypeOnly)
      .map((e) => `export const ${(e.propertyName ?? e.name).text} = {};`)
      .join('\n')
  );
}
const bundle = await build({
  entryPoints: [entry],
  bundle: true,
  format: 'esm',
  write: false,
  drop: ['console'],
  plugins: [
    {
      name: 'voice-fixture',
      setup(b) {
        b.onResolve({ filter: /.*/ }, (args) => {
          if (
            args.kind === 'entry-point' ||
            args.path.endsWith('/signaling-protocol.json') ||
            /(?:signalingTrustBoundary|trustBoundary|audioTransceiver|voiceHealth)$/.test(args.path)
          )
            return;
          return { path: args.path, namespace: 'voice-fixture' };
        });
        b.onLoad({ filter: /.*/, namespace: 'voice-fixture' }, (args) => ({
          loader: 'js',
          contents: args.path.endsWith('/stores')
            ? 'export const useAppStore={getState:()=>globalThis.voiceTestStore};'
            : args.path.endsWith('/audioDevices')
              ? 'export const audioDevices={getOutputDeviceId:()=>globalThis.voiceTestOutput};'
              : args.path === '@tauri-apps/api/core'
                ? 'export const invoke=async (...args)=>{globalThis.voiceTestDiagnostics.push(args);};'
              : (stubs.get(args.path) ?? 'export const useAppStore={};'),
        }));
      },
    },
  ],
});
const { WebRTCClient } = await import(
  `data:text/javascript,${encodeURIComponent(bundle.outputFiles[0].text + '\n//# sourceURL=voice-recovery-fixture.js')}`
);
const flush = async () => {
  for (let i = 0; i < 40; i++) await Promise.resolve();
};
const local = 'b'.repeat(64),
  remote = 'a'.repeat(64);
const track = () => ({
  kind: 'audio',
  readyState: 'live',
  enabled: true,
  stop() {
    this.readyState = 'ended';
  },
});
function fakePc() {
  const receiver = track();
  const t = {
    mid: '0',
    direction: 'sendrecv',
    currentDirection: 'sendrecv',
    receiver: { track: receiver },
    sender: {
      track: null,
      async replaceTrack(value) {
        this.track = value;
      },
    },
  };
  return {
    connectionState: 'connected',
    signalingState: 'stable',
    t,
    closed: false,
    getTransceivers: () => [t],
    async getStats() {
      return new Map();
    },
    async createOffer() {
      return { type: 'offer', sdp: 'v=0\r\n' };
    },
    async createAnswer() {
      return { type: 'answer', sdp: 'v=0\r\n' };
    },
    async setLocalDescription(d) {
      this.localDescription = d;
      this.signalingState = d.type === 'offer' ? 'have-local-offer' : 'stable';
    },
    async setRemoteDescription(d) {
      this.remoteDescription = d;
      this.signalingState = d.type === 'offer' ? 'have-remote-offer' : 'stable';
    },
    async addIceCandidate(c) {
      (this.ice ??= []).push(c);
    },
    close() {
      this.closed = true;
      this.connectionState = 'closed';
    },
  };
}
function fixture(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const restore = new Map(
    ['window', 'Audio', 'MediaStream', 'RTCSessionDescription', 'voiceTestStore', 'voiceTestOutput', 'voiceTestDiagnostics'].map((key) => [
      key,
      globalThis[key],
    ])
  );
  t.after(() => {
    for (const [key, value] of restore) globalThis[key] = value;
  });
  globalThis.window = { setTimeout, clearTimeout };
  globalThis.voiceTestOutput = '';
  globalThis.voiceTestDiagnostics = [];
  globalThis.Audio = class {
    paused = true;
    muted = false;
    volume = 1;
    plays = 0;
    async play() {
      this.plays++;
      this.atPlay = { muted: this.muted, volume: this.volume };
      this.paused = false;
    }
    pause() {
      this.paused = true;
    }
    load() {}
    remove() {}
  };
  globalThis.MediaStream = class {
    constructor(tracks) {
      this.tracks = tracks;
    }
    getAudioTracks() {
      return this.tracks;
    }
    getTracks() {
      return this.tracks;
    }
  };
  globalThis.RTCSessionDescription = class {
    constructor(d) {
      Object.assign(this, d);
    }
  };
  globalThis.voiceTestStore = {
    globalMuted: false,
    mutedPlayers: new Set(),
    playerVolumes: new Map([[remote, 0.25]]),
    myVoiceGroup: 0,
    playerVoiceGroups: new Map(),
  };
  const client = new WebRTCClient();
  client.localPlayerId = local;
  client.knownPlayers.add(remote);
  client.peerSessionGenerations.set(remote, '7');
  const messages = [];
  client.sendWebSocketMessage = (m) => {
    messages.push(m);
    return true;
  };
  function install(pc = fakePc()) {
    const peer = {
      id: remote,
      connection: pc,
      iceCandidateQueue: [],
      createdAt: Date.now(),
      isNegotiating: false,
      remoteDescriptionSet: false,
    };
    client.peerConnections.set(remote, peer);
    return peer;
  }
  return {
    client,
    messages,
    install,
    async tick(ms) {
      t.mock.timers.tick(ms);
      await flush();
    },
  };
}

test('explicit repair replaces a connected-but-silent PC and signals the other side', async (t) => {
  const f = fixture(t),
    old = f.install();
  let replacement;
  f.client.createPeerConnection = async () => {
    replacement = f.install();
  };
  const repair = f.client.reconnectPeerVoice(remote);
  await f.tick(300);
  await f.tick(500);
  await f.tick(100);
  assert.equal(await repair, true);
  assert.equal(old.connection.closed, true);
  assert.equal(f.client.peerConnections.get(remote), replacement);
  assert.deepEqual(
    f.messages.map((m) => m.type),
    ['voice-reconnect', 'offer']
  );
});

test('leaving during delayed repair prevents a ghost peer and offer', async (t) => {
  const f = fixture(t);
  f.install();
  const pending = f.client.reconnectPeerVoice(remote);
  f.client.knownPlayers.delete(remote);
  await f.tick(300);
  assert.equal(await pending, false);
  assert.deepEqual(
    f.messages.map((m) => m.type),
    ['voice-reconnect']
  );
});

test('streamless audio is attached and applies mute/group policy before first playback', async (t) => {
  const f = fixture(t),
    peer = f.install();
  globalThis.voiceTestStore.playerVoiceGroups.set(remote, 1);
  f.client.attachRemoteAudio(remote, peer.connection, peer.connection.t.receiver.track);
  await flush();
  assert.equal(peer.audioStream.getAudioTracks()[0], peer.connection.t.receiver.track);
  assert.equal(peer.audioElement.atPlay.volume, 0);
  globalThis.voiceTestStore.playerVoiceGroups.set(remote, 0);
  globalThis.voiceTestStore.globalMuted = true;
  await f.client.checkVoiceHealth();
  assert.equal(peer.audioElement.muted, true);
  assert.equal(peer.audioElement.volume, 0.25);
  peer.audioElement.pause();
  await f.client.checkVoiceHealth();
  assert.equal(peer.audioElement.paused, false);
  assert.equal(f.messages.length, 0);
});

test('unavailable saved output falls back to default before remote playback', async (t) => {
  const f = fixture(t), peer = f.install();
  globalThis.voiceTestOutput = 'removed-speaker';
  const sinks = [];
  Audio.prototype.setSinkId = async function (id) {
    sinks.push(id);
    if (id) throw new Error('output unavailable');
    this.sinkId = id;
  };
  f.client.attachRemoteAudio(remote, peer.connection, peer.connection.t.receiver.track);
  await flush();
  assert.deepEqual(sinks, ['removed-speaker', '']);
  assert.equal(peer.audioElement.paused, false);
  assert.ok(voiceTestDiagnostics.some(([, report]) => report.stage === 'playback-error'));
  assert.equal(peer.connection.closed, false);
});

test('playback failures are logged once and retry recovers without destroying the call', async (t) => {
  const f = fixture(t), peer = f.install();
  const originalPlay = Audio.prototype.play;
  Audio.prototype.play = async function () { throw new Error('playback blocked'); };
  f.client.attachRemoteAudio(remote, peer.connection, peer.connection.t.receiver.track);
  await flush();
  f.client.resumePeerAudio(peer); await flush();
  assert.equal(voiceTestDiagnostics.filter(([, report]) => report.stage === 'playback-error').length, 1);
  assert.equal(peer.playPending, false);
  assert.equal(peer.connection.closed, false);
  Audio.prototype.play = originalPlay;
  f.client.resumePeerAudio(peer); await flush();
  assert.equal(peer.audioElement.paused, false);
  assert.equal(peer.lastPlaybackError, undefined);
  assert.equal(voiceTestDiagnostics.at(-1)[1].stage, 'playback-ready');
});

test('changing a call output device reports failure to the caller', async (t) => {
  const f = fixture(t), peer = f.install();
  peer.audioElement = new Audio();
  peer.audioElement.setSinkId = async () => { throw new Error('missing device'); };
  await assert.rejects(f.client.applyOutputDeviceToAll('missing'), /missing device/);
});

test('disconnected realtime calls produce throttled disk diagnostics instead of silent health checks', async (t) => {
  const f = fixture(t), peer = f.install();
  peer.connection.connectionState = 'connecting';
  peer.connection.iceConnectionState = 'checking';
  await f.client.checkVoiceHealth(); await flush();
  await f.client.checkVoiceHealth(); await flush();
  const waiting = voiceTestDiagnostics.filter(([, report]) => report.detail.startsWith('waiting'));
  assert.equal(waiting.length, 1);
  assert.match(waiting[0][1].detail, /pc=connecting, ice=checking/);
  assert.equal(peer.connection.closed, false);
});

test('late ontrack and telemetry from an obsolete PC cannot replace new audio', async (t) => {
  const f = fixture(t),
    old = f.install();
  const channel = { close() {}, readyState: 'open' };
  f.client.bindVoiceHealthChannel(remote, old.connection, channel);
  const replacement = f.install();
  f.client.attachRemoteAudio(remote, old.connection, track());
  channel.onmessage({ data: '{"v":1,"packets":100}' });
  await flush();
  assert.equal(replacement.audioElement, undefined);
  assert.equal(replacement.remoteAudioPackets, undefined);
});

test('valid incoming renegotiation flushes queued ICE and binds the offered audio line', async (t) => {
  const f = fixture(t),
    peer = f.install();
  const mic = track();
  f.client.localStream = new MediaStream([mic]);
  peer.iceCandidateQueue.push({ candidate: 'early-ice', receivedAt: Date.now(), bytes: 8 });
  await f.client.handleWebSocketOffer({
    from: remote,
    to: local,
    sessionGeneration: 7,
    offer: { type: 'offer', sdp: 'v=0\r\n' },
  });
  assert.deepEqual(peer.connection.ice, ['early-ice']);
  assert.equal(peer.connection.t.sender.track, mic);
  assert.equal(peer.remoteDescriptionSet, true);
  assert.equal(f.messages.at(-1).type, 'answer');
});

test('offer collision elects higher ID and lower ID rolls back instead of both rolling back', async (t) => {
  const f = fixture(t),
    peer = f.install();
  peer.connection.signalingState = 'have-local-offer';
  const message = {
    from: remote,
    to: local,
    sessionGeneration: 7,
    offer: { type: 'offer', sdp: 'v=0\r\n' },
  };
  await f.client.handleWebSocketOffer(message);
  assert.equal(f.messages.length, 0);
  f.client.localPlayerId = '0'.repeat(64);
  await f.client.handleWebSocketOffer({ ...message, to: f.client.localPlayerId });
  assert.equal(peer.connection.signalingState, 'stable');
  assert.equal(f.messages.at(-1).type, 'answer');
});

test('health monitor repairs media stall despite connected state and keeps mic suppression', async (t) => {
  const f = fixture(t),
    peer = f.install();
  const mic = track();
  mic.enabled = false;
  f.client.localStream = new MediaStream([mic]);
  let sent = 0,
    clock = 0,
    repairs = 0;
  t.mock.method(performance, 'now', () => clock);
  peer.connection.getStats = async () =>
    new Map([
      ['in', { type: 'inbound-rtp', kind: 'audio', packetsReceived: 0 }],
      ['out', { type: 'remote-outbound-rtp', kind: 'audio', packetsSent: sent }],
    ]);
  f.client.reconnectPeerVoice = async () => {
    repairs++;
    return true;
  };
  for (clock = 0; clock <= 10000; clock += 2000) {
    sent++;
    await f.client.checkVoiceHealth();
  }
  assert.equal(repairs, 1);
  assert.equal(peer.connection.t.sender.track, mic);
  assert.equal(mic.enabled, false);
});

test('persistent sender binding failures trigger repair instead of bypassing health policy', async (t) => {
  const f = fixture(t),
    peer = f.install();
  f.client.localStream = new MediaStream([track()]);
  peer.connection.t.sender.replaceTrack = async () => {
    throw new Error('sender stopped');
  };
  let clock = 0,
    repairs = 0;
  t.mock.method(performance, 'now', () => clock);
  f.client.reconnectPeerVoice = async () => {
    repairs++;
    return true;
  };
  for (clock = 0; clock <= 8000; clock += 2000) await f.client.checkVoiceHealth();
  assert.equal(repairs, 1);
});

test('late local offer callback cannot overwrite an accepted colliding remote offer', async (t) => {
  const f = fixture(t),
    peer = f.install();
  f.client.localPlayerId = '0'.repeat(64);
  let resolveOffer;
  peer.connection.createOffer = () =>
    new Promise((resolve) => {
      resolveOffer = resolve;
    });
  const pending = f.client.makePeerOffer(remote, peer);
  await f.client.handleWebSocketOffer({
    from: remote,
    to: f.client.localPlayerId,
    sessionGeneration: 7,
    offer: { type: 'offer', sdp: 'v=0\r\n' },
  });
  resolveOffer({ type: 'offer', sdp: 'v=0\r\n' });
  assert.equal(await pending, false);
  assert.deepEqual(
    f.messages.map((m) => m.type),
    ['answer']
  );
  assert.equal(peer.connection.signalingState, 'stable');
});

test('microphone transition is not undone by concurrent health sampling', async (t) => {
  const f = fixture(t),
    peer = f.install();
  const previous = track(),
    next = track();
  f.client.localStream = new MediaStream([previous]);
  peer.connection.t.sender.track = next;
  f.client.micTransitions = 1;
  await f.client.checkVoiceHealth();
  assert.equal(peer.connection.t.sender.track, next);
});

test('simultaneous repair keeps the higher-ID offerer and cancels the lower-ID pending repair', async (t) => {
  const f = fixture(t),
    peer = f.install();
  f.client.voiceRecoveryTickets.set(remote, Symbol());
  const request = { type: 'voice-reconnect', from: remote, to: local, sessionGeneration: 7 };
  await f.client.handleWebSocketMessage(request);
  assert.equal(f.client.peerConnections.get(remote), peer);
  f.client.localPlayerId = '0'.repeat(64);
  await f.client.handleWebSocketMessage({ ...request, to: f.client.localPlayerId });
  assert.equal(f.client.voiceRecoveryTickets.has(remote), false);
  assert.equal(f.client.peerConnections.has(remote), false);
});
