import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const bundle = await build({
  entryPoints: ['src/services/quarkSupport.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  plugins: [
    {
      name: 'quark-ipc',
      setup(b) {
        b.onResolve({ filter: /^(@tauri-apps\/api\/core|react)$/ }, (args) => ({
          path: args.path,
          namespace: 'stub',
        }));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({
          contents:
            args.path === 'react'
              ? 'export const useSyncExternalStore=(_subscribe,snapshot)=>snapshot();'
              : 'export const invoke=(...args)=>globalThis.__quarkTestInvoke(...args);',
        }));
      },
    },
  ],
});
let fixture = 0;
async function setup() {
  const calls = [];
  globalThis.__quarkTestInvoke = (command, args) =>
    new Promise((resolve, reject) => calls.push({ command, args, resolve, reject }));
  const api = await import(
    `data:text/javascript,${encodeURIComponent(bundle.outputFiles[0].text + `\n// fixture ${++fixture}`)}`
  );
  return { api, calls };
}
const loggedOut = {
  loggedIn: false,
  name: '',
  enabled: false,
  dismissed: false,
  result: '',
  qrUrl: null,
  loginId: null,
  expiresIn: 0,
  stats: {
    successDays: 0,
    pcReferenceCents: 0,
    mobileReferenceCents: 0,
    firstDay: null,
    lastDay: null,
    todayAttempted: false,
  },
};

test('UI startup runs once without opening login; native service owns scheduling', async () => {
  const { api, calls } = await setup();
  const first = api.startQuarkSupport();
  const second = api.startQuarkSupport();
  assert.equal(first, second);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, { action: 'startup_status', loginId: null });
  calls[0].resolve(loggedOut);
  await first;
  assert.equal(api.useQuarkSupport().enabled, false);
});
test('a late poll response cannot undo a newer logout in the UI', async () => {
  const { api, calls } = await setup();
  const poll = api.quarkSupport('poll', 'old-id');
  const logout = api.quarkSupport('logout');
  calls[1].resolve(loggedOut);
  await logout;
  calls[0].resolve({ ...loggedOut, loggedIn: true, name: 'old-user' });
  await poll;
  assert.equal(api.useQuarkSupport().loggedIn, false);
  assert.equal(calls[0].args.loginId, 'old-id');
});
test('failed commands preserve the last confirmed state; startup failure is quiet', async () => {
  const { api, calls } = await setup();
  const transfer = api.quarkSupport('daily');
  calls[0].reject(new Error('storage unavailable'));
  await assert.rejects(transfer, /storage unavailable/);
  assert.equal(api.useQuarkSupport().stats.successDays, 0);
  const startup = api.startQuarkSupport();
  calls[1].reject(new Error('offline'));
  await assert.doesNotReject(startup);
});
test('only a confirmed native result can update support records', async () => {
  const { api, calls } = await setup();
  const transfer = api.quarkSupport('daily');
  assert.equal(api.useQuarkSupport().stats.successDays, 0);
  assert.equal(calls[0].args.action, 'daily');
  calls[0].resolve({
    ...loggedOut,
    loggedIn: true,
    stats: { ...loggedOut.stats, successDays: 2, pcReferenceCents: 44, mobileReferenceCents: 94 },
  });
  await transfer;
  assert.equal(api.useQuarkSupport().stats.successDays, 2);
  assert.equal(api.useQuarkSupport().stats.pcReferenceCents, 44);
});

test('UI startup verifies an existing account; revoked login reaches the UI', async () => {
  const { api, calls } = await setup();
  const startup = api.startQuarkSupport();
  calls[0].resolve({ ...loggedOut, loggedIn: true, name: 'alice' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].args, { action: 'verify', loginId: null });
  calls[1].resolve({ ...loggedOut, result: '登录已失效，请重新扫码' });
  await startup;
  assert.equal(api.useQuarkSupport().loggedIn, false);
});
test('a failed startup verification preserves the cached login', async () => {
  const { api, calls } = await setup();
  const startup = api.startQuarkSupport();
  calls[0].resolve({ ...loggedOut, loggedIn: true, name: 'alice' });
  await new Promise((resolve) => setImmediate(resolve));
  calls[1].reject(new Error('offline'));
  await startup;
  assert.equal(api.useQuarkSupport().loggedIn, true);
});


test('local startup resolves before slow online verification finishes', async () => {
  const { api, calls } = await setup();
  const startup = api.startQuarkSupport();
  const local = api.loadQuarkSupport();
  assert.equal(calls.length, 1);
  calls[0].resolve({ ...loggedOut, loggedIn: true, name: 'alice' });
  await local;
  assert.equal(api.getQuarkSupportSnapshot().ready, true);
  assert.equal(api.getQuarkSupportSnapshot().loggedIn, true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls[1].args.action, 'verify');
  // The initial local read is already usable while the network request is pending.
  assert.equal(api.loadQuarkSupport(), local);
  calls[1].reject(new Error('offline'));
  await startup;
});
