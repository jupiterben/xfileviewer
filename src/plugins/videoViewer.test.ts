// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { videoViewer } from "./videoViewer";
import type { ViewerHandle } from "../core/types";

vi.mock("@tauri-apps/api/core", () => ({
  // Per-command dispatcher so the HLS-probe path can be stubbed separately
  // from the legacy `video_stream_url` call. Any unknown command resolves
  // to the legacy stream URL by default, matching the previous behaviour.
  invoke: vi.fn(async (cmd: string) => {
    if (cmd === "ffmpeg_available") return false;
    return "http://localhost/video";
  }),
}));

let handle: ViewerHandle | undefined;
const onError = vi.fn();
const onEnded = vi.fn();
const onContentSize = vi.fn();

async function mount() {
  handle = videoViewer("test", ["mp4"]).mount(document.body, {
    path: "test.mp4",
    src: "",
    onError,
    onEnded,
    onContentSize,
  });
  await Promise.resolve();
  await Promise.resolve();
  return document.querySelector("video")!;
}

function fail(video: HTMLVideoElement, code = 3) {
  Object.defineProperty(video, "error", { configurable: true, value: { code } });
  video.dispatchEvent(new Event("error"));
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.stubGlobal("MediaError", {
    MEDIA_ERR_DECODE: 3,
    MEDIA_ERR_NETWORK: 2,
    MEDIA_ERR_SRC_NOT_SUPPORTED: 4,
  });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
});

afterEach(() => {
  handle?.destroy();
  handle = undefined;
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("video viewer", () => {
  it.each([false, true])("does not open a backend after destruction during the probe (%s)", async (available) => {
    let finish!: (value: boolean) => void;
    vi.mocked(invoke).mockImplementationOnce(() => new Promise<boolean>(resolve => { finish = resolve; }) as never);
    const viewer = videoViewer("test", ["mp4"]).mount(document.body, {
      path: "test.mp4", src: "", onError, onEnded,
    });
    viewer.destroy();
    finish(available);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(vi.mocked(invoke).mock.calls.map(call => call[0])).toEqual(["ffmpeg_available"]);
    expect(document.querySelector("video")).toBeNull();
  });
  it("requests a stream and points the element at it", async () => {
    const video = await mount();
    expect(invoke).toHaveBeenCalledWith("video_stream_url", { path: "test.mp4" });
    expect(video.src).toBe("http://localhost/video");
  });

  it("restores volume and mute from localStorage before exposing the source", async () => {
    localStorage.setItem(
      "xfileviewer.videoAudio",
      JSON.stringify({ volume: 0.35, muted: true, lastAudibleVolume: 0.35 }),
    );
    const video = await mount();
    expect(video.volume).toBeCloseTo(0.35);
    expect(video.muted).toBe(true);
    expect(video.src).toBe("http://localhost/video");
  });

  it("reports decode errors through onError", async () => {
    fail(await mount(), 3);
    expect(onError).toHaveBeenCalledWith("无法解码该视频编码");
  });

  it("reports unsupported source errors through onError", async () => {
    fail(await mount(), 4);
    expect(onError).toHaveBeenCalledWith("当前内核不支持该视频格式");
  });

  it("reports network errors through onError", async () => {
    fail(await mount(), 2);
    expect(onError).toHaveBeenCalledWith("读取视频失败");
  });

  it("falls back to a generic message for unknown error codes", async () => {
    fail(await mount(), 0);
    expect(onError).toHaveBeenCalledWith("无法播放视频");
  });

  it("surfaces stream request failures as errors", async () => {
    // The default mock returns a string for every command. For this test
    // we want `video_stream_url` to fail with a known message; the HLS
    // probe must keep reporting "not available" so the HTML5 path is taken.
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "ffmpeg_available") return false;
      if (cmd === "video_stream_url") throw new Error("no backend");
      return "http://localhost/video";
    });
    await mount();
    await Promise.resolve();
    await Promise.resolve();
    expect(onError).toHaveBeenCalledWith("no backend");
    expect(document.querySelector("video")!.getAttribute("src")).toBeNull();
  });

  it("forwards ended to the viewer context", async () => {
    const video = await mount();
    video.dispatchEvent(new Event("ended"));
    expect(onEnded).toHaveBeenCalledTimes(1);
  });

  it("reports content size once metadata is available", async () => {
    const video = await mount();
    Object.defineProperty(video, "videoWidth", { configurable: true, value: 1280 });
    Object.defineProperty(video, "videoHeight", { configurable: true, value: 720 });
    video.dispatchEvent(new Event("loadedmetadata"));
    expect(onContentSize).toHaveBeenCalledWith(1280, 720, expect.objectContaining({ width: 0 }));
  });

  it("toggles the video-viewing class on the workspace", async () => {
    const workspace = document.createElement("div");
    workspace.className = "workspace";
    document.body.append(workspace);
    handle = videoViewer("test", ["mp4"]).mount(workspace, {
      path: "test.mp4",
      src: "",
      onError,
      onEnded,
      onContentSize,
    });
    await Promise.resolve();
    expect(workspace.classList.contains("video-viewing")).toBe(true);
    handle.destroy();
    handle = undefined;
    expect(workspace.classList.contains("video-viewing")).toBe(false);
  });
});
