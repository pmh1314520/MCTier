/**
 * 公开大厅广场
 * - 通过临时 WebSocket 连接信令服务器，查询已发布到公开广场的大厅列表
 * - 不依赖已加入的大厅会话，可在大厅外（主界面/加入表单）直接调用
 */

export interface PublicLobby {
  lobbyName: string;
  playerCount: number;
  maxPlayers?: number | null;
  hostName: string;
  description: string;
  /** 加入用的明文密码（公开大厅由房主主动公开） */
  password: string;
}

const DEFAULT_SIGNALING = 'wss://mctier.pmhs.top/signaling';

/**
 * 查询公开大厅列表
 * @param signalingServer 可选，自定义信令服务器地址
 * @param timeoutMs 超时时间（毫秒）
 */
export function fetchPublicLobbies(signalingServer?: string, timeoutMs = 8000): Promise<PublicLobby[]> {
  const url = signalingServer || DEFAULT_SIGNALING;
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
            resolve(Array.isArray(msg.lobbies) ? msg.lobbies : []);
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
