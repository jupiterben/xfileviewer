export interface WindowSize {
  width: number;
  height: number;
}

export type WindowSizes = Record<string, WindowSize>;

const DOCUMENT_FALLBACK: WindowSize = { width: 1100, height: 720 };

export function sizeForKind(
  sizes: WindowSizes,
  kindId: string,
  fallback: WindowSize = DOCUMENT_FALLBACK,
): WindowSize {
  return sizes[kindId] ?? fallback;
}

export function rememberSize(
  sizes: WindowSizes,
  kindId: string,
  size: WindowSize,
): WindowSizes {
  return { ...sizes, [kindId]: size };
}
