import { mount, unmount, flushSync } from "svelte";
import MarkdownViewer from "../ui/MarkdownViewer.svelte";
import MarkdownChoices from "../ui/MarkdownChoices.svelte";
import { convertFileSrc } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { KIND_DOCUMENT } from "../core/types";
import type { Viewer, ViewerContext, ViewerHandle } from "../core/types";
import { rewriteSrc } from "./markdown/assets";
import { renderMarkdown } from "./markdown/render";
import { sanitizeMarkdown } from "./markdown/sanitize";
import { lazyModule } from "../core/lazyModule";

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

const loadMermaid = lazyModule(async () => (await import("mermaid")).default);

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

  const view = mount(MarkdownViewer, { target: el });
  const body = el.querySelector<HTMLElement>(".markdown-body")!;
  const toggle = el.querySelector<HTMLButtonElement>(".md-theme-toggle")!;
  const picker = el.querySelector<HTMLElement>(".md-theme-picker")!;
  const choices = mount(MarkdownChoices, { target: picker, props: {
    onTheme: next => { void pickTheme(next); }, onWidth: next => pickWidth(next),
  } });

  let cancelled = false;
  let mermaidDone = false;
  let selected = themeIndex(theme.id);

  function toggleLabel() {
    toggle.textContent = `${theme.label} · ${width.label}`;
  }

  function renderPicker() {
    flushSync(() => choices.update(selected, theme.id, width.id));
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
    if (mermaidDone) await hydrateMermaid(body, next, true, () => cancelled);
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
      if (id) {
        const target = body.querySelector(`#${CSS.escape(id)}`)
          ?? body.querySelector(`#${CSS.escape(`user-content-${id}`)}`);
        target?.scrollIntoView();
      }
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
    if (ctx.isInteractionBlocked?.()) return;
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
      const html = await sanitizeMarkdown(await renderMarkdown(source));
      if (cancelled) return;
      body.innerHTML = html;
      rewriteMedia(body, ctx.path);
      await hydrateMermaid(body, theme, false, () => cancelled);
      if (!cancelled) mermaidDone = true;
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
      void unmount(choices);
      void unmount(view);
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

async function readText(src: string): Promise<string> {
  const res = await fetch(src);
  if (!res.ok) {
    throw new Error("无法读取 Markdown");
  }
  return res.text();
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
  isCancelled: () => boolean,
) {
  const nodes = [...root.querySelectorAll<HTMLElement>("pre.mermaid")];
  if (nodes.length === 0) return;
  const mermaid = await loadMermaid();
  if (isCancelled()) return;
  mermaid.initialize({
    startOnLoad: false,
    theme: mermaidThemeName(theme),
    securityLevel: "strict",
  });
  for (const node of nodes) {
    if (isCancelled()) return;
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
      if (isCancelled()) return;
      node.classList.add("mermaid-error");
      node.textContent =
        err instanceof Error ? err.message : "Mermaid 渲染失败";
    }
  }
}
