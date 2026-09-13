// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { createWindowController } from "./windowController";

const win = vi.hoisted(() => ({
  scaleFactor: vi.fn(async () => 1),
  setSize: vi.fn(async (_size: { width: number; height: number }) => {}),
  setPosition: vi.fn(async (_position: { x: number; y: number }) => {}),
  outerPosition: vi.fn(async () => ({ toLogical: () => ({ x: 0, y: 0 }) })),
  outerSize: vi.fn(async () => ({ toLogical: () => ({ width: 1100, height: 740 }) })),
  innerSize: vi.fn(async () => ({ toLogical: () => ({ width: 1100, height: 720 }) })),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => win,
  currentMonitor: async () => ({
    scaleFactor: 1,
    workArea: {
      position: { toLogical: () => ({ x: 0, y: 0 }) },
      size: { toLogical: () => ({ width: 1920, height: 1080 }) },
    },
  }),
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

it("leaves room for the OS window frame so the outer window fits the work area", async () => {
  // Window has a 20px frame (outer 740 vs inner 720). A 300x3000 tall image
  // would otherwise produce an inner height of 1080 (== work area height) and
  // an outer window of 1100 that overflows the work area. The min-width floor
  // (240) applies, but the height is capped so inner (1060) + frame (20) ==
  // work area height (1080).
  win.outerSize.mockResolvedValue({ toLogical: () => ({ width: 1100, height: 740 }) });
  win.innerSize.mockResolvedValue({ toLogical: () => ({ width: 1100, height: 720 }) });
  win.outerPosition.mockResolvedValue({ toLogical: () => ({ x: 410, y: 180 }) });
  const controller = createWindowController(() => "image", () => false);
  controller.reportContentSize(300, 3000);
  await new Promise(resolve => setTimeout(resolve, 0));
  const calls = win.setSize.mock.calls;
  const [size] = calls[calls.length - 1]!;
  expect(size).toEqual(expect.objectContaining({ width: 240, height: 1060 }));
  const posCalls = win.setPosition.mock.calls;
  const [position] = posCalls[posCalls.length - 1]!;
  // Outer size = 240x1080 == work area; centered on (960, 540) and clamped.
  expect(position).toEqual(expect.objectContaining({ x: 840, y: 0 }));
});

it("clamps the centered position so a tall image stays fully on screen", async () => {
  // Window center is (550, 360) — off the screen center. A 300x1000 portrait
  // image centered there would start at y = -140, cutting off the top 140px.
  win.outerSize.mockResolvedValue({ toLogical: () => ({ width: 300, height: 1000 }) });
  win.innerSize.mockResolvedValue({ toLogical: () => ({ width: 300, height: 1000 }) });
  win.outerPosition.mockResolvedValue({ toLogical: () => ({ x: 400, y: -140 }) });
  const controller = createWindowController(() => "image", () => false);
  controller.reportContentSize(300, 1000);
  await new Promise(resolve => setTimeout(resolve, 0));
  const posCalls = win.setPosition.mock.calls;
  const [position] = posCalls[posCalls.length - 1]!;
  // Clamped into the work area: y in [0, 1080 - 1000] = [0, 80].
  expect(position.y).toBeGreaterThanOrEqual(0);
  expect(position.y + 1000).toBeLessThanOrEqual(1080);
});
