import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundled = await build({
  entryPoints: ['src/services/emoji/emojiLibrary.ts'], bundle: true, format: 'esm', write: false,
  plugins: [{ name: 'native-fixture', setup(b) {
    b.onResolve({ filter: /^(@tauri-apps\/api\/|\.\.\/chat\/imageData)/ }, args => ({ path: args.path, namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path.endsWith('/core')
      ? 'export const invoke=(...a)=>globalThis.emojiFixture.invoke(...a); export const convertFileSrc=p=>`asset:${p}`;'
      : args.path.endsWith('/event')
        ? 'export const listen=(name,cb)=>globalThis.emojiFixture.listen(name,cb);'
        : 'export const fileToChatImageDataUrl=()=>null;' }));
  } }],
});

test('failed local extraction reports once without download retries', async () => {
  const progress = [], closedProgress = [];
  let emit, calls = 0, stopCount = 0, listenerCount = 0;
  globalThis.emojiFixture = {
    listen: async (_name, cb) => { listenerCount++; emit = cb; return () => stopCount++; },
    invoke: async () => {
      calls++;
      emit({ payload: { downloaded: 0, total: 5 } });
      throw new Error('内置表情资源包已损坏');
    },
  };
  try {
    const { syncBuiltinEmojiItems } = await import(`data:text/javascript,${encodeURIComponent(bundled.outputFiles[0].text)}`);
    const controller = new AbortController();
    const first = syncBuiltinEmojiItems(false, p => closedProgress.push(p), controller.signal);
    controller.abort();
    await assert.rejects(first, /内置表情资源包已损坏/);
    await assert.rejects(syncBuiltinEmojiItems(true, p => progress.push(p)), /内置表情资源包已损坏/);
    assert.equal(calls, 2);
    assert.equal(listenerCount, 2);
    assert.equal(stopCount, 2);
    assert.equal(closedProgress.length, 1);
    assert.ok(progress.some(p => p.error?.includes('内置表情资源包已损坏')));
  } finally {
    delete globalThis.emojiFixture;
  }
});

test('startup, chat and picker share one extraction and reuse the local index', async () => {
  let calls = 0, finish;
  globalThis.emojiFixture = {
    listen: async () => () => {},
    invoke: () => { calls++; return new Promise(resolve => { finish = resolve; }); },
  };
  try {
    const { syncBuiltinEmojiItems } = await import(`data:text/javascript,${encodeURIComponent(bundled.outputFiles[0].text)}#concurrent`);
    const pending = [syncBuiltinEmojiItems(), syncBuiltinEmojiItems(), syncBuiltinEmojiItems()];
    await Promise.resolve();
    assert.equal(calls, 1);
    finish([{ id: 'builtin-a', name: 'a', path: '/local/a.gif' }]);
    const results = await Promise.all(pending);
    assert.equal(results[0], results[1]);
    assert.equal(results[0], results[2]);
    assert.equal((await syncBuiltinEmojiItems())[0].dataUrl, 'asset:/local/a.gif');
    assert.equal(calls, 1);
  } finally { delete globalThis.emojiFixture; }
});
