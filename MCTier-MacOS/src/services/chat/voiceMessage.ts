export const MAX_VOICE_BYTES = 2 * 1024 * 1024;
export const VOICE_MIMES = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/wav'];

export function voiceMetadata(content: string): { mime: string; duration: number } | null {
  try {
    const meta = JSON.parse(content);
    return VOICE_MIMES.includes(meta.mime) && Number.isFinite(meta.duration) && meta.duration >= 0.5 && meta.duration <= 60.5
      ? { mime: meta.mime, duration: meta.duration } : null;
  } catch { return null; }
}

export function voiceDataUrl(bytes: number[], mime: string): string {
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += 8192) chunks.push(String.fromCharCode(...bytes.slice(i, i + 8192)));
  return `data:${mime};base64,${btoa(chunks.join(''))}`;
}

export function safeVoiceUrl(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_VOICE_BYTES * 1.4 + 128 &&
    /^data:audio\/(webm|ogg|mp4|wav);base64,[A-Za-z0-9+/]+=*$/.test(value);
}
