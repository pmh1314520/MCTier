import { invoke } from '@tauri-apps/api/core';

export const isProtectedPassword = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 4096 &&
  /^(mctier-local-v1:|mctier-invite-v3:)[A-Za-z0-9_-]+$/.test(value);

export const protectLobbyPassword = (password: string): Promise<string> =>
  password ? invoke<string>('protect_lobby_password', { password }) : Promise.resolve('');
