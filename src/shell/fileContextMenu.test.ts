// @vitest-environment jsdom
import { LogicalPosition } from "@tauri-apps/api/dpi";
import type { Window } from "@tauri-apps/api/window";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  popup: vi.fn(),
  reveal: vi.fn(),
  invoke: vi.fn(),
  copy: vi.fn(),
  currentWindow: vi.fn(),
  // GTK content-child origin relative to the GdkWindow (CSD header / borders).
  chrome: new Map<string, { x: number; y: number }>(),
}));

vi.mock("@tauri-apps/api/menu", () => ({ Menu: { new: mocks.create } }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/plugin-opener", () => ({ revealItemInDir: mocks.reveal }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ message: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: mocks.currentWindow }));

import { createFileContextMenu } from "./fileContextMenu";

function makeWindow(label = "main"): Window {
  return { label } as unknown as Window;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.chrome.clear();
  mocks.create.mockResolvedValue({ popup: mocks.popup });
  mocks.copy.mockResolvedValue(undefined);
  mocks.reveal.mockResolvedValue(undefined);
  mocks.chrome.set("main", { x: 0, y: 0 });
  mocks.chrome.set("video-overlay", { x: 0, y: 0 });
  mocks.invoke.mockImplementation(async (command: string, args?: { label?: string }) => {
    if (command === "menu_popup_chrome_offset") {
      const label = args?.label ?? "main";
      return mocks.chrome.get(label) ?? { x: 0, y: 0 };
    }
  });
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: mocks.copy } });
  mocks.currentWindow.mockImplementation(() => makeWindow());
});

it("does not offer file actions without a current file", async () => {
  await createFileContextMenu(() => null)({ x: 10, y: 20 });
  expect(mocks.create).not.toHaveBeenCalled();
});
it("acts on the file selected when the menu opened and refreshes on next opening", async () => {
  let path = "/tmp/中文 文件.png";
  const show = createFileContextMenu(() => path);
  await show({ x: 120, y: 80 });
  const items = mocks.create.mock.calls[0][0].items;
  path = "/tmp/next.png";
  items[0].action(); items[1].action(); items[3].action(); items[4].action();
  expect(mocks.copy.mock.calls).toEqual([["/tmp/中文 文件.png"], ["中文 文件.png"]]);
  expect(mocks.reveal).toHaveBeenCalledWith("/tmp/中文 文件.png");
  expect(mocks.invoke).toHaveBeenCalledWith("choose_file_application", { path: "/tmp/中文 文件.png" });
  await show({ x: 120, y: 80 });
  items[0].action();
  expect(mocks.copy).toHaveBeenLastCalledWith("/tmp/next.png");
  expect(mocks.create).toHaveBeenCalledTimes(1);
});

it("anchors the menu to the click when the window has no chrome", async () => {
  await createFileContextMenu(() => "/tmp/file.png")({ x: 123.5, y: 87.25 });
  expect(mocks.invoke).toHaveBeenCalledWith("menu_popup_chrome_offset", { label: "main" });
  expect(mocks.popup).toHaveBeenCalledWith(new LogicalPosition(123.5, 87.25), undefined);
});
it("uses the overlay window as the origin for video clicks", async () => {
  const overlay = makeWindow("video-overlay");
  await createFileContextMenu(() => "/tmp/video.mp4")({ x: 40, y: 60 }, overlay);
  expect(mocks.invoke).toHaveBeenCalledWith("menu_popup_chrome_offset", { label: "video-overlay" });
  expect(mocks.popup).toHaveBeenCalledWith(new LogicalPosition(40, 60), overlay);
});

it("adds the GTK content-child offset so the menu lands at the cursor under a CSD header", async () => {
  // Wayland + decorations: HeaderBar sits inside the GdkWindow; clientX/Y
  // start below it. muda popup_at_rect is GdkWindow-relative (tauri#13608).
  mocks.chrome.set("main", { x: 0, y: 37 });
  await createFileContextMenu(() => "/tmp/file.png")({ x: 100, y: 200 });
  expect(mocks.popup).toHaveBeenCalledWith(new LogicalPosition(100, 237), undefined);
});

it("applies a non-zero X chrome offset (CSD side inset)", async () => {
  mocks.chrome.set("main", { x: 26, y: 24 });
  await createFileContextMenu(() => "/tmp/file.png")({ x: 100, y: 200 });
  expect(mocks.popup).toHaveBeenCalledWith(new LogicalPosition(126, 224), undefined);
});

it("queries the owner window for the offset, not the current one", async () => {
  mocks.chrome.set("main", { x: 0, y: 37 });
  mocks.chrome.set("video-overlay", { x: 0, y: 0 });
  const overlay = makeWindow("video-overlay");
  await createFileContextMenu(() => "/tmp/video.mp4")({ x: 40, y: 60 }, overlay);
  expect(mocks.popup).toHaveBeenCalledWith(new LogicalPosition(40, 60), overlay);
});

it("recomputes the offset on every right-click so header size changes are picked up", async () => {
  mocks.chrome.set("main", { x: 0, y: 37 });
  const show = createFileContextMenu(() => "/tmp/file.png");
  await show({ x: 10, y: 10 });
  mocks.chrome.set("main", { x: 0, y: 48 });
  await show({ x: 20, y: 20 });
  expect(mocks.popup.mock.calls[0][0]).toEqual(new LogicalPosition(10, 47));
  expect(mocks.popup.mock.calls[1][0]).toEqual(new LogicalPosition(20, 68));
});
