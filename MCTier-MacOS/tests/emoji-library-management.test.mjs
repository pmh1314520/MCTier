import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = (relativePath) => readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');

const records = new Map([
  ['custom-1', { id: 'custom-1', categoryId: 'custom', name: 'Original', mime: 'image/gif', dataUrl: 'data:image/gif;base64,R0lGODlh', createdAt: 1 }],
  ['protected-1', { id: 'protected-1', categoryId: 'builtin', name: 'Built in', mime: 'image/gif', dataUrl: 'asset:test', createdAt: 0, builtin: true }],
]);

function asynchronousRequest(result, mutate) {
  const request = {};
  queueMicrotask(() => {
    mutate?.();
    request.result = result;
    request.onsuccess?.();
  });
  return request;
}

globalThis.indexedDB = {
  open() {
    const db = {
      close() {},
      transaction() {
        return {
          objectStore() {
            return {
              getAll: () => asynchronousRequest([...records.values()]),
              put: (item) => asynchronousRequest(undefined, () => records.set(item.id, item)),
              delete: (id) => asynchronousRequest(undefined, () => records.delete(id)),
            };
          },
        };
      },
    };
    return asynchronousRequest(db);
  },
};

const localValues = new Map([
  ['mctier.emoji.categories.v1', JSON.stringify([{ id: 'animals', name: 'Animals' }])],
  ['mctier.emoji.recent.v1', JSON.stringify(['custom-1', 'protected-1'])],
]);
globalThis.localStorage = {
  getItem: (key) => localValues.get(key) ?? null,
  setItem: (key, value) => localValues.set(key, String(value)),
};

const result = await build({
  entryPoints: [fileURLToPath(new URL('../src/services/emoji/emojiLibrary.ts', import.meta.url))],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  write: false,
});
const emojiLibrary = await import(`data:text/javascript,${encodeURIComponent(result.outputFiles[0].text)}`);

test('custom emoji can be renamed and moved to a valid destination', async () => {
  const updated = await emojiLibrary.updateCustomEmoji('custom-1', '  Renamed  ', 'animals');
  assert.equal(updated.name, 'Renamed');
  assert.equal(updated.categoryId, 'animals');
  assert.equal(records.get('custom-1').categoryId, 'animals');
  await assert.rejects(emojiLibrary.updateCustomEmoji('custom-1', 'Name', 'builtin'), /EMOJI_CATEGORY/);
});

test('built-in emoji cannot be modified or deleted', async () => {
  await assert.rejects(emojiLibrary.updateCustomEmoji('protected-1', 'Changed', 'custom'), /EMOJI_BUILTIN/);
  await assert.rejects(emojiLibrary.deleteCustomEmoji('protected-1'), /EMOJI_BUILTIN/);
  assert.ok(records.has('protected-1'));
});

test('deleting custom emoji also removes it from recent emoji', async () => {
  await emojiLibrary.deleteCustomEmoji('custom-1');
  assert.equal(records.has('custom-1'), false);
  assert.deepEqual(JSON.parse(localValues.get('mctier.emoji.recent.v1')), ['protected-1']);
});

test('desktop and Android emoji actions expose completion feedback and current menu wording', () => {
  const desktopChat = source('../src/components/ChatRoom/ChatRoom.tsx');
  const desktopPicker = source('../src/components/EmojiPicker/EmojiPicker.tsx');
  const desktopFeedbackHost = source('../src/components/FeedbackHost/FeedbackHost.tsx');
  const desktopFeedbackCss = source('../src/components/FeedbackHost/FeedbackHost.css');
  const desktopApp = source('../src/App.tsx');
  const androidRepository = source('../../MCTier-Android/app/src/main/java/top/pmh13/mctier/MctierRepository.kt');
  const androidUi = source('../../MCTier-Android/app/src/main/java/top/pmh13/mctier/ui/MctierApp.kt');
  const combined = [desktopChat, desktopPicker, androidUi].join('\n');

  assert.match(desktopChat, /添加到表情库/);
  assert.match(androidUi, /添加到表情库/);
  assert.doesNotMatch(combined, /添加到自定义|已添加到自定义|Add to Custom|Added to Custom/);
  for (const feedback of ['已导入', '分类已创建', '分类已重命名', '表情信息已保存', '表情已删除']) {
    assert.match(desktopPicker, new RegExp(feedback));
    assert.match(androidUi, new RegExp(feedback));
  }
  assert.match(androidRepository, /fun importEmojiUris\([^)]*onResult:/);
  assert.match(androidRepository, /fun addChatImageAsEmoji\([^)]*onResult:/);
  assert.match(androidRepository, /fun addChatAttachmentAsEmoji\([^)]*onResult:/);
  assert.match(desktopApp, /<FeedbackHost\s*\/>/);
  assert.match(desktopFeedbackHost, /createPortal\([\s\S]*document\.body/);
  assert.match(desktopFeedbackHost, /aria-live="polite"/);
  assert.match(desktopFeedbackCss, /z-index:\s*2147483000/);
});

test('voice transcription, recording guidance, image reuse, and preview downloads are wired on both clients', () => {
  const desktopChat = source('../src/components/ChatRoom/ChatRoom.tsx');
  const desktopChatCss = source('../src/components/ChatRoom/ChatRoom.css');
  const desktopApp = source('../src/App.tsx');
  const androidUi = source('../../MCTier-Android/app/src/main/java/top/pmh13/mctier/ui/MctierApp.kt');

  for (const sourceText of [desktopChat, androidUi]) {
    assert.match(sourceText, /语音转文字/);
    assert.match(sourceText, /上滑取消/);
    assert.match(sourceText, /下载/);
  }
  assert.match(desktopChat, /const ChatImageBubble:[\s\S]*chat-image-wrapper/);
  assert.match(desktopChat, /kind === 'image' && cached[\s\S]*<ChatImageBubble[\s\S]*setPreviewImage/);
  assert.match(desktopChat, /message\.type === 'image' && imageData[\s\S]*<ChatImageBubble/);
  assert.match(androidUi, /kind == "image" && localFile != null[\s\S]*ChatImageBubble/);
  assert.doesNotMatch(desktopChat, /voice-recording-overlay[\s\S]{0,500}>\s*取消\s*</);
  assert.match(desktopChat, /voice-transcript-inline/);
  assert.doesNotMatch(desktopChat, /voice-transcript-modal/);
  assert.match(androidUi, /voiceTranscript != null -> SelectionContainer/);
  assert.doesNotMatch(androidUi, /showVoiceTranscript/);
  assert.match(desktopApp, /\(e\.ctrlKey \|\| e\.metaKey\)[\s\S]*mctier-open-chat-search/);
  assert.match(desktopChat, /mctier-open-chat-search/);
  assert.match(desktopChatCss, /chat-search-toggle[^}]*justify-content:center/);
});
