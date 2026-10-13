import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../src/security/trustBoundary.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;

// Older URL implementations expose non-special schemes as opaque paths.
class OpaqueNodeURL extends URL {
  get hostname() {
    return /^(tcp|udp|txt):$/.test(this.protocol) ? '' : super.hostname;
  }
}

for (const Parser of [URL, OpaqueNodeURL]) {
  const exports = {};
  vm.runInNewContext(compiled, { exports, URL: Parser });
  const { isSafeServerNode, isSafeSignalingServer } = exports;
  test(`node addresses validate with ${Parser.name}`, () => {
    for (const address of [
      'udp://us01.225284.xyz:11010', 'tcp://225284.xyz:11010',
      'tcp://easytier.weiai.org.cn:11010', 'UDP://192.168.1.2:11010',
      'tcp://[2001:db8::1]:11010', 'txt://nodes.example.com',
      'wss://relay.example.com/easytier', 'custom',
    ]) assert.equal(isSafeServerNode(address), true, address);
    assert.equal(isSafeSignalingServer('wss://mctier.pmhs.top/signaling'), true);
  });

  test(`invalid node authorities stay rejected with ${Parser.name}`, () => {
    for (const address of [
      undefined, {}, '', 'udp://', 'udp:///host', 'udp:host:11010',
      'udp://host:65536', 'tcp://host:abc', 'udp://user:secret@host',
      'tcp://host#fragment', 'tcp://host\\evil', 'udp://host\n.evil',
      'udp://host name', 'udp://[invalid]:11010', 'javascript://host',
      'file://host/path', 'https://host',
    ]) assert.equal(isSafeServerNode(address), false, String(address));
    assert.equal(isSafeSignalingServer('udp://host:11010'), false);
    assert.equal(isSafeSignalingServer('wss://user:secret@host'), false);
  });
}

test('compatibility fixture reproduces the old hostname rejection for built-in nodes', () => {
  assert.equal(new OpaqueNodeURL('udp://us01.225284.xyz:11010').hostname, '');
  assert.equal(new URL('udp://us01.225284.xyz:11010').hostname, 'us01.225284.xyz');
});
