import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import ts from 'typescript';
import { encodeBuiltinEmoji, decodeBuiltinEmoji } from '../src/services/emoji/builtinEmojiMessage.ts';

const entry = fileURLToPath(new URL('../src/services/chat/P2PChatService.ts', import.meta.url));
const ast = ts.createSourceFile(entry, fs.readFileSync(entry, 'utf8'), ts.ScriptTarget.Latest, true);
const stubs = new Map();
for (const node of ast.statements) if (ts.isImportDeclaration(node) && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) {
  stubs.set(node.moduleSpecifier.text, node.importClause.namedBindings.elements.filter(e => !e.isTypeOnly).map(e => `export const ${(e.propertyName ?? e.name).text}=()=>null;`).join('\n'));
}
const bundle = await build({ entryPoints: [entry], bundle: true, format: 'esm', write: false, drop: ['console'], plugins: [{ name: 'chat-fixture', setup(b) {
  b.onResolve({ filter: /.*/ }, args => args.kind === 'entry-point' || /(?:trustBoundary|recallPolicy|fileAttachment)$/.test(args.path) || args.path === 'jszip' || args.importer.includes('node_modules') ? undefined : { path: args.path, namespace: 'fixture' });
  b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path === '@tauri-apps/api/core'
    ? 'export const invoke=(...args)=>globalThis.chatFixture.invoke(...args);'
    : stubs.get(args.path) || 'export const useAppStore={getState:()=>({})};' }));
} }] });
const { p2pChatService: chat } = await import(`data:text/javascript,${encodeURIComponent(bundle.outputFiles[0].text)}`);
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

test('image transport sends optimized bytes and updates local preview with the same image', async () => {
  const f = setup();
  try {
    const optimized = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    const original = 'data:image/png;base64,' + Buffer.alloc(2 * 1024 * 1024 + 1, 42).toString('base64');
    for (const recipientId of [undefined, 'remote']) {
      const sent = [], previews = [];
      globalThis.chatFixture.invoke = async (command, args) => {
        if (command === 'prepare_chat_image') {
          assert.equal(args.imageData, original.split(',')[1]);
          assert.equal(args.recipientId, recipientId ?? null);
          return { imageDataUrl: optimized, attachment: null };
        }
        sent.push(args);
        return { delivered: 1, total: 1 };
      };
      await chat.sendImageMessage(original, '[图片]', 'image-optimized', recipientId, p => previews.push(p));
      assert.deepEqual(previews, [{ imageData: optimized }]);
      assert.equal(sent[0].messageType, 'image');
      assert.equal(sent[0].messageId, 'image-optimized');
      assert.equal(sent[0].recipientId, recipientId ?? null);
      assert.deepEqual(sent[0].imageData, [...Buffer.from(optimized.split(',')[1], 'base64')]);
    }
  } finally { await f.close(); }
});

test('large lossless images use attachments without lowering quality or losing the private recipient', async () => {
  const f = setup();
  try {
    const attachment = { id: 'att-image-large-1234', name: 'image.png', mime: 'image/png', size: 3 * 1024 * 1024 };
    const calls = [], previews = [];
    globalThis.chatFixture.invoke = async (command, args) => {
      calls.push([command, args]);
      if (command === 'prepare_chat_image') return { imageDataUrl: null, attachment };
      return { delivered: 1, total: 1 };
    };
    await chat.sendImageMessage('data:image/png;base64,iVBORw0KGgo=', '[图片]', 'image-large', 'remote', p => previews.push(p));
    assert.deepEqual(previews, [{ attachment }]);
    assert.equal(calls[1][0], 'send_p2p_chat_message');
    assert.equal(calls[1][1].messageType, 'file');
    assert.deepEqual(JSON.parse(calls[1][1].content), attachment);
    assert.equal(calls[1][1].imageData, null);
    assert.equal(calls[1][1].recipientId, 'remote');
    assert.equal(calls[1][1].messageId, 'image-large');
  } finally { await f.close(); }
});

test('failed optimization preparation does not send or display a broken image', async () => {
  const f = setup();
  try {
    globalThis.chatFixture.invoke = async command => { assert.equal(command, 'prepare_chat_image'); throw new Error('cache unavailable'); };
    await assert.rejects(chat.sendImageMessage('data:image/png;base64,iVBORw0KGgo=', '[图片]', 'image-fail', undefined, () => assert.fail('must not display')), /cache unavailable/);
  } finally { await f.close(); }
});

test('zero delivery reports failure for both inline and attachment images', async () => {
  const f = setup();
  try {
    for (const attachment of [null, { id: 'att-image-large-1234', name: 'image.png', mime: 'image/png', size: 3000000 }]) {
      globalThis.chatFixture.invoke = async command => command === 'prepare_chat_image'
        ? { imageDataUrl: 'data:image/gif;base64,R0lGODlh', attachment }
        : { total: 1, delivered: 0 };
      await assert.rejects(chat.sendImageMessage('data:image/png;base64,iVBORw0KGgo=', '[图片]', 'image-failed'), /未送达/);
    }
  } finally { await f.close(); }
});

test('voice bytes finishing after a lobby switch cannot be sent to the new lobby', async () => {
  const f = setup();
  try {
    let complete;
    const blob = { type: 'audio/ogg', arrayBuffer: () => new Promise(resolve => { complete = resolve; }) };
    globalThis.chatFixture.invoke = async () => assert.fail('old recording must not send');
    const pending = chat.sendVoiceMessage(blob, 1, 'old-voice');
    chat.reset(); complete(new ArrayBuffer(4));
    await assert.rejects(pending, /聊天会话已变化/);
  } finally { await f.close(); }
});

test('switching lobby during compression cancels the old image before sending', async () => {
  const f = setup();
  try {
    let complete;
    globalThis.chatFixture.invoke = async command => {
      assert.equal(command, 'prepare_chat_image');
      return new Promise(resolve => { complete = resolve; });
    };
    const pending = chat.sendImageMessage('data:image/png;base64,iVBORw0KGgo=', '[图片]', 'old-image', undefined, () => assert.fail('must not display old image'));
    chat.reset();
    complete({ imageDataUrl: 'data:image/gif;base64,R0lGODlh', attachment: null });
    await assert.rejects(pending, /聊天会话已变化/);
  } finally { await f.close(); }
});

test('built-in emoji uses text transport without GIF bytes for public and private chat', async () => {
  const f = setup();
  try {
    const content = encodeBuiltinEmoji('builtin-a_B-9');
    for (const recipientId of [undefined, 'remote']) {
      globalThis.chatFixture.invoke = async (command, args) => {
        assert.equal(command, 'send_p2p_chat_message');
        assert.equal(args.messageType, 'text');
        assert.equal(args.content, content);
        assert.equal(args.imageData, null);
        assert.equal(args.recipientId, recipientId ?? null);
        return { delivered: 1, total: 1 };
      };
      assert.deepEqual(await chat.sendTextMessage(content, 'emoji-message', recipientId), { delivered: 1, total: 1 });
    }
    globalThis.chatFixture.invoke = async () => [{ ...message('incoming-emoji'), content }];
    await chat.reconcileHistory();
    assert.equal(decodeBuiltinEmoji(f.received[0].content), 'builtin-a_B-9');
    assert.equal(f.received[0].type, 'text');
  } finally { await f.close(); }
});
const message = id => ({ id, player_id: 'remote', player_name: 'Phone', message_type: 'text', content: 'hello', timestamp: 100 });

function setup() {
  let next = 1;
  const timers = new Map(), streams = [], received = [];
  const original = { window: globalThis.window, fetch: globalThis.fetch, clearTimeout: globalThis.clearTimeout };
  globalThis.window = { setTimeout: fn => { const id = next++; timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id),
    setInterval: fn => { const id = next++; timers.set(id, fn); return id; }, clearInterval: id => timers.delete(id) };
  globalThis.clearTimeout = globalThis.window.clearTimeout;
  globalThis.fetch = (_url, options) => new Promise((_resolve, reject) => {
    streams.push(options.signal);
    options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });
  globalThis.chatFixture = { invoke: async () => [] };
  chat.reset(); chat.initialize(['10.126.126.2'], 'self', '10.126.126.1'); chat.onMessage(m => received.push(m));
  chat.setChatToken('a'.repeat(64)); chat.startPolling();
  return { timers, streams, received, close: async () => { chat.reset(); await flush(); Object.assign(globalThis, original); } };
}

test('token rotation retains history recovery and delivers once even when SSE is silent', async () => {
  const f = setup();
  try {
    chat.setChatToken('b'.repeat(64));
    assert.ok(chat.historyReconcileTimer);
    assert.ok(chat.streamWatchdog);
    assert.equal(f.streams[0].aborted, true);
    globalThis.chatFixture.invoke = async () => [message('message-one')];
    await chat.reconcileHistory(); await chat.reconcileHistory();
    assert.equal(f.received.length, 1);
  } finally { await f.close(); }
});

test('stalled stream is replaced without waiting for a network close event', async () => {
  const f = setup();
  try {
    chat.lastStreamActivity = Date.now() - 46000;
    f.timers.get(chat.streamWatchdog)();
    assert.equal(f.streams[0].aborted, true);
    assert.equal(f.streams.length, 2);
  } finally { await f.close(); }
});

test('old lobby history completion cannot enter the new lobby or clear its in-flight request', async () => {
  const f = setup();
  try {
    let finishOld, finishNew;
    globalThis.chatFixture.invoke = () => new Promise(resolve => { finishOld = resolve; });
    const old = chat.reconcileHistory();
    chat.reset(); chat.initialize([], 'new-self', '10.126.126.3'); chat.onMessage(m => f.received.push(m));
    chat.setChatToken('c'.repeat(64)); chat.startPolling();
    globalThis.chatFixture.invoke = () => new Promise(resolve => { finishNew = resolve; });
    const current = chat.reconcileHistory();
    finishOld([message('old-message')]); await old;
    assert.equal(f.received.length, 0);
    assert.equal(chat.historyReconcileInFlight, true);
    finishNew([]); await current;
  } finally { await f.close(); }
});

test('periodic full recovery does not let a fast peer clock permanently hide messages', async () => {
  const f = setup();
  try {
    chat.historySince = 999999;
    chat.lastFullHistory = Date.now() - 31000;
    globalThis.chatFixture.invoke = async (_command, args) => { assert.equal(args.since, null); return [message('slow-peer-message')]; };
    await chat.reconcileHistory();
    assert.equal(f.received.length, 1);
  } finally { await f.close(); }
});

test('full history across multiple peers does not replay more than 1000 older messages', async () => {
  const f = setup();
  try {
    globalThis.chatFixture.invoke = async () => Array.from({ length: 1500 }, (_, i) => message(`history-${i}`));
    for (let round = 0; round < 3; round++) {
      chat.lastFullHistory = 0;
      await chat.reconcileHistory();
    }
    assert.equal(f.received.length, 1500);
  } finally { await f.close(); }
});
