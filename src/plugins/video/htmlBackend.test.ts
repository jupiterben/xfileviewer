// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { createHtmlBackend } from "./htmlBackend";
import { createPlayerShell } from "./playerShell";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(invoke).mockReset();
});

it.each([false, true])("revokes a stream exactly once when destroyed (late open: %s)", async (late) => {
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  let finish!: (url: string) => void;
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === "video_stream_url") return new Promise<string>(resolve => { finish = resolve; });
  });
  const ctx = { path: "clip.mp4", src: "", onError: vi.fn(), onEnded: vi.fn() };
  const shell = createPlayerShell(ctx);
  const backend = createHtmlBackend(shell, ctx);
  const opening = backend.open();
  if (late) backend.destroy();
  finish("http://localhost/token/media/session");
  await opening;
  backend.destroy();
  backend.destroy();
  const calls = vi.mocked(invoke).mock.calls;
  expect(calls.filter(([command]) => command === "video_stream_close")).toEqual([
    ["video_stream_close", { session: (calls[0][1] as { session: string }).session }],
  ]);
  expect(shell.surface.querySelector("video")).toBeNull();
  shell.destroy();
});
