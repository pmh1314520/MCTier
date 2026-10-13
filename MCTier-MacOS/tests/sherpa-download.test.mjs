import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

test('Sherpa download retries preserve interrupted transfers and reject invalid completed downloads', {
  skip: process.platform !== 'win32',
}, () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'mctier-sherpa-test-'));
  try {
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'psmodulepath'));
    const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
      fileURLToPath(new URL('./sherpa-download.test.ps1', import.meta.url)), '-FixtureDirectory', fixture], { encoding: 'utf8', env });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal((result.stdout.match(/PASS:/g) ?? []).length, 3);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});
