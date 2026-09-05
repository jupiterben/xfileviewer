import { Channel, convertFileSrc, invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  LogicalPosition,
  LogicalSize,
  currentMonitor,
  getCurrentWindow,
} from "@tauri-apps/api/window";
import { PluginRegistry } from "./core/registry";
import { basename } from "./core/path";
import { buildSequence, move, createSequenceAppender } from "./core/sequence";
import { KIND_DOCUMENT, type Sequence, type ViewerHandle } from "./core/types";
import {
  loadMediaWindowMode,
  mediaWindowModeLabel,
  resolveMediaWindowMode,
  saveMediaWindowMode,
  shouldFitWindowToContent,
  shouldRememberWindowSize,
  toggleMediaWindowMode,
  type MediaWindowMode,
} from "./shell/mediaWindow";
import { escAction } from "./shell/escAction";
import { sequenceStepForKey } from "./shell/sequenceKeys";
import { builtinPlugins } from "./plugins/builtin";
import { loadExternalPlugins } from "./plugins/external";
import {
  associationDecision,
  rememberAssociation,
  type AssociationSettings,
} from "./shell/associations";
import {
  associationChanges,
  buildAssociationRows,
  groupAssociationRows,
  mergeAssociationState,
  setAssociationRowError,
  setKindGranted,
  setRowGranted,
  type AssociationRow,
} from "./shell/associationSettings";
import { resolveAppVersion } from "./shell/appVersion";
import {
  fitWindowToContent,
  positionKeepingCenter,
  type Size,
} from "./shell/fitWindow";
import { createWheelPager, kindUsesWheelPaging } from "./shell/wheelPager";
import {
  rememberSize,
  sizeForKind,
  type WindowSizes,
} from "./shell/windowSizes";

const host = document.querySelector<HTMLElement>("#viewer-host")!;
const prevBtn = document.querySelector<HTMLButtonElement>("#prev")!;
const nextBtn = document.querySelector<HTMLButtonElement>("#next")!;
const overlay = document.querySelector<HTMLElement>("#assoc-overlay")!;
const assocText = document.querySelector<HTMLElement>("#assoc-text")!;
const assocYes = document.querySelector<HTMLButtonElement>("#assoc-yes")!;
const assocNo = document.querySelector<HTMLButtonElement>("#assoc-no")!;
const workspace = document.querySelector<HTMLElement>(".workspace")!;
const scanStatusEl = document.createElement("div");
scanStatusEl.className = "scan-status";
scanStatusEl.hidden = true;
workspace.append(scanStatusEl);
const settingsPage = document.querySelector<HTMLElement>("#settings")!;
const settingsList = document.querySelector<HTMLElement>("#settings-list")!;
const settingsBack = document.querySelector<HTMLButtonElement>("#settings-back")!;
const settingsApply = document.querySelector<HTMLButtonElement>("#settings-apply")!;
const mediaWindowBtn = document.querySelector<HTMLButtonElement>("#media-window-mode")!;
const mediaWindowRadios = document.querySelectorAll<HTMLInputElement>(
  'input[name="media-window-mode"]',
);

const registry = new PluginRegistry();
let sequence: Sequence | null = null;
let openRequest = 0;
let scanning = false;
let scanError = "";
let scannedEntries = 0;
let receivedFiles = 0;
let handle: ViewerHandle | null = null;
let settings: AssociationSettings = {
  granted: [],
  denied: [],
};
let windowSizes: WindowSizes = {};
let mediaWindowMode: MediaWindowMode = loadMediaWindowMode(localStorage);
let lastContentSize: { width: number; height: number; chrome: Size } | null =
  null;
let saveSizeTimer: number | undefined;
let appliedRows: AssociationRow[] = [];
let associationRows: AssociationRow[] = [];
let appVersionLabel = "";

interface AssociationQuery {
  osManaged: boolean;
  granted: Record<string, boolean>;
}

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
  closeSettingsView();
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
    void openSettings();
  });
  wrap.append(p, btn);
  if (appVersionLabel) {
    const ver = document.createElement("p");
    ver.className = "app-version";
    ver.textContent = appVersionLabel;
    wrap.append(ver);
  }
  host.append(wrap);
  lastContentSize = null;
  setWindowTitle("");
  prevBtn.disabled = true;
  nextBtn.disabled = true;
  updateMediaWindowModeUi();
}

function closeSettingsView() {
  if (settingsPage.hidden) return;
  settingsPage.hidden = true;
  workspace.hidden = false;
  if (!sequence) setWindowTitle("");
  updateMediaWindowModeUi();
}

async function openSettings() {
  workspace.hidden = true;
  settingsPage.hidden = false;
  setWindowTitle("设置");
  updateMediaWindowModeUi();
  await refreshAssociationRows();
}

async function refreshAssociationRows() {
  associationRows = buildAssociationRows(registry.extensionsWithPlugins());
  const extensions = associationRows.map((row) => row.ext);
  try {
    const queried = await invoke<AssociationQuery>("query_file_associations", {
      extensions,
    });
    associationRows = mergeAssociationState(
      associationRows,
      queried.granted,
      settings,
      queried.osManaged,
    );
  } catch {
    associationRows = mergeAssociationState(
      associationRows,
      {},
      settings,
      false,
    );
  }
  appliedRows = associationRows;
  renderAssociationRows();
}

function renderAssociationRows() {
  settingsList.replaceChildren();
  for (const group of groupAssociationRows(associationRows)) {
    const heading = document.createElement("label");
    heading.className = "assoc-kind";
    const kindInput = document.createElement("input");
    kindInput.type = "checkbox";
    kindInput.checked = group.checkState === "all";
    kindInput.indeterminate = group.checkState === "mixed";
    kindInput.addEventListener("change", () => {
      associationRows = setKindGranted(
        associationRows,
        group.kindId,
        kindInput.checked,
      );
      renderAssociationRows();
    });
    const kindName = document.createElement("span");
    kindName.textContent = group.label;
    heading.append(kindInput, kindName);
    settingsList.append(heading);
    const wrap = document.createElement("div");
    wrap.className = "assoc-exts";
    for (const row of group.rows) {
      const label = document.createElement("label");
      label.className = "assoc-row";
      label.title = row.error ? row.error : row.pluginName;
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = row.granted;
      input.addEventListener("change", () => {
        associationRows = setRowGranted(associationRows, row.ext, input.checked);
        renderAssociationRows();
      });
      const ext = document.createElement("span");
      ext.className = "assoc-ext";
      ext.textContent = `.${row.ext}`;
      label.append(input, ext);
      if (row.error) label.classList.add("is-error");
      wrap.append(label);
    }
    settingsList.append(wrap);
  }
  updateApplyEnabled();
}

function updateApplyEnabled() {
  const changes = associationChanges(appliedRows, associationRows);
  settingsApply.disabled = changes.grant.length === 0 && changes.revoke.length === 0;
}

async function applyAssociations() {
  const { grant, revoke } = associationChanges(appliedRows, associationRows);
  let rows = associationRows;
  let failed = false;
  for (const ext of grant) {
    try {
      await invoke("grant_file_associations", { extensions: [ext] });
      settings = rememberAssociation(settings, [ext], true);
    } catch (err) {
      failed = true;
      rows = setAssociationRowError(rows, ext, invokeErrorText(err));
    }
  }
  for (const ext of revoke) {
    try {
      await invoke("revoke_file_associations", { extensions: [ext] });
      settings = rememberAssociation(settings, [ext], false);
    } catch (err) {
      failed = true;
      rows = setAssociationRowError(rows, ext, invokeErrorText(err));
    }
  }
  await invoke("save_association_settings", { settings });
  const errors = Object.fromEntries(
    rows.filter((row) => row.error).map((row) => [row.ext, row.error!]),
  );
  await refreshAssociationRows();
  if (!failed) return;
  for (const [ext, error] of Object.entries(errors)) {
    associationRows = setAssociationRowError(associationRows, ext, error);
  }
  renderAssociationRows();
}

function invokeErrorText(err: unknown): string {
  const text = String(err);
  return text.includes("无法关联") ? "无法关联" : text || "无法关联";
}

function destroyViewer() {
  try {
    handle?.destroy();
  } catch {
    // Viewer teardown must not kill the shell.
  }
  handle = null;
  lastContentSize = null;
}

function renderError(message: string) {
  destroyViewer();
  host.replaceChildren();
  const p = document.createElement("p");
  p.className = "error";
  p.textContent = message;
  host.append(p);
  updateMediaWindowModeUi();
}

function updateChrome() {
  const path = currentPath();
  if (!sequence || !path) {
    scanStatusEl.hidden = true;
    prevBtn.disabled = true;
    nextBtn.disabled = true;
    setWindowTitle("");
    return;
  }
  if (document.title !== basename(path)) setWindowTitle(basename(path));
  prevBtn.disabled = sequence.items.length < 2;
  nextBtn.disabled = sequence.items.length < 2;
  const position = `${sequence.index + 1} / ${sequence.items.length}`;
  const scanStatus = scanning ? " · 正在后台扫描目录" : scanError;
  prevBtn.title = `上一个（${position}）${scanStatus}`;
  nextBtn.title = `下一个（${position}）${scanStatus}`;
  scanStatusEl.hidden = false;
  scanStatusEl.textContent = scanError
    ? `${position} · ${scanError}`
    : `${position} · ${scanning ? "扫描中" : "扫描完成"}：已检查 ${scannedEntries} 项，收到 ${receivedFiles} 个文件`;
}

async function resizeWindowToContent(
  width: number,
  height: number,
  chrome: Size = { width: 0, height: 0 },
) {
  const win = getCurrentWindow();
  const scale = await win.scaleFactor();
  const monitor = await currentMonitor();
  const work = monitor
    ? {
        ...monitor.workArea.position.toLogical(monitor.scaleFactor),
        ...monitor.workArea.size.toLogical(monitor.scaleFactor),
      }
    : {
        x: 0,
        y: 0,
        width: window.screen.availWidth,
        height: window.screen.availHeight,
      };
  const size = fitWindowToContent(
    { width, height },
    chrome,
    { width: work.width, height: work.height },
  );
  const outerPos = (await win.outerPosition()).toLogical(scale);
  const outerSize = (await win.outerSize()).toLogical(scale);
  const innerSize = (await win.innerSize()).toLogical(scale);
  const nextOuter = {
    width: size.width + (outerSize.width - innerSize.width),
    height: size.height + (outerSize.height - innerSize.height),
  };
  const pos = positionKeepingCenter(
    {
      x: outerPos.x,
      y: outerPos.y,
      width: outerSize.width,
      height: outerSize.height,
    },
    nextOuter,
  );
  await win.setSize(new LogicalSize(size.width, size.height));
  await win.setPosition(new LogicalPosition(pos.x, pos.y));
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
  try {
    handle = viewer.mount(stage, {
      path,
      src: convertFileSrc(path),
      onEnded: () => go(1),
      onError: (message) => renderError(message),
      onContentSize: (width, height, chrome) => {
        lastContentSize = {
          width,
          height,
          chrome: chrome ?? { width: 0, height: 0 },
        };
        if (
          !sequence ||
          !shouldFitWindowToContent(sequence.kindId, mediaWindowMode)
        ) {
          return;
        }
        void resizeWindowToContent(
          width,
          height,
          lastContentSize.chrome,
        );
      },
    });
  } catch (err) {
    renderError(err instanceof Error ? err.message : String(err));
  }
  updateChrome();
  updateMediaWindowModeUi();
}

async function openPath(path: string) {
  scannedEntries = 0;
  receivedFiles = 0;
  const request = ++openRequest;
  scanning = false;
  scanError = "";
  closeSettingsView();
  setWindowTitle(basename(path));
  const kindId = registry.kindFor(path);
  if (!kindId) {
    showEmpty(`不支持的文件类型：${basename(path)}`);
    return;
  }
  await maybePromptAssociation(path);
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
  lastContentSize = null;
  if (shouldRememberWindowSize(kindId, mediaWindowMode)) {
    await restoreKindWindow(kindId);
  }
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
async function restoreKindWindow(kindId: string) {
  const size =
    kindId === KIND_DOCUMENT
      ? sizeForKind(windowSizes, kindId)
      : windowSizes[kindId];
  if (!size) return;
  await getCurrentWindow().setSize(new LogicalSize(size.width, size.height));
}

function scheduleSaveWindowSize() {
  if (!sequence || !shouldRememberWindowSize(sequence.kindId, mediaWindowMode)) {
    return;
  }
  window.clearTimeout(saveSizeTimer);
  saveSizeTimer = window.setTimeout(() => {
    void persistKindWindow();
  }, 400);
}

async function persistKindWindow() {
  if (!sequence || !shouldRememberWindowSize(sequence.kindId, mediaWindowMode)) {
    return;
  }
  const win = getCurrentWindow();
  const inner = await win.innerSize();
  const logical = inner.toLogical(await win.scaleFactor());
  windowSizes = rememberSize(windowSizes, sequence.kindId, {
    width: Math.round(logical.width),
    height: Math.round(logical.height),
  });
  await invoke("save_window_sizes", { sizes: windowSizes });
}

function updateMediaWindowModeUi() {
  const viewingMedia =
    !!sequence && shouldFitWindowToContent(sequence.kindId, "fit");
  mediaWindowBtn.hidden = !viewingMedia || !settingsPage.hidden;
  mediaWindowBtn.textContent = mediaWindowModeLabel(mediaWindowMode);
  for (const input of mediaWindowRadios) {
    input.checked = input.value === mediaWindowMode;
  }
}

async function setMediaWindowMode(mode: MediaWindowMode) {
  mediaWindowMode = mode;
  saveMediaWindowMode(localStorage, mode);
  updateMediaWindowModeUi();
  if (!sequence) return;
  if (shouldRememberWindowSize(sequence.kindId, mode)) {
    await persistKindWindow();
    return;
  }
  if (
    lastContentSize &&
    shouldFitWindowToContent(sequence.kindId, mode)
  ) {
    await resizeWindowToContent(
      lastContentSize.width,
      lastContentSize.height,
      lastContentSize.chrome,
    );
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

async function maybePromptAssociation(path: string) {
  const plugin = registry.pluginFor(path);
  if (!plugin?.requestAssociation) return;
  const exts = plugin.viewers.flatMap((v) => v.extensions);
  const decision = associationDecision(settings, exts);
  if (decision !== "ask") return;
  const ok = await promptAssociation(plugin.name, exts);
  settings = rememberAssociation(settings, exts, ok);
  await invoke("save_association_settings", { settings });
  if (ok) {
    try {
      await invoke("grant_file_associations", { extensions: exts });
    } catch {
      // remembered; OS grant can fail for unknown MIME
    }
  }
}

function promptAssociation(name: string, exts: string[]): Promise<boolean> {
  assocText.textContent = `插件「${name}」想关联 ${exts.map((e) => "." + e).join(" ")}，设为默认打开方式？`;
  overlay.hidden = false;
  return new Promise((resolve) => {
    const finish = (ok: boolean) => {
      overlay.hidden = true;
      assocYes.removeEventListener("click", onYes);
      assocNo.removeEventListener("click", onNo);
      resolve(ok);
    };
    const onYes = () => finish(true);
    const onNo = () => finish(false);
    assocYes.addEventListener("click", onYes);
    assocNo.addEventListener("click", onNo);
  });
}

prevBtn.addEventListener("click", () => go(-1));
nextBtn.addEventListener("click", () => go(1));
mediaWindowBtn.addEventListener("click", () => {
  void setMediaWindowMode(toggleMediaWindowMode(mediaWindowMode));
});
for (const input of mediaWindowRadios) {
  input.addEventListener("change", () => {
    if (!input.checked) return;
    void setMediaWindowMode(resolveMediaWindowMode(input.value));
  });
}
settingsBack.addEventListener("click", () => closeSettingsView());
settingsApply.addEventListener("click", () => void applyAssociations());
document.addEventListener("mousedown", (event) => {
  if (event.button !== 0 || overlay.hidden === false || !settingsPage.hidden) return;
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
    const action = escAction(overlay.hidden === false, !settingsPage.hidden);
    if (action === "ignore") return;
    e.preventDefault();
    if (action === "close-settings") {
      closeSettingsView();
      return;
    }
    void getCurrentWindow().close();
    return;
  }
  if (overlay.hidden === false) return;
  if (!settingsPage.hidden) return;
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
    if (overlay.hidden === false || !settingsPage.hidden || !sequence) return;
    if (!kindUsesWheelPaging(sequence.kindId)) return;
    e.preventDefault();
    const dir = wheelPage(e.deltaY);
    if (dir) go(dir);
  },
  { passive: false },
);

async function boot() {
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
  settings = await invoke<AssociationSettings>("load_association_settings");
  try {
    windowSizes = await invoke<WindowSizes>("load_window_sizes");
  } catch {
    windowSizes = {};
  }
  await getCurrentWindow().onResized(() => {
    scheduleSaveWindowSize();
  });
  await getCurrentWebview().onDragDropEvent((event) => {
    if (event.payload.type === "drop" && event.payload.paths[0]) {
      void openPath(event.payload.paths[0]);
    }
  });
  const launch = await invoke<string | null>("take_launch_path");
  if (launch) {
    await openPath(launch);
  } else {
    showEmpty("双击图片、视频或 Markdown，或把文件拖到这里");
  }
  updateMediaWindowModeUi();
}

void boot();
