import { invoke } from "@tauri-apps/api/core";
import { formatClock } from "../shell/formatClock";
import type { Viewer, ViewerContext, ViewerHandle } from "../core/types";
import { seekDeltaForKey, seekTime } from "./video/seek";

export function videoViewer(id: string, extensions: string[]): Viewer {
  return {
    id,
    kindId: "video",
    extensions,
    mount(el, ctx) {
      return mountVideo(el, ctx);
    },
  };
}

function mediaErrorMessage(video: HTMLVideoElement): string {
  switch (video.error?.code) {
    case MediaError.MEDIA_ERR_DECODE:
      return "无法解码该视频编码（常见于 HEVC/H.265）。请使用 H.264 的 MP4";
    case MediaError.MEDIA_ERR_NETWORK:
      return "读取视频失败";
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return "当前内核不支持该视频格式";
    default:
      return "无法播放视频";
  }
}

function mountVideo(el: HTMLElement, ctx: ViewerContext): ViewerHandle {
  const wrap = document.createElement("div");
  wrap.className = "video-player";

  const video = document.createElement("video");
  video.className = "media video";
  video.autoplay = true;
  video.preload = "auto";
  video.playsInline = true;

  const bar = document.createElement("div");
  bar.className = "video-bar";

  const playBtn = document.createElement("button");
  playBtn.type = "button";
  playBtn.className = "video-play";
  playBtn.setAttribute("aria-label", "播放/暂停");
  playBtn.textContent = "▶";

  const currentEl = document.createElement("span");
  currentEl.className = "video-time";
  currentEl.textContent = "0:00";

  const seek = document.createElement("input");
  seek.type = "range";
  seek.className = "video-seek";
  seek.min = "0";
  seek.max = "0";
  seek.step = "0.1";
  seek.value = "0";
  seek.setAttribute("aria-label", "播放进度");

  const durationEl = document.createElement("span");
  durationEl.className = "video-time";
  durationEl.textContent = "0:00";

  bar.append(playBtn, currentEl, seek, durationEl);
  wrap.append(video, bar);
  el.append(wrap);

  let cancelled = false;
  let seeking = false;

  const syncPlayBtn = () => {
    playBtn.textContent = video.paused ? "▶" : "❚❚";
  };

  const syncTimes = () => {
    currentEl.textContent = formatClock(video.currentTime);
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    durationEl.textContent = formatClock(duration);
    if (!seeking) {
      seek.max = String(duration);
      seek.value = String(video.currentTime || 0);
    }
  };

  const onEnded = () => ctx.onEnded();
  const onPlay = () => syncPlayBtn();
  const onPause = () => syncPlayBtn();
  const onTime = () => syncTimes();
  const onMeta = () => {
    syncTimes();
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (w > 0 && h > 0) {
      ctx.onContentSize?.(w, h, {
        width: 0,
        height: bar.offsetHeight || 48,
      });
    }
  };

  video.addEventListener("ended", onEnded);
  video.addEventListener("play", onPlay);
  video.addEventListener("pause", onPause);
  video.addEventListener("timeupdate", onTime);
  video.addEventListener("loadedmetadata", onMeta);
  video.addEventListener("durationchange", onTime);
  video.addEventListener(
    "error",
    () => {
      if (!cancelled) ctx.onError(mediaErrorMessage(video));
    },
    { once: true },
  );

  playBtn.addEventListener("click", () => {
    if (video.paused) void video.play();
    else video.pause();
  });
  seek.addEventListener("pointerdown", () => {
    seeking = true;
  });
  seek.addEventListener("input", () => {
    video.currentTime = Number(seek.value);
    currentEl.textContent = formatClock(video.currentTime);
  });
  seek.addEventListener("change", () => {
    video.currentTime = Number(seek.value);
    seeking = false;
  });
  bar.addEventListener("wheel", (e) => e.stopPropagation());

  const onKey = (event: KeyboardEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (document.querySelector<HTMLElement>("#assoc-overlay")?.hidden === false) {
      return;
    }
    if (event.key === " ") {
      event.preventDefault();
      if (!event.repeat) {
        if (video.paused) void video.play();
        else video.pause();
      }
      return;
    }
    const delta = seekDeltaForKey(event.key);
    if (delta == null) return;
    event.preventDefault();
    video.currentTime = seekTime(video.currentTime, video.duration, delta);
    syncTimes();
  };
  window.addEventListener("keydown", onKey);

  void (async () => {
    try {
      console.debug("[video] requesting stream", { path: ctx.path });
      const url = await invoke<string>("video_stream_url", { path: ctx.path });
      if (cancelled) return;
      video.src = url;
    } catch (err) {
      console.error("[video] stream request failed", { path: ctx.path, error: err });
      if (!cancelled) {
        ctx.onError(err instanceof Error ? err.message : String(err));
      }
    }
  })();

  return {
    destroy() {
      cancelled = true;
      window.removeEventListener("keydown", onKey);
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("loadedmetadata", onMeta);
      video.removeEventListener("durationchange", onTime);
      video.pause();
      video.removeAttribute("src");
      video.load();
      wrap.remove();
    },
  };
}
