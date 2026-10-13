export type LobbyEntryMode = 'create' | 'join' | 'auto';

interface EntryState {
  appState: string;
  signalingStatus: string;
  signalingError: string | null;
  versionError: unknown;
}

/** Keep the form visible until authoritative registration and local setup finish. */
export function waitForLobbyEntry(
  subscribe: (listener: (state: EntryState) => void) => () => void,
  signal: AbortSignal,
  timeoutMs = 180_000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let unsubscribe = () => {};
    const finish = (error?: Error) => {
      clearTimeout(timer);
      unsubscribe();
      signal.removeEventListener('abort', abort);
      if (error) reject(error); else resolve();
    };
    const abort = () => finish(new DOMException('大厅连接已取消', 'AbortError'));
    const timer = setTimeout(() => finish(new Error('大厅连接超时，请重试')), timeoutMs);
    unsubscribe = subscribe(state => {
      if (state.versionError) finish(new Error('客户端版本过低，请先更新'));
      else if (state.signalingStatus === 'failed') finish(new Error(state.signalingError || '大厅连接失败'));
      else if (state.appState === 'in-lobby' && state.signalingStatus === 'connected') finish();
    });
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}
