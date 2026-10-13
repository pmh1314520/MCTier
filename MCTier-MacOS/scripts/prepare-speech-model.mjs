// Build-time only. Both release formats carry the same verified model bytes.
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, stat, copyFile, rename, rm } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createGzip, createGunzip } from 'node:zlib';

// Android's asset merger transparently expands files ending in .gz.
export const bundledFileName = (entry) => entry.name + (entry.compression === 'gzip' ? '.gzip' : '');

export async function verifyBundledFile(file, entry) {
  if (!entry.compression) return verifyModelFile(file, entry);
  if (entry.compression !== 'gzip') return false;
  const source = createReadStream(file);
  const decoder = createGunzip();
  let size = 0;
  const hash = createHash('sha256');
  try {
    await pipeline(source, decoder, new Transform({ transform(chunk, encoding, done) {
      size += chunk.length;
      hash.update(chunk);
      done(size > entry.size ? new Error('Model expands beyond manifest') : null);
    } }));
    return size === entry.size && hash.digest('hex') === entry.sha256;
  } catch { return false; }
}

export async function verifyModelFile(file, entry) {
  try {
    if ((await stat(file)).size !== entry.size) return false;
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    return hash.digest('hex') === entry.sha256;
  } catch { return false; }
}

export async function prepareSpeechModel(manifest, output, sourceDirectory) {
  await mkdir(output, { recursive: true });
  for (const entry of manifest.files) {
    if (!/^[a-zA-Z0-9._-]+$/.test(entry.name) || !Number.isSafeInteger(entry.size) || entry.size <= 0 || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error('Invalid model manifest');
    if (entry.compression && entry.compression !== 'gzip') throw new Error('Unsupported model compression');
    const destination = path.join(output, bundledFileName(entry));
    if (await verifyBundledFile(destination, entry)) continue;
    const pending = `${destination}.${process.pid}.partial`;
    const compressed = `${pending}.gz`;
    try {
      const source = sourceDirectory && path.join(sourceDirectory, entry.name);
      if (source && await verifyModelFile(source, entry)) {
        await copyFile(source, pending);
      } else {
        const url = new URL(entry.name, manifest.baseUrl);
        if (url.protocol !== 'https:') throw new Error('Model download requires HTTPS');
        console.log(`Preparing bundled speech model: ${entry.name}`);
        const response = await fetch(url, { signal: AbortSignal.timeout(600000) });
        if (!response.ok || !response.body) throw new Error(`Model download failed: HTTP ${response.status}`);
        let bytes = 0;
        const bound = new Transform({ transform(chunk, encoding, callback) {
          bytes += chunk.length;
          callback(bytes > entry.size ? new Error('Model size exceeds manifest') : null, chunk);
        } });
        await pipeline(Readable.fromWeb(response.body), bound, createWriteStream(pending, { flags: 'wx' }));
      }
      if (!await verifyModelFile(pending, entry)) throw new Error(`Model checksum mismatch: ${entry.name}`);
      if (entry.compression === 'gzip') {
        await pipeline(createReadStream(pending), createGzip({ level: 9 }), createWriteStream(compressed, { flags: 'wx' }));
        if (!await verifyBundledFile(compressed, entry)) throw new Error('Compressed model verification failed');
        await rename(compressed, destination);
      } else await rename(pending, destination);
    } finally {
      await rm(pending, { force: true });
      await rm(compressed, { force: true });
    }
  }
  const bundledBytes = (await Promise.all(manifest.files.map(entry => stat(path.join(output, bundledFileName(entry)))))).reduce((sum, file) => sum + file.size, 0);
  if (manifest.maxBundledBytes && bundledBytes > manifest.maxBundledBytes) throw new Error(`Bundled speech model exceeds ${manifest.maxBundledBytes} bytes: ${bundledBytes}`);
  // Remove only obsolete, generated raw copies after their compressed replacements
  // have passed verification. Otherwise Android would package both versions.
  for (const entry of manifest.files.filter(entry => entry.compression)) {
    await rm(path.join(output, entry.name), { force: true });
    await rm(path.join(output, entry.name + '.gz'), { force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const manifest = JSON.parse(await readFile(path.join(root, 'shared/speech-model.json'), 'utf8'));
  await prepareSpeechModel(manifest, path.join(root, 'shared/generated/speech-model'), process.env.MCTIER_SPEECH_MODEL_SOURCE);
  console.log('Bundled speech model verified (no runtime download).');
}
