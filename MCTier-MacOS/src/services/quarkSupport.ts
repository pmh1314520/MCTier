import { useSyncExternalStore } from 'react';
import { invoke } from '@tauri-apps/api/core';

export interface QuarkSupportState {
  ready: boolean;
  loggedIn: boolean;
  name: string;
  enabled: boolean;
  dismissed: boolean;
  result: string;
  backgroundSupported: boolean;
  backgroundRegistered: boolean;
  backgroundError: string;
  qrUrl: string | null;
  loginId: string | null;
  loginMethod: 'qr' | 'mobile' | null;
  expiresIn: number;
  stats: {
    successDays: number;
    pcReferenceCents: number;
    mobileReferenceCents: number;
    firstDay: string | null;
    lastDay: string | null;
    todayAttempted: boolean;
  };
}
let state: QuarkSupportState = {
  ready: false,
  loggedIn: false,
  name: '',
  enabled: false,
  dismissed: false,
  result: '',
  backgroundSupported: false,
  backgroundRegistered: false,
  backgroundError: '',
  qrUrl: null,
  loginId: null,
  loginMethod: null,
  expiresIn: 0,
  stats: {
    successDays: 0,
    pcReferenceCents: 0,
    mobileReferenceCents: 0,
    firstDay: null,
    lastDay: null,
    todayAttempted: false,
  },
};
const listeners = new Set<() => void>();
export function getQuarkSupportSnapshot() {
  return state;
}
let issued = 0;
let applied = 0;
export async function quarkSupport(
  action:
    | 'verify'
    | 'status'
    | 'startup_status'
    | 'login'
    | 'poll'
    | 'cancel'
    | 'daily'
    | 'logout'
    | 'dismiss'
    | 'mobile_login'
    | 'mobile_complete',
  loginId: string | null = null,
  serviceTicket?: string
) {
  const sequence = ++issued;
  const result = await invoke<QuarkSupportState>('quark_support', {
    action,
    loginId,
    ...(serviceTicket === undefined ? {} : { serviceTicket }),
  });
  if (sequence >= applied) {
    applied = sequence;
    state = { ...result, ready: true };
    listeners.forEach((notify) => notify());
  }
  return result;
}
export function useQuarkSupport() {
  return useSyncExternalStore(
    (notify) => {
      listeners.add(notify);
      return () => {
        listeners.delete(notify);
      };
    },
    () => state
  );
}
let startup: Promise<unknown> | undefined;
let localStartup: Promise<QuarkSupportState | undefined> | undefined;
export function loadQuarkSupport() {
  // Read the atomic local snapshot without waiting for network checks or scheduling.
  localStartup ??= quarkSupport('startup_status').catch(() => undefined);
  return localStartup;
}
export function startQuarkSupport() {
  // StrictMode/remounts must not duplicate startup requests. Never surface a popup.
  startup ??= loadQuarkSupport()
    .then((current) => (current?.loggedIn ? quarkSupport('verify') : current))
    .catch(() => undefined);
  return startup;
}
