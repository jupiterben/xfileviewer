// @vitest-environment jsdom
import { expect, it } from "vitest";
import { renderMarkdown } from "../../../src/plugins/markdown/render";
import { sanitizeMarkdown } from "../../../src/plugins/markdown/sanitize";

it("removes scripts, event handlers, unsafe URLs and embedded browsing contexts", async () => {
  const html = await sanitizeMarkdown('<script>window.bad=true</script><img src="a.png" onerror="alert(1)"><a href="javascript:alert(1)">bad</a><iframe srcdoc="<script>alert(1)</script>"></iframe><object data="x"></object><svg onload="alert(1)"></svg>');
  const root = document.createElement("div"); root.innerHTML = html;
  expect(root.querySelector("script,iframe,object,embed")).toBeNull();
  expect(root.querySelector("[onerror],[onload]")).toBeNull();
  expect(root.querySelector("a")?.hasAttribute("href")).toBe(false);
  expect(root.querySelector("img")?.getAttribute("src")).toBe("a.png");
});

it("keeps ordinary HTML, local media, Mermaid source and task lists", async () => {
  const html = await sanitizeMarkdown(await renderMarkdown('<div class="raw">ok</div>\n\n![photo](./photo.png)\n\n<video controls src="./clip.mp4"></video>\n\n- [x] done\n\n```mermaid\ngraph TD; A-->B\n```'));
  expect(html).toContain('class="raw"');
  expect(html).toContain("photo.png");
  expect(html).toContain("clip.mp4");
  expect(html).toContain('type="checkbox"');
  expect(html).toContain('class="mermaid"');
  expect(html).toContain("A--&gt;B");
});

it("preserves math output while removing document-controlled style and named-property clobbering", async () => {
  const html = await sanitizeMarkdown(await renderMarkdown('$E=mc^2$\n\n<style>body{display:none}</style><form id="attributes"></form>'));
  expect(html).toContain("katex");
  expect(html).toContain("<math");
  expect(html).not.toContain("<style");
  expect(html).not.toContain('id="attributes"');
});

it("rejects overlay and URL-bearing CSS even on forged KaTeX elements", async () => {
  const html = await sanitizeMarkdown('<span class="katex" style="position:fixed;inset:0;z-index:999999;background:url(https://bad.example/a);transform:scale(100);width:999999em;top:-999999px;color:red">bad</span><div style="position:absolute!important;opacity:0;pointer-events:auto">hidden</div>');
  const root = document.createElement("div"); root.innerHTML = html;
  expect(root.querySelector("span")?.getAttribute("style")).toBe("color: red");
  expect(root.querySelector("div")?.hasAttribute("style")).toBe(false);
  expect(html).not.toMatch(/fixed|absolute|z-index|url\(|transform|pointer-events|999999/);
});

it("retains bounded formula layout styles", async () => {
  const html = await sanitizeMarkdown(await renderMarkdown(String.raw`$\frac{a}{b}+\sqrt{x}+\sum_{i=1}^n x_i$`));
  const root = document.createElement("div"); root.innerHTML = html;
  expect(root.querySelector(".katex")).not.toBeNull();
  expect(root.querySelector('[style*="top:"]')).not.toBeNull();
  expect(root.querySelector('[style*="height:"]')).not.toBeNull();
  expect(root.querySelector(".mfrac")).not.toBeNull();
});

it("preserves bounded rule and colored box declarations", async () => {
  const html = await sanitizeMarkdown(await renderMarkdown(String.raw`$\rule{1em}{1em}+\colorbox{red}{x}+\fcolorbox{blue}{red}{abc}$`));
  const root = document.createElement("div"); root.innerHTML = html;
  expect(root.querySelector('[style*="border-right-width: 1em"]')).not.toBeNull();
  expect(root.querySelector('[style*="border-top-width: 1em"]')).not.toBeNull();
  expect(root.querySelector('[style*="background-color: red"]')).not.toBeNull();
  expect(root.querySelector('[style*="border-color: blue"]')).not.toBeNull();
  expect(root.querySelector('[style*="border-width: 0.04em"]')).not.toBeNull();
});

it("rejects escaped and external SVG resource references without rewriting text attributes", async () => {
  const html = await sanitizeMarkdown(String.raw`<svg><rect fill="url(\23 shell-gradient)" clip-path="u\72l(#shell-clip)" stroke="url(https://bad.example/a.svg#x)" /></svg><pre class="mermaid" data-source="url(#plain-text)">url(#plain-text)</pre>`);
  const root = document.createElement("div"); root.innerHTML = html;
  expect(root.querySelector("rect")?.hasAttribute("fill")).toBe(false);
  expect(root.querySelector("rect")?.hasAttribute("clip-path")).toBe(false);
  expect(root.querySelector("rect")?.getAttribute("stroke")).toBe("none");
  expect(root.querySelector("pre")?.dataset.source).toBe("url(#plain-text)");
  expect(root.querySelector("pre")?.textContent).toBe("url(#plain-text)");
});

it("rewrites namespaced fragment, label, ARIA and SVG references without targeting the shell", async () => {
  const html = await sanitizeMarkdown('<h2 id="section">Section</h2><a href="#section">jump</a><a href="#open-button">shell</a><label for="field">Name</label><input id="field" aria-labelledby="section"><svg><defs><linearGradient id="gradient"><stop offset="0" /></linearGradient></defs><rect fill="url(#gradient)" clip-path="url(#shell-clip)" /></svg>');
  const root = document.createElement("div"); root.innerHTML = html;
  expect(root.querySelector("h2")?.id).toBe("user-content-section");
  expect(root.querySelector("a")?.getAttribute("href")).toBe("#user-content-section");
  expect(root.querySelectorAll("a")[1].hasAttribute("href")).toBe(false);
  expect(root.querySelector("label")?.getAttribute("for")).toBe("user-content-field");
  expect(root.querySelector("input")?.getAttribute("aria-labelledby")).toBe("user-content-section");
  expect(root.querySelector("rect")?.getAttribute("fill")).toBe("url(#user-content-gradient)");
  expect(root.querySelector("rect")?.getAttribute("clip-path")).toBe("none");
});
