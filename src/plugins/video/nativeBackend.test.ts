// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { createNativeBackend, type NativeSnapshot } from "./nativeBackend";
import { createPlayerShell } from "./playerShell";
import type { ViewerContext } from "../../core/types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const RECT = { left: 10, top: 20, width: 640, height: 360 };
let roCallbacks: Array<() => void> = [];
let snapshot: NativeSnapshot | null = null;

function baseSnapshot(): NativeSnapshot {
  return {
    time: 0,
    duration: 0,
    paused: true,
    volume: 1,
    muted: false,
    width: 0,
    height: 0,
    videoWidth: 0,
    videoHeight: 0,
    ended: false,
    error: null,
  };
}

function setRect(rect: Partial<typeof RECT>) {
  Object.assign(RECT, rect);
}

function mount() {
  const ctx: ViewerContext = {
    path: "C:\\videos\\clip.mp4",
    src: "",
    onEnded: vi.fn(),
    onError: vi.fn(),
    onContentSize: vi.fn(),
  };
  const host = document.createElement("div");
  document.body.append(host);
  const shell = createPlayerShell(ctx);
  host.append(shell.el);
  shell.surface.getBoundingClientRect = () =>
    ({
      ...RECT,
      right: RECT.left + RECT.width,
      bottom: RECT.top + RECT.height,
      x: RECT.left,
      y: RECT.top,
      toJSON: () => ({}),
    }) as DOMRect;
  const backend = createNativeBackend(shell, ctx);
  shell.attach(backend);
  return { shell, backend, ctx, host };
}

function resizeCallbacks() {
  for (const cb of roCallbacks) cb();
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  roCallbacks = [];
  snapshot = baseSnapshot();
  setRect({ left: 10, top: 20, width: 640, height: 360 });
  Object.defineProperty(window, "devicePixelRatio", {
    configurable: true,
    value: 2,
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        roCallbacks.push(callback);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.mocked(invoke).mockImplementation(((cmd: string) => {
    if (cmd === "native_video_status") return Promise.resolve(snapshot);
    return Promise.resolve(null);
  }) as never);
});

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  Object.defineProperty(window, "devicePixelRatio", {
    configurable: true,
    value: 1,
  });
});

describe("native video backend", () => {
  it("creates the overlay only after opening the native surface", async () => {
    const { backend } = mount();
    await backend.open();
    const commands = vi.mocked(invoke).mock.calls.map(call => call[0]);
    expect(commands.indexOf("native_video_overlay")).toBeGreaterThan(commands.indexOf("native_video_open"));
    backend.destroy();
  });

  it("closes a late native open without creating an overlay", async () => {
    let finish!: () => void;
    vi.mocked(invoke).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }) as never);
    const { backend } = mount();
    const opening = backend.open();
    backend.destroy();
    finish();
    await opening;
    backend.destroy();
    const commands = vi.mocked(invoke).mock.calls.map(call => call[0]);
    expect(commands).toEqual(["native_video_open", "native_video_close"]);
  });

  it("closes once when destroyed during overlay creation and never starts polling", async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    vi.mocked(invoke).mockImplementation(((cmd: string) => cmd === "native_video_overlay"
      ? new Promise<void>(resolve => { finish = resolve; }) : Promise.resolve(null)) as never);
    const { backend } = mount();
    const opening = backend.open();
    await Promise.resolve();
    backend.destroy();
    finish();
    await opening;
    backend.destroy();
    await vi.advanceTimersByTimeAsync(500);
    expect(vi.mocked(invoke).mock.calls.map(call => call[0])).toEqual([
      "native_video_open", "native_video_overlay", "native_video_close",
    ]);
  });
  it("opens the file with bounds in physical pixels", async () => {
    const { backend, shell } = mount();
    await backend.open();
    expect(invoke).toHaveBeenCalledWith(
      "native_video_open",
      expect.objectContaining({
        path: "C:\\videos\\clip.mp4",
        bounds: { x: 20, y: 40, width: 1280, height: 720, visible: true },
        volume: shell.state.volume,
        muted: shell.state.muted,
      }),
    );
    backend.destroy();
  });

  it("reports the decoded video size, not the scaled display size", async () => {
    vi.useFakeTimers();
    const { backend, shell, ctx } = mount();
    await backend.open();
    snapshot = {
      ...baseSnapshot(),
      width: 960,
      height: 540,
      videoWidth: 1920,
      videoHeight: 1080,
      duration: 30,
      time: 4,
      paused: false,
    };
    await vi.advanceTimersByTimeAsync(100);
    expect(ctx.onContentSize).toHaveBeenCalledWith(1920, 1080, {
      width: 0,
      height: 48,
    });
    expect(shell.state.time).toBe(4);
    expect(shell.state.duration).toBe(30);
    expect(shell.state.paused).toBe(false);
    backend.destroy();
  });

  it("forwards end of file once", async () => {
    vi.useFakeTimers();
    const { backend, ctx } = mount();
    await backend.open();
    snapshot = { ...baseSnapshot(), ended: true, duration: 10, time: 10 };
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(100);
    expect(ctx.onEnded).toHaveBeenCalledTimes(1);
    backend.destroy();
  });

  it("surfaces decoder errors through the viewer context", async () => {
    vi.useFakeTimers();
    const { backend, ctx } = mount();
    await backend.open();
    snapshot = { ...baseSnapshot(), error: "视频解码失败：unsupported codec" };
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(100);
    expect(ctx.onError).toHaveBeenCalledWith("视频解码失败：unsupported codec");
    expect(ctx.onError).toHaveBeenCalledTimes(1);
    backend.destroy();
  });

  it("relays control bar actions to the decoder", async () => {
    const { backend } = mount();
    await backend.open();
    vi.clearAllMocks();
    backend.setPaused(false);
    backend.seek(12.5);
    backend.setVolume(0.4, true);
    expect(invoke).toHaveBeenCalledWith(
      "native_video_control",
      expect.objectContaining({ paused: false }),
    );
    expect(invoke).toHaveBeenCalledWith(
      "native_video_control",
      expect.objectContaining({ time: 12.5 }),
    );
    expect(invoke).toHaveBeenCalledWith(
      "native_video_control",
      expect.objectContaining({ volume: 0.4, muted: true }),
    );
    backend.destroy();
  });

  it("pushes a new layout when the surface resizes", async () => {
    const { backend } = mount();
    await backend.open();
    vi.clearAllMocks();
    setRect({ width: 800, height: 450 });
    resizeCallbacks();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(invoke).toHaveBeenCalledWith(
      "native_video_layout",
      expect.objectContaining({
        bounds: { x: 20, y: 40, width: 1600, height: 900, visible: true },
      }),
    );
    backend.destroy();
  });

  it("closes the decoder when the viewer is destroyed", async () => {
    const { backend } = mount();
    await backend.open();
    vi.clearAllMocks();
    backend.destroy();
    expect(invoke).toHaveBeenCalledWith(
      "native_video_close",
      expect.objectContaining({ session: expect.stringMatching(/^native-/) }),
    );
  });

  it("stops polling after destroy", async () => {
    vi.useFakeTimers();
    const { backend } = mount();
    await backend.open();
    backend.destroy();
    vi.clearAllMocks();
    await vi.advanceTimersByTimeAsync(500);
    expect(invoke).not.toHaveBeenCalled();
  });
});
