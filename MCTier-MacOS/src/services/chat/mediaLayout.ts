export function voiceBubbleWidth(seconds: number): number {
  const duration = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  return 144 + Math.min(duration, 10) * 9.6;
}

export function nonEmptySheets(sections: string[]): string[] {
  return sections.filter(section => section.split('\n').slice(1).some(row => row.trim().length > 0));
}
