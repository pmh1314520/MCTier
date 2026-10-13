import test from 'node:test';
import assert from 'node:assert/strict';
import { mockIPC } from '@tauri-apps/api/mocks';
import {
  buildLobbyInviteLink,
  formatLobbyInviteText,
  parseLobbyInviteLink,
  parseLobbyInviteText,
} from '../src/services/lobby/lobbyInvite.ts';

const invite = {
  name: '测试 Lobby + 1',
  password: 'Abc+123456',
  serverNode: 'udp://us01.225284.xyz:11010',
  signalingServer: 'wss://test.pmhs.top',
};
const sealed = 'mctier-invite-v3:AAABBBCCC';
globalThis.window = {};
mockIPC((command, args) => {
  assert.equal(command, 'export_lobby_password');
  assert.equal(args.password, invite.password);
  return sealed;
});

test('v3 lobby links carry encrypted credentials and preserve connection data', async () => {
  const link = await buildLobbyInviteLink(invite);
  assert.ok(!link.includes('pwd=') && !link.includes(invite.password));
  assert.deepEqual(parseLobbyInviteLink(link), { ...invite, password: sealed });
});

test('legacy links remain supported without changing preferences', () => {
  assert.deepEqual(parseLobbyInviteLink('mctier://join?name=Old+Lobby&pwd=Abc12345'), {
    name: 'Old Lobby',
    password: 'Abc12345',
    serverNode: undefined,
    signalingServer: undefined,
  });
});

test('Chinese and English shared text omit plaintext and parse connection endpoints', async () => {
  for (const language of ['zh', 'en']) {
    const text = await formatLobbyInviteText(invite, language);
    assert.ok(!text.includes(invite.password));
    assert.deepEqual(parseLobbyInviteText(text), { ...invite, password: sealed });
  }
});

test('invalid modern invitations cannot fall back to plaintext fields', () => {
  assert.equal(parseLobbyInviteText('大厅名称：Lobby123\n密码：Secret123\nmctier://join?v=3&name=Lobby123&secret=invalid'), null);
  assert.equal(parseLobbyInviteLink('mctier://join?v=4&name=Lobby123&pwd=Secret123'), null);
});

test('legacy pipe-separated clipboard text remains supported', () => {
  assert.deepEqual(parseLobbyInviteText('LegacyLobby|Abc12345'), {
    name: 'LegacyLobby',
    password: 'Abc12345',
  });
});
