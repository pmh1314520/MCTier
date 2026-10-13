export const SCREEN_RESOLUTIONS = [720, 1080, 1440, 2160] as const;
export const SCREEN_FRAME_RATES = [30, 60, 120] as const;
export const SCREEN_BITRATES = [0, 4, 8, 16, 32, 64] as const;

export interface ScreenShareQuality {
  resolution: number;
  frameRate: number;
  bitrateMbps: number; // 0 chooses a budget for the resolution and frame rate.
}

export const DEFAULT_SCREEN_QUALITY: ScreenShareQuality = {
  resolution: 1080,
  frameRate: 30,
  bitrateMbps: 0,
};

export function normalizeScreenQuality(
  value?: Partial<ScreenShareQuality> | null
): ScreenShareQuality {
  return {
    resolution: SCREEN_RESOLUTIONS.some((n) => n === value?.resolution) ? value!.resolution! : 1080,
    frameRate: SCREEN_FRAME_RATES.some((n) => n === value?.frameRate) ? value!.frameRate! : 30,
    bitrateMbps: SCREEN_BITRATES.some((n) => n === value?.bitrateMbps) ? value!.bitrateMbps! : 0,
  };
}

export function screenBitrate(quality: ScreenShareQuality): number {
  const q = normalizeScreenQuality(quality);
  const base = ({ 720: 2, 1080: 4, 1440: 8, 2160: 16 } as Record<number, number>)[q.resolution];
  return (q.bitrateMbps || Math.min(64, (base * q.frameRate) / 30)) * 1_000_000;
}

export function screenDimensions(
  width: number,
  height: number,
  resolution: number
): [number, number] {
  const short = normalizeScreenQuality({ resolution }).resolution;
  const long = (short * 16) / 9;
  if (!(width > 0 && height > 0)) return [long, short];
  const scale = Math.min(1, short / Math.min(width, height), long / Math.max(width, height));
  const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2);
  return [even(width * scale), even(height * scale)];
}

export function screenSenderLimits(quality: ScreenShareQuality, isOwner: boolean) {
  // Relays forward the incoming track and let WebRTC adapt to their network.
  // A viewer's own capture preferences must not cap someone else's stream.
  return isOwner
    ? {
        maxBitrate: screenBitrate(quality),
        maxFramerate: normalizeScreenQuality(quality).frameRate,
      }
    : {};
}

const STORAGE_KEY = 'mctier_screen_share_quality';
export function loadScreenQuality(): ScreenShareQuality {
  try {
    return normalizeScreenQuality(JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'));
  } catch {
    return { ...DEFAULT_SCREEN_QUALITY };
  }
}
export function saveScreenQuality(quality: ScreenShareQuality): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeScreenQuality(quality)));
  } catch {
    /* Sharing still works when browser storage is unavailable. */
  }
}
