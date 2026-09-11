import { invoke } from "@tauri-apps/api/core";
import type { Viewer, ViewerContext, ViewerHandle } from "../core/types";
import { isTauri, isWindows } from "../shell/platform";
import { isOverlayReady, waitForOverlayReady } from "../shell/overlayReadiness";
import { createPlayerShell, type VideoBackend } from "./video/playerShell";
import { createHtmlBackend } from "./video/htmlBackend";

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

/**
 * Three-tier decoder selection:
 *   1. libmpv (Windows + bundled `libmpv-2.dll` available)
 *   2. WebView `<video>` for formats the browser decodes natively
 *   3. ffmpeg → HLS → WebView for everything else
 *
 * Tier 3 only runs when ffmpeg is on PATH. Users without ffmpeg fall back
 * to the standard "format not supported" error from tier 2.
 */
function mountVideo(el: HTMLElement, ctx: ViewerContext): ViewerHandle {
  const shell = createPlayerShell(ctx);
  el.append(shell.el);
  let backend: VideoBackend | null = null;
  let cancelled = false;

  const attach = (next: VideoBackend) => {
    backend = next;
    shell.attach(next);
  };

  const openHtml = () => {
    if (cancelled) return;
    const html = createHtmlBackend(shell, ctx);
    attach(html);
    void html.open().catch((err: unknown) => {
      if (cancelled) return;
      shell.fail(err instanceof Error ? err.message : String(err));
    });
  };

  const openHls = (reason: string) => {
    void (async () => {
      const { createHlsBackend } = await import("./video/hlsBackend");
      if (cancelled) return;
      const hls = createHlsBackend(shell, ctx);
      attach(hls);
      try {
        await hls.open();
        if (cancelled) {
          hls.destroy();
          return;
        }
        console.debug("[video] hls transcode", { path: ctx.path, reason });
      } catch (err) {
        hls.destroy();
        if (cancelled) return;
        backend = null;
        shell.setStatus(null);
        console.warn("[video] hls transcode failed", {
          path: ctx.path,
          reason,
          error: err,
        });
        // Stay on the WebView path so the user at least sees the standard
        // error message when ffmpeg itself is broken.
        openHtml();
      }
    })();
  };

  void (async () => {
    if (isTauri() && isWindows()) {
      let native: VideoBackend | null = null;
      try {
        const { createNativeBackend } = await import("./video/nativeBackend");
        if (cancelled) return;
        native = createNativeBackend(shell, ctx);
        attach(native);
        await native.open();
        if (cancelled) {
          native.destroy();
          return;
        }
        console.debug("[video] native decoder", { path: ctx.path });
        // The libmpv pipeline covers the video surface with an HWND; route
        // the volume popup through the transparent overlay webview so it
        // can rise above the picture. Only flip once the overlay page has
        // confirmed its popup listeners are live — commands emitted before
        // that would vanish and leave the control permanently hidden.
        const ready = isOverlayReady() || (await waitForOverlayReady(2000));
        if (cancelled) {
          native.destroy();
          return;
        }
        shell.setPopupMode(ready ? "overlay" : "inline");
        return;
      } catch (err) {
        native?.destroy();
        backend = null;
        shell.setStatus(null);
        // Most failures mean libmpv-2.dll is missing or the wrong architecture.
        // Run `npm run prepare:native` (or `node scripts/prepare-native.mjs`)
        // to fetch the bundled decoder, then rebuild the installer.
        console.warn(
          "[video] native decoder unavailable, using WebView. If this clip failed to render, run `npm run prepare:native` to bundle libmpv-2.dll.",
          { path: ctx.path, error: err },
        );
        if (cancelled) return;
      }
    }

    // Decide between tier 2 (HTML5) and tier 3 (HLS) using a pre-flight
    // `canPlayType` probe. The probe returns "" for codecs the WebView
    // cannot decode, and the pre-flight `ffmpeg_available` check ensures
    // we never enter tier 3 without a working transcode pipeline.
    const useHls = await canUseHls(ctx);
    if (cancelled) return;
    if (useHls) {
      openHls("canPlayType-unsupported");
      return;
    }
    openHtml();
  })();

  return {
    setNavigation: state => shell.setNavigation(state),
    destroy() {
      cancelled = true;
      backend?.destroy();
      backend = null;
      shell.destroy();
    },
  };
}

async function canUseHls(ctx: ViewerContext): Promise<boolean> {
  // Only attempt HLS when ffmpeg is on PATH; otherwise the user gets the
  // standard "format not supported" error from the HTML5 path.
  let available: unknown = false;
  try {
    available = await invoke<boolean>("ffmpeg_available");
  } catch {
    return false;
  }
  if (available !== true) return false;
  // Use canPlayType to short-circuit for formats the WebView can already
  // handle. Empty string means "no codec matches"; we only treat that as
  // a fallback trigger for video/* MIME types, not for everything (some
  // paths have unknown MIME and we still want HTML5 to attempt first).
  const mime = videoMimeFor(ctx.path);
  if (!mime) return false;
  const probe = document.createElement("video");
  const can = probe.canPlayType(mime);
  return can === "";
}

function videoMimeFor(path: string): string | null {
  const idx = path.lastIndexOf(".");
  if (idx < 0 || idx === path.length - 1) return null;
  const ext = path.slice(idx + 1).toLowerCase();
  switch (ext) {
    case "mp4":
    case "m4v":
      return "video/mp4";
    case "webm":
      return "video/webm";
    case "mov":
      return "video/quicktime";
    case "mkv":
      return "video/x-matroska";
    case "avi":
      return "video/x-msvideo";
    case "m2ts":
    case "ts":
      return "video/mp2t";
    case "wmv":
      return "video/x-ms-wmv";
    case "flv":
      return "video/x-flv";
    case "3gp":
      return "video/3gpp";
    case "mts":
      return "video/mp2t";
    default:
      return null;
  }
}
