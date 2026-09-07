import { describe, expect, it } from "vitest";
import {
  DEFAULT_THEME_ID,
  MARKDOWN_THEMES,
  mermaidThemeName,
  moveThemeIndex,
  resolveTheme,
  themeIndex,
} from "./themes";

describe("resolveTheme", () => {
  it("returns the named theme and falls back to GitHub Dark", () => {
    expect(resolveTheme("nord").id).toBe("nord");
    expect(resolveTheme("nope").id).toBe(DEFAULT_THEME_ID);
    expect(resolveTheme(undefined).id).toBe(DEFAULT_THEME_ID);
  });

  it("includes the eight preview themes", () => {
    expect(MARKDOWN_THEMES.map((t) => t.id)).toEqual([
      "github-dark",
      "github-light",
      "solarized-dark",
      "solarized-light",
      "nord",
      "dracula",
      "monokai",
      "one-dark",
    ]);
  });
});

describe("mermaidThemeName", () => {
  it("uses mermaid dark for dark appearances and default for light", () => {
    expect(mermaidThemeName(resolveTheme("github-dark"))).toBe("dark");
    expect(mermaidThemeName(resolveTheme("github-light"))).toBe("default");
  });
});

describe("moveThemeIndex", () => {
  it("wraps around the theme list", () => {
    expect(moveThemeIndex(0, -1, 8)).toBe(7);
    expect(moveThemeIndex(7, 1, 8)).toBe(0);
    expect(moveThemeIndex(themeIndex("nord"), 1, MARKDOWN_THEMES.length)).toBe(
      themeIndex("dracula"),
    );
  });
});
