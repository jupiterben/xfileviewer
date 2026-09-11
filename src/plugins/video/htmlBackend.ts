import { invoke } from "@tauri-apps/api/core";
import type { ViewerContext } from "../../core/types";
import type { PlayerShell, VideoBackend } from "./playerShell";

const MEDIA_ERR_NETWORK = 2;
const MEDIA_ERR_DECODE = 3;
const MEDIA_ERR_SRC_NOT_SUPPORTED = 4;
let sessionCounter = 0;

export function mediaErrorMessage(code: number | undefined): string {
  switch (code) {
    case MEDIA_ERR_DECODE:
      return "无法解码该视频编码";
    case MEDIA_ERR_NETWORK:
      return "读取视频失败";
    case MEDIA_ERR_SRC_NOT_SUPPORTED:
      return "当前内核不支持该视频格式";
    default:
      return "无法播放视频";
  }
}

/**
 * WebView decoder path: used on Linux, and on Windows when the bundled
 * decoder is unavailable.
 */
export function createHtmlBackend(
  shell: PlayerShell,
  ctx: ViewerContext,
): VideoBackend {
  const session = `html-${Date.now().toString(36)}-${sessionCounter++}`;
  const video = document.createElement("video");
  video.className = "media video";
  video.autoplay = true;
  video.preload = "auto";
  video.playsInline = true;
  // Restore before assigning a source so autoplay cannot briefly play unmuted.
  video.volume = shell.state.volume;
  video.muted = shell.state.muted;
  shell.surface.append(video);

  let cancelled = false;
  let opened = false;
  const closeSession = () => {
    if (!opened) return;
    opened = false;
    void invoke("video_stream_close", { session }).catch(() => undefined);
  };

  const onEnded = () => shell.ended();
  const onPlay = () => shell.patch({ paused: false });
  const onPause = () => shell.patch({ paused: true });
  const onTime = () => shell.patch({ time: video.currentTime });
  const onDuration = () =>
    shell.patch({
      duration: Number.isFinite(video.duration) ? video.duration : 0,
    });
  const onMeta = () => {
    onDuration();
    shell.patch({ time: video.currentTime });
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (w > 0 && h > 0) shell.reportContentSize(w, h);
  };
  const onError = () => {
    if (cancelled) return;
    const code = video.error?.code;
    // This branch only triggers on the WebView fallback. The bundled libmpv
    // path never produces a MEDIA_ERR_* code, so any hint we emit here applies
    // only when xfileviewer could not start the native decoder.
    if (code === MEDIA_ERR_SRC_NOT_SUPPORTED) {
      console.warn("[video] WebView could not decode this format. Install HEVC Video Extensions from Device Manufacturer if the clip is H.265.",
        { path: ctx.path, code });
    }
    shell.fail(mediaErrorMessage(code));
  };

  video.addEventListener("ended", onEnded);
  video.addEventListener("play", onPlay);
  video.addEventListener("pause", onPause);
  video.addEventListener("timeupdate", onTime);
  video.addEventListener("loadedmetadata", onMeta);
  video.addEventListener("durationchange", onDuration);
  video.addEventListener("error", onError);

  return {
    async open() {
      if (cancelled) return;
      console.debug("[video] requesting stream", { path: ctx.path });
      let url: string;
      try {
        url = await invoke<string>("video_stream_url", { path: ctx.path, session });
      } catch (err) {
        console.error("[video] stream request failed", {
          path: ctx.path,
          error: err,
        });
        throw err;
      }
      opened = true;
      if (cancelled) {
        closeSession();
        return;
      }
      video.src = url;
    },
    setPaused(paused) {
      if (paused) video.pause();
      else void video.play().catch(() => undefined);
    },
    setVolume(next, muted) {
      video.volume = next;
      video.muted = muted;
    },
    seek(time) {
      video.currentTime = time;
    },
    destroy() {
      if (cancelled) return;
      cancelled = true;
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("loadedmetadata", onMeta);
      video.removeEventListener("durationchange", onDuration);
      video.removeEventListener("error", onError);
      video.pause();
      video.removeAttribute("src");
      video.load();
      video.remove();
      closeSession();
    },
  };
}
