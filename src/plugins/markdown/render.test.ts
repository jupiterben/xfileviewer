import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./render";

describe("renderMarkdown", () => {
  it("renders headings and passes raw HTML through", () => {
    const html = renderMarkdown("# Title\n\n<div class=\"raw\">ok</div>");
    expect(html).toContain("<h1");
    expect(html).toContain("Title");
    expect(html).toContain('<div class="raw">ok</div>');
  });

  it("renders GFM tables and task lists", () => {
    const html = renderMarkdown(
      "| a | b |\n| --- | --- |\n| 1 | 2 |\n\n- [x] done\n- [ ] todo\n",
    );
    expect(html).toContain("<table");
    expect(html).toContain("checkbox");
  });

  it("renders KaTeX math", () => {
    const html = renderMarkdown("The value is $E=mc^2$.");
    expect(html).toContain("katex");
  });

  it("keeps mermaid fences for later hydration", () => {
    const html = renderMarkdown("```mermaid\ngraph TD; A-->B;\n```");
    expect(html).toContain('class="mermaid"');
    expect(html).toContain("graph TD");
  });
});
