import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
globalThis.DOMMatrix ??= DOMMatrix;
globalThis.ImageData ??= ImageData;
globalThis.Path2D ??= Path2D;
const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');

// A vector-only two-page PDF exercises the bundled decoder without network or system fonts.
function pdfFixture() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 64 64] /Resources << >> /Contents 5 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 64 64] /Resources << >> /Contents 6 0 R >>',
    ...['1 0 0 rg 0 0 64 64 re f\n', '0 1 0 rg 0 0 64 64 re f\n'].map(
      (stream) => `<< /Length ${stream.length} >>\nstream\n${stream}endstream`
    ),
  ];
  let result = '%PDF-1.7\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(result.length);
    result += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = result.length;
  result += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) result += `${String(offset).padStart(10, '0')} 00000 n \n`;
  result += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(result);
}

test('bundled PDF engine renders multiple pages and scaled canvases without the browser viewer', async () => {
  const task = getDocument({ data: pdfFixture(), enableXfa: false, useSystemFonts: false });
  try {
    const document = await task.promise;
    assert.equal(document.numPages, 2);
    for (const [index, color] of [
      [1, [255, 0, 0, 255]],
      [2, [0, 255, 0, 255]],
    ]) {
      const page = await document.getPage(index);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = createCanvas(viewport.width, viewport.height);
      await page.render({ canvas, viewport }).promise;
      assert.equal(canvas.width, 128);
      assert.deepEqual([...canvas.getContext('2d').getImageData(64, 64, 1, 1).data], color);
    }
  } finally {
    await task.destroy();
  }
});
