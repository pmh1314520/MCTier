import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

test('Windows release export works through junctions and rejects incomplete or wrong-version builds', {
  skip: process.platform !== 'win32',
}, () => {
  const base = fs.existsSync('D:/文件盘扩展') ? 'D:/文件盘扩展' : os.tmpdir();
  const fixture = fs.mkdtempSync(path.join(base, 'mctier-release-test-'));
  try {
    // Do not inherit PowerShell 7's module paths when launching Windows PowerShell via Node.
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'psmodulepath'));
    const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
      fileURLToPath(new URL('./windows-release.test.ps1', import.meta.url)), '-FixtureDirectory', fixture], { encoding: 'utf8', env });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal((result.stdout.match(/PASS:/g) ?? []).length, 7);
  } finally {
    // Remove the link itself before removing only this test's unique generated directory.
    const junction = path.join(fixture, 'target', 'release');
    if (fs.existsSync(junction)) fs.unlinkSync(junction);
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});
