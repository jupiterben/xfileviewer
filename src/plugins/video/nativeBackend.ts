import { invoke } from "@tauri-apps/api/core";
import type { ViewerContext } from "../../core/types";
import type { PlayerShell, VideoBackend } from "./playerShell";

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
}

export interface NativeSnapshot {
  time: number;
  duration: number;
  paused: boolean;
  volume: number;
  muted: boolean;
  width: number;
  height: number;
  videoWidth: number;
  videoHeight: number;
  ended: boolean;
  error: string | null;
}

const POLL_MS = 100;

let sessionCounter = 0;

/**
 * Windows backend: libmpv owns decoding and a child window that sits on top of
 * the WebView. This side only feeds it a rectangle and relays the control bar.
 */
export function createNativeBackend(
  shell: PlayerShell,
  ctx: ViewerContext,
): VideoBackend {
  const session = `native-${Date.now().toString(36)}-${sessionCounter++}`;
  let cancelled = false;
  let errored = false;
  let endedFired = false;
  let sizeReported = false;
  let timer: number | undefined;
  let frame = 0;
  let observer: ResizeObserver | undefined;
  let opened = false;
  const closeSession = () => {
    if (!opened) return;
    opened = false;
    void invoke("native_video_close", { session }).catch(() => undefined);
  };

  function measure(): Bounds {
    const rect = shell.surface.getBoundingClientRect();
    // Why physical pixels: SetWindowPos / CreateWindowExW take screen coords in
    // the parent's DPI scale. window.devicePixelRatio matches Tauri's per-monitor
    // DPI for the WebView's client area, so multiplying the CSS rect gives the
    // HWND the correct placement. Skipping this lands the child window in the
    // top-left corner on a 200% scaled display.
    const scale = window.devicePixelRatio || 1;
    const width = Math.round(rect.width * scale);
    const height = Math.round(rect.height * scale);
    return {
      x: Math.round(rect.left * scale),
      y: Math.round(rect.top * scale),
      width: Math.max(1, width),
      height: Math.max(1, height),
      visible: width > 0 && height > 0,
    };
  }

  function pushLayout() {
    if (cancelled) return;
    void invoke("native_video_layout", { session, bounds: measure() }).catch(
      () => undefined,
    );
  }

  async function poll() {
    if (cancelled) return;
    let snapshot: NativeSnapshot | null;
    try {
      snapshot = await invoke<NativeSnapshot | null>("native_video_status", {
        session,
      });
    } catch (err) {
      if (!cancelled && !errored) {
        errored = true;
        shell.fail(err instanceof Error ? err.message : String(err));
      }
      return;
    }
    if (cancelled || !snapshot) return;
    if (snapshot.error) {
      if (!errored) {
        errored = true;
        shell.fail(snapshot.error);
      }
      return;
    }
    shell.setStatus(null);
    shell.patch({
      time: snapshot.time,
      duration: snapshot.duration,
      paused: snapshot.paused,
    });
    if (!sizeReported && snapshot.videoWidth > 0 && snapshot.videoHeight > 0) {
      sizeReported = true;
      shell.reportContentSize(snapshot.videoWidth, snapshot.videoHeight);
    }
    if (snapshot.ended) {
      if (!endedFired) {
        endedFired = true;
        shell.ended();
      }
    } else {
      endedFired = false;
    }
  }

  return {
    async open() {
      if (cancelled) return;
      shell.setStatus("正在打开…");
      await invoke("native_video_open", {
        session,
        path: ctx.path,
        bounds: measure(),
        volume: shell.state.volume,
        muted: shell.state.muted,
      });
      opened = true;
      if (cancelled) {
        closeSession();
        return;
      }
      // The overlay window is a UX enhancement, not a playback dependency:
      // on failure keep playing and leave the popup inside the control bar.
      await invoke("native_video_overlay", { session }).catch(
        (err: unknown) => {
          console.warn(
            "[video] overlay window unavailable, popup stays in bar",
            err,
          );
        },
      );
      if (cancelled) return;
      observer = new ResizeObserver(() => {
        if (frame) return;
        frame = window.requestAnimationFrame(() => {
          frame = 0;
          pushLayout();
        });
      });
      observer.observe(shell.surface);
      timer = window.setInterval(() => void poll(), POLL_MS);
      void poll();
    },
    setPaused(paused) {
      void invoke("native_video_control", { session, paused }).catch(() => undefined);
    },
    setVolume(volume, muted) {
      void invoke("native_video_control", { session, volume, muted }).catch(
        () => undefined,
      );
    },
    seek(time) {
      void invoke("native_video_control", { session, time }).catch(() => undefined);
    },
    destroy() {
      if (cancelled) return;
      cancelled = true;
      if (timer !== undefined) window.clearInterval(timer);
      if (frame) window.cancelAnimationFrame(frame);
      observer?.disconnect();
      closeSession();
    },
  };
}
