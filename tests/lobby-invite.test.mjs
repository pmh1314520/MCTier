import test from 'node:test';
import assert from 'node:assert/strict';
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

test('v2 lobby links round-trip node and signaling data', () => {
  assert.deepEqual(parseLobbyInviteLink(buildLobbyInviteLink(invite)), invite);
});

test('legacy links remain supported without changing preferences', () => {
  assert.deepEqual(parseLobbyInviteLink('mctier://join?name=Old+Lobby&pwd=Abc12345'), {
    name: 'Old Lobby',
    password: 'Abc12345',
    serverNode: undefined,
    signalingServer: undefined,
  });
});

test('Chinese and English shared text include and parse connection endpoints', () => {
  assert.deepEqual(parseLobbyInviteText(formatLobbyInviteText(invite, 'zh')), invite);
  assert.deepEqual(parseLobbyInviteText(formatLobbyInviteText(invite, 'en')), invite);
});

test('legacy pipe-separated clipboard text remains supported', () => {
  assert.deepEqual(parseLobbyInviteText('LegacyLobby|Abc12345'), {
    name: 'LegacyLobby',
    password: 'Abc12345',
  });
});
