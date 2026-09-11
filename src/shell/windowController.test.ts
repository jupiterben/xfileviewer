// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { createWindowController } from "./windowController";

const win = vi.hoisted(() => ({
  scaleFactor: vi.fn(async () => 1),
  setSize: vi.fn(async (_size: unknown) => {}),
  setPosition: vi.fn(async () => {}),
  outerPosition: vi.fn(async () => ({ toLogical: () => ({ x: 0, y: 0 }) })),
  outerSize: vi.fn(async () => ({ toLogical: () => ({ width: 1100, height: 740 }) })),
  innerSize: vi.fn(async () => ({ toLogical: () => ({ width: 1100, height: 720 }) })),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => win,
  currentMonitor: async () => ({ scaleFactor: 1, workArea: { size: { toLogical: () => ({ width: 1920, height: 1080 }) } } }),
  LogicalSize: class { constructor(public width: number, public height: number) {} },
  LogicalPosition: class { constructor(public x: number, public y: number) {} },
}));
beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  document.body.innerHTML = '<button id="media-window-mode"></button>';
});
afterEach(() => { vi.useRealTimers(); });

it("ignores invalid persisted dimensions and restores the document default", async () => {
  vi.mocked(invoke).mockResolvedValue({ document: { width: -1, height: 500 } });
  const controller = createWindowController(() => "document", () => false);
  await controller.load();
  await controller.restore("document");
  expect(win.setSize).toHaveBeenCalledWith(expect.objectContaining({ width: 1100, height: 720 }));
});

it("does not resize a new viewer using an old viewer's delayed measurement", async () => {
  let finish!: (scale: number) => void;
  win.scaleFactor.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const controller = createWindowController(() => "image", () => false);
  controller.reportContentSize(640, 480);
  controller.clearContent();
  finish(1);
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(win.setSize).not.toHaveBeenCalled();
  expect(win.setPosition).not.toHaveBeenCalled();
});

it("cancels a pending size save when the viewing session changes", async () => {
  vi.useFakeTimers();
  const controller = createWindowController(() => "document", () => false);
  controller.scheduleSave();
  controller.clearContent();
  await vi.runAllTimersAsync();
  expect(invoke).not.toHaveBeenCalled();
});
