import MarkdownIt from "markdown-it";
import { katex } from "@mdit/plugin-katex";
import hljs from "highlight.js/lib/common";
import taskLists from "markdown-it-task-lists";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const md = new MarkdownIt({
  html: true,
  linkify: true,
  highlight(str, lang): string {
    if (lang === "mermaid") {
      return `<pre class="mermaid">${escapeHtml(str)}</pre>`;
    }
    if (lang && hljs.getLanguage(lang)) {
      try {
        return `<pre class="hljs"><code>${hljs.highlight(str, { language: lang }).value}</code></pre>`;
      } catch {
        // keep going with escaped text
      }
    }
    return `<pre class="hljs"><code>${escapeHtml(str)}</code></pre>`;
  },
});

md.use(katex);
md.use(taskLists);

export function renderMarkdown(source: string): string {
  return md.render(source);
}
