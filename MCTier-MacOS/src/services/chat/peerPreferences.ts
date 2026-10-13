export interface PeerPreference { pinned: boolean; muted: boolean; markedUnread: boolean }
export type PeerPreferences = Record<string, PeerPreference>;
const key = 'mctier.private-peers.v1';
export const defaultPeerPreference: PeerPreference = { pinned: false, muted: false, markedUnread: false };
export function parsePeerPreferences(json: string | null): PeerPreferences {
  try {
    const data: unknown = JSON.parse(json || '{}');
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
    return Object.fromEntries(Object.entries(data).filter(([id, p]) => /^[a-f0-9]{64}$/.test(id) && p && typeof p === 'object').map(([id, p]) => [id, {
      pinned: p.pinned === true, muted: p.muted === true, markedUnread: p.markedUnread === true,
    }]));
  } catch { return {}; }
}
export function loadPeerPreferences(): PeerPreferences {
  try { return parsePeerPreferences(localStorage.getItem(key)); } catch { return {}; }
}
export function savePeerPreferences(preferences: PeerPreferences): void {
  localStorage.setItem(key, JSON.stringify(preferences));
}
export function updatePeerPreference(preferences: PeerPreferences, id: string, patch: Partial<PeerPreference>): PeerPreferences {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid peer identity');
  const value = { ...defaultPeerPreference, ...preferences[id], ...patch };
  const next = { ...preferences };
  if (value.pinned || value.muted || value.markedUnread) next[id] = value;
  else delete next[id];
  return next;
}
export function sortPrivatePeers<T extends { id: string }>(peers: T[], preferences: PeerPreferences): T[] {
  return [...peers].sort((a, b) => Number(!!preferences[b.id]?.pinned) - Number(!!preferences[a.id]?.pinned));
}
export function notificationUnreadCount(unread: Record<string, string>, preferences: PeerPreferences, visibleIds?: string[]): number {
  const conversations = Object.values(unread);
  return conversations.filter(c => !c.startsWith('private:') || !preferences[c.slice(8)]?.muted).length
    + Object.entries(preferences).filter(([id, p]) => (!visibleIds || visibleIds.includes(id)) && p.markedUnread && !p.muted && !conversations.includes(`private:${id}`)).length;
}
