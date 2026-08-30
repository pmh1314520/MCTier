/**
 * 输入法（IME）组合态下的回车提交策略。
 *
 * 中文/日文/韩文输入法在候选词面板打开时，用回车「确认候选词」。若直接把
 * keydown 的 Enter 当成提交，确认候选词的那次回车会被误当作发送，导致发出
 * 空消息或半截文本。浏览器为此提供两个信号：
 *
 * - `isComposing`：组合会话进行中（compositionstart 之后、compositionend 之前）。
 * - `keyCode === 229`：部分引擎在组合态下把按键上报为 229（"processed"），
 *   此时 `isComposing` 可能已经是 false，仅靠前者会漏判。
 *
 * 两者任一成立都必须放弃提交，把这次回车留给输入法。
 */
export interface ImeSubmitSignals {
  key: string;
  isComposing?: boolean;
  keyCode?: number;
  /** 组合会话是否仍未结束（由 compositionstart/compositionend 自行跟踪）。 */
  composingSession?: boolean;
}

export const IME_PROCESSED_KEY_CODE = 229;

/** 该次按键是否处于输入法组合态，处于组合态时不得触发提交。 */
export function isComposingKeyEvent({
  isComposing,
  keyCode,
  composingSession,
}: ImeSubmitSignals): boolean {
  return Boolean(isComposing) || Boolean(composingSession) || keyCode === IME_PROCESSED_KEY_CODE;
}

/** 回车是否应触发提交：必须是回车、不带 Shift、且不在输入法组合态。 */
export function shouldSubmitOnEnter(
  signals: ImeSubmitSignals & { shiftKey?: boolean },
): boolean {
  if (signals.key !== 'Enter') return false;
  if (signals.shiftKey) return false;
  return !isComposingKeyEvent(signals);
}
