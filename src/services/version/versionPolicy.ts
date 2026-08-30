export const DOWNLOAD_WEBSITE = 'https://mctier.pmhs.top';

const MAX_VERSION_LENGTH = 64;
const RELEASE_VERSION_PATTERN = /^v?(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/;

/**
 * Normalize a release tag only when it is an exact, bounded x.y.z version.
 * Update metadata is untrusted input, so tags such as `2.8.0.exe` or
 * `999999999999999999999.0.0` must never become a candidate update.
 */
export function normalizeReleaseVersion(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_VERSION_LENGTH) {
    return null;
  }
  const match = RELEASE_VERSION_PATTERN.exec(value);
  if (!match) return null;
  return `${match[1]}.${match[2]}.${match[3]}`;
}

export function isReleaseVersion(value: unknown): value is string {
  return normalizeReleaseVersion(value) !== null;
}

export function compareVersions(left: string, right: string): number {
  const toParts = (version: string): number[] | null => {
    if (typeof version !== 'string' || version.length === 0 || version.length > MAX_VERSION_LENGTH) {
      return null;
    }
    const parts = version.replace(/^v/i, '').split('.');
    if (parts.some((part) => !/^\d{1,9}$/.test(part))) return null;
    const numbers = parts.map((part) => Number(part));
    if (numbers.some((part) => !Number.isSafeInteger(part))) return null;
    while (numbers.length < 3) numbers.push(0);
    return numbers;
  };
  const leftParts = toParts(left);
  const rightParts = toParts(right);
  if (!leftParts || !rightParts) return 0;
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference > 0 ? 1 : -1;
  }
  return 0;
}
export function newestVersionTag<T extends { name: string }>(tags: readonly T[]): T | undefined {
  return tags.reduce<T | undefined>((newest, tag) => {
    if (!isReleaseVersion(tag.name)) return newest;
    if (!newest || compareVersions(tag.name, newest.name) > 0) return tag;
    return newest;
  }, undefined);
}
