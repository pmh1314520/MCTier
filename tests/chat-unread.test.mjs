import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const bundle = await build({ entryPoints: [fileURLToPath(new URL('../src/services/chat/unread.ts', import.meta.url))], bundle: true, format: 'esm', write: false });
const { recordUnread, readConversation, unreadLabel } = await import(`data:text/javascript,${encodeURIComponent(bundle.outputFiles[0].text)}`);
const message = (id, peer = 'alice', recipientId = 'me') => ({ id, playerId: peer, recipientId, timestamp: 9999999999999 });

test('only the visible conversation is read, independent of sender clock and arrival order', () => {
  let unread = recordUnread({}, message('a'), 'me', null);
  unread = recordUnread(unread, message('b', 'bob'), 'me', null);
  unread = recordUnread(unread, message('lobby', 'alice', null), 'me', null);
  unread = readConversation(unread, 'private:alice');
  assert.deepEqual(unread, { b: 'private:bob', lobby: 'lobby' });
  assert.deepEqual(recordUnread(unread, message('new'), 'me', 'private:alice'), unread);
  assert.deepEqual(readConversation(unread, null), unread, 'closing chat preserves other unread conversations');
  unread = recordUnread(unread, message('after-close'), 'me', null);
  assert.equal(unread['after-close'], 'private:alice');
  assert.deepEqual(readConversation(unread, 'lobby'), { b: 'private:bob', 'after-close': 'private:alice' });
});

test('own, recalled and misaddressed messages do not count; duplicates count once', () => {
  assert.deepEqual(recordUnread({}, message('self', 'me'), 'me', null), {});
  assert.deepEqual(recordUnread({}, { ...message('recall'), recalled: true }, 'me', null), {});
  assert.deepEqual(recordUnread({}, message('other', 'alice', 'bob'), 'me', null), {});
  const first = recordUnread({}, message('a'), 'me', null);
  assert.deepEqual(recordUnread(first, message('a'), 'me', null), first);
});

test('badge counts cap at 99+ from 100 onwards', () => {
  assert.deepEqual([1, 9, 10, 99, 100, 101, 1000].map(unreadLabel), ['1', '9', '10', '99', '99+', '99+', '99+']);
});
