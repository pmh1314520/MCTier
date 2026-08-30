/**
 * 用户共享节点（社区投稿的 EasyTier 节点）
 * - 通过临时 WebSocket 连接信令服务器，查询/投稿共享节点
 * - 与公开广场一致：不依赖已加入的大厅会话，可在大厅外直接调用
 * - 节点存活判定与「失效超过 1 天自动移除」由信令服务器负责，客户端只做展示
 */

export interface CommunityNode {
  name: string;
  address: string;
  /** 投稿者昵称（可选） */
  submitter?: string;
  /** 首次投稿时间（Unix 秒） */
  submittedAt: number;
  /** 最近一次探测成功时间（Unix 秒） */
  lastOkAt: number;
  /** 最近一轮巡检是否可达 */
  online: boolean;
  /** 最近一次成功探测的耗时（毫秒） */
  latencyMs?: number;
}

export interface SubmitCommunityNodeResult {
  ok: boolean;
  message: string;
  node?: CommunityNode;
}

const DEFAULT_SIGNALING = 'wss://mctier.pmhs.top/signaling';

/** 服务器侧的自动淘汰阈值（1 天），仅用于前端文案与「即将过期」提示 */
export const COMMUNITY_NODE_MAX_OFFLINE_SECS = 24 * 60 * 60;

/** 允许投稿的地址协议，与服务器校验保持一致 */
const ALLOWED_SCHEMES = ['tcp://', 'udp://', 'ws://', 'wss://'];

/**
 * 本地预校验投稿地址，减少一次无效往返。
 * 返回 null 表示通过，否则返回给用户看的原因。
 */
export function validateCommunityNodeAddress(address: string): string | null {
  const trimmed = address.trim();
  if (!trimmed) return '节点地址不能为空';
  if (trimmed.length > 128) return '节点地址过长';
  if (/\s/.test(trimmed)) return '节点地址不能包含空格';
  const lower = trimmed.toLowerCase();
  if (!ALLOWED_SCHEMES.some((scheme) => lower.startsWith(scheme))) {
    return '节点地址必须以 tcp:// udp:// ws:// wss:// 开头';
  }
  const rest = trimmed.slice(trimmed.indexOf('://') + 3);
  const hostPort = rest.split('/')[0];
  if (!hostPort) return '节点地址缺少主机名';
  // 显式写了端口就必须合法
  const portMatch = /:(\d+)$/.exec(hostPort);
  if (portMatch) {
    const port = Number(portMatch[1]);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) return '节点端口无效';
  }
  return null;
}

/** 把 Unix 秒换算成「距今多久」的中文/英文描述 */
export function describeNodeFreshness(lastOkAt: number, nowSecs = Math.floor(Date.now() / 1000)): {
  offlineSecs: number;
  /** 距离被服务器自动移除还剩多少秒（在线节点为 null） */
  secsUntilRemoval: number | null;
} {
  const offlineSecs = Math.max(0, nowSecs - (lastOkAt || 0));
  return {
    offlineSecs,
    secsUntilRemoval:
      offlineSecs >= COMMUNITY_NODE_MAX_OFFLINE_SECS
        ? 0
        : COMMUNITY_NODE_MAX_OFFLINE_SECS - offlineSecs,
  };
}

/**
 * 通过一次性 WebSocket 与信令服务器交换一条请求/响应。
 *
 * 抽出来复用是因为查询与投稿的连接生命周期完全一样：连上 -> 发一条 -> 等特定
 * type 的响应 -> 关闭。任何一步失败都必须确保 socket 被关闭，否则会泄漏连接。
 */
function requestOnce<T>(
  signalingServer: string | undefined,
  payload: Record<string, unknown>,
  expectType: string,
  parse: (msg: any) => T,
  timeoutMs: number,
): Promise<T> {
  const url = signalingServer || DEFAULT_SIGNALING;
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      reject(e);
      return;
    }

    const cleanup = () => {
      try { ws.close(); } catch { /* ignore */ }
    };

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      cleanup();
      fn();
    };

    const timer = window.setTimeout(() => {
      finish(() => reject(new Error('连接信令服务器超时')));
    }, timeoutMs);

    ws.onopen = () => {
      try {
        ws.send(JSON.stringify(payload));
      } catch (e) {
        finish(() => reject(e));
      }
    };

    ws.onmessage = (event) => {
      let msg: any;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return; // 忽略非 JSON 或无关消息
      }
      if (!msg || msg.type !== expectType) return;
      finish(() => {
        try {
          resolve(parse(msg));
        } catch (e) {
          reject(e);
        }
      });
    };

    ws.onerror = () => {
      finish(() => reject(new Error('无法连接信令服务器')));
    };

    ws.onclose = () => {
      // 服务器先关连接（例如版本准入拒绝）时不要让调用方一直挂着
      finish(() => reject(new Error('信令服务器已关闭连接')));
    };
  });
}

/** 把服务器返回的单条节点数据收敛成前端类型，脏数据一律丢弃 */
function normalizeNode(raw: any): CommunityNode | null {
  const name = typeof raw?.name === 'string' ? raw.name.trim() : '';
  const address = typeof raw?.address === 'string' ? raw.address.trim() : '';
  if (!name || !address) return null;
  const submitter = typeof raw?.submitter === 'string' && raw.submitter.trim()
    ? raw.submitter.trim()
    : undefined;
  const toSecs = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
  const latency = typeof raw?.latencyMs === 'number' && Number.isFinite(raw.latencyMs) && raw.latencyMs >= 0
    ? Math.round(raw.latencyMs)
    : undefined;
  return {
    name,
    address,
    submitter,
    submittedAt: toSecs(raw?.submittedAt),
    lastOkAt: toSecs(raw?.lastOkAt),
    online: raw?.online === true,
    latencyMs: latency,
  };
}

/**
 * 查询共享节点列表
 * @param signalingServer 可选，自定义信令服务器地址
 * @param timeoutMs 超时时间（毫秒）
 */
export function fetchCommunityNodes(signalingServer?: string, timeoutMs = 8000): Promise<CommunityNode[]> {
  return requestOnce(
    signalingServer,
    { type: 'community-node-list-request' },
    'community-node-list-response',
    (msg) => {
      const list = Array.isArray(msg.nodes) ? msg.nodes : [];
      return list
        .map(normalizeNode)
        .filter((n: CommunityNode | null): n is CommunityNode => n !== null);
    },
    timeoutMs,
  );
}

/**
 * 投稿一个共享节点
 *
 * 服务器会先探测该地址，不可达就拒绝入库，因此超时给得比查询更宽。
 */
export function submitCommunityNode(
  node: { name: string; address: string; submitter?: string },
  signalingServer?: string,
  timeoutMs = 15000,
): Promise<SubmitCommunityNodeResult> {
  const payload: Record<string, unknown> = {
    type: 'community-node-submit',
    name: node.name.trim(),
    address: node.address.trim(),
  };
  const submitter = node.submitter?.trim();
  if (submitter) payload.submitter = submitter;

  return requestOnce(
    signalingServer,
    payload,
    'community-node-submit-result',
    (msg) => ({
      ok: msg.ok === true,
      message: typeof msg.message === 'string' ? msg.message : '',
      node: msg.node ? normalizeNode(msg.node) ?? undefined : undefined,
    }),
    timeoutMs,
  );
}