import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const launcher = fileURLToPath(new URL('../../一键更新MCTier版本.bat', import.meta.url));
// The workspace launcher lives above this Git repository; standalone clones may not have it.
test('actual BAT entrypoint loads hashing modules and reports success/failure correctly', { skip: process.platform !== 'win32' || !fs.existsSync(launcher) }, () => {
  const base = fs.existsSync('D:/文件盘扩展') ? 'D:/文件盘扩展' : os.tmpdir();
  const fixture = fs.mkdtempSync(path.join(base, 'mctier-bat-test-'));
  try {
    // Use the real launcher, but a bounded payload in place of the full release build.
    fs.copyFileSync(launcher, path.join(fixture, 'launch.bat'));
    fs.writeFileSync(path.join(fixture, 'update_version.ps1'), `
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -ne 5) { throw 'Expected Windows PowerShell 5.1' }
$hash = Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256
if ($hash.Hash.Length -ne 64) { throw 'Invalid SHA256' }
Write-Output 'PASS: Windows PowerShell hashing works through BAT'
exit 0
`);
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'psmodulepath'));
    env.PSModulePath = path.join(fixture, 'foreign-powershell-modules');
    fs.mkdirSync(env.PSModulePath);
    const result = spawnSync('cmd.exe', ['/d', '/c', 'launch.bat'], { cwd: fixture, env, encoding: 'utf8', timeout: 20000, input: '\r\n' });
    assert.equal(result.status, 0, `${result.error ?? ''}\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /PASS: Windows PowerShell hashing works through BAT/);
    const child = path.join(fixture, 'source');
    fs.mkdirSync(child);
    const relative = spawnSync('cmd.exe', ['/d', '/c', 'call ..\\launch.bat'], { cwd: child, env, encoding: 'utf8', timeout: 20000, input: '\r\n' });
    assert.equal(relative.status, 0, `${relative.error ?? ''}\n${relative.stdout}\n${relative.stderr}`);
    assert.match(relative.stdout, /PASS: Windows PowerShell hashing works through BAT/);
    fs.writeFileSync(path.join(fixture, 'update_version.ps1'), 'exit 7\r\n');
    const failed = spawnSync('cmd.exe', ['/d', '/c', 'launch.bat'], { cwd: fixture, env, encoding: 'utf8', timeout: 20000, input: '\r\n' });
    assert.equal(failed.status, 1, `${failed.error ?? ''}\n${failed.stdout}\n${failed.stderr}`);
    assert.match(failed.stdout, /打包或版本更新失败/);
    assert.equal(failed.stderr.trim(), '', 'UTF-8 BAT failure branch must not be parsed as broken commands');
  } finally { fs.rmSync(fixture, { recursive: true, force: true }); }
});
