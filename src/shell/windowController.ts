import { invoke } from "@tauri-apps/api/core";
import { currentMonitor, getCurrentWindow, LogicalPosition, LogicalSize } from "@tauri-apps/api/window";
import { KIND_DOCUMENT } from "../core/types";
import { clampPositionToWorkArea, fitWindowToContent, type Size } from "./fitWindow";
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
  // Resize requests are serialized through a single in-flight slot: rapid
  // navigation (holding an arrow key while browsing photos) fires many
  // onContentSize reports back to back, and each resize spans several async
  // geometry round-trips. Without serialization the setSize/setPosition pairs
  // of overlapping resizes interleave — a stale resize can apply its size but
  // have its position cancelled by the revision guard, leaving the window
  // sized-but-not-recentered, and the next resize then centers on that wrong
  // state. Coalescing keeps exactly one resize running and the newest request
  // wins, so the final window is always sized AND centered consistently.
  let pendingResize: { width: number; height: number; chrome: Size } | null = null;
  let resizeRunning = false;

  async function resize(width: number, height: number, chrome: Size) {
    const request = ++revision;
    pendingResize = { width, height, chrome };
    void drainResize().catch(reportError);
    return request;
  }

  function sync() {
    const kind = getKind();
    button.hidden = !kind || !shouldFitWindowToContent(kind, "fit") || isSettingsOpen();
    button.textContent = mediaWindowModeLabel(mode);
    for (const radio of radios) radio.checked = radio.value === mode;
  }

  async function drainResize() {
    if (resizeRunning) return;
    resizeRunning = true;
    try {
      while (pendingResize) {
        const job = pendingResize;
        pendingResize = null;
        await resizeNow(job.width, job.height, job.chrome);
      }
    } finally {
      resizeRunning = false;
    }
  }

  async function resizeNow(width: number, height: number, chrome: Size) {
    const request = revision;
    const win = getCurrentWindow();
    const scale = await win.scaleFactor();
    if (request !== revision) return;
    const monitor = await currentMonitor();
    const work = monitor
      ? monitor.workArea.size.toLogical(monitor.scaleFactor)
      : { width: window.screen.availWidth, height: window.screen.availHeight };
    const workOrigin = monitor
      ? monitor.workArea.position.toLogical(monitor.scaleFactor)
      : { x: 0, y: 0 };
    // Capture the window's current rectangle BEFORE resizing: the center the
    // user currently sees is what must stay fixed. (Reading after setSize
    // would observe the already-resized window at its old position, whose
    // center has already drifted — centering on that would freeze the drift.)
    const positionBefore = (await win.outerPosition()).toLogical(scale);
    const outerBefore = (await win.outerSize()).toLogical(scale);
    const innerBefore = (await win.innerSize()).toLogical(scale);
    if (request !== revision) return;
    // The OS window frame (outer minus inner) is invisible chrome that sits
    // outside the webview. fitWindowToContent subtracts it from the work area
    // so the outer window still fits; without it a tall image would make the
    // outer window taller than the work area and its bottom would be hidden
    // under the taskbar.
    const frame = {
      width: outerBefore.width - innerBefore.width,
      height: outerBefore.height - innerBefore.height,
    };
    const size = fitWindowToContent({ width, height }, chrome, work, { width: 240, height: 160 }, frame);
    document.title = JSON.stringify({ content: { width, height }, work, frame, size, outerBefore, innerBefore });
    const targetCenter = {
      x: positionBefore.x + outerBefore.width / 2,
      y: positionBefore.y + outerBefore.height / 2,
    };
    await win.setSize(new LogicalSize(size.width, size.height));
    // Predict the outer size the resized window will have (same chrome, same
    // monitor), then place it so its center coincides with the pre-resize
    // center. The serialized queue guarantees no other resize interleaves
    // between setSize and setPosition, so the pair lands atomically. Finally
    // clamp the position to the work area: keeping the center is what makes
    // navigation feel stable, but a tall/wide image centered on an
    // off-center window would push the image off-screen (e.g. a portrait
    // photo whose top ends up above the screen edge).
    const outerAfter = {
      width: size.width + frame.width,
      height: size.height + frame.height,
    };
    const centered = {
      x: Math.round(targetCenter.x - outerAfter.width / 2),
      y: Math.round(targetCenter.y - outerAfter.height / 2),
    };
    const nextPosition = clampPositionToWorkArea(centered, outerAfter, { ...workOrigin, ...work });
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
