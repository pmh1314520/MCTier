import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('release signing rejects missing identities and unsigned/tampered artifacts', {
  skip: process.platform !== 'win32',
}, () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'mctier-signing-test-'));
  try {
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'psmodulepath'));
    const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
      fileURLToPath(new URL('./release-signing.test.ps1', import.meta.url)), '-FixtureDirectory', fixture], { encoding: 'utf8', env });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal((result.stdout.match(/PASS:/g) ?? []).length, env.MCTIER_SIGNING_TEST_CONFIG ? 12 : 6);
  } finally {
    // This unique temp directory contains only this test's generated fixture files.
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});
