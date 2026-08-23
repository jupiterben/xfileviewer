export const DEFAULT_WIDTH_ID = "medium";
export const WIDTH_STORAGE_KEY = "xfileviewer.markdownWidth";

export type MarkdownWidthId = "narrow" | "medium" | "wide" | "full";

export interface MarkdownWidth {
  id: MarkdownWidthId;
  label: string;
  css: string;
}

export const MARKDOWN_WIDTHS: MarkdownWidth[] = [
  { id: "narrow", label: "窄", css: "640px" },
  { id: "medium", label: "中", css: "860px" },
  { id: "wide", label: "宽", css: "1100px" },
  { id: "full", label: "铺满", css: "none" },
];

export function resolveWidth(id: string | undefined | null): MarkdownWidth {
  return MARKDOWN_WIDTHS.find((width) => width.id === id) ?? MARKDOWN_WIDTHS[1]!;
}

export function widthCss(id: string): string {
  return resolveWidth(id).css;
}

export function loadWidthId(storage: Pick<Storage, "getItem">): MarkdownWidthId {
  return resolveWidth(storage.getItem(WIDTH_STORAGE_KEY)).id;
}

export function saveWidthId(
  storage: Pick<Storage, "setItem">,
  id: MarkdownWidthId,
): void {
  storage.setItem(WIDTH_STORAGE_KEY, id);
}
