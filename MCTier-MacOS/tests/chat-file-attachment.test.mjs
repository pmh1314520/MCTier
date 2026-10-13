import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const result = await build({
  entryPoints: [fileURLToPath(new URL('../src/services/chat/fileAttachment.ts', import.meta.url))],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  write: false,
});
const attachments = await import(`data:text/javascript,${encodeURIComponent(result.outputFiles[0].text)}`);

const valid = { id: 'att-123456789abc', name: 'meeting.mp3', mime: 'audio/mpeg', size: 4096 };

test('chat attachment metadata is bounded and rejects path syntax', () => {
  assert.deepEqual(attachments.parseChatAttachment(valid), valid);
  assert.equal(attachments.parseChatAttachment({ ...valid, name: '../secret.txt' }), null);
  assert.equal(attachments.parseChatAttachment({ ...valid, size: 64 * 1024 * 1024 + 1 }), null);
  assert.equal(attachments.parseChatAttachment({ ...valid, mime: 'audio/mpeg; charset=utf-8' }), null);
});

test('common attachment kinds and human sizes are detected consistently', () => {
  assert.equal(attachments.chatFileKind(valid), 'audio');
  assert.equal(attachments.chatFileKind({ ...valid, name: 'photo.png', mime: 'image/png' }), 'image');
  assert.equal(attachments.chatFileKind({ ...valid, name: 'clip.mp4', mime: 'video/mp4' }), 'video');
  assert.equal(attachments.chatFileKind({ ...valid, name: 'notes.docx', mime: 'application/octet-stream' }), 'word');
  assert.equal(attachments.chatFileKind({ ...valid, name: 'table.xlsx', mime: 'application/octet-stream' }), 'sheet');
  assert.equal(attachments.chatFileKind({ ...valid, name: 'table.xls', mime: 'application/octet-stream' }), 'sheet');
  assert.equal(attachments.chatFileKind({ ...valid, name: 'table.xlsb', mime: 'application/octet-stream' }), 'sheet');
  assert.equal(attachments.chatFileKind({ ...valid, name: 'table.ods', mime: 'application/octet-stream' }), 'sheet');
  assert.equal(attachments.chatFileKind({ ...valid, name: 'table.csv', mime: 'application/octet-stream' }), 'sheet');
  assert.equal(attachments.chatFileKind({ ...valid, name: 'deck.pptx', mime: 'application/octet-stream' }), 'slides');
  assert.equal(attachments.chatFileKind({ ...valid, name: 'deck.ppt', mime: 'application/octet-stream' }), 'slides');
  assert.equal(attachments.chatFileKind({ ...valid, name: 'deck.odp', mime: 'application/octet-stream' }), 'slides');
  assert.equal(attachments.chatFileKind({ ...valid, name: 'notes.doc', mime: 'application/octet-stream' }), 'word');
  assert.equal(attachments.chatFileKind({ ...valid, name: 'notes.odt', mime: 'application/octet-stream' }), 'word');
  assert.equal(attachments.chatFileKind({ ...valid, name: 'report.pdf', mime: 'application/pdf' }), 'pdf');
  assert.equal(attachments.formatFileSize(2 * 1024 * 1024), '2.0 MB');
});

test('Office preview accepts attachment-sized containers and keeps ZIP expansion checks separate', async () => {
  const largeInvalidZip = new Blob([new Uint8Array(32 * 1024 * 1024)]);
  await assert.rejects(
    attachments.previewOfficeFile(largeInvalidZip, 'slides', 'deck.pptx'),
    (error) => error instanceof Error && error.message !== 'OFFICE_PREVIEW_TOO_LARGE',
  );
});
