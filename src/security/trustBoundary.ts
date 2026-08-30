/**
 * Frontend trust-boundary helpers.
 *
 * Values received from signaling, P2P chat, Tauri events, deep links, or
 * persisted storage are data, not trusted application state. Keep the
 * checks here dependency-free so they can also be covered by node tests.
 */

export const MAX_PLAYER_NAME_LENGTH = 64;
export const MAX_CHAT_TEXT_LENGTH = 10_000;
export const MAX_ANNOUNCEMENT_LENGTH = 200;
export const MAX_TODO_ITEMS = 200;
export const MAX_TODO_TEXT_LENGTH = 200;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGE_DATA_URL_LENGTH = 14 * 1024 * 1024;
export const CHAT_TOKEN_LENGTH = 64;
/** Uncompressed P-256 SubjectPublicKeyInfo DER is 91 bytes (~124 chars of
 * base64). The cap leaves room for encoder differences while still rejecting
 * anything absurd; the backend re-validates by actually parsing the key. */
export const MAX_CHAT_PUBLIC_KEY_LENGTH = 512;
export const MAX_RESOURCE_ID_LENGTH = 128;
export const MAX_SESSION_ID_LENGTH = 192;
export const MAX_RELATIVE_PATH_LENGTH = 4096;
export const MAX_PATH_SEGMENT_LENGTH = 255;

const DISALLOWED_CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const ENDPOINT_CONTROL_OR_SPACE = /[\u0000-\u0020\u007F]/;
const IMAGE_DATA_URL_PATTERN = /^data:image\/(?:jpeg|png|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/i;
const CHAT_TOKEN_PATTERN = /^[A-Fa-f0-9]{64}$/;
const CHAT_PUBLIC_KEY_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SAFE_RESOURCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SERVER_NODE_PROTOCOLS = new Set(['tcp:', 'udp:', 'ws:', 'wss:', 'txt:']);

export function sanitizeUntrustedText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string' || maxLength <= 0) return '';
  return value.replace(DISALLOWED_CONTROL_CHARS, '').slice(0, maxLength);
}

export function sanitizeIdentifier(value: unknown, maxLength = 128): string {
  return sanitizeUntrustedText(value, maxLength).trim();
}

/**
 * IDs cross a trust boundary before they are used as map keys, URL path
 * segments, or Tauri command arguments. Keep them to a small ASCII grammar
 * so separators and control characters cannot change the resource being
 * addressed. `sanitizeIdentifier` remains intentionally looser for display
 * and diagnostics.
 */
export function isSafeIdentifier(value: unknown, maxLength = MAX_RESOURCE_ID_LENGTH): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maxLength &&
    SAFE_IDENTIFIER_PATTERN.test(value)
  );
}

export function isSafeResourceId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_RESOURCE_ID_LENGTH && SAFE_RESOURCE_ID_PATTERN.test(value);
}

export function isSafeSessionId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_SESSION_ID_LENGTH && SAFE_IDENTIFIER_PATTERN.test(value);
}

export function isSafePathSegment(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_PATH_SEGMENT_LENGTH &&
    value !== '.' &&
    value !== '..' &&
    !/[\\/\u0000-\u001F\u007F]/.test(value)
  );
}

/** Empty string denotes the share root. All other paths are relative and
 * contain only ordinary path segments; callers should still URL-encode each
 * segment before placing it in an HTTP URL. */
export function isSafeRelativePath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > MAX_RELATIVE_PATH_LENGTH) return false;
  if (value === '') return true;
  if (value.startsWith('/') || value.includes('\\') || /[\u0000-\u001F\u007F]/.test(value)) return false;
  return value.split('/').every((segment) => isSafePathSegment(segment));
}

export function isSafeChatToken(value: unknown): value is string {
  return typeof value === 'string' && value.length === CHAT_TOKEN_LENGTH && CHAT_TOKEN_PATTERN.test(value);
}

/** Shape check only. The renderer never verifies signatures itself, so it just
 * has to avoid passing anything unparseable (or injection-shaped) down to the
 * backend, which does the real cryptographic validation. */
export function isSafeChatPublicKey(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_CHAT_PUBLIC_KEY_LENGTH &&
    CHAT_PUBLIC_KEY_PATTERN.test(value)
  );
}

export function isSafeImageDataUrl(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= MAX_IMAGE_DATA_URL_LENGTH &&
    IMAGE_DATA_URL_PATTERN.test(value)
  );
}

export function sanitizeImageDataUrl(value: unknown): string | undefined {
  return isSafeImageDataUrl(value) ? value : undefined;
}

function hasSafeEndpointCharacters(value: string): boolean {
  return value.length > 0 && !ENDPOINT_CONTROL_OR_SPACE.test(value);
}

export function isSafeSignalingServer(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!hasSafeEndpointCharacters(trimmed)) return false;
  try {
    const parsed = new URL(trimmed);
    return (
      (parsed.protocol === 'ws:' || parsed.protocol === 'wss:') &&
      parsed.hostname.length > 0 &&
      !parsed.username &&
      !parsed.password &&
      !parsed.hash
    );
  } catch {
    return false;
  }
}

export function isSafeServerNode(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (trimmed === 'custom') return true;
  if (!hasSafeEndpointCharacters(trimmed)) return false;
  try {
    const parsed = new URL(trimmed);
    return (
      SERVER_NODE_PROTOCOLS.has(parsed.protocol) &&
      parsed.hostname.length > 0 &&
      !parsed.username &&
      !parsed.password &&
      !parsed.hash
    );
  } catch {
    return false;
  }
}

export function isSafeHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!hasSafeEndpointCharacters(trimmed)) return false;
  try {
    const parsed = new URL(trimmed);
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      parsed.hostname.length > 0 &&
      !parsed.username &&
      !parsed.password
    );
  } catch {
    return false;
  }
}

export function isSafeVirtualIp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parts = value.trim().split('.');
  if (
    parts.length !== 4 ||
    !parts.every((part) => /^(?:0|[1-9]\d{0,2})$/.test(part) && Number(part) >= 0 && Number(part) <= 255)
  ) {
    return false;
  }
  const [first, second, third, host] = parts.map(Number);
  // MCTier uses EasyTier's fixed 10.126.126.0/24 overlay. Accepting an
  // arbitrary self-reported unicast address would turn the native HTTP
  // clients into an SSRF primitive against the user's physical LAN.
  return first === 10 && second === 126 && third === 126 && host >= 1 && host <= 254;
}

export function isSafeVirtualDomain(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const domain = value.trim();
  if (domain.length === 0 || domain.length > 253 || domain.includes('..')) return false;
  return domain.split('.').every((label) =>
    /^(?=.{1,63}$)[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label),
  );
}

export interface TrustedTodoItem {
  id: string;
  text: string;
  done: boolean;
  assignee: string;
  creator: string;
  ts: number;
}

export function sanitizeTodoItems(value: unknown): TrustedTodoItem[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_TODO_ITEMS).flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object') return [];
    const item = candidate as Record<string, unknown>;
    const id = sanitizeIdentifier(item.id, 128);
    const text = sanitizeUntrustedText(item.text, MAX_TODO_TEXT_LENGTH).trim();
    const assignee = sanitizeUntrustedText(item.assignee, MAX_PLAYER_NAME_LENGTH).trim();
    const creator = sanitizeUntrustedText(item.creator, MAX_PLAYER_NAME_LENGTH).trim();
    const ts = typeof item.ts === 'number' && Number.isFinite(item.ts) ? item.ts : Date.now();
    if (!id || !text || typeof item.done !== 'boolean') return [];
    return [{ id, text, done: item.done, assignee, creator, ts }];
  });
}
