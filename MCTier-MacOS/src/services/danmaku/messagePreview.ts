import { chatFileKind, formatFileSize, parseChatAttachment } from '../chat/fileAttachment';
import { sniffImageMime } from '../chat/imageData';
import { decodeBuiltinEmoji } from '../emoji/builtinEmojiMessage';

export type PreviewKind = 'text' | 'image' | 'video' | 'voice' | 'audio' | 'file';
export interface PreviewMessage { type?: string; content: string; imageData?: string; attachment?: unknown; recalled?: boolean }
export interface MessagePreview { kind: PreviewKind; text: string; detail?: string; image?: string }
export function messagePreview(message: PreviewMessage): MessagePreview {
  if (message.recalled) return { kind: 'text', text: '[消息已撤回]' };
  if ((!message.type || message.type === 'text') && decodeBuiltinEmoji(message.content)) return { kind: 'image', text: '[内置表情]' };
  if (!message.type || message.type === 'text') return { kind: 'text', text: message.content.replace(/^> \[reply:[^\]]+\]\s*/, '> ') };
  if (message.type === 'image') return { kind: 'image', text: '[图片 / 表情]', image: message.imageData };
  if (message.type === 'voice') {
    let duration = 0;
    try { duration = Number(JSON.parse(message.content).duration); } catch { /* legacy voice */ }
    return { kind: 'voice', text: '语音消息', detail: Number.isFinite(duration) && duration > 0 && duration <= 120 ? `${Math.ceil(duration)} 秒` : undefined };
  }
  if (message.type === 'file') {
    const file = parseChatAttachment(message.attachment ?? message.content);
    if (!file) return { kind: 'file', text: '[附件不可用]' };
    const kind = chatFileKind(file);
    return { kind: kind === 'image' || kind === 'video' || kind === 'audio' ? kind : 'file', text: file.name,
      detail: `${file.name.split('.').pop()?.toUpperCase() ?? 'FILE'} · ${formatFileSize(file.size)}` };
  }
  return { kind: 'file', text: '[不支持的消息]' };
}

/** A bounded thumbnail crosses the overlay event boundary, never attachment metadata or remote URLs. */
export async function visualThumbnail(src: string, kind: 'image' | 'video'): Promise<string> {
  if (kind === 'image') {
    const response = await fetch(src, { signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error('Preview unavailable');
    const blob = await response.blob();
    const mime = sniffImageMime(new Uint8Array(await blob.slice(0, 32).arrayBuffer()));
    if (blob.size <= 2 * 1024 * 1024 && mime) {
      return await new Promise((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob.slice(0, blob.size, mime));
      });
    }
  }
  return await new Promise((resolve, reject) => {
    const media = kind === 'video' ? document.createElement('video') : new Image();
    const timer = window.setTimeout(() => finish(new Error('Preview timeout')), 12000);
    const finish = (error?: Error, value?: string) => {
      clearTimeout(timer); media.onload = null; media.onerror = null;
      if (media instanceof HTMLVideoElement) { media.onloadeddata = null; media.onseeked = null; media.removeAttribute('src'); media.load(); }
      if (error) reject(error); else resolve(value!);
    };
    const render = () => {
      try {
        const w = media instanceof HTMLVideoElement ? media.videoWidth : media.naturalWidth;
        const h = media instanceof HTMLVideoElement ? media.videoHeight : media.naturalHeight;
        if (!w || !h) throw new Error('No visual track');
        const scale = Math.min(1, 320 / w, 180 / h);
        const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(w * scale)); canvas.height = Math.max(1, Math.round(h * scale));
        const context = canvas.getContext('2d'); if (!context) throw new Error('No canvas');
        context.drawImage(media, 0, 0, canvas.width, canvas.height); finish(undefined, canvas.toDataURL('image/jpeg', .82));
      } catch (error) { finish(error as Error); }
    };
    media.onerror = () => finish(new Error('Preview unavailable'));
    if (media instanceof HTMLVideoElement) { media.muted = true; media.preload = 'auto'; media.onloadeddata = render; }
    else media.onload = render;
    media.src = src;
  });
}
