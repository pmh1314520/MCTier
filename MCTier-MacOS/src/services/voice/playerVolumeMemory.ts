/**
 * 单人音量记忆（按玩家名持久化）
 * - 玩家 ID 每次会话都变化，因此按玩家名记忆音量
 * - 下次再和同一个人联机时自动恢复上次设定的音量
 */

const KEY = 'mctier_player_volumes';

type VolumeMap = Record<string, number>;

function read(): VolumeMap {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function write(map: VolumeMap): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch { /* ignore */ }
}

export const playerVolumeMemory = {
  /** 读取某玩家名记忆的音量（0~1），无记忆返回 undefined */
  get(name: string): number | undefined {
    if (!name) return undefined;
    const v = read()[name];
    return typeof v === 'number' ? v : undefined;
  },
  /** 记录某玩家名的音量 */
  set(name: string, volume: number): void {
    if (!name) return;
    const map = read();
    map[name] = Math.max(0, Math.min(1, volume));
    write(map);
  },
};
