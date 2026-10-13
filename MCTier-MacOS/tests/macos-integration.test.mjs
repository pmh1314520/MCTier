import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const read = (relativePath) => readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');

test('macOS uses per-session authorization instead of a reusable root command channel', () => {
  const network = read('src-tauri/src/modules/network_service.rs');
  assert.match(network, /macos_privilege::start_elevated/);
  assert.match(network, /macos_privilege::mark_stop/);
  assert.match(network, /macos_privilege::cleanup/);
  assert.doesNotMatch(network, /macos_privileged_daemon|macos_daemon_tag/);
  assert.doesNotMatch(read('src-tauri/src/modules/mod.rs'), /macos_privileged_daemon/);
  assert.doesNotMatch(read('src-tauri/src/lib.rs'), /macos_privileged_daemon/);
  assert.equal(existsSync(new URL('../src-tauri/src/modules/macos_privileged_daemon.rs', import.meta.url)), false);
});

test('macOS build entrypoints resolve the isolated source root', () => {
  for (const file of ['build.sh', 'build-easytier.sh', 'fetch-binaries.sh']) {
    const script = read(`scripts/${file}`);
    assert.match(script, /ROOT="\$\(cd -- "\$\{SCRIPT_DIR\}\/\.\." && pwd\)"/);
    assert.doesNotMatch(script, /MCTier-macOS\/scripts\//);
  }
  assert.match(read('build-dmg.command'), /ROOT="\$\{SCRIPT_DIR\}"/);
  assert.match(read('scripts/build.sh'), /bash "\$\{SCRIPT_DIR\}\/fetch-binaries\.sh"/);
  assert.match(read('scripts/build.sh'), /npm test/);
});

test('macOS frontend preparation does not overwrite Android resources', () => {
  assert.doesNotMatch(read('scripts/build-file-preview.mjs'), /MCTier-Android\/app\/src\/main\/assets/);
});
