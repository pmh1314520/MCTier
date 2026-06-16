/**
 * 数据统计服务（纯本地，绝不上报网络）
 * 统计联机时长、加入次数、房主/成员次数、最长/平均时长、活跃时段、首末使用时间等。
 * 常玩伙伴排行复用 recentService 的玩家记录。
 */

import { recentService } from '../recent/recentService';

const STATS_KEY = 'mctier_local_stats';

interface RawStats {
  totalOnlineMs: number;
  joinCount: number;
  hostCount: number;
  memberCount: number;
  maxSessionMs: number;
  firstUseTs: number;
  lastOnlineTs: number;
  // 活跃时段计次：0=凌晨(0-6) 1=上午(6-12) 2=下午(12-18) 3=晚上(18-24)
  buckets: [number, number, number, number];
  sessionStart: number; // 进行中的会话开始时间，0=无
}

export interface PartnerStat {
  name: string;
  count: number;
  lastSeen: number;
}

export interface ComputedStats {
  totalOnlineMs: number;
  joinCount: number;
  hostCount: number;
  memberCount: number;
  maxSessionMs: number;
  avgSessionMs: number;
  firstUseTs: number;
  lastOnlineTs: number;
  usedDays: number;
  buckets: [number, number, number, number];
  mostActiveBucket: number; // -1=无
  partners: PartnerStat[];
  uniquePartners: number;
  hasData: boolean;
}

const DEFAULT: RawStats = {
  totalOnlineMs: 0,
  joinCount: 0,
  hostCount: 0,
  memberCount: 0,
  maxSessionMs: 0,
  firstUseTs: 0,
  lastOnlineTs: 0,
  buckets: [0, 0, 0, 0],
  sessionStart: 0,
};

function read(): RawStats {
  try {
    const raw = localStorage.getItem(STATS_KEY);
    if (!raw) return { ...DEFAULT };
    const p = JSON.parse(raw);
    return { ...DEFAULT, ...p, buckets: p.buckets ?? [0, 0, 0, 0] };
  } catch {
    return { ...DEFAULT };
  }
}

function write(s: RawStats): void {
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(s));
  } catch (e) {
    console.error('保存统计失败:', e);
  }
}

function bucketOf(ts: number): number {
  const h = new Date(ts).getHours();
  if (h < 6) return 0;
  if (h < 12) return 1;
  if (h < 18) return 2;
  return 3;
}

export const statsService = {
  /** 进入大厅：记录会话开始与身份 */
  startSession(isHost: boolean): void {
    const s = read();
    const now = Date.now();
    if (s.firstUseTs === 0) s.firstUseTs = now;
    s.joinCount += 1;
    if (isHost) s.hostCount += 1;
    else s.memberCount += 1;
    s.buckets[bucketOf(now)] += 1;
    s.sessionStart = now;
    write(s);
  },

  /** 离开大厅/退出：累加本次会话时长 */
  endSession(): void {
    const s = read();
    if (s.sessionStart > 0) {
      const dur = Date.now() - s.sessionStart;
      if (dur > 0) {
        s.totalOnlineMs += dur;
        if (dur > s.maxSessionMs) s.maxSessionMs = dur;
      }
      s.lastOnlineTs = Date.now();
      s.sessionStart = 0;
      write(s);
    }
  },

  getStats(): ComputedStats {
    const s = read();
    const partnersRaw = recentService.getRecentPlayers();
    const partners: PartnerStat[] = partnersRaw
      .map((p) => ({ name: p.name, count: p.count, lastSeen: p.lastSeen }))
      .sort((a, b) => b.count - a.count);
    const usedDays = s.firstUseTs > 0 ? Math.max(1, Math.ceil((Date.now() - s.firstUseTs) / 86400000)) : 0;
    const avgSessionMs = s.joinCount > 0 ? Math.round(s.totalOnlineMs / s.joinCount) : 0;
    let mostActiveBucket = -1;
    let maxB = 0;
    s.buckets.forEach((v, i) => {
      if (v > maxB) {
        maxB = v;
        mostActiveBucket = i;
      }
    });
    const hasData = s.joinCount > 0 || s.totalOnlineMs > 0 || partners.length > 0;
    return {
      totalOnlineMs: s.totalOnlineMs,
      joinCount: s.joinCount,
      hostCount: s.hostCount,
      memberCount: s.memberCount,
      maxSessionMs: s.maxSessionMs,
      avgSessionMs,
      firstUseTs: s.firstUseTs,
      lastOnlineTs: s.lastOnlineTs,
      usedDays,
      buckets: s.buckets,
      mostActiveBucket,
      partners,
      uniquePartners: partners.length,
      hasData,
    };
  },

  /** 清除统计数据（伙伴记录一并清空） */
  clear(): void {
    write({ ...DEFAULT });
    recentService.clearPlayers();
  },
};

/** 格式化时长为"X小时Y分钟" */
export function formatDuration(ms: number): string {
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h} 小时 ${m} 分钟`;
  return `${m} 分钟`;
}

export const BUCKET_LABELS = ['凌晨', '上午', '下午', '晚上'];
