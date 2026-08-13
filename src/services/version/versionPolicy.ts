export const DOWNLOAD_WEBSITE = 'https://mctier.pmhs.top';

export function compareVersions(left: string, right: string): number {
  const toParts = (version: string) => {
    const parts = version
      .replace(/^v/i, '')
      .split('.')
      .map((part) => Number.parseInt(part, 10) || 0);
    while (parts.length < 3) parts.push(0);
    return parts;
  };
  const leftParts = toParts(left);
  const rightParts = toParts(right);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference > 0 ? 1 : -1;
  }
  return 0;
}
export function newestVersionTag<T extends { name: string }>(tags: readonly T[]): T | undefined {
  return tags.reduce<T | undefined>((newest, tag) => {
    if (!newest || compareVersions(tag.name, newest.name) > 0) return tag;
    return newest;
  }, undefined);
}
