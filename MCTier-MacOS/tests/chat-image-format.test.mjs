import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const result = await build({
  entryPoints: [fileURLToPath(new URL('../src/services/chat/imageData.ts', import.meta.url))],
  bundle: true,
  format: 'esm',
  write: false,
});
const imageData = await import(`data:text/javascript,${encodeURIComponent(result.outputFiles[0].text)}`);

test('chat images are identified from bytes instead of extensions', () => {
  assert.equal(imageData.sniffImageMime(Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])), 'image/gif');
  assert.equal(imageData.sniffImageMime(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10])), 'image/png');
  assert.equal(imageData.sniffImageMime(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
  assert.equal(imageData.sniffImageMime(Uint8Array.from([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80])), 'image/webp');
  assert.equal(imageData.sniffImageMime(Uint8Array.from([0x3c, 0x73, 0x76, 0x67])), null);
});

test('data URLs retain the detected animated image MIME', () => {
  const gif = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
  assert.match(imageData.bytesToImageDataUrl(gif), /^data:image\/gif;base64,/);
});

test('inline chat images reject payloads above the shared two MiB boundary', async () => {
  const oversized = new Blob([new Uint8Array(2 * 1024 * 1024 + 1)], { type: 'image/gif' });
  await assert.rejects(imageData.fileToChatImageDataUrl(oversized), /IMAGE_SIZE/);
});
