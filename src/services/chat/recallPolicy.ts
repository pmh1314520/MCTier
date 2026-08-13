export interface RecallableMessage {
  id: string;
  playerId: string;
  timestamp: number;
  recalled?: boolean;
  content: string;
  type?: 'text' | 'image';
  imageData?: string;
}
export const RECALL_WINDOW_MS = 2 * 60 * 1000;

export function isWithinRecallWindow(timestamp: number, now = Date.now()): boolean {
  return now - timestamp <= RECALL_WINDOW_MS;
}

export function applyMessageRecall<T extends RecallableMessage>(
  messages: readonly T[],
  messageId: string,
  requesterId: string,
  now = Date.now()
): { messages: readonly T[]; changed: boolean } {
  const target = messages.find((message) => message.id === messageId);
  if (
    !target ||
    target.playerId !== requesterId ||
    target.recalled ||
    !isWithinRecallWindow(target.timestamp, now)
  ) {
    return { messages, changed: false };
  }
  return {
    changed: true,
    messages: messages.map((message) =>
      message.id === messageId
        ? ({ ...message, content: '', imageData: undefined, type: 'text', recalled: true } as T)
        : message
    ),
  };
}
