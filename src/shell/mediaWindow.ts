import { KIND_DOCUMENT, KIND_IMAGE, KIND_VIDEO } from "../core/types";

export const MEDIA_WINDOW_STORAGE_KEY = "xfileviewer.mediaWindowMode";

export type MediaWindowMode = "fit" | "fixed";

export function resolveMediaWindowMode(
  id: string | null | undefined,
): MediaWindowMode {
  return id === "fixed" ? "fixed" : "fit";
}

export function loadMediaWindowMode(
  storage: Pick<Storage, "getItem">,
): MediaWindowMode {
  return resolveMediaWindowMode(storage.getItem(MEDIA_WINDOW_STORAGE_KEY));
}

export function saveMediaWindowMode(
  storage: Pick<Storage, "setItem">,
  mode: MediaWindowMode,
): void {
  storage.setItem(MEDIA_WINDOW_STORAGE_KEY, mode);
}

export function toggleMediaWindowMode(mode: MediaWindowMode): MediaWindowMode {
  return mode === "fit" ? "fixed" : "fit";
}

export function mediaWindowModeLabel(mode: MediaWindowMode): string {
  return mode === "fit" ? "适应尺寸" : "固定窗口";
}

export function shouldFitWindowToContent(
  kindId: string,
  mode: MediaWindowMode,
): boolean {
  return isMediaKind(kindId) && mode === "fit";
}

export function shouldRememberWindowSize(
  kindId: string,
  mode: MediaWindowMode,
): boolean {
  return kindId === KIND_DOCUMENT || (isMediaKind(kindId) && mode === "fixed");
}

function isMediaKind(kindId: string): boolean {
  return kindId === KIND_IMAGE || kindId === KIND_VIDEO;
}
