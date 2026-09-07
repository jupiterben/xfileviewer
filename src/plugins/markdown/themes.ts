export const DEFAULT_THEME_ID = "github-dark";
export const THEME_STORAGE_KEY = "xfileviewer.markdownTheme";

export type MarkdownThemeId =
  | "github-dark"
  | "github-light"
  | "solarized-dark"
  | "solarized-light"
  | "nord"
  | "dracula"
  | "monokai"
  | "one-dark";

export interface MarkdownTheme {
  id: MarkdownThemeId;
  label: string;
  appearance: "dark" | "light";
}

export const MARKDOWN_THEMES: MarkdownTheme[] = [
  { id: "github-dark", label: "GitHub Dark", appearance: "dark" },
  { id: "github-light", label: "GitHub Light", appearance: "light" },
  { id: "solarized-dark", label: "Solarized Dark", appearance: "dark" },
  { id: "solarized-light", label: "Solarized Light", appearance: "light" },
  { id: "nord", label: "Nord", appearance: "dark" },
  { id: "dracula", label: "Dracula", appearance: "dark" },
  { id: "monokai", label: "Monokai", appearance: "dark" },
  { id: "one-dark", label: "One Dark", appearance: "dark" },
];

export function resolveTheme(id: string | undefined | null): MarkdownTheme {
  return MARKDOWN_THEMES.find((theme) => theme.id === id) ?? MARKDOWN_THEMES[0]!;
}

export function themeIndex(id: string): number {
  const index = MARKDOWN_THEMES.findIndex((theme) => theme.id === id);
  return index < 0 ? 0 : index;
}

export function moveThemeIndex(
  index: number,
  delta: number,
  length: number,
): number {
  return (index + delta + length) % length;
}

export function mermaidThemeName(theme: MarkdownTheme): "dark" | "default" {
  return theme.appearance === "light" ? "default" : "dark";
}

export function loadThemeId(storage: Pick<Storage, "getItem">): MarkdownThemeId {
  return resolveTheme(storage.getItem(THEME_STORAGE_KEY)).id;
}

export function saveThemeId(
  storage: Pick<Storage, "setItem">,
  id: MarkdownThemeId,
): void {
  storage.setItem(THEME_STORAGE_KEY, id);
}
