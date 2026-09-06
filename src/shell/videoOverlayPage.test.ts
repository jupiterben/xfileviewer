// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { emit } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { bootVideoOverlay } from "./videoOverlayPage";

const handlers = vi.hoisted(() => new Map<string, (event: { payload: unknown }) => void>());
vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn().mockResolvedValue(undefined),
  listen: vi.fn(async (name, handler) => { handlers.set(name, handler); return () => {}; }),
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: vi.fn(() => ({ setFocus: vi.fn(), onDragDropEvent: vi.fn().mockResolvedValue(() => {}) })),
}));

it("returns focus through the main-view event on dismissal and Escape", async () => {
  await bootVideoOverlay();
  const command = handlers.get("video-overlay-cmd")!;
  command({ payload: { show: true } });
  command({ payload: { show: false } });
  expect(emit).toHaveBeenCalledWith("video-overlay-closed");
  vi.mocked(emit).mockClear();
  command({ payload: { show: true } });
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
  expect(emit).toHaveBeenCalledWith("video-overlay-closed");
  expect(document.querySelector(".video-overlay-pop")!.classList.contains("show")).toBe(false);
  // No focus call may target the current (overlay) WebView.
  expect(getCurrentWebview).toHaveBeenCalledTimes(1);
});
