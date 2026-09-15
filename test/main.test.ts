// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  label: "main",
  app: vi.fn(async () => {}),
  overlay: vi.fn(async () => {}),
}));
vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: () => ({ label: state.label }) }));
vi.mock("../src/shell/application", () => ({ bootApplication: state.app }));
vi.mock("../src/shell/videoOverlayPage", () => ({ bootVideoOverlay: state.overlay }));

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  vi.resetModules();
  vi.clearAllMocks();
});

it.each(["main", "video-overlay"])("boots only the selected window: %s", async label => {
  state.label = label;
  await import("../src/main");
  const selected = label === "main" ? state.app : state.overlay;
  const other = label === "main" ? state.overlay : state.app;
  await vi.waitFor(() => expect(selected).toHaveBeenCalledTimes(1));
  expect(other).not.toHaveBeenCalled();
  expect(document.querySelector("#viewer-host")).not.toBeNull();
  expect(document.querySelector("#settings-back")?.textContent).toBe("返回");
});
