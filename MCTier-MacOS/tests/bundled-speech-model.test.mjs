import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { prepareSpeechModel, verifyModelFile, verifyBundledFile } from '../scripts/prepare-speech-model.mjs';
import { gunzipSync } from 'node:zlib';

test('build preparation reuses verified local files and repairs corruption without network', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mctier-model-test-'));
  try {
    const source = path.join(root, 'source'), output = path.join(root, 'output');
    await mkdir(source);
    const bytes = Buffer.from('offline-model-fixture');
    const entry = { name: 'model.int8.onnx', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
    // This deliberately invalid URL makes accidental network fallback fail immediately.
    const manifest = { files: [entry], baseUrl: 'no-network' };
    await writeFile(path.join(source, entry.name), bytes);
    await prepareSpeechModel(manifest, output, source);
    assert.deepEqual(await readFile(path.join(output, entry.name)), bytes);
    await prepareSpeechModel(manifest, output);
    await writeFile(path.join(output, entry.name), Buffer.alloc(bytes.length));
    assert.equal(await verifyModelFile(path.join(output, entry.name), entry), false);
    await prepareSpeechModel(manifest, output, source);
    assert.equal(await verifyModelFile(path.join(output, entry.name), entry), true);
    assert.deepEqual(await readdir(output), [entry.name]);
    await assert.rejects(prepareSpeechModel({ ...manifest, files: [{ ...entry, name: '../escape' }] }, output));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('gzip assets are bounded, verified, repaired offline and do not bundle raw copies', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mctier-model-gzip-'));
  try {
    const source = path.join(root, 'source'), output = path.join(root, 'output');
    await mkdir(source); await mkdir(output);
    const bytes = Buffer.from('offline compressed model '.repeat(100));
    const entry = { name: 'model.int8.onnx', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), compression: 'gzip' };
    const manifest = { files: [entry], baseUrl: 'no-network', maxBundledBytes: 1000 };
    await writeFile(path.join(source, entry.name), bytes);
    await writeFile(path.join(output, entry.name), 'obsolete large model');
    await prepareSpeechModel(manifest, output, source);
    const compressed = path.join(output, entry.name + '.gzip');
    assert.deepEqual(await readdir(output), [entry.name + '.gzip']);
    assert.deepEqual(gunzipSync(await readFile(compressed)), bytes);
    await prepareSpeechModel(manifest, output);
    const good = await readFile(compressed);
    await writeFile(compressed, good.subarray(0, good.length - 5));
    assert.equal(await verifyBundledFile(compressed, entry), false);
    await prepareSpeechModel(manifest, output, source);
    assert.equal(await verifyBundledFile(compressed, { ...entry, size: 1 }), false);
    await assert.rejects(prepareSpeechModel({ ...manifest, maxBundledBytes: 1 }, output), /exceeds/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('production speech manifest pins the small Chinese model and a strict bundle limit', async () => {
  const manifest = JSON.parse(await readFile(new URL('../shared/speech-model.json', import.meta.url), 'utf8'));
  assert.equal(manifest.id, 'zipformer-ctc-zh-int8-2025-04-01');
  assert.equal(manifest.maxBundledBytes, 20_100_000);
  assert.equal(manifest.files[0].compression, 'gzip');
  assert.ok(!manifest.baseUrl.includes('/main/'));
});
