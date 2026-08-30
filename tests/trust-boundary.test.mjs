import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isSafeHttpUrl,
  isSafeIdentifier,
  isSafeChatToken,
  isSafeImageDataUrl,
  isSafePathSegment,
  isSafeRelativePath,
  isSafeResourceId,
  isSafeSessionId,
  isSafeServerNode,
  isSafeSignalingServer,
  isSafeVirtualDomain,
  isSafeVirtualIp,
  sanitizeTodoItems,
  sanitizeUntrustedText,
} from '../src/security/trustBoundary.ts';
import fs from 'node:fs';

const publicLobbiesSource = fs.readFileSync(new URL('../src/services/lobby/publicLobbies.ts', import.meta.url), 'utf8');
const hostPanelSource = fs.readFileSync(new URL('../src/components/HostPanel/HostPanel.tsx', import.meta.url), 'utf8');
const lobbyFormSource = fs.readFileSync(new URL('../src/components/LobbyForm/LobbyForm.tsx', import.meta.url), 'utf8');
const webRtcSource = fs.readFileSync(new URL('../src/services/webrtc/WebRTCClient.ts', import.meta.url), 'utf8');

test('endpoint validation rejects executable schemes, credentials, and control characters', () => {
  assert.equal(isSafeSignalingServer('wss://mctier.pmhs.top/signaling'), true);
  assert.equal(isSafeSignalingServer('https://mctier.pmhs.top/signaling'), false);
  assert.equal(isSafeSignalingServer('wss://user:password@example.com/signaling'), false);
  assert.equal(isSafeSignalingServer('wss://example.com/\nattack'), false);

  assert.equal(isSafeServerNode('udp://us01.225284.xyz:11010'), true);
  assert.equal(isSafeServerNode('javascript://example.com'), false);
  assert.equal(isSafeServerNode('udp://user:password@example.com:11010'), false);
  assert.equal(isSafeServerNode('custom'), true);
});

test('external link and image validation use narrow allowlists', () => {
  assert.equal(isSafeHttpUrl('https://example.com/path?q=1'), true);
  assert.equal(isSafeHttpUrl('javascript:alert(1)'), false);
  assert.equal(isSafeHttpUrl('file:///C:/secrets.txt'), false);
  assert.equal(isSafeImageDataUrl('data:image/jpeg;base64,AAECAwQ='), true);
  assert.equal(isSafeImageDataUrl('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='), false);
  assert.equal(isSafeImageDataUrl('https://example.com/avatar.png'), false);
});

test('remote text and collaboration items are bounded and typed', () => {
  assert.equal(sanitizeUntrustedText('<script>\u0000hello', 100), '<script>hello');
  assert.equal(isSafeVirtualIp('10.126.126.1'), true);
  assert.equal(isSafeVirtualIp('10.126.126.254'), true);
  assert.equal(isSafeVirtualIp('10.126.126.0'), false);
  assert.equal(isSafeVirtualIp('10.126.126.255'), false);
  assert.equal(isSafeVirtualIp('10.126.125.1'), false);
  assert.equal(isSafeVirtualIp('192.168.1.10'), false);
  assert.equal(isSafeVirtualIp('0.0.0.0'), false);
  assert.equal(isSafeVirtualIp('127.0.0.1'), false);
  assert.equal(isSafeVirtualIp('169.254.1.1'), false);
  assert.equal(isSafeVirtualIp('224.0.0.1'), false);
  assert.equal(isSafeVirtualIp('255.255.255.255'), false);
  assert.equal(isSafeVirtualIp('999.1.1.1'), false);
  assert.equal(isSafeVirtualDomain('player-1.mctier'), true);
  assert.equal(isSafeVirtualDomain('player..mctier'), false);

  const safe = sanitizeTodoItems([
    { id: 'todo-1', text: '<b>build</b>', done: false, assignee: '', creator: 'alice', ts: 1 },
    { id: 'bad', text: 42, done: false, assignee: '', creator: 'mallory', ts: 2 },
  ]);
  assert.deepEqual(safe, [{ id: 'todo-1', text: '<b>build</b>', done: false, assignee: '', creator: 'alice', ts: 1 }]);
});

test('chat credentials are fixed-size hexadecimal values', () => {
  assert.equal(isSafeChatToken('a'.repeat(64)), true);
  assert.equal(isSafeChatToken('A'.repeat(64)), true);
  assert.equal(isSafeChatToken('a'.repeat(63)), false);
  assert.equal(isSafeChatToken(`${'a'.repeat(63)}g`), false);
});

test('desktop chat and file authorization fail closed when session synchronization fails', () => {
  assert.match(webRtcSource, /failClosedChatSession[\s\S]{0,900}invoke\('stop_p2p_chat'\)/);
  assert.match(webRtcSource, /chat-token-rotated[\s\S]{0,1200}failClosedChatSession/);
  assert.match(webRtcSource, /撤销离开玩家的聊天权限失败[\s\S]{0,120}break/);
});

test('resource identifiers and relative file paths cannot change addressing', () => {
  assert.equal(isSafeIdentifier('player-1234-a1'), true);
  assert.equal(isSafeIdentifier('player/../other'), false);
  assert.equal(isSafeResourceId('share-player-1234'), true);
  assert.equal(isSafeResourceId('share/player'), false);
  assert.equal(isSafeSessionId('rc-player-1234'), true);
  assert.equal(isSafeSessionId('rc player'), false);
  assert.equal(isSafePathSegment('maps'), true);
  assert.equal(isSafePathSegment('..'), false);
  assert.equal(isSafeRelativePath('maps/world.zip'), true);
  assert.equal(isSafeRelativePath('../secrets.txt'), false);
  assert.equal(isSafeRelativePath('maps\\world.zip'), false);
});

test('public plaza never transports a lobby password', () => {
  assert.doesNotMatch(publicLobbiesSource, /^\s*password\??:/m);
  assert.match(hostPanelSource, /Public lobbies must not have a password/);
  assert.match(lobbyFormSource, /password:\s*''/);
});
