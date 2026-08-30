/**
 * 最近联机记录服务（本地持久化）
 * - 记录最近成功进入的大厅，便于快速重进
 * - 记录最近一起联机过的玩家
 */

import { isSafeServerNode, isSafeSignalingServer, sanitizeUntrustedText } from '../../security/trustBoundary';

export interface RecentLobby {
  name: string;
  /** Passwords are intentionally never persisted. A selected record requires re-entry. */
  password?: string;
  playerName?: string;
  useDomain?: boolean;
  serverNode?: string;
  signalingServer?: string;
  lastJoined: number;
}

export interface RecentPlayer {
  name: string;
  lastSeen: number;
  count: number;
}

const LOBBIES_KEY = 'mctier_recent_lobbies';
const PLAYERS_KEY = 'mctier_recent_players';
const FAV_PLAYERS_KEY = 'mctier_favorite_players';
const MAX_LOBBIES = 10;
const MAX_PLAYERS = 30;

function readJson<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeJson<T>(key: string, value: T[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error('保存最近记录失败:', error);
  }
}

function normalizeRecentLobby(value: unknown): RecentLobby | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const name = sanitizeUntrustedText(item.name, 64).trim();
  const lastJoined = typeof item.lastJoined === 'number' && Number.isFinite(item.lastJoined)
    ? Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(item.lastJoined)))
    : 0;
  if (!name || !lastJoined) return null;
  const playerName = sanitizeUntrustedText(item.playerName, 64).trim();
  const serverNode = typeof item.serverNode === 'string' && isSafeServerNode(item.serverNode) && item.serverNode !== 'custom'
    ? item.serverNode.trim()
    : undefined;
  const signalingServer = typeof item.signalingServer === 'string' && isSafeSignalingServer(item.signalingServer)
    ? item.signalingServer.trim()
    : undefined;
  return {
    name,
    ...(playerName ? { playerName } : {}),
    ...(item.useDomain === true ? { useDomain: true } : {}),
    ...(serverNode ? { serverNode } : {}),
    ...(signalingServer ? { signalingServer } : {}),
    lastJoined,
  };
}

function readRecentLobbies(): RecentLobby[] {
  return readJson<unknown>(LOBBIES_KEY).flatMap((item) => {
    const lobby = normalizeRecentLobby(item);
    return lobby ? [lobby] : [];
  });
}

function writeRecentLobbies(value: RecentLobby[]): void {
  // Explicitly rebuild each object so legacy `password` properties cannot be
  // copied back into localStorage during migration.
  writeJson(LOBBIES_KEY, value.map(({ password: _password, ...lobby }) => lobby));
}

function normalizeRecentPlayers(value: unknown): RecentPlayer[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return [];
    const item = candidate as Record<string, unknown>;
    const name = sanitizeUntrustedText(item.name, 64).trim();
    const lastSeen = typeof item.lastSeen === 'number' && Number.isFinite(item.lastSeen)
      ? Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(item.lastSeen)))
      : 0;
    const count = typeof item.count === 'number' && Number.isFinite(item.count)
      ? Math.max(0, Math.min(1_000_000, Math.trunc(item.count)))
      : 0;
    return name && lastSeen ? [{ name, lastSeen, count }] : [];
  });
}

export const recentService = {
  /** 记录一次成功进入的大厅 */
  recordLobby(lobby: Omit<RecentLobby, 'lastJoined'>): void {
    const name = sanitizeUntrustedText(lobby.name, 64).trim();
    if (!name) return;
    let list = readRecentLobbies();
    // Passwords are not a stable local identifier and must never be written.
    list = list.filter((item) => !(
      item.name === name &&
      item.serverNode === lobby.serverNode &&
      item.signalingServer === lobby.signalingServer
    ));
    const playerName = sanitizeUntrustedText(lobby.playerName, 64).trim();
    const serverNode = typeof lobby.serverNode === 'string' && isSafeServerNode(lobby.serverNode) && lobby.serverNode !== 'custom'
      ? lobby.serverNode.trim()
      : undefined;
    const signalingServer = typeof lobby.signalingServer === 'string' && isSafeSignalingServer(lobby.signalingServer)
      ? lobby.signalingServer.trim()
      : undefined;
    list.unshift({
      name,
      ...(playerName ? { playerName } : {}),
      ...(lobby.useDomain === true ? { useDomain: true } : {}),
      ...(serverNode ? { serverNode } : {}),
      ...(signalingServer ? { signalingServer } : {}),
      lastJoined: Date.now(),
    });
    if (list.length > MAX_LOBBIES) list = list.slice(0, MAX_LOBBIES);
    writeRecentLobbies(list);
  },

  getRecentLobbies(): RecentLobby[] {
    const list = readRecentLobbies().sort((a, b) => b.lastJoined - a.lastJoined);
    writeRecentLobbies(list.slice(0, MAX_LOBBIES));
    return list;
  },

  removeLobby(name: string, lastJoined?: number): void {
    const safeName = sanitizeUntrustedText(name, 64).trim();
    const list = readRecentLobbies().filter((lobby) =>
      !(lobby.name === safeName && (lastJoined === undefined || lobby.lastJoined === lastJoined))
    );
    writeRecentLobbies(list);
  },

  clearLobbies(): void {
    writeJson(LOBBIES_KEY, []);
  },

  /** 记录一起联机过的玩家（传入当前大厅其他玩家名） */
  recordPlayers(names: string[]): void {
    if (!names || names.length === 0) return;
    const list = normalizeRecentPlayers(readJson<unknown>(PLAYERS_KEY));
    const map = new Map<string, RecentPlayer>();
    list.forEach(p => map.set(p.name, p));
    const now = Date.now();
    names
      .map((name) => sanitizeUntrustedText(name, 64).trim())
      .filter(Boolean)
      .forEach(name => {
        const existing = map.get(name);
        if (existing) {
          existing.lastSeen = now;
          existing.count += 1;
        } else {
          map.set(name, { name, lastSeen: now, count: 1 });
        }
      });
    let merged = Array.from(map.values()).sort((a, b) => b.lastSeen - a.lastSeen);
    if (merged.length > MAX_PLAYERS) merged = merged.slice(0, MAX_PLAYERS);
    writeJson(PLAYERS_KEY, merged);
  },

  getRecentPlayers(): RecentPlayer[] {
    const list = normalizeRecentPlayers(readJson<unknown>(PLAYERS_KEY)).sort((a, b) => b.lastSeen - a.lastSeen);
    writeJson(PLAYERS_KEY, list.slice(0, MAX_PLAYERS));
    return list;
  },

  clearPlayers(): void {
    writeJson(PLAYERS_KEY, []);
  },

  // ==================== 收藏队友 ====================
  /** 获取收藏的队友名字列表 */
  getFavoritePlayers(): string[] {
    const list = readJson<unknown>(FAV_PLAYERS_KEY)
      .map((name) => sanitizeUntrustedText(name, 64).trim())
      .filter(Boolean)
      .slice(0, MAX_PLAYERS);
    const unique = Array.from(new Set(list));
    writeJson(FAV_PLAYERS_KEY, unique);
    return unique;
  },

  isFavoritePlayer(name: string): boolean {
    const safeName = sanitizeUntrustedText(name, 64).trim();
    return !!safeName && this.getFavoritePlayers().includes(safeName);
  },

  /** 切换收藏/取消收藏某队友，返回切换后的是否已收藏 */
  toggleFavoritePlayer(name: string): boolean {
    const safeName = sanitizeUntrustedText(name, 64).trim();
    if (!safeName) return false;
    let list = this.getFavoritePlayers();
    let fav: boolean;
    if (list.includes(safeName)) { list = list.filter(n => n !== safeName); fav = false; }
    else { list = [...list, safeName].slice(0, MAX_PLAYERS); fav = true; }
    writeJson(FAV_PLAYERS_KEY, list);
    return fav;
  },
};
