import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const result = await build({ entryPoints: [fileURLToPath(new URL('../src/services/danmaku/messagePreview.ts', import.meta.url))], bundle: true, format: 'esm', write: false });
const { messagePreview } = await import(`data:text/javascript,${encodeURIComponent(result.outputFiles[0].text)}`);
const meta = { id: 'att-123456789abc', name: 'photo.gif', mime: 'image/gif', size: 4096 };

test('built-in IDs display an image summary and recall hides them', () => {
  const message = { type: 'text', content: 'mctier:emoji:v3:builtin-a_B-9' };
  assert.deepEqual(messagePreview(message), { kind: 'image', text: '[内置表情]' });
  assert.deepEqual(messagePreview({ ...message, recalled: true }), { kind: 'text', text: '[消息已撤回]' });
});

test('attachment messages show media previews rather than internal JSON', () => {
  for (const [name, mime, kind] of [['photo.gif', 'image/gif', 'image'], ['photo.png', 'image/png', 'image'], ['clip.mp4', 'video/mp4', 'video'], ['song.mp3', 'audio/mpeg', 'audio'], ['deck.pptx', 'application/octet-stream', 'file']]) {
    const attachment = { ...meta, name, mime };
    for (const message of [{ type: 'file', content: JSON.stringify(attachment) }, { type: 'file', content: JSON.stringify(attachment), attachment }]) {
      const preview = messagePreview(message);
      assert.equal(preview.kind, kind);
      assert.equal(preview.text, name);
      assert.ok(!JSON.stringify(preview).includes(meta.id));
      assert.match(preview.detail, /KB/);
    }
  }
});
test('legacy images and animated emoji preserve their image data', () => {
  const imageData = 'data:image/gif;base64,R0lGODlh';
  assert.equal(messagePreview({ type: 'image', content: '[表情]', imageData }).image, imageData);
});
test('voice duration is bounded and malformed payloads never expose internal data', () => {
  assert.equal(messagePreview({ type: 'voice', content: '{"duration":2.2,"data":"secret"}' }).detail, '3 秒');
  for (const content of ['{"duration":999}', '{"duration":-2}', 'not json']) assert.equal(messagePreview({ type: 'voice', content }).detail, undefined);
  for (const type of ['voice', 'file', 'unknown']) assert.ok(!JSON.stringify(messagePreview({ type, content: '{"private":"secret"}' })).includes('secret'));
});
test('actual text remains intact, reply metadata is hidden, recalled messages are safe', () => {
  assert.equal(messagePreview({ type: 'text', content: '{"example":42}' }).text, '{"example":42}');
  assert.equal(messagePreview({ type: 'text', content: '> [reply:abc] hello' }).text, '> hello');
  assert.equal(messagePreview({ type: 'file', content: 'secret', recalled: true }).text, '[消息已撤回]');
});
