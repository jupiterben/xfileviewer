import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../../../src/plugins/markdown/render";

describe("renderMarkdown", () => {
  it("renders headings and passes raw HTML through", async () => {
    const html = await renderMarkdown("# Title\n\n<div class=\"raw\">ok</div>");
    expect(html).toContain("<h1");
    expect(html).toContain("Title");
    expect(html).toContain('<div class="raw">ok</div>');
  });

  it("renders GFM tables and task lists", async () => {
    const html = await renderMarkdown(
      "| a | b |\n| --- | --- |\n| 1 | 2 |\n\n- [x] done\n- [ ] todo\n",
    );
    expect(html).toContain("<table");
    expect(html).toContain("checkbox");
  });

  it("renders KaTeX math", async () => {
    const html = await renderMarkdown("The value is $E=mc^2$.");
    expect(html).toContain("katex");
  });

  it("supports display math and highlighted code without leaking plugins across concurrent renders", async () => {
    const [math, code, plain] = await Promise.all([
      renderMarkdown("$$\nx^2 + y^2\n$$"),
      renderMarkdown("```javascript\nconst answer = 42;\n```"),
      renderMarkdown("Plain prose without optional features."),
    ]);
    expect(math).toContain("katex-display");
    expect(code).toContain("hljs-keyword");
    expect(plain).not.toContain("katex");
  });

  it("escapes unknown languages and preserves Mermaid with an info suffix", async () => {
    expect(await renderMarkdown("```unknown\n<script>\n```" )).toContain("&lt;script&gt;");
    expect(await renderMarkdown("```mermaid title\ngraph TD; A-->B;\n```" )).toContain('class="mermaid"');
  });

  it("keeps mermaid fences for later hydration", async () => {
    const html = await renderMarkdown("```mermaid\ngraph TD; A-->B;\n```");
    expect(html).toContain('class="mermaid"');
    expect(html).toContain("graph TD");
  });
});
