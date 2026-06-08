/**
 * 最近联机记录服务（本地持久化）
 * - 记录最近成功进入的大厅，便于快速重进
 * - 记录最近一起联机过的玩家
 */

export interface RecentLobby {
  name: string;
  password: string;
  playerName?: string;
  useDomain?: boolean;
  serverNode?: string;
  lastJoined: number;
}

export interface RecentPlayer {
  name: string;
  lastSeen: number;
  count: number;
}

const LOBBIES_KEY = 'mctier_recent_lobbies';
const PLAYERS_KEY = 'mctier_recent_players';
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

export const recentService = {
  /** 记录一次成功进入的大厅 */
  recordLobby(lobby: Omit<RecentLobby, 'lastJoined'>): void {
    if (!lobby.name) return;
    let list = readJson<RecentLobby>(LOBBIES_KEY);
    // 以"大厅名+密码"去重，保留最新
    list = list.filter(l => !(l.name === lobby.name && l.password === lobby.password));
    list.unshift({ ...lobby, lastJoined: Date.now() });
    if (list.length > MAX_LOBBIES) list = list.slice(0, MAX_LOBBIES);
    writeJson(LOBBIES_KEY, list);
  },

  getRecentLobbies(): RecentLobby[] {
    return readJson<RecentLobby>(LOBBIES_KEY).sort((a, b) => b.lastJoined - a.lastJoined);
  },

  removeLobby(name: string, password: string): void {
    const list = readJson<RecentLobby>(LOBBIES_KEY).filter(
      l => !(l.name === name && l.password === password)
    );
    writeJson(LOBBIES_KEY, list);
  },

  clearLobbies(): void {
    writeJson(LOBBIES_KEY, []);
  },

  /** 记录一起联机过的玩家（传入当前大厅其他玩家名） */
  recordPlayers(names: string[]): void {
    if (!names || names.length === 0) return;
    const list = readJson<RecentPlayer>(PLAYERS_KEY);
    const map = new Map<string, RecentPlayer>();
    list.forEach(p => map.set(p.name, p));
    const now = Date.now();
    names.filter(Boolean).forEach(name => {
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
    return readJson<RecentPlayer>(PLAYERS_KEY).sort((a, b) => b.lastSeen - a.lastSeen);
  },

  clearPlayers(): void {
    writeJson(PLAYERS_KEY, []);
  },
};
