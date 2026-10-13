import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { build } from 'esbuild';

const bundle = await build({
  entryPoints: ['src/services/quarkMobileLogin.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
});
const { quarkMobileTicket } = await import(
  `data:text/javascript,${encodeURIComponent(bundle.outputFiles[0].text)}`
);
const ticket = 'a'.repeat(32);

test('desktop accepts only a valid CAS ticket from the current official login frame', () => {
  const frame = {};
  const message = { origin: 'https://uop.quark.cn', source: frame, data: ticket };
  assert.equal(quarkMobileTicket(message, frame), ticket);
  for (const origin of [
    'null',
    'http://uop.quark.cn',
    'https://uop.quark.cn.evil.test',
    'https://pan.quark.cn',
  ]) {
    assert.equal(quarkMobileTicket({ ...message, origin }, frame), null);
  }
  assert.equal(quarkMobileTicket({ ...message, source: {} }, frame), null);
  assert.equal(quarkMobileTicket(message, null), null);
  for (const data of [
    { st: ticket },
    '1234',
    'a'.repeat(33),
    ticket + '\n',
    `${'a'.repeat(31)}\n`,
  ]) {
    assert.equal(quarkMobileTicket({ ...message, data }, frame), null);
  }
});

function androidBridge() {
  const html = readFileSync('../MCTier-Android/app/src/main/assets/quark-mobile-login.html', 'utf8');
  const program = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const frame = { contentWindow: {} };
  let receive;
  vm.runInNewContext(program, {
    document: { getElementById: () => frame },
    window: {
      addEventListener: (_name, callback) => {
        receive = callback;
      },
    },
  });
  return { frame, receive };
}

test('Android bridge buffers a genuine ticket until the native channel arrives', () => {
  const { frame, receive } = androidBridge();
  const messages = [];
  receive({ origin: 'https://uop.quark.cn', source: frame.contentWindow, data: ticket, ports: [] });
  assert.deepEqual(messages, []);
  receive({
    source: null,
    data: 'quark-login-channel',
    ports: [{ postMessage: (value) => messages.push(value) }],
  });
  assert.deepEqual(messages, [ticket]);
});

test('Android rejects foreign senders, forged channels and malformed tickets', () => {
  const { frame, receive } = androidBridge();
  const messages = [];
  const port = { postMessage: (value) => messages.push(value) };
  receive({ source: frame.contentWindow, data: 'quark-login-channel', ports: [port] });
  receive({ source: null, data: 'quark-login-channel', ports: [port] });
  for (const event of [
    { origin: 'https://uop.quark.cn.evil.test', source: frame.contentWindow, data: ticket },
    { origin: 'https://uop.quark.cn', source: {}, data: ticket },
    { origin: 'https://uop.quark.cn', source: frame.contentWindow, data: { st: ticket } },
  ])
    receive({ ...event, ports: [] });
  assert.deepEqual(messages, []);
  receive({ origin: 'https://uop.quark.cn', source: frame.contentWindow, data: ticket, ports: [] });
  assert.deepEqual(messages, [ticket]);
});
