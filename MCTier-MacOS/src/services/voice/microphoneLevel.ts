/** RMS retains quiet speech; the displayed range is -60 .. 0 dBFS. */
export function pcmRms(samples: Float32Array): number {
  let sum = 0;
  for (const sample of samples) if (Number.isFinite(sample)) sum += sample * sample;
  return samples.length ? Math.sqrt(sum / samples.length) : 0;
}

export function microphoneLevelPercent(rms: number): number {
  if (!Number.isFinite(rms) || rms <= 0) return 0;
  return Math.round(Math.max(0, Math.min(100, (20 * Math.log10(rms) + 60) / 60 * 100)));
}
