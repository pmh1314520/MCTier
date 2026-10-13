import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { encodeBuiltinEmoji, decodeBuiltinEmoji } from '../src/services/emoji/builtinEmojiMessage.ts';

test('versioned emoji IDs are short exact text and reject paths or embedded content', () => {
  assert.equal(encodeBuiltinEmoji('builtin-a_B-9'), 'mctier:emoji:v3:builtin-a_B-9');
  assert.equal(decodeBuiltinEmoji('mctier:emoji:v3:builtin-a_B-9'), 'builtin-a_B-9');
  for (const id of ['', 'custom-1', 'builtin-', 'builtin-../x', 'builtin-a/b', 'builtin-a\\b', 'builtin-%2e', 'builtin-😀', 'builtin-a\n', 'builtin-' + 'a'.repeat(129)]) {
    assert.throws(() => encodeBuiltinEmoji(id));
    assert.equal(decodeBuiltinEmoji('mctier:emoji:v3:' + id), null);
  }
  for (const text of [' mctier:emoji:v3:builtin-a', 'mctier:emoji:v3:builtin-a\r\n', 'mctier:emoji:v4:builtin-a', 'hello mctier:emoji:v3:builtin-a', '> quote\nmctier:emoji:v3:builtin-a']) assert.equal(decodeBuiltinEmoji(text), null);
});

test('every ID in the pack shared by Windows and Android round trips without image bytes', () => {
  const pack = gunzipSync(readFileSync('shared/builtin-emoji/builtin-v3.pack.gz'));
  const magic = Buffer.from('MCTIER_EMOJI_PACK_V3\0');
  assert.ok(pack.subarray(0, magic.length).equals(magic));
  const count = pack.readUInt32LE(magic.length);
  assert.ok(count >= 100);
  let offset = magic.length + 4, imageBytes = 0, textBytes = 0;
  const ids = new Set();
  for (let i = 0; i < count; i++) {
    const idLength = pack.readUInt16LE(offset), size = pack.readUInt32LE(offset + 2);
    offset += 6;
    const id = 'builtin-' + pack.subarray(offset, offset + idLength).toString('ascii');
    offset += idLength;
    const text = encodeBuiltinEmoji(id);
    assert.equal(decodeBuiltinEmoji(text), id);
    assert.ok(Buffer.byteLength(text) <= 152);
    assert.equal(ids.has(id), false);
    ids.add(id);
    imageBytes += size; textBytes += Buffer.byteLength(text);
    offset += size;
  }
  assert.equal(offset, pack.length);
  assert.equal(ids.has('builtin-1f60d'), false);
  assert.equal(ids.has('builtin-1f970'), true);
  assert.ok(textBytes < imageBytes / 100);
});

test('removed duplicate IDs resolve to the retained emoji for old messages', () => {
  assert.equal(decodeBuiltinEmoji('mctier:emoji:v3:builtin-1f60d'), 'builtin-1f970');
  assert.equal(encodeBuiltinEmoji('builtin-1f60d'), 'mctier:emoji:v3:builtin-1f970');
});
