import type { ChatMessage } from '../../types';

export type ChatUnread = Record<string, string>;

export function incomingConversation(message: ChatMessage, localId: string | null): string | null {
  if (!localId || message.playerId === localId || message.recalled) return null;
  if (!message.recipientId) return 'lobby';
  return message.recipientId === localId ? `private:${message.playerId}` : null;
}

export function recordUnread(unread: ChatUnread, message: ChatMessage, localId: string | null, active: string | null): ChatUnread {
  const conversation = incomingConversation(message, localId);
  return conversation === null || conversation === active ? unread : { ...unread, [message.id]: conversation };
}

export function readConversation(unread: ChatUnread, conversation: string | null): ChatUnread {
  if (conversation === null) return unread;
  return Object.fromEntries(Object.entries(unread).filter(([, value]) => value !== conversation));
}

export const unreadLabel = (count: number): string => count > 99 ? '99+' : String(count);
