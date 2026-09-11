import { sanitizeUntrustedText } from '../../security/trustBoundary';

export function savedLobbyPlayerName(value: unknown, legacyPassword?: unknown): string {
  const name = sanitizeUntrustedText(value, 64).trim();
  if (!name || name.length > 8) return '';
  if (typeof legacyPassword === 'string' && legacyPassword && name === legacyPassword.trim()) {
    return '';
  }
  return name;
}

export function selectSavedLobbyPlayerName(current: unknown, saved: unknown, configured: unknown): string {
  return savedLobbyPlayerName(current) || savedLobbyPlayerName(configured) || savedLobbyPlayerName(saved);
}
