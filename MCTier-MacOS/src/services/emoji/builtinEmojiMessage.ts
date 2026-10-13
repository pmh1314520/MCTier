// Shared with Android BuiltinEmojiMessage.kt. The pack version is part of the
// wire identifier so future packs cannot silently render a different image.
const prefix = 'mctier:emoji:v3:';
const idPattern = /^builtin-[A-Za-z0-9_-]{1,128}$/;
const validId = (id: string) => id.match(idPattern)?.[0] === id;

export function encodeBuiltinEmoji(id: string): string {
  if (!validId(id)) throw new Error('INVALID_BUILTIN_EMOJI_ID');
  return prefix + (id === 'builtin-1f60d' ? 'builtin-1f970' : id);
}

export function decodeBuiltinEmoji(content: string): string | null {
  if (!content.startsWith(prefix)) return null;
  const id = content.slice(prefix.length);
  return validId(id) ? (id === 'builtin-1f60d' ? 'builtin-1f970' : id) : null;
}
