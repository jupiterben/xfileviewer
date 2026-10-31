import { afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ imported: [] as string[] }));
vi.mock("highlight.js/lib/common", () => {
  state.imported.push("highlight");
  return { default: { getLanguage: () => false } };
});
vi.mock("@mdit/plugin-katex", () => {
  state.imported.push("math"); return { katex: () => {} };
});
vi.mock("katex/dist/katex.min.css?inline", () => ({ default: "" }));
afterEach(() => { vi.resetModules(); state.imported.length = 0; });

it("plain prose, untyped code and Mermaid do not load optional render libraries", async () => {
  const { renderMarkdown } = await import("../../../src/plugins/markdown/render");
  expect(state.imported).toEqual([]);
  await renderMarkdown("# Heading\n\nPlain prose with `$HOME` and \\$escaped\\$\n\n```\n$code$\n```\n\n```mermaid\ngraph TD; A-->B\n```");
  expect(state.imported).toEqual([]);
});

it("loads highlighting only for a labelled code fence", async () => {
  const { renderMarkdown } = await import("../../../src/plugins/markdown/render");
  await renderMarkdown("```javascript\nconst n = 1;\n```");
  expect(state.imported).toEqual(["highlight"]);
});

it("loads math only for possible formulas in prose, not code blocks", async () => {
  const { renderMarkdown } = await import("../../../src/plugins/markdown/render");
  await renderMarkdown("- Formula $x^2$\n\n$$\ny^2\n$$");
  expect(state.imported).toEqual(["math"]);
});
