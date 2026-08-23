import { convertFileSrc } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { KIND_DOCUMENT } from "../core/types";
import type { Viewer, ViewerContext, ViewerHandle } from "../core/types";
import { rewriteSrc } from "./markdown/assets";
import { renderMarkdown } from "./markdown/render";
import {
  MARKDOWN_THEMES,
  loadThemeId,
  mermaidThemeName,
  moveThemeIndex,
  resolveTheme,
  saveThemeId,
  themeIndex,
  type MarkdownTheme,
} from "./markdown/themes";
import {
  MARKDOWN_WIDTHS,
  loadWidthId,
  resolveWidth,
  saveWidthId,
  type MarkdownWidth,
} from "./markdown/widths";
import "./markdown/markdown.css";
import "katex/dist/katex.min.css";

type PickerChoice =
  | { type: "theme"; theme: MarkdownTheme }
  | { type: "width"; width: MarkdownWidth };

const PICKER_CHOICES: PickerChoice[] = [
  ...MARKDOWN_THEMES.map((theme) => ({ type: "theme" as const, theme })),
  ...MARKDOWN_WIDTHS.map((width) => ({ type: "width" as const, width })),
];

export function markdownViewer(id: string, extensions: string[]): Viewer {
  return {
    id,
    kindId: KIND_DOCUMENT,
    extensions,
    mount(el, ctx) {
      return mountMarkdown(el, ctx);
    },
  };
}

function mountMarkdown(el: HTMLElement, ctx: ViewerContext): ViewerHandle {
  el.classList.add("markdown-stage");
  let theme = resolveTheme(loadThemeId(localStorage));
  let width = resolveWidth(loadWidthId(localStorage));
  applyTheme(el, theme);
  applyWidth(el, width);

  const body = document.createElement("div");
  body.className = "markdown-body";
  el.append(body);

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "md-theme-toggle";
  el.append(toggle);

  const picker = document.createElement("div");
  picker.className = "md-theme-picker";
  picker.hidden = true;
  picker.setAttribute("role", "listbox");
  picker.setAttribute("aria-label", "Markdown 主题与宽度");
  el.append(picker);

  let cancelled = false;
  let mermaidDone = false;
  let selected = themeIndex(theme.id);

  function toggleLabel() {
    toggle.textContent = `${theme.label} · ${width.label}`;
  }

  function choiceButton(
    label: string,
    index: number,
    current: boolean,
    onPick: () => void,
  ) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute("role", "option");
    btn.setAttribute("aria-selected", String(index === selected));
    if (current) btn.dataset.current = "true";
    btn.textContent = label;
    btn.addEventListener("click", onPick);
    return btn;
  }

  function sectionLabel(text: string) {
    const label = document.createElement("div");
    label.className = "md-theme-picker-label";
    label.textContent = text;
    return label;
  }

  function renderPicker() {
    picker.replaceChildren(
      sectionLabel("主题"),
      ...MARKDOWN_THEMES.map((item, index) =>
        choiceButton(item.label, index, item.id === theme.id, () =>
          void pickTheme(item),
        ),
      ),
      sectionLabel("宽度"),
      ...MARKDOWN_WIDTHS.map((item, index) =>
        choiceButton(
          item.label,
          MARKDOWN_THEMES.length + index,
          item.id === width.id,
          () => pickWidth(item),
        ),
      ),
    );
  }

  function setPickerOpen(open: boolean) {
    picker.hidden = !open;
    if (open) {
      selected = themeIndex(theme.id);
      renderPicker();
    }
  }

  async function pickTheme(next: MarkdownTheme) {
    theme = next;
    selected = themeIndex(next.id);
    applyTheme(el, next);
    saveThemeId(localStorage, next.id);
    toggleLabel();
    setPickerOpen(false);
    if (mermaidDone) await hydrateMermaid(body, next, true);
  }

  function pickWidth(next: MarkdownWidth) {
    width = next;
    selected = MARKDOWN_THEMES.length + MARKDOWN_WIDTHS.findIndex((w) => w.id === next.id);
    applyWidth(el, next);
    saveWidthId(localStorage, next.id);
    toggleLabel();
    setPickerOpen(false);
  }

  toggleLabel();

  const onClick = (event: MouseEvent) => {
    const a = (event.target as HTMLElement | null)?.closest("a");
    if (!a) return;
    const href = a.getAttribute("href");
    if (!href) return;
    event.preventDefault();
    if (href.startsWith("#")) {
      const id = decodeURIComponent(href.slice(1));
      if (id) body.querySelector(`#${CSS.escape(id)}`)?.scrollIntoView();
      return;
    }
    if (/^https?:/i.test(href)) {
      void openUrl(href);
    }
  };
  body.addEventListener("click", onClick);
  toggle.addEventListener("click", () => setPickerOpen(picker.hidden));

  const onKey = (event: KeyboardEvent) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (associationOpen()) return;
    if (event.key === "t" || event.key === "T") {
      event.preventDefault();
      event.stopPropagation();
      setPickerOpen(picker.hidden);
      return;
    }
    if (picker.hidden) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setPickerOpen(false);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      event.stopPropagation();
      selected = moveThemeIndex(selected, 1, PICKER_CHOICES.length);
      renderPicker();
      return;
    }
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      event.stopPropagation();
      selected = moveThemeIndex(selected, -1, PICKER_CHOICES.length);
      renderPicker();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      const choice = PICKER_CHOICES[selected];
      if (choice?.type === "theme") void pickTheme(choice.theme);
      if (choice?.type === "width") pickWidth(choice.width);
    }
  };
  window.addEventListener("keydown", onKey, true);

  void (async () => {
    try {
      const source = await readText(ctx.src);
      if (cancelled) return;
      setUnsafeHtml(body, renderMarkdown(source));
      rewriteMedia(body, ctx.path);
      await hydrateMermaid(body, theme, false);
      mermaidDone = true;
    } catch (err) {
      if (!cancelled) {
        ctx.onError(
          err instanceof Error && err.message
            ? err.message
            : "无法读取 Markdown",
        );
      }
    }
  })();

  return {
    destroy() {
      cancelled = true;
      window.removeEventListener("keydown", onKey, true);
      body.removeEventListener("click", onClick);
      toggle.remove();
      picker.remove();
      body.remove();
      el.classList.remove("markdown-stage");
      delete el.dataset.mdTheme;
      delete el.dataset.mdWidth;
    },
  };
}

function applyTheme(stage: HTMLElement, theme: MarkdownTheme) {
  stage.dataset.mdTheme = theme.id;
}

function applyWidth(stage: HTMLElement, width: MarkdownWidth) {
  stage.dataset.mdWidth = width.id;
}

function associationOpen(): boolean {
  return document.querySelector<HTMLElement>("#assoc-overlay")?.hidden === false;
}

async function readText(src: string): Promise<string> {
  const res = await fetch(src);
  if (!res.ok) {
    throw new Error("无法读取 Markdown");
  }
  return res.text();
}

function setUnsafeHtml(el: HTMLElement, html: string) {
  el.innerHTML = html;
  for (const old of [...el.querySelectorAll("script")]) {
    const next = document.createElement("script");
    for (const attr of old.attributes) {
      next.setAttribute(attr.name, attr.value);
    }
    next.textContent = old.textContent;
    old.replaceWith(next);
  }
}

function rewriteMedia(root: HTMLElement, fromFile: string) {
  for (const node of root.querySelectorAll("img[src], video[src], source[src]")) {
    const href = node.getAttribute("src");
    if (href) node.setAttribute("src", rewriteSrc(fromFile, href, convertFileSrc));
  }
}

async function hydrateMermaid(
  root: HTMLElement,
  theme: MarkdownTheme,
  rerender: boolean,
) {
  const nodes = [...root.querySelectorAll<HTMLElement>("pre.mermaid")];
  if (nodes.length === 0) return;
  const { default: mermaid } = await import("mermaid");
  mermaid.initialize({
    startOnLoad: false,
    theme: mermaidThemeName(theme),
    securityLevel: "loose",
  });
  for (const node of nodes) {
    if (!node.dataset.source) {
      node.dataset.source = node.textContent ?? "";
    }
    if (rerender) {
      node.removeAttribute("data-processed");
      node.classList.remove("mermaid-error");
      node.textContent = node.dataset.source;
    }
    try {
      await mermaid.run({ nodes: [node] });
    } catch (err) {
      node.classList.add("mermaid-error");
      node.textContent =
        err instanceof Error ? err.message : "Mermaid 渲染失败";
    }
  }
}
