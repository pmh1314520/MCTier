import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const path = new URL('../src/App.tsx', import.meta.url);
const source = ts.createSourceFile('App.tsx', fs.readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const app = source.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === 'App');
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
      appState: 'in-lobby', lobby: { name: 'Test', password: '', virtualIp: '10.126.126.1' },
      lobbySessionCoordinator: { current: () => ({}), isCurrent: () => true, assertCurrent() {} },
      useAppStore: { getState: () => store }, webrtcClient,
      addPlayer(player) { events.push(['player', player.id]); }, removePlayer() {},
      updatePlayerStatus() {}, setPlayerSpeaking() {}, addChatMessage() {},
      speakingDetector: { setCallback() {} },
      fileShareService: { async startServer() { complete(); } },
      console: { log() {}, error() {} },
      Error,
      tl: text => text, sanitizeUntrustedText: text => text,
    });
    await finished;
    assert.deepEqual(events, failed
      ? [['status', 'failed', 'virtual adapter unavailable']]
      : [['host', 'local'], ['player', 'remote'], ['status', 'connected', undefined]]);
  });
}
