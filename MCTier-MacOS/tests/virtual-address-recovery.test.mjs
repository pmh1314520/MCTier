import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const bundle = await build({ entryPoints: [fileURLToPath(new URL('../src/services/lobby/virtualAddressRecovery.ts', import.meta.url))], bundle: true, format: 'esm', write: false });
const { recoverVirtualAddress } = await import(`data:text/javascript,${encodeURIComponent(bundle.outputFiles[0].text)}`);
const conflict = '无法连接大厅: virtualIp 已被大厅内其他成员使用';
const lobby = { name: 'room', password: '', virtualIp: '10.126.126.20', automaticVirtualIp: true, serverNode: 'udp://relay:11010', signalingServer: 'wss://signal' };

test('a passwordless collision advances the address and retains endpoints and the original deadline', async () => {
  const calls = [];
  const restart = async attempt => { calls.push(attempt); return { ...lobby, virtualIp: `10.126.126.${20 + attempt}` }; };
  const first = await recoverVirtualAddress(lobby, conflict, restart, () => true, 1000);
  const second = await recoverVirtualAddress(first, conflict, restart, () => true, 2000);
  assert.deepEqual(calls, [1, 2]);
  assert.equal(second.addressRecoveryStartedAt, 1000);
  assert.equal(second.serverNode, lobby.serverNode);
  assert.equal(second.virtualIp, '10.126.126.22');
});

test('password errors, explicit static addresses, and cancellation never retry', async () => {
  const restart = () => assert.fail('must not restart');
  assert.equal(await recoverVirtualAddress(lobby, '密码错误', restart, () => true), null);
  assert.equal(await recoverVirtualAddress({ ...lobby, automaticVirtualIp: false }, conflict, restart, () => true), null);
  assert.equal(await recoverVirtualAddress(lobby, conflict, restart, () => false), null);
});

test('recovery is bounded by both subnet capacity and elapsed time', async () => {
  const restart = () => assert.fail('must not restart');
  await assert.rejects(recoverVirtualAddress({ ...lobby, addressAttempt: 253 }, conflict, restart, () => true));
  await assert.rejects(recoverVirtualAddress({ ...lobby, addressRecoveryStartedAt: 1000 }, conflict, restart, () => true, 61000));
});

test('a cancelled replacement is never published and native restart errors survive', async () => {
  let current = true;
  assert.equal(await recoverVirtualAddress(lobby, conflict, async () => { current = false; return lobby; }, () => current), null);
  await assert.rejects(recoverVirtualAddress(lobby, conflict, async () => { throw new Error('adapter failed'); }, () => true), /adapter failed/);
});
