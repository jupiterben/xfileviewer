import { invoke } from "@tauri-apps/api/core";
import type { ViewerContext } from "../../core/types";
import type { PlayerShell, VideoBackend } from "./playerShell";

interface HlsInfo {
  url: string;
  port: number;
}

/**
 * HLS transcode fallback. Spawns an ffmpeg child process on the Rust side
 * to slice the source into `.ts` segments, then points a `<video>` element
 * at the playlist URL on the local media server. This is the only path
 * that plays codecs the WebView cannot decode natively (HEVC, AV1, ProRes,
 * certain MKV audio combos, MTS/M2TS, ...).
 *
 * The backend mirrors the HTML5 backend almost 1:1, because once the
 * playlist URL is set, the browser's native HLS machinery does the rest
 * (downloads segments, decodes, seeks). The only Rust-side work after
 * `open()` is keeping the ffmpeg process alive, which `destroy()` handles
 * by calling `hls_close`.
 */
export function createHlsBackend(
  shell: PlayerShell,
  ctx: ViewerContext,
): VideoBackend {
  const session = `hls-${Date.now().toString(36)}-${sessionCounter++}`;

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
    void invoke("hls_close", { session }).catch(() => undefined);
  };

  const onReady = () => {
    if (!cancelled) shell.setStatus(null);
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
    if (cancelled || !opened) return;
    // The HLS pipeline can fail for many reasons: ffmpeg dies mid-stream,
    // the WebView lacks H.264 hwdec, the playlist never produced a
    // keyframe. Surface a single message and let the user retry.
    const code = video.error?.code;
    const detail = code != null ? `（code=${code}）` : "";
    shell.fail(`后台解码播放失败${detail}`);
  };

  video.addEventListener("ended", onEnded);
  video.addEventListener("play", onPlay);
  video.addEventListener("pause", onPause);
  video.addEventListener("timeupdate", onTime);
  video.addEventListener("loadedmetadata", onMeta);
  video.addEventListener("durationchange", onDuration);
  video.addEventListener("error", onError);
  video.addEventListener("loadeddata", onReady);
  video.addEventListener("playing", onReady);

  return {
    async open() {
      if (cancelled) return;
      shell.setStatus("后台解码中…");
      let info: HlsInfo;
      try {
        info = await invoke<HlsInfo>("hls_open", { session, path: ctx.path });
      } catch (err) {
        throw err instanceof Error ? err : new Error(String(err));
      }
      opened = true;
      if (cancelled) {
        closeSession();
        return;
      }
      video.src = info.url;
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
      video.removeEventListener("loadeddata", onReady);
      video.removeEventListener("playing", onReady);
      video.pause();
      video.removeAttribute("src");
      video.load();
      video.remove();
      closeSession();
    },
  };
}

let sessionCounter = 0;
