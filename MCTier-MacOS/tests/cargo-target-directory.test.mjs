import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveCargoTargetDirectory } from '../scripts/cargo-target-directory.mjs';

test('Cargo release cache resolves nested junctions to its physical directory without moving files', { skip: process.platform !== 'win32' }, () => {
  const root = fs.mkdtempSync(path.join(fs.existsSync('D:/文件盘扩展') ? 'D:/文件盘扩展' : os.tmpdir(), 'mctier-cargo-path-'));
  try {
    const target = path.join(root, 'project', 'target');
    const physical = path.join(root, 'physical-cache');
    const intermediate = path.join(root, 'old-cache-location');
    fs.mkdirSync(target, { recursive: true });
    fs.mkdirSync(path.join(physical, 'release'), { recursive: true });
    fs.writeFileSync(path.join(physical, 'release', 'sentinel'), 'preserve');
    fs.symlinkSync(physical, intermediate, 'junction');
    fs.symlinkSync(path.join(intermediate, 'release'), path.join(target, 'release'), 'junction');
    assert.equal(resolveCargoTargetDirectory(target), fs.realpathSync.native(physical));
    assert.equal(fs.readFileSync(path.join(physical, 'release', 'sentinel'), 'utf8'), 'preserve');
    assert.ok(fs.lstatSync(path.join(target, 'release')).isSymbolicLink());

    const fresh = path.join(root, 'fresh-target');
    assert.equal(resolveCargoTargetDirectory(fresh), fresh);
    assert.equal(fs.existsSync(fresh), false);

    fs.unlinkSync(path.join(target, 'release'));
    fs.symlinkSync(path.join(root, 'missing-cache'), path.join(target, 'release'), 'junction');
    assert.throws(() => resolveCargoTargetDirectory(target), /ENOENT/);
    fs.unlinkSync(path.join(target, 'release'));
    fs.writeFileSync(path.join(target, 'release'), 'not a directory');
    assert.throws(() => resolveCargoTargetDirectory(target), /not a directory/);
    assert.equal(fs.readFileSync(path.join(target, 'release'), 'utf8'), 'not a directory');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('explicit cross target retains its triple in the physical output layout', { skip: process.platform !== 'win32' }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mctier-cargo-triple-'));
  try {
    const triple = 'x86_64-pc-windows-msvc';
    const target = path.join(root, 'target');
    const physical = path.join(root, 'cache');
    fs.mkdirSync(path.join(target, triple), { recursive: true });
    fs.mkdirSync(path.join(physical, triple, 'release'), { recursive: true });
    fs.symlinkSync(path.join(physical, triple, 'release'), path.join(target, triple, 'release'), 'junction');
    assert.equal(resolveCargoTargetDirectory(target, triple), fs.realpathSync.native(physical));
    fs.unlinkSync(path.join(target, triple, 'release'));
    fs.mkdirSync(path.join(physical, 'release'));
    fs.symlinkSync(path.join(physical, 'release'), path.join(target, triple, 'release'), 'junction');
    assert.throws(() => resolveCargoTargetDirectory(target, triple), /does not preserve/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
