// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { createViewerSession } from "./viewerSession";
import type { Viewer, ViewerContext } from "../core/types";

it("ignores stale callbacks after switching viewers", () => {
  const session = createViewerSession();
  let old!: ViewerContext;
  const destroy = vi.fn();
  const viewer: Viewer = {
    id: "test", kindId: "image", extensions: ["jpg"],
    mount: (_el, ctx) => { old = ctx; return { destroy }; },
  };
  const ctx = { path: "a.jpg", src: "", onError: vi.fn(), onEnded: vi.fn(), onToolbar: vi.fn() };
  session.mount(viewer, document.createElement("div"), ctx);
  const stale = old;
  session.mount(viewer, document.createElement("div"), ctx);
  stale.onError("late");
  stale.onEnded();
  stale.onToolbar?.(document.createElement("div"));
  expect(stale.isInteractionBlocked?.()).toBe(true);
  expect(ctx.onError).not.toHaveBeenCalled();
  expect(ctx.onEnded).not.toHaveBeenCalled();
  expect(ctx.onToolbar).not.toHaveBeenCalled();
  expect(destroy).toHaveBeenCalledTimes(1);
  session.destroy();
});

it("cleans up a handle returned after a synchronous mount error", () => {
  const session = createViewerSession();
  const destroy = vi.fn();
  session.mount({
    id: "test", kindId: "image", extensions: [],
    mount(_el, ctx) { ctx.onError("failed"); return { destroy }; },
  }, document.createElement("div"), {
    path: "", src: "", onEnded() {}, onError: () => session.destroy(),
  });
  expect(destroy).toHaveBeenCalledTimes(1);
});
