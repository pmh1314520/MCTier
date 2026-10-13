import { isSafeIdentifier, isSafeResourceId, isSafeSessionId } from '../../security/trustBoundary';

export const CLIENT_ID_PATTERN = /^[a-f0-9]{64}$/;
export const SESSION_GENERATION_PATTERN = /^[a-f0-9]{16,64}$/;

const OUTBOUND_SIGNALING_TYPES = new Set([
  'players-list-request',
  'offer',
  'answer',
  'ice-candidate',
  'voice-reconnect',
  'status-update',
  'chat-message',
  'screen-share-list-request',
  'screen-share-list-response',
  'screen-share-start',
  'screen-share-stop',
  'screen-share-offer',
  'screen-share-answer',
  'screen-share-ice-candidate',
  'screen-share-error',
  'screen-share-relay',
  'screen-share-update',
  'screen-share-viewer-left',
  'file-share-list-request',
  'file-share-list-response',
  'file-share-added',
  'file-share-removed',
  'remote-control-request',
  'remote-control-accept',
  'remote-control-reject',
  'remote-control-offer',
  'remote-control-answer',
  'remote-control-ice',
  'remote-control-stop',
  'kick-player',
  'mute-player',
  'transfer-host',
  'set-lobby-options',
]);

const SDP_MESSAGE_TYPES = new Set([
  'offer',
  'answer',
  'screen-share-offer',
  'screen-share-answer',
  'remote-control-offer',
  'remote-control-answer',
]);

const ICE_MESSAGE_TYPES = new Set([
  'ice-candidate',
  'screen-share-ice-candidate',
  'remote-control-ice',
]);

export interface InboundTrustContext {
  localPlayerId: string;
  knownPlayers: ReadonlySet<string>;
  peerSessionGenerations: ReadonlyMap<string, string>;
}

export interface OutboundTrustContext {
  localPlayerId: string;
  knownPlayers: ReadonlySet<string>;
  serverSessionGeneration: string;
}

export type OutboundValidationFailure =
  | 'invalid-message'
  | 'unknown-type'
  | 'forged-sender'
  | 'unknown-target'
  | 'forged-client'
  | 'forged-player'
  | 'oversized';

export type OutboundValidation =
  | { ok: true; messageType: string; serialized: string }
  | { ok: false; messageType?: string; reason: OutboundValidationFailure };

export function parseSessionGeneration(value: unknown): string | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value);
  return typeof value === 'string' && SESSION_GENERATION_PATTERN.test(value) ? value : null;
}

export function parseRouteVersion(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  return typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= 1_000_000_000
    ? value
    : undefined;
}

export function parseViewerCount(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value)
    ? Math.max(0, Math.min(100_000, value))
    : 0;
}

export function parseResourceId(value: unknown): string | null {
  return isSafeResourceId(value) ? value : null;
}

export function isValidSessionDescription(
  value: unknown,
  expectedType: 'offer' | 'answer',
): value is RTCSessionDescriptionInit {
  if (!value || typeof value !== 'object') return false;
  const input = value as Record<string, unknown>;
  return (
    input.type === expectedType &&
    typeof input.sdp === 'string' &&
    input.sdp.length > 0 &&
    input.sdp.length <= 128 * 1024
  );
}

export function isValidIceCandidate(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const input = value as Record<string, unknown>;
  if (
    typeof input.candidate !== 'string' ||
    input.candidate.length === 0 ||
    input.candidate.length > 16 * 1024
  ) {
    return false;
  }
  if (
    input.sdpMLineIndex !== null && input.sdpMLineIndex !== undefined &&
    (typeof input.sdpMLineIndex !== 'number' ||
      !Number.isSafeInteger(input.sdpMLineIndex) ||
      input.sdpMLineIndex < 0 ||
      input.sdpMLineIndex > 256)
  ) {
    return false;
  }
  return input.sdpMid === null || input.sdpMid === undefined ||
    (typeof input.sdpMid === 'string' && input.sdpMid.length <= 128);
}

export function authenticatePeerMessage(
  message: unknown,
  context: InboundTrustContext,
  requireTarget = true,
): string | null {
  if (!message || typeof message !== 'object') return null;
  const input = message as Record<string, unknown>;
  const from = input.from;
  const to = input.to;
  if (
    !isSafeIdentifier(from) ||
    from === context.localPlayerId ||
    !context.knownPlayers.has(from)
  ) {
    return null;
  }
  const expectedGeneration = context.peerSessionGenerations.get(from);
  const messageGeneration = parseSessionGeneration(input.sessionGeneration);
  if (!expectedGeneration || messageGeneration !== expectedGeneration) return null;
  if (requireTarget && to !== context.localPlayerId) return null;
  if (!requireTarget && input.to !== undefined && to !== context.localPlayerId) return null;
  return from;
}

export function authenticateSessionMessage(
  message: unknown,
  context: InboundTrustContext,
): { peerId: string; sessionId: string } | null {
  const peerId = authenticatePeerMessage(message, context);
  if (!peerId || !message || typeof message !== 'object') return null;
  const sessionId = (message as Record<string, unknown>).sessionId;
  return isSafeSessionId(sessionId) ? { peerId, sessionId } : null;
}

export function validateOutboundSignalingMessage(
  message: unknown,
  context: OutboundTrustContext,
): OutboundValidation {
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    return { ok: false, reason: 'invalid-message' };
  }
  const input = message as Record<string, unknown>;
  const messageType = input.type;
  if (!isSafeIdentifier(messageType, 64) || !OUTBOUND_SIGNALING_TYPES.has(messageType)) {
    return { ok: false, reason: 'unknown-type' };
  }
  if (input.from !== undefined && input.from !== context.localPlayerId) {
    return { ok: false, messageType, reason: 'forged-sender' };
  }
  if (
    input.to !== undefined &&
    (!isSafeIdentifier(input.to) ||
      input.to === context.localPlayerId ||
      !context.knownPlayers.has(input.to))
  ) {
    return { ok: false, messageType, reason: 'unknown-target' };
  }
  if (messageType === 'status-update' && input.clientId !== context.localPlayerId) {
    return { ok: false, messageType, reason: 'forged-client' };
  }
  if (messageType === 'chat-message' && input.playerId !== context.localPlayerId) {
    return { ok: false, messageType, reason: 'forged-player' };
  }

  const outbound = context.serverSessionGeneration
    ? { ...input, sessionGeneration: context.serverSessionGeneration }
    : input;
  let serialized: string;
  try {
    serialized = JSON.stringify(outbound);
  } catch {
    return { ok: false, messageType, reason: 'invalid-message' };
  }
  const maxBytes = SDP_MESSAGE_TYPES.has(messageType)
    ? 128 * 1024
    : ICE_MESSAGE_TYPES.has(messageType)
      ? 16 * 1024
      : 64 * 1024;
  if (serialized.length > maxBytes) {
    return { ok: false, messageType, reason: 'oversized' };
  }
  return { ok: true, messageType, serialized };
}
