import { flushSync, mount } from "svelte";
import App from "../../src/ui/App.svelte";
// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import type { ViewerContext, ViewerNavigation } from "../../src/core/types";

const mocks = vi.hoisted(() => ({
  contexts: [] as ViewerContext[],
  openDialog: vi.fn<() => Promise<string | null>>(),
  navigation: vi.fn(),
  destroyed: vi.fn(),
  setTitle: vi.fn(async () => {}),
  drop: undefined as undefined | ((event: { payload: { type: string; paths: string[] } }) => void),
  batch: undefined as undefined | { onmessage: (batch: { files: string[]; directories?: string[]; scanned: number; done: boolean }) => void },
  scans: new Map<string, { onmessage: (batch: { files: string[]; directories?: string[]; scanned: number; done: boolean }) => void }>(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.openDialog }));
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset:${path}`,
  Channel: class { onmessage = () => {}; },
  invoke: vi.fn(async (command, args) => {
    if (command === "load_association_settings" || command === "load_window_sizes") throw new Error("corrupt config");
    if (command === "take_launch_path") return "/fixtures/first.mp4";
    if (command === "parent_dir") return "/fixtures";
    if (command === "list_dir_files") {
      mocks.batch = args.onBatch;
      mocks.scans.set(args.dir, args.onBatch);
    }
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(async () => {}),
  listen: vi.fn(async () => () => {}),
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: async (handler: typeof mocks.drop) => { mocks.drop = handler; },
    setFocus: vi.fn(async () => {}),
  }),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ setTitle: mocks.setTitle, onResized: vi.fn(async () => {}) }),
}));
vi.mock("../../src/shell/appVersion", () => ({ resolveAppVersion: async () => "v-test" }));
vi.mock("../../src/plugins/external", () => ({ loadExternalPlugins: async () => [] }));
vi.mock("../../src/plugins/builtin", () => ({
  builtinPlugins: () => [{
    id: "test", name: "Test", version: "1",
    viewers: [
      { id: "video", kindId: "video", extensions: ["mp4"] },
      { id: "image", kindId: "image", extensions: ["jpg"] },
      { id: "model", kindId: "3dmodel", extensions: ["ply", "splat"] },
    ].map(descriptor => ({
      ...descriptor,
      mount(el: HTMLElement, ctx: ViewerContext) {
        mocks.contexts.push(ctx);
        if (descriptor.kindId === "video") {
          const toolbar = document.createElement("footer");
          el.append(toolbar);
          ctx.onToolbar?.(toolbar);
        }
        return {
          destroy: mocks.destroyed,
          setNavigation: (state: ViewerNavigation) => mocks.navigation(state),
        };
      },
    })),
  }],
}));

it("boots with corrupt settings, scans, navigates, docks tools and discards stale viewer events", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  document.body.replaceChildren();
  mount(App, { target: document.body });
  const { bootApplication } = await import("../../src/shell/application");
  await expect(bootApplication()).resolves.toBeUndefined();
  expect(mocks.contexts[0].path).toBe("/fixtures/first.mp4");
  expect(document.querySelector("#media-window-mode")?.parentElement?.tagName).toBe("FOOTER");
  expect(document.querySelector(".workspace")?.classList.contains("video-viewing")).toBe(true);
  mocks.batch!.onmessage({ files: ["/fixtures/second.mp4"], scanned: 2, done: true });
  expect(mocks.navigation).toHaveBeenLastCalledWith(expect.objectContaining({ disabled: false }));
  document.querySelector<HTMLButtonElement>("#next")!.click();
  expect(mocks.contexts[1].path).toBe("/fixtures/second.mp4");
  expect(mocks.destroyed).toHaveBeenCalledTimes(1);
  mocks.scans.get("/fixtures")!.onmessage({ files: [], directories: ["/fixtures/album", "/fixtures/other"], scanned: 4, done: true });
  flushSync();
  expect(mocks.scans.has("/fixtures/album")).toBe(false);
  const folder = () => document.querySelector<HTMLButtonElement>('button[title="/fixtures/album"]')!;
  folder().click(); flushSync();
  await vi.waitFor(() => expect(mocks.scans.has("/fixtures/album")).toBe(true));
  const albumScan = mocks.scans.get("/fixtures/album")!;
  albumScan.onmessage({ files: ["/fixtures/album/third.mp4", "/fixtures/album/ignore.jpg"], directories: [], scanned: 2, done: true });
  flushSync();
  expect(document.querySelector('button[title="/fixtures/album/third.mp4"]')).not.toBeNull();
  expect(document.querySelector('button[title="/fixtures/album/ignore.jpg"]')).toBeNull();
  const mounts = mocks.contexts.length;
  folder().click(); flushSync();
  expect(document.querySelector('button[title="/fixtures/album/third.mp4"]')).toBeNull();
  expect(mocks.contexts).toHaveLength(mounts);
  folder().click(); flushSync();
  expect(mocks.scans.get("/fixtures/album")).toBe(albumScan); // Cached, no rescan.
  document.querySelector<HTMLButtonElement>('button[title="/fixtures/album/third.mp4"]')!.click();
  expect(mocks.contexts[mocks.contexts.length - 1]?.path).toBe("/fixtures/album/third.mp4");
  const keyboardLeak = vi.fn();
  window.addEventListener("keydown", keyboardLeak);
  const activate = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
  folder().dispatchEvent(activate);
  expect(activate.defaultPrevented).toBe(false);
  expect(keyboardLeak).not.toHaveBeenCalled();
  window.removeEventListener("keydown", keyboardLeak);
  const sidebarWheel = new WheelEvent("wheel", { deltaY: 300, bubbles: true, cancelable: true });
  document.querySelector(".sidebar-files")!.dispatchEvent(sidebarWheel);
  expect(sidebarWheel.defaultPrevented).toBe(false);
  expect(mocks.contexts[mocks.contexts.length - 1]?.path).toBe("/fixtures/album/third.mp4");
  document.querySelector<HTMLButtonElement>('button[title="/fixtures/other"]')!.click(); flushSync();
  await vi.waitFor(() => expect(mocks.scans.has("/fixtures/other")).toBe(true));
  const staleScan = mocks.scans.get("/fixtures/other")!;
  mocks.drop!({ payload: { type: "drop", paths: ["/fixtures/photo.jpg"] } });
  await vi.waitFor(() => expect(mocks.contexts[mocks.contexts.length - 1]?.path).toBe("/fixtures/photo.jpg"));
  staleScan.onmessage({ files: ["/fixtures/other/stale.mp4"], directories: ["/fixtures/other/stale"], scanned: 2, done: true });
  flushSync();
  expect(document.querySelector('button[title="/fixtures/other/stale.mp4"]')).toBeNull();
  expect(document.querySelector('button[title="/fixtures/other/stale"]')).toBeNull();
  mocks.contexts[0].onError("obsolete error");
  expect(document.querySelector(".error")).toBeNull();
  expect(document.querySelector("#media-window-mode")?.parentElement?.className).toBe("workspace");
  expect(document.querySelector(".workspace")?.classList.contains("video-viewing")).toBe(false);
  expect(warn).toHaveBeenCalled();
  mocks.openDialog.mockResolvedValueOnce("/fixtures/model.ply");
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "o", ctrlKey: true, cancelable: true }));
  await vi.waitFor(() => expect(mocks.contexts[mocks.contexts.length - 1]?.path).toBe("/fixtures/model.ply"));
  expect(mocks.openDialog).toHaveBeenCalledWith(expect.objectContaining({
    filters: [{ name: "支持的文件", extensions: expect.arrayContaining(["ply", "splat"]) }],
  }));
  const current = mocks.contexts.length;
  mocks.openDialog.mockResolvedValueOnce(null);
  mocks.contexts[mocks.contexts.length - 1]?.onOpen?.();
  await vi.waitFor(() => expect(mocks.openDialog).toHaveBeenCalledTimes(2));
  expect(mocks.contexts).toHaveLength(current);
  warn.mockRestore();
});
