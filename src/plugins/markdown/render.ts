import MarkdownIt from "markdown-it";
import taskLists from "markdown-it-task-lists";
import { lazyModule } from "../../core/lazyModule";

const loadHighlight = lazyModule(async () => (await import("highlight.js/lib/common")).default);
const loadMath = lazyModule(async () => {
  const [module, stylesheet] = await Promise.all([
    import("@mdit/plugin-katex"),
    import("katex/dist/katex.min.css?inline"),
  ]);
  // Inline CSS is still a lazy JS chunk, with font URLs rewritten by Vite.
  // Unlike Vite's CSS preloader, a failed import does not permanently mark a
  // stylesheet URL as loaded, so the shared factory can retry correctly.
  if (typeof document !== "undefined") {
    const style = document.createElement("style");
    style.dataset.feature = "markdown-math";
    style.textContent = stylesheet.default;
    document.head.append(style);
  }
  return module.katex;
});

function hasMathDelimiter(source: string): boolean {
  // Ignore escaped dollar signs and backtick-delimited inline code. Using the
  // inline source also retains Markdown's standalone $$ display delimiters.
  const prose = source.replace(/(`+)[\s\S]*?\1/g, "");
  for (let i = 0; i < prose.length; i++) {
    if (prose[i] !== "$") continue;
    let slashes = 0;
    for (let j = i - 1; j >= 0 && prose[j] === "\\"; j--) slashes++;
    if (slashes % 2 === 0) return true;
  }
  return false;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Optional features are selected from parsed content, not loaded by registration.
 * Each render owns its MarkdownIt instance so concurrent files cannot race over
 * a global parser's plugins/highlighter. Module promises are shared instead.
 */
export async function renderMarkdown(source: string): Promise<string> {
  const md = new MarkdownIt({ html: true, linkify: true });
  md.use(taskLists);
  const tokens = md.parse(source, {});
  const needsHighlight = tokens.some(token => token.type === "fence"
    && token.info.trim() !== "" && token.info.trim().split(/\s+/)[0] !== "mermaid");
  const needsMath = tokens.some(token => token.type === "inline" && token.children?.some(child =>
    child.type === "text" && child.content.includes("$") && hasMathDelimiter(token.content),
  ));
  const [hljs, math] = await Promise.all([
    needsHighlight ? loadHighlight() : undefined,
    needsMath ? loadMath() : undefined,
  ]);
  if (math) md.use(math);
  md.options.highlight = (str, lang): string => {
    if (lang === "mermaid") return `<pre class="mermaid">${escapeHtml(str)}</pre>`;
    if (hljs && lang && hljs.getLanguage(lang)) {
      try {
        return `<pre class="hljs"><code>${hljs.highlight(str, { language: lang }).value}</code></pre>`;
      } catch {
        // Unknown/invalid language: fall back to escaped code.
      }
    }
    return `<pre class="hljs"><code>${escapeHtml(str)}</code></pre>`;
  };
  return md.render(source);
}
