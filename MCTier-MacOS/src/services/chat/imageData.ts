import { MAX_IMAGE_BYTES } from '../../security/trustBoundary';

export const SUPPORTED_CHAT_IMAGE_MIMES = ['image/gif', 'image/png', 'image/jpeg', 'image/webp'] as const;
export type SupportedChatImageMime = (typeof SUPPORTED_CHAT_IMAGE_MIMES)[number];

export function sniffImageMime(bytes: Uint8Array): SupportedChatImageMime | null {
  if (bytes.length >= 6) {
    const header = String.fromCharCode(...bytes.subarray(0, 6));
    if (header === 'GIF87a' || header === 'GIF89a') return 'image/gif';
  }
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 12 && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF'
    && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP') return 'image/webp';
  return null;
}

export function bytesToImageDataUrl(bytes: Uint8Array, mime = sniffImageMime(bytes)): string {
  if (!mime) throw new Error('Unsupported image format');
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 8192, bytes.length)));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

export async function fileToChatImageDataUrl(file: Blob): Promise<string> {
  if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) throw new Error('IMAGE_SIZE');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = sniffImageMime(bytes);
  if (!mime) throw new Error('IMAGE_FORMAT');
  return bytesToImageDataUrl(bytes, mime);
}

/** Source limit is separate from the 2 MiB inline wire limit. Optimization
 * happens natively; large lossless results use image attachments. */
export async function fileToOutgoingImageDataUrl(file: Blob): Promise<string> {
  if (file.size <= 0 || file.size > 64 * 1024 * 1024) throw new Error('IMAGE_SIZE_64_MIB');
  return bytesToImageDataUrl(new Uint8Array(await file.arrayBuffer()));
}
