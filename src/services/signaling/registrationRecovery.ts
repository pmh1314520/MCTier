export type RegistrationPhase = 'transport' | 'challenge' | 'signing' | 'response' | 'local-auth';

export class RegistrationError extends Error {
  constructor(message: string, readonly retryable = true) {
    super(message);
    this.name = 'RegistrationError';
  }
}

export const REGISTRATION_ATTEMPTS = 8;
export const REGISTRATION_BUDGET_MS = 75_000;

export function registrationRejection(message: string): RegistrationError {
  // Current servers report this transient old-session cleanup race as text.
  return new RegistrationError(message || '信令注册被拒绝', message === '客户端身份已在使用中，请重新连接');
}

export function registrationRetryDelay(attempt: number): number {
  return Math.min(1000 * 2 ** Math.max(0, attempt - 1), 6000);
}

export function registrationPhaseLabel(phase: RegistrationPhase): string {
  return {
    transport: '建立信令连接',
    challenge: '等待服务器协议挑战',
    signing: '生成本机注册签名',
    response: '等待服务器注册响应',
    'local-auth': '配置本地聊天认证',
  }[phase];
}

export function waitForRegistrationRetry(delay: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('大厅会话已取消', 'AbortError')); return; }
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      reject(new DOMException('大厅会话已取消', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, delay);
    signal?.addEventListener('abort', abort, { once: true });
  });
}
