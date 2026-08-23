export const VIDEO_SEEK_STEP = 5;

export function seekDeltaForKey(key: string): number | null {
  if (key === "ArrowLeft") return -VIDEO_SEEK_STEP;
  if (key === "ArrowRight") return VIDEO_SEEK_STEP;
  return null;
}

export function seekTime(current: number, duration: number, delta: number): number {
  const t = current + delta;
  if (t < 0) return 0;
  if (Number.isFinite(duration) && duration > 0 && t > duration) return duration;
  return t;
}
