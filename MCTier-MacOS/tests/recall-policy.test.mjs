import test from 'node:test';
import assert from 'node:assert/strict';
import { applyMessageRecall } from '../src/services/chat/recallPolicy.ts';

const imageMessage = {
  id: 'message-1',
  playerId: 'alice',
  playerName: 'Alice',
  content: '[图片]',
  timestamp: 1_000,
  type: 'image',
  imageData: 'data:image/jpeg;base64,secret',
};

test('the original sender can recall and sensitive payload is removed', () => {
  const result = applyMessageRecall([imageMessage], 'message-1', 'alice', 1_000);
  assert.equal(result.changed, true);
  assert.deepEqual(result.messages[0], {
    ...imageMessage,
    content: '',
    type: 'text',
    imageData: undefined,
    recalled: true,
  });
});

test('another player cannot recall the message', () => {
  const messages = [imageMessage];
  const result = applyMessageRecall(messages, 'message-1', 'mallory', 1_000);
  assert.equal(result.changed, false);
  assert.equal(result.messages, messages);
  assert.equal(result.messages[0].recalled, undefined);
});

test('a message outside the recall window remains visible', () => {
  const messages = [imageMessage];
  const result = applyMessageRecall(messages, 'message-1', 'alice', 121_001);
  assert.equal(result.changed, false);
  assert.equal(result.messages, messages);
  assert.equal(result.messages[0].recalled, undefined);
});
