export type FeedbackKind = 'success' | 'warning' | 'error' | 'info';

export interface FeedbackDetail {
  id: number;
  kind: FeedbackKind;
  text: string;
}

const feedbackEvent = 'mctier-feedback';
let nextFeedbackId = 1;

export function showFeedback(kind: FeedbackKind, text: string) {
  window.dispatchEvent(new CustomEvent<FeedbackDetail>(feedbackEvent, {
    detail: { id: nextFeedbackId++, kind, text },
  }));
}

export function subscribeFeedback(listener: (detail: FeedbackDetail) => void) {
  const handler = (event: Event) => listener((event as CustomEvent<FeedbackDetail>).detail);
  window.addEventListener(feedbackEvent, handler);
  return () => window.removeEventListener(feedbackEvent, handler);
}
