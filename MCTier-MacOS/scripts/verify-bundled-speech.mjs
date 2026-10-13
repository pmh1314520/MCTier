// Verify that a built portable EXE really contains both pinned model files.
// Build-time verification only; no execution of the application or network access.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundledFileName, verifyBundledFile } from './prepare-speech-model.mjs';
import JSZip from 'jszip';
import { gunzipSync } from 'node:zlib';

const root = fileURLToPath(new URL('../', import.meta.url));
const executable = process.argv[2];
if (!executable) throw new Error('Usage: node scripts/verify-bundled-speech.mjs <MCTier.exe|MCTier.apk>');
const manifest = JSON.parse(await readFile(path.join(root, 'shared/speech-model.json'), 'utf8'));
const image = await readFile(executable);
const apk = executable.endsWith('.apk') ? await JSZip.loadAsync(image) : null;
let bundledBytes = 0;
if (apk) {
  const names = Object.keys(apk.files).filter(name => name.startsWith('assets/speech-model/') && !apk.files[name].dir).sort();
  const expected = manifest.files.map(entry => 'assets/speech-model/' + bundledFileName(entry)).sort();
  if (JSON.stringify(names) !== JSON.stringify(expected)) throw new Error('APK contains missing or obsolete model assets');
}
for (const entry of manifest.files) {
  const name = bundledFileName(entry);
  const assetPath = path.join(root, 'shared/generated/speech-model', name);
  if (!await verifyBundledFile(assetPath, entry)) throw new Error(`Invalid build asset: ${name}`);
  const bytes = apk ? await apk.file('assets/speech-model/' + name).async('nodebuffer') : await readFile(assetPath);
  bundledBytes += bytes.length;
  if (apk) {
    const raw = entry.compression === 'gzip' ? gunzipSync(bytes, { maxOutputLength: entry.size }) : bytes;
    if (raw.length !== entry.size || createHash('sha256').update(raw).digest('hex') !== entry.sha256) throw new Error(`Invalid APK asset: ${name}`);
    console.log(`${name}: ${bytes.length} bytes verified inside APK`);
    continue;
  }
  const signature = bytes.subarray(0, 64);
  let offset = image.indexOf(signature);
  let found = false;
  while (offset !== -1) {
    if (offset + bytes.length <= image.length && image.subarray(offset, offset + bytes.length).equals(bytes)) { found = true; break; }
    offset = image.indexOf(signature, offset + 1);
  }
  if (!found) throw new Error(`EXE does not contain verified ${entry.name}`);
  console.log(`${name}: ${bytes.length} bytes verified inside EXE`);
}
if (bundledBytes > manifest.maxBundledBytes) throw new Error(`Model bundle exceeds ${manifest.maxBundledBytes} bytes: ${bundledBytes}`);
console.log(`Bundled model total: ${bundledBytes} bytes; offline extraction SHA-256 verified.`);
