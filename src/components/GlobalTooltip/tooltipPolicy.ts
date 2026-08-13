export interface GlobalTooltipTarget {
  title: string | null;
  componentOwned: boolean;
  optedOut: boolean;
}

export function shouldHandleGlobalTooltip({
  title,
  componentOwned,
  optedOut,
}: GlobalTooltipTarget): boolean {
  return Boolean(title?.trim()) && !componentOwned && !optedOut;
}
