import { invoke } from "@tauri-apps/api/core";
import { currentMonitor, getCurrentWindow, LogicalPosition, LogicalSize } from "@tauri-apps/api/window";
import { KIND_DOCUMENT } from "../core/types";
import { fitWindowToContent, positionKeepingCenter, type Size } from "./fitWindow";
import {
  loadMediaWindowMode, mediaWindowModeLabel, resolveMediaWindowMode, saveMediaWindowMode,
  shouldFitWindowToContent, shouldRememberWindowSize, toggleMediaWindowMode, type MediaWindowMode,
} from "./mediaWindow";
import { rememberSize, sizeForKind, type WindowSizes } from "./windowSizes";

export function createWindowController(getKind: () => string | undefined, isSettingsOpen: () => boolean) {
  const button = document.querySelector<HTMLButtonElement>("#media-window-mode")!;
  const radios = document.querySelectorAll<HTMLInputElement>('input[name="media-window-mode"]');
  let sizes: WindowSizes = {};
  let mode = loadMediaWindowMode(localStorage);
  let content: { width: number; height: number; chrome: Size } | null = null;
  let revision = 0;
  let saveTimer: number | undefined;

  function sync() {
    const kind = getKind();
    button.hidden = !kind || !shouldFitWindowToContent(kind, "fit") || isSettingsOpen();
    button.textContent = mediaWindowModeLabel(mode);
    for (const radio of radios) radio.checked = radio.value === mode;
  }

  async function resize(width: number, height: number, chrome: Size) {
    const request = ++revision;
    const win = getCurrentWindow();
    const scale = await win.scaleFactor();
    const monitor = await currentMonitor();
    const work = monitor
      ? monitor.workArea.size.toLogical(monitor.scaleFactor)
      : { width: window.screen.availWidth, height: window.screen.availHeight };
    const size = fitWindowToContent({ width, height }, chrome, work);
    const position = (await win.outerPosition()).toLogical(scale);
    const outer = (await win.outerSize()).toLogical(scale);
    const inner = (await win.innerSize()).toLogical(scale);
    const nextPosition = positionKeepingCenter(
      { ...position, ...outer },
      { width: size.width + outer.width - inner.width, height: size.height + outer.height - inner.height },
    );
    if (request !== revision) return;
    await win.setSize(new LogicalSize(size.width, size.height));
    if (request !== revision) return;
    await win.setPosition(new LogicalPosition(nextPosition.x, nextPosition.y));
  }

  async function persist() {
    const kind = getKind();
    if (!kind || !shouldRememberWindowSize(kind, mode)) return;
    const win = getCurrentWindow();
    const inner = await win.innerSize();
    const logical = inner.toLogical(await win.scaleFactor());
    if (getKind() !== kind || !shouldRememberWindowSize(kind, mode)) return;
    sizes = rememberSize(sizes, kind, {
      width: Math.round(logical.width), height: Math.round(logical.height),
    });
    await invoke("save_window_sizes", { sizes });
  }

  const reportError = (error: unknown) => console.warn("[window] operation failed", error);

  async function setMode(next: MediaWindowMode) {
    revision += 1;
    mode = next;
    saveMediaWindowMode(localStorage, mode);
    sync();
    const kind = getKind();
    if (!kind) return;
    if (shouldRememberWindowSize(kind, mode)) await persist();
    else if (content && shouldFitWindowToContent(kind, mode)) {
      await resize(content.width, content.height, content.chrome);
    }
  }

  button.addEventListener("click", () => { void setMode(toggleMediaWindowMode(mode)).catch(reportError); });
  for (const radio of radios) {
    radio.addEventListener("change", () => {
      if (radio.checked) void setMode(resolveMediaWindowMode(radio.value)).catch(reportError);
    });
  }

  return {
    sync,
    clearContent() {
      revision += 1;
      content = null;
      window.clearTimeout(saveTimer);
    },
    reportContentSize(width: number, height: number, chrome: Size = { width: 0, height: 0 }) {
      content = { width, height, chrome };
      const kind = getKind();
      if (kind && shouldFitWindowToContent(kind, mode)) void resize(width, height, chrome).catch(reportError);
    },
    async restore(kind: string) {
      if (!shouldRememberWindowSize(kind, mode)) return;
      const size = kind === KIND_DOCUMENT ? sizeForKind(sizes, kind) : sizes[kind];
      if (size) {
        try {
          await getCurrentWindow().setSize(new LogicalSize(size.width, size.height));
        } catch (error) { reportError(error); }
      }
    },
    scheduleSave() {
      window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(() => { void persist().catch(reportError); }, 400);
    },
    async load() {
      try {
        const loaded = await invoke<WindowSizes>("load_window_sizes");
        if (!loaded || typeof loaded !== "object" || Array.isArray(loaded)) throw new Error("Invalid window sizes");
        sizes = Object.fromEntries(Object.entries(loaded).filter(([, size]) =>
          size && Number.isFinite(size.width) && size.width > 0 && Number.isFinite(size.height) && size.height > 0,
        ));
      } catch (error) { reportError(error); }
    },
  };
}
