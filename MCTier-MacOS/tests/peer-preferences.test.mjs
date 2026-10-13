import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const bundle = await build({ entryPoints: [fileURLToPath(new URL('../src/services/chat/peerPreferences.ts', import.meta.url))], bundle: true, format: 'esm', write: false });
const { updatePeerPreference: update, parsePeerPreferences: parse, sortPrivatePeers: sort, notificationUnreadCount: count } = await import(`data:text/javascript,${encodeURIComponent(bundle.outputFiles[0].text)}`);
const alice = 'a'.repeat(64), bob = 'b'.repeat(64);
test('pin and DND survive serialization and same-identity rejoin without nickname inheritance', () => {
  const prefs = parse(JSON.stringify(update({}, alice, { pinned: true, muted: true })));
  assert.deepEqual(sort([{ id: bob, name: 'Same' }, { id: alice, name: 'Renamed' }], prefs).map(p => p.id), [alice, bob]);
  assert.equal(prefs[bob], undefined);
  assert.deepEqual(sort([{ id: bob }], prefs), [{ id: bob }]);
  assert.equal(prefs[alice].muted, true);
  assert.deepEqual(update(prefs, alice, { pinned: false, muted: false }), {});
});
test('DND preserves message unread but suppresses notification count, including manual unread', () => {
  const unread = { first: `private:${alice}`, second: `private:${bob}`, public: 'lobby' };
  const prefs = update({}, alice, { muted: true, markedUnread: true });
  assert.equal(count(unread, prefs), 2);
  assert.equal(Object.keys(unread).length, 3);
  assert.equal(count({}, update(prefs, alice, { muted: false })), 1);
  assert.equal(count({ first: `private:${alice}` }, update(prefs, alice, { muted: false })), 1);
  assert.equal(count({}, update(prefs, alice, { markedUnread: false })), 0);
  assert.equal(count({}, update(prefs, alice, { muted: false }), [bob]), 0, 'offline manual marks do not leave an inaccessible global badge');
});
test('corrupt records and session IDs do not become persistent identities', () => {
  assert.deepEqual(parse('bad json'), {});
  assert.deepEqual(parse('[]'), {});
  assert.deepEqual(parse('{"nickname":{"pinned":true}}'), {});
  assert.throws(() => update({}, 'nickname', { pinned: true }));
  assert.equal(parse(JSON.stringify({ [alice]: { pinned: 'true', muted: false } }))[alice].pinned, false);
});
