import test from 'node:test';
import assert from 'node:assert/strict';
import { isComposingKeyEvent, shouldSubmitOnEnter } from '../src/utils/imeSubmitPolicy.ts';

test('plain Enter submits', () => {
  assert.equal(shouldSubmitOnEnter({ key: 'Enter' }), true);
  assert.equal(shouldSubmitOnEnter({ key: 'Enter', isComposing: false, keyCode: 13 }), true);
});

test('Shift+Enter never submits so newlines still work', () => {
  assert.equal(shouldSubmitOnEnter({ key: 'Enter', shiftKey: true }), false);
});

test('IME composition swallows the Enter that confirms a candidate', () => {
  // 中文候选词面板打开时的回车属于输入法，不能发消息。
  assert.equal(shouldSubmitOnEnter({ key: 'Enter', isComposing: true }), false);
  assert.equal(shouldSubmitOnEnter({ key: 'Enter', keyCode: 229 }), false);
  assert.equal(shouldSubmitOnEnter({ key: 'Enter', composingSession: true }), false);
});

test('keyCode 229 is caught even when isComposing already flipped to false', () => {
  // fcitx5 / 部分 IME 在确认候选词时 isComposing 已是 false，只剩 keyCode 229 可判。
  assert.equal(isComposingKeyEvent({ key: 'Enter', isComposing: false, keyCode: 229 }), true);
  assert.equal(shouldSubmitOnEnter({ key: 'Enter', isComposing: false, keyCode: 229 }), false);
});

test('non-Enter keys never submit', () => {
  for (const key of ['Tab', 'Escape', 'a', 'ArrowDown', ' ']) {
    assert.equal(shouldSubmitOnEnter({ key }), false);
  }
});

test('a finished composition session submits again', () => {
  assert.equal(shouldSubmitOnEnter({ key: 'Enter', composingSession: false, isComposing: false, keyCode: 13 }), true);
});
