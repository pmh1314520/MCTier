/**
 * 公开大厅广场
 * - 通过临时 WebSocket 连接信令服务器，查询已发布到公开广场的大厅列表
 * - 不依赖已加入的大厅会话，可在大厅外（主界面/加入表单）直接调用
 */

import {
  isSafeServerNode,
  isSafeSignalingServer,
  sanitizeUntrustedText,
} from '../../security/trustBoundary';

export interface PublicLobby {
  lobbyName: string;
  playerCount: number;
  maxPlayers?: number | null;
  hostName: string;
  description: string;
  /** Public lobbies are passwordless; the listing never carries a password. */
  /** 房主使用的 EasyTier 节点地址，加入时自动同步（空=未知，回退加入者默认节点） */
  serverNode?: string;
}

const DEFAULT_SIGNALING = 'wss://test.pmhs.top';

/**
 * 查询公开大厅列表
 * @param signalingServer 可选，自定义信令服务器地址
 * @param timeoutMs 超时时间（毫秒）
 */
export function fetchPublicLobbies(signalingServer?: string, timeoutMs = 8000): Promise<PublicLobby[]> {
  const url = signalingServer?.trim() || DEFAULT_SIGNALING;
  if (!isSafeSignalingServer(url)) {
    return Promise.reject(new Error('信令服务器地址无效'));
  }
  return new Promise((resolve, reject) => {
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

    const timer = window.setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(new Error('查询公开大厅超时'));
      }
    }, timeoutMs);

    ws.onopen = () => {
      try {
        ws.send(JSON.stringify({ type: 'public-lobby-list-request' }));
      } catch (e) {
        if (!settled) {
          settled = true;
          window.clearTimeout(timer);
          cleanup();
          reject(e);
        }
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg && msg.type === 'public-lobby-list-response') {
          if (!settled) {
            settled = true;
            window.clearTimeout(timer);
            cleanup();
            const lobbies = Array.isArray(msg.lobbies) ? msg.lobbies : [];
            resolve(lobbies.flatMap((lobby: unknown) => {
              if (!lobby || typeof lobby !== 'object') return [];
              const item = lobby as Record<string, unknown>;
              const lobbyName = sanitizeUntrustedText(item.lobbyName, 64).trim();
              const hostName = sanitizeUntrustedText(item.hostName, 64).trim();
              if (!lobbyName || !hostName) return [];

              const playerCount = typeof item.playerCount === 'number' && Number.isFinite(item.playerCount)
                ? Math.max(0, Math.min(100_000, Math.floor(item.playerCount)))
                : 0;
              const maxPlayers = typeof item.maxPlayers === 'number' && Number.isFinite(item.maxPlayers)
                ? Math.max(1, Math.min(100_000, Math.floor(item.maxPlayers)))
                : null;
              const rawServerNode = typeof item.serverNode === 'string' ? item.serverNode.trim() : '';

              return [{
                lobbyName,
                hostName,
                playerCount,
                maxPlayers,
                description: sanitizeUntrustedText(item.description ?? item.desc, 200).trim(),
                serverNode: rawServerNode && isSafeServerNode(rawServerNode) && rawServerNode !== 'custom'
                  ? rawServerNode
                  : undefined,
              }];
            }));
          }
        }
      } catch {
        /* 忽略非 JSON 或无关消息 */
      }
    };

    ws.onerror = () => {
      if (!settled) {
        settled = true;
        window.clearTimeout(timer);
        cleanup();
        reject(new Error('无法连接信令服务器'));
      }
    };
  });
}
