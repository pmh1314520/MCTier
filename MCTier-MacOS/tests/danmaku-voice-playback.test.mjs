import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { safeVoiceUrl } from '../src/services/chat/voiceMessage.ts';

// Execute the actual overlay callbacks while replacing only the browser audio API.
const file = 'src/components/Danmaku/DanmakuOverlay.tsx';
const ast = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const callbacks = new Map();
function visit(node) {
  if (ts.isVariableDeclaration(node) && ['stopVoice', 'doPlayVoice', 'activateBullet'].includes(node.name.getText(ast))) callbacks.set(node.name.getText(ast), node.initializer.getText(ast));
  ts.forEachChild(node, visit);
}
visit(ast);
const script = ts.transpileModule(`const stopVoice=${callbacks.get('stopVoice')}; const doPlayVoice=${callbacks.get('doPlayVoice')}; globalThis.play=doPlayVoice;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const voice = 'data:audio/ogg;base64,T2dnUw==';
function fixture() {
  const players = [], released = [], toasts = [];
  const context = vm.createContext({ voicePlayer: { current: null }, useCallback: fn => fn, safeVoiceUrl,
    tl: zh => zh, showToast: text => toasts.push(text), releaseAfterAction: id => released.push(id),
    Audio: class {
      constructor(src) { this.src = src; players.push(this); }
      async play() { this.playing = true; }
      pause() { this.playing = false; }
      removeAttribute(name) { delete this[name]; }
      load() { this.cleaned = true; }
    },
  });
  vm.runInContext(script, context);
  return { context, players, released, toasts };
}

test('voice action plays actual audio, resumes the bullet and replaces earlier playback', async () => {
  const f = fixture(); await f.context.play({ id: 1, voice });
  assert.equal(f.players[0].src, voice); assert.equal(f.players[0].playing, true);
  assert.deepEqual(f.released, [1]);
  await f.context.play({ id: 2, voice });
  assert.equal(f.players[0].playing, false); assert.equal(f.players[0].cleaned, true);
  assert.equal(f.players[1].playing, true);
  f.players[1].onended();
  assert.equal(f.context.voicePlayer.current, null);
  assert.equal(f.players[1].onerror, null);
  assert.deepEqual(f.toasts, []);
});

test('missing or remote audio never causes an external request', async () => {
  const f = fixture();
  for (const source of [undefined, 'https://example.com/voice.ogg']) await f.context.play({ id: 1, voice: source });
  assert.equal(f.players.length, 0); assert.equal(f.toasts.length, 2);
});

test('playback errors release audio resources and show feedback', async () => {
  const f = fixture(); await f.context.play({ id: 1, voice });
  f.players[0].onerror();
  assert.equal(f.context.voicePlayer.current, null); assert.equal(f.players[0].cleaned, true);
  assert.match(f.toasts[0], /播放失败/);
});

test('direct click dispatches every message kind and ignores repeated clicks before completion', () => {
  const actions = [], seen = new Set();
  const context = vm.createContext({ actionedRef: { current: seen },
    releaseAfterAction: id => seen.add(id),
    doCopy: b => actions.push(['copy', b.id]), doPlayVoice: b => actions.push(['play', b.id]),
    doDownload: b => actions.push(['download', b.id]),
  });
  vm.runInContext(ts.transpileModule(`globalThis.activate=${callbacks.get('activateBullet')}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, context);
  const kinds = ['text', 'voice', 'image', 'file', 'audio', 'video', 'unknown'];
  kinds.forEach((kind, id) => { context.activate({ kind, id }); context.activate({ kind, id }); });
  context.activate({ id: 7, kind: 'unknown', attachment: { name: 'archive.zip' } });
  assert.deepEqual(actions, [['copy', 0], ['play', 1], ['download', 2], ['download', 3], ['download', 4], ['download', 5], ['copy', 6], ['download', 7]]);
});
