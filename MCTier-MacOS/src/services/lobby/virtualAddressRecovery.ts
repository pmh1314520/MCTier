import type { Lobby } from '../../types';

export const isVirtualIpConflict = (error: string): boolean =>
  error.includes('virtualIp 已被大厅内其他成员使用');

/** Called only after the rejected network session has been stopped. */
export async function recoverVirtualAddress(
  lobby: Lobby,
  error: string,
  restart: (attempt: number) => Promise<Lobby>,
  isCurrent: () => boolean,
  now = Date.now(),
): Promise<Lobby | null> {
  if (!lobby.automaticVirtualIp || !isVirtualIpConflict(error) || !isCurrent()) return null;
  const startedAt = lobby.addressRecoveryStartedAt ?? now;
  const attempt = (lobby.addressAttempt ?? 0) + 1;
  if (attempt >= 254 || now - startedAt >= 60_000) {
    throw new Error('自动分配虚拟 IP 未成功，请稍后重试或检查大厅地址占用');
  }
  const replacement = await restart(attempt);
  if (!isCurrent()) return null;
  return { ...replacement, entryMode: lobby.entryMode, serverNode: lobby.serverNode, signalingServer: lobby.signalingServer,
    addressAttempt: attempt, addressRecoveryStartedAt: startedAt };
}
