import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const bundle = await build({ entryPoints: [fileURLToPath(new URL('../src/services/lobby/savedLobbyIdentity.ts', import.meta.url))], bundle: true, format: 'esm', write: false });
const { savedLobbyPlayerName, selectSavedLobbyPlayerName } = await import(`data:text/javascript,${encodeURIComponent(bundle.outputFiles[0].text)}`);

test('legacy favorites cannot migrate a known password into the player name', () => {
  assert.equal(savedLobbyPlayerName('Secret12', 'Secret12'), '');
  assert.equal(savedLobbyPlayerName(' Secret12 ', 'Secret12'), '');
  assert.equal(savedLobbyPlayerName('Alice', 'Secret12'), 'Alice');
  assert.equal(savedLobbyPlayerName('long-password-value'), '');
  assert.equal(savedLobbyPlayerName(undefined), '');
});

test('selecting favorites or recent lobbies preserves the active player identity', () => {
  assert.equal(selectSavedLobbyPlayerName('Bob', 'Secret12', 'Alice'), 'Bob');
  assert.equal(selectSavedLobbyPlayerName('', 'Secret12', 'Alice'), 'Alice');
  assert.equal(selectSavedLobbyPlayerName('', 'Bob', ''), 'Bob');
  assert.equal(selectSavedLobbyPlayerName('', undefined, ''), '');
});
