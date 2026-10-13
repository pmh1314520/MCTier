import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const result = await build({
  entryPoints: [fileURLToPath(new URL('../src/services/danmaku/danmakuService.ts', import.meta.url))],
  bundle: true, format: 'esm', write: false,
  plugins: [{ name: 'tauri-boundary', setup(builder) {
    builder.onResolve({ filter: /^@tauri-apps\/api\// }, args => ({ path: args.path, namespace: 'tauri-test' }));
    builder.onLoad({ filter: /.*/, namespace: 'tauri-test' }, () => ({ contents: `
      export const invoke = (...args) => globalThis.__danmakuTest.invoke(...args);
      export const convertFileSrc = path => 'asset://localhost/' + path;
      export const emitTo = (...args) => globalThis.__danmakuTest.events.push(args);
      export const listen = async () => () => {};
    ` }));
  } }],
});
globalThis.localStorage = { getItem: () => null };
const { danmakuService } = await import(`data:text/javascript,${encodeURIComponent(result.outputFiles[0].text)}`);
const attachment = { id: 'att-123456789abc', name: 'animated.gif', mime: 'image/gif', size: 43 };
const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

test('voice notifications carry bounded playable audio and reject remote URLs', async () => {
  globalThis.__danmakuTest = { events: [], invoke: async () => { assert.fail('Voice is already local'); } };
  const voice = 'data:audio/ogg;base64,T2dnUw==';
  await danmakuService.pushMessage('Player', { playerId: 'peer', type: 'voice', content: '{"mime":"audio/ogg","duration":2}', imageData: voice });
  const payload = globalThis.__danmakuTest.events[0][2];
  assert.equal(payload.kind, 'voice');
  assert.equal(payload.voice, voice);
  assert.equal(payload.image, undefined);
  for (const imageData of ['https://example.com/voice.ogg', 'data:audio/ogg;base64,' + 'A'.repeat(3 * 1024 * 1024)]) {
    await danmakuService.pushMessage('Player', { playerId: 'peer', type: 'voice', content: '{"duration":2}', imageData });
    assert.equal(globalThis.__danmakuTest.events.at(-1)[2].voice, undefined);
  }
});

test('built-in emoji notifications reuse the local index and never request a remote attachment', async () => {
  const originalFetch = globalThis.fetch, originalReader = globalThis.FileReader;
  let syncs = 0;
  globalThis.__danmakuTest = { events: [], invoke: async command => {
    assert.equal(command, 'sync_builtin_emoji');
    syncs++;
    return [{ id: 'builtin-a', name: 'a', path: 'builtin/a.gif' }];
  } };
  globalThis.fetch = async url => {
    assert.equal(url, 'asset://localhost/builtin/a.gif');
    return new Response(gif);
  };
  globalThis.FileReader = class {
    readAsDataURL(blob) { blob.arrayBuffer().then(bytes => { this.result = `data:${blob.type};base64,${Buffer.from(bytes).toString('base64')}`; this.onload(); }); }
  };
  try {
    for (let i = 0; i < 2; i++) await danmakuService.pushMessage('Player', { playerId: 'peer', type: 'text', content: 'mctier:emoji:v3:builtin-a' });
    assert.equal(syncs, 1);
    assert.equal(globalThis.__danmakuTest.events.length, 2);
    for (const event of globalThis.__danmakuTest.events) {
      assert.equal(event[2].kind, 'image');
      assert.equal(event[2].image, `data:image/gif;base64,${gif.toString('base64')}`);
      assert.ok(!event[2].text.includes('mctier:emoji'));
    }
    await danmakuService.pushMessage('Player', { playerId: 'peer', type: 'text', content: 'mctier:emoji:v3:builtin-unknown' });
    assert.match(globalThis.__danmakuTest.events[2][2].text, /内置表情/);
    assert.equal(globalThis.__danmakuTest.events[2][2].image, undefined);
  } finally { globalThis.fetch = originalFetch; globalThis.FileReader = originalReader; }
});

test('received image attachments resolve to GIF data, never wire JSON, even with octet-stream MIME', async () => {
  const originalFetch = globalThis.fetch, originalReader = globalThis.FileReader;
  const calls = [];
  globalThis.__danmakuTest = { events: [], invoke: async (...args) => { calls.push(args); return 'animated.gif'; } };
  globalThis.fetch = async url => {
    assert.equal(url, 'asset://localhost/animated.gif');
    return new Response(gif, { headers: { 'content-type': 'application/octet-stream' } });
  };
  globalThis.FileReader = class {
    readAsDataURL(blob) { blob.arrayBuffer().then(bytes => { this.result = `data:${blob.type};base64,${Buffer.from(bytes).toString('base64')}`; this.onload(); }); }
  };
  try {
    await danmakuService.pushMessage('Player', { playerId: 'peer', type: 'file', attachment, content: JSON.stringify(attachment) });
    assert.deepEqual(calls[0], ['fetch_chat_attachment', { ownerPlayerId: 'peer', attachment }]);
    const [windowName, eventName, payload] = globalThis.__danmakuTest.events[0];
    assert.equal(windowName, 'danmaku');
    assert.equal(eventName, 'danmaku-msg');
    assert.equal(payload.kind, 'image');
    assert.equal(payload.image, `data:image/gif;base64,${gif.toString('base64')}`);
    assert.ok(!payload.text.includes(attachment.id));
  } finally { globalThis.fetch = originalFetch; globalThis.FileReader = originalReader; }
});

test('failed media retrieval produces a readable fallback without leaking attachment JSON', async () => {
  globalThis.__danmakuTest = { events: [], invoke: async () => { throw new Error('Peer disconnected'); } };
  await danmakuService.pushMessage('Player', { playerId: 'peer', type: 'file', content: JSON.stringify(attachment) });
  const payload = globalThis.__danmakuTest.events[0][2];
  assert.match(payload.text, /animated.gif/);
  assert.match(payload.detail, /预览暂不可用/);
  assert.ok(!payload.text.includes(attachment.id));
  assert.deepEqual(payload.attachment, attachment);
  assert.equal(payload.ownerPlayerId, 'peer');
});

test('all attachment kinds retain original download metadata independently of thumbnails', async () => {
  for (const [name, mime] of [['song.mp3', 'audio/mpeg'], ['clip.mp4', 'video/mp4'], ['manual.pdf', 'application/pdf'], ['pack.zip', 'application/zip']]) {
    const file = { ...attachment, name, mime };
    globalThis.__danmakuTest = { events: [], invoke: async () => { throw new Error('No preview'); } };
    await danmakuService.pushMessage('Player', { playerId: 'peer', type: 'file', content: JSON.stringify(file) });
    const payload = globalThis.__danmakuTest.events.at(-1)[2];
    assert.deepEqual(payload.attachment, file);
    assert.equal(payload.ownerPlayerId, 'peer');
  }
});

test('recall, leave, or mute during attachment fetch suppresses late notifications', async () => {
  let visible = true;
  globalThis.__danmakuTest = { events: [], invoke: async () => { visible = false; throw new Error('Left'); } };
  await danmakuService.pushMessage('Player', { playerId: 'peer', type: 'file', content: JSON.stringify(attachment) }, () => visible);
  assert.equal(globalThis.__danmakuTest.events.length, 0);
});
