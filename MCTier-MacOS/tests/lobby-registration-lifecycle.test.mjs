import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const recoveryBundle = await build({ entryPoints: [fileURLToPath(new URL('../src/services/lobby/virtualAddressRecovery.ts', import.meta.url))], bundle: true, format: 'esm', write: false });
const recovery = await import(`data:text/javascript,${encodeURIComponent(recoveryBundle.outputFiles[0].text)}`);

const path = new URL('../src/App.tsx', import.meta.url);
const source = ts.createSourceFile('App.tsx', fs.readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const app = source.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === 'MainWindowApp');
const effect = app.body.statements.find(s => ts.isExpressionStatement(s) &&
  ts.isCallExpression(s.expression) && s.expression.expression.getText(source) === 'useEffect' &&
  s.expression.arguments[0].getText(source).includes('const initWebRTC ='));
const compiled = ts.transpileModule(`(${effect.expression.arguments[0].getText(source)})();`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

for (const failed of [false, true]) {
  test(`lobby effect ${failed ? 'shows registration failure' : 'observes the first host and roster'} before displaying a ready lobby`, async () => {
    const events = [];
    const callbacks = {};
    let complete;
    const finished = new Promise(resolve => { complete = resolve; });
    const store = {
      appState: 'connecting',
      setAppState(state) { this.appState = state; events.push(['screen', state]); },
      currentPlayerId: 'local', config: { playerName: 'Local' }, versionError: null,
      setSignalingStatus(status, error) { events.push(['status', status, error]); if (status === 'failed') complete(); },
      setHostId(id) { events.push(['host', id]); },
      setMaxPlayers() {}, setIsPublicLobby() {}, setHostMutedPlayers() {},
    };
    const webrtcClient = new Proxy({}, { get: (_, name) => name === 'initialize'
      ? async () => {
          if (failed) throw new Error('virtual adapter unavailable');
          callbacks.onLobbyMeta?.({ hostId: 'local' });
          callbacks.onPlayerJoined?.('remote', 'Remote', '10.126.126.2');
          callbacks.onSignalingStatus?.('connected');
        }
      : callback => { callbacks[name] = callback; }
    });
    vm.runInNewContext(compiled, {
      appState: 'connecting', lobby: { name: 'Test', password: '', virtualIp: '10.126.126.1', entryMode: 'create' },
      lobbySessionCoordinator: { current: () => ({}), isCurrent: () => true, assertCurrent() {} },
      useAppStore: { getState: () => store }, webrtcClient,
      addPlayer(player) { events.push(['player', player.id]); }, removePlayer() {},
      updatePlayerStatus() {}, setPlayerSpeaking() {}, addChatMessage() {},
      speakingDetector: { setCallback() {} },
      fileShareService: { async startServer() { complete(); } },
      async invoke(command) { events.push(['invoke', command]); },
      console: { log() {}, error() {} },
      Error,
      tl: text => text, sanitizeUntrustedText: text => text,
    });
    await finished;
    assert.deepEqual(events, failed
      ? [['invoke', 'leave_lobby'], ['status', 'failed', 'virtual adapter unavailable']]
      : [['host', 'local'], ['player', 'remote'], ['status', 'connected', undefined], ['screen', 'in-lobby']]);
  });
}

test('a superseded registration failure does not stop the replacement network session', async () => {
  const events = [];
  let current = true;
  const store = { currentPlayerId: 'local', config: { playerName: 'Local' }, versionError: null,
    setSignalingStatus() { events.push('status'); } };
  vm.runInNewContext(compiled, {
    appState: 'in-lobby', lobby: { name: 'Test', password: '', virtualIp: '10.126.126.1' },
    lobbySessionCoordinator: { current: () => ({}), isCurrent: () => current },
    useAppStore: { getState: () => store },
    webrtcClient: new Proxy({}, { get: (_, name) => name === 'initialize'
      ? async () => { current = false; throw new Error('old registration failed'); }
      : () => {} }),
    speakingDetector: { setCallback() {} },
    async invoke(command) { events.push(command); },
    console: { log() {}, error() {} }, Error,
    tl: text => text, sanitizeUntrustedText: text => text,
  });
  for (let i = 0; i < 20; i++) await Promise.resolve();
  assert.equal(current, false, 'the old initialization must reach its failure');
  assert.deepEqual(events, []);
});

for (const reconnect of [false, true]) {
  test(`IP collision during ${reconnect ? 'reconnect' : 'startup'} stops the old session before restarting`, async () => {
    const events = [];
    const callbacks = {};
    let finish;
    const finished = new Promise(resolve => { finish = resolve; });
    const lobby = { name: 'room', password: '', virtualIp: '10.126.126.1', automaticVirtualIp: true,
      serverNode: 'udp://selected:11010', signalingServer: 'wss://selected', entryMode: 'create' };
    const store = { currentPlayerId: 'alice', config: { playerName: 'Alice' }, versionError: null,
      setSignalingStatus() {}, setLobby(value) { events.push(['publish', value.virtualIp]); finish(value); } };
    const conflict = 'virtualIp 已被大厅内其他成员使用';
    vm.runInNewContext(compiled, {
      ...recovery, appState: 'in-lobby', lobby,
      lobbySessionCoordinator: { current: () => ({}), isCurrent: () => true, assertCurrent() {} },
      useAppStore: { getState: () => store },
      webrtcClient: new Proxy({}, { get: (_, name) => name === 'initialize'
        ? async () => { if (!reconnect) throw new Error(conflict); callbacks.onSignalingStatus?.('connected'); }
        : name === 'cleanup' ? async () => { events.push(['cleanup']); }
        : callback => { callbacks[name] = callback; } }),
      speakingDetector: { setCallback() {} },
      fileShareService: { async startServer() { callbacks.onSignalingStatus('failed', conflict); } },
      async invoke(command, args) {
        events.push([command]);
        if (command === 'join_lobby') {
          assert.equal(args.addressAttempt, 1);
          assert.equal(args.password, '');
          assert.equal(args.serverNode, lobby.serverNode);
          return { ...lobby, virtualIp: '10.126.126.2' };
        }
      },
      console: { log() {}, error() {} }, Error, tl: text => text, sanitizeUntrustedText: text => text,
    });
    const replacement = await finished;
    assert.deepEqual(events, [['cleanup'], ['leave_lobby'], ['join_lobby'], ['publish', '10.126.126.2']]);
    assert.equal(replacement.addressAttempt, 1);
    assert.equal(replacement.entryMode, reconnect ? 'auto' : 'create');
  });
}
