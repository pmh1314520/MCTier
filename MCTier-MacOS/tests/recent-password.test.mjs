import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

let instance = 0;
async function fixture(encrypt) {
  const data = new Map();
  globalThis.localStorage = {
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
  };
  globalThis.encryptRecentPassword = encrypt;
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../src/services/recent/recentService.ts', import.meta.url))],
    bundle: true, format: 'esm', write: false,
    plugins: [{ name: 'secret-store', setup(builder) {
      builder.onResolve({ filter: /^@tauri-apps\/api\/core$/ }, () => ({ path: 'native', namespace: 'stub' }));
      builder.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export const invoke = (_, args) => globalThis.encryptRecentPassword(args.password);' }));
    } }],
  });
  const { recentService } = await import(`data:text/javascript,${encodeURIComponent(result.outputFiles[0].text)}#${instance++}`);
  return { data, service: recentService };
}

test('clearing while a legacy password migrates never resurrects the record', async () => {
  let complete;
  let started;
  const migrating = new Promise(resolve => { started = resolve; });
  const { data, service } = await fixture(() => { started(); return new Promise(resolve => { complete = resolve; }); });
  data.set('mctier_recent_lobbies', JSON.stringify([{ name: 'Old', password: 'Secret123', lastJoined: 1 }]));
  const reading = service.getRecentLobbies();
  await migrating;
  const clearing = service.clearLobbies();
  complete('mctier-local-v1:AAAA');
  await Promise.all([reading, clearing]);
  assert.deepEqual(JSON.parse(data.get('mctier_recent_lobbies')), []);
});

test('concurrent joins retain both encrypted passwords and reads do not reseal them', async () => {
  let calls = 0;
  const { data, service } = await fixture(async () => `mctier-local-v1:AAAA${++calls}`);
  await Promise.all([
    service.recordLobby({ name: 'One', password: 'Secret123' }),
    service.recordLobby({ name: 'Two', password: 'Other123' }),
  ]);
  assert.equal(calls, 2);
  assert.equal((await service.getRecentLobbies()).length, 2);
  assert.equal(calls, 2);
  assert.ok(!data.get('mctier_recent_lobbies').includes('Secret123'));
  await service.removeLobby('One');
  assert.deepEqual((await service.getRecentLobbies()).map(lobby => lobby.name), ['Two']);
});

test('an unavailable credential store preserves the legacy record for retry', async () => {
  const { data, service } = await fixture(async () => { throw new Error('locked'); });
  const original = JSON.stringify([{ name: 'Old', password: 'Secret123', lastJoined: 1 }]);
  data.set('mctier_recent_lobbies', original);
  await assert.rejects(service.getRecentLobbies(), /locked/);
  assert.equal(data.get('mctier_recent_lobbies'), original);
  await service.clearLobbies();
  assert.deepEqual(JSON.parse(data.get('mctier_recent_lobbies')), []);
});
