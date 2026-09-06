// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { createHlsBackend } from "./hlsBackend";
import { createPlayerShell } from "./playerShell";
import type { ViewerContext } from "../../core/types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

function makeCtx(path: string): ViewerContext {
  return {
    path,
    src: "",
    onEnded: vi.fn(),
    onError: vi.fn(),
    onContentSize: vi.fn(),
  };
}

function makeShell(ctx: ViewerContext) {
  const host = document.createElement("div");
  document.body.append(host);
  const shell = createPlayerShell(ctx);
  host.append(shell.el);
  shells.push(shell);
  return shell;
}
const shells: ReturnType<typeof createPlayerShell>[] = [];

describe("hlsBackend", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  });

  afterEach(() => {
    for (const shell of shells.splice(0)) shell.destroy();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("closes a session that finishes opening after destruction, exactly once", async () => {
    const shell = makeShell(makeCtx("clip.mkv"));
    let finish!: (value: { url: string; port: number }) => void;
    vi.mocked(invoke).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const backend = createHlsBackend(shell, makeCtx("clip.mkv"));
    const opening = backend.open();
    backend.destroy();
    finish({ url: "http://localhost/test.m3u8", port: 1 });
    await opening;
    backend.destroy();
    expect(vi.mocked(invoke).mock.calls.filter(call => call[0] === "hls_close")).toHaveLength(1);
    expect(shell.surface.querySelector("video")).toBeNull();
  });

  it.each(["loadeddata", "playing"])("clears the loading mask on %s", async (event) => {
    const shell = makeShell(makeCtx("clip.mkv"));
    vi.mocked(invoke).mockResolvedValueOnce({ url: "http://localhost/test.m3u8", port: 1 });
    const backend = createHlsBackend(shell, makeCtx("clip.mkv"));
    await backend.open();
    expect(shell.el.querySelector<HTMLElement>(".video-status")!.hidden).toBe(false);
    shell.surface.querySelector("video")!.dispatchEvent(new Event(event));
    expect(shell.el.querySelector<HTMLElement>(".video-status")!.hidden).toBe(true);
    backend.destroy();
  });

  it("invokes hls_open with a unique session id and assigns the returned url", async () => {
    const ctx = makeCtx("C:\\videos\\raw.mkv");
    const shell = makeShell(ctx);
    vi.mocked(invoke).mockResolvedValueOnce({
      url: "http://127.0.0.1:1234/hls/abc/index.m3u8",
      port: 1234,
    });

    const backend = createHlsBackend(shell, ctx);
    await backend.open();

    const hlsOpen = vi.mocked(invoke).mock.calls.find(
      (call) => call[0] === "hls_open",
    );
    expect(hlsOpen).toBeDefined();
    expect(hlsOpen![1]).toMatchObject({ path: ctx.path });
    expect(typeof (hlsOpen![1] as { session: string }).session).toBe("string");

    const video = shell.surface.querySelector("video");
    expect(video?.src).toBe("http://127.0.0.1:1234/hls/abc/index.m3u8");
  });

  it("rejects with the invoke error when hls_open fails", async () => {
    const ctx = makeCtx("C:\\videos\\raw.mkv");
    const shell = makeShell(ctx);
    const failure = new Error("ffmpeg 不在 PATH 中");
    vi.mocked(invoke).mockRejectedValueOnce(failure);

    const backend = createHlsBackend(shell, ctx);
    await expect(backend.open()).rejects.toThrow("ffmpeg");
  });

  it("calls hls_close on destroy only after open succeeded", async () => {
    const ctx = makeCtx("C:\\videos\\raw.mkv");
    const shell = makeShell(ctx);
    vi.mocked(invoke).mockResolvedValueOnce({
      url: "http://127.0.0.1:1/hls/s/index.m3u8",
      port: 1,
    });

    const backend = createHlsBackend(shell, ctx);
    backend.destroy();
    const closeCalls = vi.mocked(invoke).mock.calls.filter(
      (call) => call[0] === "hls_close",
    );
    expect(closeCalls).toHaveLength(0);

    const backend2 = createHlsBackend(shell, ctx);
    await backend2.open();
    backend2.destroy();
    const closeCalls2 = vi.mocked(invoke).mock.calls.filter(
      (call) => call[0] === "hls_close",
    );
    expect(closeCalls2).toHaveLength(1);
  });

  it("forwards setPaused / setVolume / seek to the <video> element", async () => {
    const ctx = makeCtx("C:\\videos\\raw.mkv");
    const shell = makeShell(ctx);
    vi.mocked(invoke).mockResolvedValueOnce({
      url: "http://127.0.0.1:1/hls/s/index.m3u8",
      port: 1,
    });
    const backend = createHlsBackend(shell, ctx);
    await backend.open();
    const video = shell.surface.querySelector("video") as HTMLVideoElement;
    const playSpy = vi.spyOn(video, "play").mockResolvedValue();
    const pauseSpy = vi.spyOn(video, "pause").mockImplementation(() => undefined);

    backend.setPaused(false);
    expect(playSpy).toHaveBeenCalled();

    backend.setPaused(true);
    expect(pauseSpy).toHaveBeenCalled();

    backend.setVolume(0.42, true);
    expect(video.volume).toBe(0.42);
    expect(video.muted).toBe(true);

    backend.seek(12.5);
    expect(video.currentTime).toBe(12.5);
  });
});
