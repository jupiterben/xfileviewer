export function createWheelPager(
  now: () => number,
  cooldownMs: number,
): (deltaY: number) => 1 | -1 | null {
  let last = Number.NEGATIVE_INFINITY;
  return (deltaY: number) => {
    const dir: 1 | -1 | null = deltaY > 0 ? 1 : deltaY < 0 ? -1 : null;
    if (!dir) return null;
    const t = now();
    if (t - last < cooldownMs) return null;
    last = t;
    return dir;
  };
}

export function kindUsesWheelPaging(kindId: string): boolean {
  return kindId !== "document";
}
