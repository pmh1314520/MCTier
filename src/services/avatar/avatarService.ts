import { invoke } from '@tauri-apps/api/core';
import { useAppStore } from '../../stores';
import { p2pChatService } from '../chat/P2PChatService';

export async function saveAvatarData(avatarData?: string): Promise<void> {
  await invoke('set_avatar_data', { avatarData: avatarData ?? null });
  const store = useAppStore.getState();
  store.updateConfig({ avatarData });
  if (store.currentPlayerId) {
    store.updatePlayerStatus(store.currentPlayerId, { avatarData });
  }
  if (store.appState === 'in-lobby') {
    void p2pChatService.sendAvatar(avatarData).catch(() => undefined);
  }
}

export async function clearAvatarData(): Promise<void> {
  await saveAvatarData(undefined);
}
