// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { lazyViewer } from "./lazyViewer";
import type { Viewer } from "../core/types";

const descriptor = { id: "lazy", kindId: "document", extensions: ["md"] };
const ctx = () => ({ path: "a.md", src: "", onEnded: vi.fn(), onError: vi.fn() });
const flush = async () => { await new Promise(resolve => setTimeout(resolve, 0)); };

it("loads on first mount only and replays navigation received while loading", async () => {
  const setNavigation = vi.fn();
  const mount = vi.fn(() => ({ destroy: vi.fn(), setNavigation }));
  const load = vi.fn(async () => ({ ...descriptor, mount }));
  const viewer = lazyViewer(descriptor, load);
  expect(load).not.toHaveBeenCalled();
  const handle = viewer.mount(document.createElement("div"), ctx());
  handle.setNavigation?.({ disabled: false });
  await flush();
  expect(setNavigation).toHaveBeenCalledWith({ disabled: false });
  handle.destroy();
  const second = viewer.mount(document.createElement("div"), ctx());
  await flush();
  expect(load).toHaveBeenCalledTimes(1);
  expect(mount).toHaveBeenCalledTimes(2);
  second.destroy();
});

it("does not mount a viewer whose import finishes after destruction", async () => {
  let finish!: (viewer: Viewer) => void;
  const mount = vi.fn(() => ({ destroy() {} }));
  const viewer = lazyViewer(descriptor, () => new Promise(resolve => { finish = resolve; }));
  viewer.mount(document.createElement("div"), ctx()).destroy();
  finish({ ...descriptor, mount });
  await flush();
  expect(mount).not.toHaveBeenCalled();
});

it("reports import failure and allows retry", async () => {
  const load = vi.fn<() => Promise<Viewer>>()
    .mockRejectedValueOnce(new Error("load failed"))
    .mockResolvedValue({ ...descriptor, mount: () => ({ destroy() {} }) });
  const viewer = lazyViewer(descriptor, load);
  const context = ctx();
  viewer.mount(document.createElement("div"), context);
  await flush();
  expect(context.onError).toHaveBeenCalledWith("load failed");
  const second = viewer.mount(document.createElement("div"), ctx());
  await flush();
  expect(load).toHaveBeenCalledTimes(2);
  second.destroy();
});
