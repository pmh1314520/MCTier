import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COMMUNITY_NODE_MAX_OFFLINE_SECS,
  describeNodeFreshness,
  validateCommunityNodeAddress,
} from '../src/services/lobby/communityNodes.ts';

test('address validation accepts every EasyTier scheme the server allows', () => {
  for (const address of [
    'tcp://example.com:11010',
    'udp://example.com:11010',
    'ws://example.com',
    'wss://example.com/signaling',
    'TCP://Example.COM:11010',
  ]) {
    assert.equal(validateCommunityNodeAddress(address), null, `should accept ${address}`);
  }
});

test('address validation rejects malformed submissions before a round-trip', () => {
  for (const address of [
    '',
    '   ',
    'example.com:11010',
    'http://example.com',
    'tcp://',
    'tcp://exa mple.com:11010',
    'tcp://example.com:0',
    'tcp://example.com:70000',
  ]) {
    assert.notEqual(validateCommunityNodeAddress(address), null, `should reject ${JSON.stringify(address)}`);
  }
  assert.notEqual(validateCommunityNodeAddress(`tcp://${'a'.repeat(200)}.com:11010`), null);
});

test('freshness countdown matches the one-day server-side removal rule', () => {
  const now = 10 * COMMUNITY_NODE_MAX_OFFLINE_SECS;

  // 刚探测成功：还有完整一天
  assert.deepEqual(describeNodeFreshness(now, now), {
    offlineSecs: 0,
    secsUntilRemoval: COMMUNITY_NODE_MAX_OFFLINE_SECS,
  });

  // 掉线一小时：剩余时间同步减少
  assert.deepEqual(describeNodeFreshness(now - 3600, now), {
    offlineSecs: 3600,
    secsUntilRemoval: COMMUNITY_NODE_MAX_OFFLINE_SECS - 3600,
  });

  // 恰好一天：服务器判定为“未超过”，前端显示 0 但节点仍在
  assert.deepEqual(describeNodeFreshness(now - COMMUNITY_NODE_MAX_OFFLINE_SECS, now), {
    offlineSecs: COMMUNITY_NODE_MAX_OFFLINE_SECS,
    secsUntilRemoval: 0,
  });

  // 时间戳缺失（0）不应算出负数
  const missing = describeNodeFreshness(0, now);
  assert.equal(missing.offlineSecs, now);
  assert.equal(missing.secsUntilRemoval, 0);
});