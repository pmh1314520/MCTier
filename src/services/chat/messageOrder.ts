let lastMessageTime = 0;

export function createChatMessageId(playerId: string): string {
  lastMessageTime = Math.max(Date.now(), lastMessageTime + 1);
  return `msg-${playerId}-${lastMessageTime}-${crypto.randomUUID()}`;
}

interface OrderedMessage { id: string; playerId: string; timestamp: number }

export function messageOrderTime(message: OrderedMessage): number {
  const prefix = `msg-${message.playerId}-`;
  const match = message.id.startsWith(prefix) ? /^(\d{13})(?:-|$)/.exec(message.id.slice(prefix.length)) : null;
  return match ? Number(match[1]) : message.timestamp;
}

export function compareChatMessages(a: OrderedMessage, b: OrderedMessage): number {
  return messageOrderTime(a) - messageOrderTime(b) || a.id.localeCompare(b.id);
}
