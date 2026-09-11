import { Channel, convertFileSrc, invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { PluginRegistry } from "../core/registry";
import { basename } from "../core/path";
import { buildSequence, move, createSequenceAppender } from "../core/sequence";
import { KIND_VIDEO, type Sequence } from "../core/types";
import { createViewerSession } from "./viewerSession";
import { createAssociationController } from "./associationController";
import { createWindowController } from "./windowController";
import { escAction } from "./escAction";
import { markOverlayReady } from "./overlayReadiness";
import { sequenceStepForKey } from "./sequenceKeys";
import { builtinPlugins } from "../plugins/builtin";
import { loadExternalPlugins } from "../plugins/external";
import {
  resolveAppVersion,
} from "./appVersion";
import { createWheelPager, kindUsesWheelPaging } from "./wheelPager";

const host = document.querySelector<HTMLElement>("#viewer-host")!;
const prevBtn = document.querySelector<HTMLButtonElement>("#prev")!;
const nextBtn = document.querySelector<HTMLButtonElement>("#next")!;
const workspace = document.querySelector<HTMLElement>(".workspace")!;
const scanStatusEl = document.createElement("div");
scanStatusEl.className = "scan-status";
scanStatusEl.hidden = true;
workspace.append(scanStatusEl);
const mediaWindowBtn = document.querySelector<HTMLButtonElement>("#media-window-mode")!;

const registry = new PluginRegistry();
let sequence: Sequence | null = null;
let openRequest = 0;
let scanning = false;
let scanError = "";
let scannedEntries = 0;
let receivedFiles = 0;
const viewerSession = createViewerSession();
const associations = createAssociationController(registry, open => {
  workspace.hidden = open;
  if (open) setWindowTitle("设置");
  else updateChrome();
  windowController.sync();
});
const windowController = createWindowController(() => sequence?.kindId, associations.isOpen);
let appVersionLabel = "";

function setWindowTitle(text: string) {
  const title = text.trim() || " ";
  document.title = title;
  void getCurrentWindow().setTitle(title);
}

function currentPath(): string | null {
  if (!sequence) return null;
  return sequence.items[sequence.index] ?? null;
}

function showEmpty(message: string) {
  scanStatusEl.hidden = true;
  openRequest += 1;
  scanning = false;
  scanError = "";
  associations.close();
  destroyViewer();
  sequence = null;
  host.replaceChildren();
  const wrap = document.createElement("div");
  wrap.className = "empty-wrap";
  const p = document.createElement("p");
  p.className = "empty";
  p.textContent = message;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "empty-settings";
  btn.textContent = "设置";
  btn.addEventListener("click", () => {
    void associations.open();
  });
  wrap.append(p, btn);
  if (appVersionLabel) {
    const ver = document.createElement("p");
    ver.className = "app-version";
    ver.textContent = appVersionLabel;
    wrap.append(ver);
  }
  host.append(wrap);
  setWindowTitle("");
  syncNavButtons(true);
  windowController.sync();
}

/**
 * Mirrors the window-level prev/next state onto the video control bar's nav
 * buttons. The bar buttons replace the floating arrows while a video is on
 * screen (the native backend draws over them), so they must stay in sync.
 */
function syncNavButtons(disabled: boolean, meta?: { position: string; scanStatus: string }) {
  viewerSession.setNavigation({
    disabled,
    ...(meta ? {
      previousTitle: `上一个（${meta.position}）${meta.scanStatus}`,
      nextTitle: `下一个（${meta.position}）${meta.scanStatus}`,
    } : {}),
  });
}

function destroyViewer() {
  viewerSession.destroy();
  windowController.clearContent();
  workspace.classList.remove("video-viewing");
  workspace.append(mediaWindowBtn);
  void emit("video-overlay-cmd", { show: false }).catch(() => undefined);
}

function renderError(message: string) {
  destroyViewer();
  host.replaceChildren();
  const p = document.createElement("p");
  p.className = "error";
  p.textContent = message;
  host.append(p);
  windowController.sync();
}

function updateChrome() {
  const path = currentPath();
  if (!sequence || !path) {
    scanStatusEl.hidden = true;
    prevBtn.disabled = true;
    nextBtn.disabled = true;
    syncNavButtons(true);
    setWindowTitle("");
    return;
  }
  if (!associations.isOpen() && document.title !== basename(path)) setWindowTitle(basename(path));
  const navDisabled = sequence.items.length < 2;
  prevBtn.disabled = navDisabled;
  nextBtn.disabled = navDisabled;
  const position = `${sequence.index + 1} / ${sequence.items.length}`;
  const scanStatus = scanning ? " · 正在后台扫描目录" : scanError;
  prevBtn.title = `上一个（${position}）${scanStatus}`;
  nextBtn.title = `下一个（${position}）${scanStatus}`;
  syncNavButtons(navDisabled, { position, scanStatus });
  scanStatusEl.hidden = false;
  scanStatusEl.textContent = scanError
    ? `${position} · ${scanError}`
    : `${position} · ${scanning ? "扫描中" : "扫描完成"}：已检查 ${scannedEntries} 项，收到 ${receivedFiles} 个文件`;
}

function mountCurrent() {
  const path = currentPath();
  if (!sequence || !path) return;
  const viewer = registry.viewerFor(path);
  host.replaceChildren();
  if (!viewer) {
    renderError(`没有查看器：${basename(path)}`);
    updateChrome();
    return;
  }
  const stage = document.createElement("div");
  stage.className = "stage";
  host.append(stage);
  workspace.classList.toggle("video-viewing", sequence.kindId === KIND_VIDEO);
  try {
    viewerSession.mount(viewer, stage, {
      path,
      src: convertFileSrc(path),
      onEnded: () => go(1),
      onError: (message) => renderError(message),
      onNavigate: (step) => go(step),
      isInteractionBlocked: associations.isInteractionBlocked,
      onToolbar: toolbar => (toolbar ?? workspace).append(mediaWindowBtn),
      onVolumePopup: (show, pos) => {
        void emit("video-overlay-cmd", { show, ...pos }).catch(() => undefined);
      },
      onContentSize: windowController.reportContentSize,
    });
  } catch (err) {
    renderError(err instanceof Error ? err.message : String(err));
  }
  updateChrome();
  windowController.sync();
}

async function openPath(path: string) {
  scannedEntries = 0;
  receivedFiles = 0;
  const request = ++openRequest;
  scanning = false;
  scanError = "";
  associations.close();
  setWindowTitle(basename(path));
  const kindId = registry.kindFor(path);
  if (!kindId) {
    showEmpty(`不支持的文件类型：${basename(path)}`);
    return;
  }
  await associations.promptFor(path);
  if (request !== openRequest) return;
  const next = buildSequence(
    [],
    kindId,
    registry.extensionsForKind(kindId),
    path,
  );
  if (!next) {
    showEmpty(`无法在目录中定位：${basename(path)}`);
    return;
  }
  destroyViewer();
  sequence = next;
  scanning = true;
  await windowController.restore(kindId);
  if (request !== openRequest) return;
  mountCurrent();
  void scanSequence(path, kindId, request);
}

async function scanSequence(path: string, kindId: string, request: number) {
  try {
    const folder = await invoke<string>("parent_dir", { path });
    if (request !== openRequest || !sequence) return;
    const append = createSequenceAppender(sequence, registry.extensionsForKind(kindId));
    const onBatch = new Channel<{ files: string[]; scanned: number; done: boolean }>();
    onBatch.onmessage = (batch) => {
      if (request !== openRequest || !sequence) return;
      scannedEntries = batch.scanned;
      receivedFiles += batch.files.length;
      for (const file of batch.files) append(sequence, file);
      if (batch.done) scanning = false;
      updateChrome();
    };
    console.info("[sequence] starting scan", { folder, kindId });
    await invoke("list_dir_files", { dir: folder, onBatch });
  } catch (err) {
    if (request !== openRequest) return;
    console.error("[sequence] scan failed", { path, error: err });
    scanError = `目录扫描失败：${String(err)}`;
    scanning = false;
    updateChrome();
  }
}
function go(direction: 1 | -1) {
  if (!sequence || sequence.items.length === 0) return;
  const previousPath = currentPath();
  destroyViewer();
  sequence = move(sequence, direction);
  console.debug("[sequence] navigate", {
    direction,
    from: previousPath,
    to: currentPath(),
    index: sequence.index,
    count: sequence.items.length,
  });
  mountCurrent();
}

prevBtn.addEventListener("click", () => go(-1));
nextBtn.addEventListener("click", () => go(1));
document.addEventListener("mousedown", (event) => {
  if (event.button !== 0 || associations.isInteractionBlocked()) return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (target.closest('button, input, select, textarea, a, label, [role="button"], [contenteditable="true"]')) return;
  event.preventDefault();
  void getCurrentWindow().startDragging().catch((error) => {
    console.error("Unable to drag window", error);
  });
});
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    const action = escAction(associations.isPromptOpen(), associations.isOpen());
    if (action === "ignore") return;
    e.preventDefault();
    if (action === "close-settings") {
      associations.close();
      return;
    }
    void getCurrentWindow().close();
    return;
  }
  if (associations.isInteractionBlocked()) return;
  if (!sequence) return;
  const step = sequenceStepForKey(sequence.kindId, e.key);
  if (!step) return;
  e.preventDefault();
  go(step);
});
const wheelPage = createWheelPager(() => performance.now(), 180);
window.addEventListener(
  "wheel",
  (e) => {
    if (associations.isInteractionBlocked() || !sequence) return;
    if (!kindUsesWheelPaging(sequence.kindId)) return;
    e.preventDefault();
    const dir = wheelPage(e.deltaY);
    if (dir) go(dir);
  },
  { passive: false },
);

export async function bootApplication() {
  appVersionLabel = await resolveAppVersion();
  const versionEl = document.querySelector<HTMLElement>("#app-version");
  if (versionEl && appVersionLabel) {
    versionEl.textContent = appVersionLabel;
    versionEl.hidden = false;
  }
  for (const plugin of builtinPlugins()) {
    registry.register(plugin);
  }
  const external = await loadExternalPlugins();
  for (const plugin of external) {
    registry.register(plugin);
  }
  await associations.load();
  await windowController.load();
  await getCurrentWindow().onResized(windowController.scheduleSave);
  await getCurrentWebview().onDragDropEvent((event) => {
    if (event.payload.type === "drop" && event.payload.paths[0]) {
      void openPath(event.payload.paths[0]);
    }
  });
  // While a native (libmpv) video is on screen, the video windows sit on top
  // of the WebView and the webview-level drag-drop handler never sees drops
  // over that area. native_video.rs registers its own OLE drop target there
  // and replays the dropped paths through this event. The overlay webview
  // (above the video) forwards its drops through the same channel.
  await listen<string[]>("video-file-drop", (event) => {
    const path = event.payload[0];
    if (typeof path === "string" && path) void openPath(path);
  });
  // The overlay webview covers the video surface, so wheel paging and Escape
  // there are forwarded back into this webview's handlers.
  await listen<{ deltaY: number }>("video-overlay-wheel", (event) => {
    if (associations.isInteractionBlocked() || !sequence) return;
    if (!kindUsesWheelPaging(sequence.kindId)) return;
    const dir = wheelPage(event.payload?.deltaY ?? 0);
    if (dir) go(dir);
  });
  await listen("video-overlay-closed", () => {
    void getCurrentWebview().setFocus().catch(() => undefined);
  });
  // Handshake from the overlay webview: it fires this once its popup
  // listeners are live, unblocking the popupMode switch in videoViewer.
  await listen("video-overlay-ready", () => markOverlayReady());
  const launch = await invoke<string | null>("take_launch_path");
  if (launch) {
    await openPath(launch);
  } else {
    showEmpty("双击图片、视频或 Markdown，或把文件拖到这里");
  }
  windowController.sync();
}

