import { mount, unmount } from "svelte";
import VideoPlayer from "../../ui/VideoPlayer.svelte";
import { emit, listen } from "@tauri-apps/api/event";
import { isTauri } from "../../shell/platform";
import { formatClock } from "../../shell/formatClock";
import { seekDeltaForKey, seekTime } from "./seek";
import { bindVerticalVolumeRail } from "./verticalVolume";
import {
  loadAudioSettings,
  saveAudioSettings,
  type VideoAudioSettings,
} from "./audioSettings";
import type { ViewerContext, ViewerNavigation } from "../../core/types";

export interface PlayerState {
  time: number;
  duration: number;
  paused: boolean;
  volume: number;
  muted: boolean;
}

export interface VideoBackend {
  /** Load the file and start playback. Rejects with a user-facing message. */
  open(): Promise<void>;
  setPaused(paused: boolean): void;
  setVolume(volume: number, muted: boolean): void;
  seek(time: number): void;
  destroy(): void;
}

/**
 * Widest the control bar can get: nav cluster, both timestamps, a usable
 * seek slider, a hover volume control, and the docked window-mode toggle.
 * Narrow videos letterbox so every control stays reachable.
 */
const MIN_SHELL_WIDTH = 470;

export interface PlayerShell {
  el: HTMLElement;
  /** The rectangle the picture occupies; the native backend covers it. */
  surface: HTMLElement;
  state: PlayerState;
  audio: VideoAudioSettings;
  /** Sequence navigation owned by this viewer. */
  nav: { prev: HTMLButtonElement; next: HTMLButtonElement };
  setNavigation(state: ViewerNavigation): void;
  /** Native video needs the popup in the overlay above its video surface. */
  setPopupMode(mode: "inline" | "overlay"): void;
  attach(backend: VideoBackend): void;
  patch(next: Partial<PlayerState>): void;
  setStatus(text: string | null): void;
  reportContentSize(width: number, height: number): void;
  ended(): void;
  fail(message: string): void;
  destroy(): void;
}

/**
 * Owns everything the user interacts with — control bar, keyboard, volume
 * persistence — and delegates pixels to whichever backend is attached.
 */
export function createPlayerShell(ctx: ViewerContext): PlayerShell {
  const audio = loadAudioSettings(localStorage);
  const state: PlayerState = {
    time: 0,
    duration: 0,
    paused: true,
    volume: audio.volume,
    muted: audio.muted,
  };
  let backend: VideoBackend | null = null;
  let seeking = false;
  let destroyed = false;
  let lastAudibleVolume = audio.lastAudibleVolume;

  const target = document.createElement("div");
  const view = mount(VideoPlayer, { target });
  const wrap = target.querySelector<HTMLElement>(".video-player")!;
  const surface = wrap.querySelector<HTMLElement>(".video-surface")!;
  const status = wrap.querySelector<HTMLElement>(".video-status")!;
  const bar = wrap.querySelector<HTMLElement>(".video-bar")!;
  const navPrev = wrap.querySelector<HTMLButtonElement>(".video-nav-prev")!;
  const navNext = wrap.querySelector<HTMLButtonElement>(".video-nav-next")!;
  const playBtn = wrap.querySelector<HTMLButtonElement>(".video-play")!;
  const currentEl = wrap.querySelector<HTMLElement>(".video-current")!;
  const durationEl = wrap.querySelector<HTMLElement>(".video-duration")!;
  const seek = wrap.querySelector<HTMLInputElement>(".video-seek")!;
  const muteBtn = wrap.querySelector<HTMLButtonElement>(".video-mute")!;
  const volume = wrap.querySelector<HTMLInputElement>(".video-volume")!;
  const volumeRail = wrap.querySelector<HTMLElement>(".video-volume-rail")!;
  const volumeValue = wrap.querySelector<HTMLElement>(".video-volume-value")!;
  const volumeWrap = wrap.querySelector<HTMLElement>(".video-volume-wrap")!;
  const unbindVolumeRail = bindVerticalVolumeRail(volumeRail, volume);
  let popupMode: "inline" | "overlay" = "inline";
  let barHover = false;
  let overlayHover = false;
  let hideTimer: number | undefined;
  const unlisteners: Array<() => void> = [];

  function showPopup() {
    window.clearTimeout(hideTimer);
    if (popupMode !== "overlay") return;
    const rect = surface.getBoundingClientRect();
    const button = muteBtn.getBoundingClientRect();
    ctx.onVolumePopup?.(true, {
      x: Math.round(button.left + button.width / 2 - rect.left),
      bottom: 0,
      volume: state.volume,
      muted: state.muted,
    });
  }
  function scheduleHide() {
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => {
      if (!barHover && !overlayHover && !volumeWrap.contains(document.activeElement)) {
        ctx.onVolumePopup?.(false);
      }
    }, 300);
  }
  volumeWrap.addEventListener("pointerenter", () => { barHover = true; showPopup(); });
  volumeWrap.addEventListener("pointerleave", () => { barHover = false; scheduleHide(); });
  volumeWrap.addEventListener("focusin", showPopup);
  volumeWrap.addEventListener("focusout", scheduleHide);
  if (isTauri()) {
    const keep = (unlisten: () => void) => { if (destroyed) unlisten(); else unlisteners.push(unlisten); };
    void listen<{ active: boolean }>("video-overlay-hover", ({ payload }) => {
      overlayHover = payload.active;
      if (overlayHover) window.clearTimeout(hideTimer);
      else scheduleHide();
    }).then(keep, () => undefined);
    void listen<{ volume: number; muted: boolean }>("video-overlay-volume", ({ payload }) => {
      setVolume(payload.volume, payload.muted);
    }).then(keep, () => undefined);
  }


  ctx.onToolbar?.(bar);

  /** Drive the seek slider's progress fill from the current position. */
  function updateSeekFill() {
    const percent =
      state.duration > 0
        ? Math.min(100, Math.max(0, (state.time / state.duration) * 100))
        : 0;
    seek.style.setProperty("--seek-percent", `${percent}%`);
  }

  function render() {
    playBtn.textContent = state.paused ? "▶" : "❚❚";
    currentEl.textContent = formatClock(state.time);
    durationEl.textContent = formatClock(state.duration);
    if (!seeking) {
      seek.max = String(state.duration || 0);
      seek.value = String(state.time || 0);
    }
    updateSeekFill();
    const silent = state.muted || state.volume === 0;
    const percent = Math.round(state.volume * 100);
    muteBtn.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4Z"/>${silent ? '<path d="m16 9 5 6m0-6-5 6"/>' : '<path d="M15 8a6 6 0 0 1 0 8"/>' + (percent > 50 ? '<path d="M18 5a10 10 0 0 1 0 14"/>' : '')}</svg>`;
    volumeValue.textContent = silent ? "静音" : `${percent}%`;
    volumeWrap.classList.toggle("is-muted", silent);
    muteBtn.title = silent ? "开启声音" : "静音";
    muteBtn.setAttribute("aria-label", muteBtn.title);
    muteBtn.setAttribute("aria-pressed", String(silent));
    volume.value = String(percent);
    volumeRail.style.setProperty("--volume-percent", String(percent));
    volume.title = `音量 ${percent}%${state.muted ? "（已静音）" : ""}`;
    volume.setAttribute(
      "aria-valuetext",
      `${percent}%${state.muted ? "（已静音）" : ""}`,
    );
  }

  function persistVolume() {
    if (state.volume > 0) lastAudibleVolume = state.volume;
    saveAudioSettings(localStorage, {
      volume: state.volume,
      muted: state.muted,
      lastAudibleVolume,
    });
  }

  function setVolume(next: number, muted: boolean) {
    if (!Number.isFinite(next)) return;
    state.volume = Math.min(1, Math.max(0, next));
    state.muted = muted;
    persistVolume();
    render();
    backend?.setVolume(state.volume, state.muted);
    if (popupMode === "overlay") {
      void emit("video-overlay-state", { volume: state.volume, muted: state.muted }).catch(() => undefined);
    }
  }

  function togglePlay() {
    const paused = !state.paused;
    state.paused = paused;
    render();
    backend?.setPaused(paused);
  }

  function seekTo(time: number) {
    const target = seekTime(time, state.duration, 0);
    state.time = target;
    render();
    backend?.seek(target);
  }

  // Keep native slider/button keys from triggering player or file navigation.
  const onControlKey = (event: KeyboardEvent) => {
    if (
      ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", " ", "Enter"].includes(
        event.key,
      )
    ) {
      event.stopPropagation();
    }
  };
  muteBtn.addEventListener("keydown", onControlKey);
  volume.addEventListener("keydown", onControlKey);
  seek.addEventListener("keydown", onControlKey);

  playBtn.addEventListener("click", togglePlay);
  navPrev.addEventListener("click", () => ctx.onNavigate?.(-1));
  navNext.addEventListener("click", () => ctx.onNavigate?.(1));
  muteBtn.addEventListener("click", () => {
    if (state.muted || state.volume === 0) {
      setVolume(state.volume === 0 ? lastAudibleVolume : state.volume, false);
    } else {
      setVolume(state.volume, true);
    }
  });
  volume.addEventListener("input", () => {
    setVolume(Number(volume.value) / 100, false);
  });
  seek.addEventListener("pointerdown", () => {
    seeking = true;
  });
  seek.addEventListener("input", () => {
    // Preview locally; committing on every tick would flood the native backend.
    state.time = Number(seek.value);
    currentEl.textContent = formatClock(state.time);
    updateSeekFill();
  });
  seek.addEventListener("change", () => {
    seeking = false;
    seekTo(Number(seek.value));
  });
  bar.addEventListener("wheel", (e) => e.stopPropagation());

  volumeWrap.addEventListener("wheel", (event) => {
    if (event.ctrlKey || event.deltaY === 0) return;
    event.preventDefault();
    event.stopPropagation();
    setVolume(state.volume + (event.deltaY < 0 ? 0.05 : -0.05), false);
  }, { passive: false });

  const onKey = (event: KeyboardEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (ctx.isInteractionBlocked?.()) {
      return;
    }
    if (event.key === " ") {
      event.preventDefault();
      if (!event.repeat) togglePlay();
      return;
    }
    const delta = seekDeltaForKey(event.key);
    if (delta == null) return;
    event.preventDefault();
    seekTo(state.time + delta);
  };
  window.addEventListener("keydown", onKey);

  persistVolume();
  render();

  return {
    el: wrap,
    surface,
    state,
    audio,
    nav: { prev: navPrev, next: navNext },
    setNavigation(state) {
      navPrev.disabled = state.disabled;
      navNext.disabled = state.disabled;
      if (state.previousTitle !== undefined) navPrev.title = state.previousTitle;
      if (state.nextTitle !== undefined) navNext.title = state.nextTitle;
    },
    setPopupMode(mode) {
      popupMode = mode;
      volumeWrap.classList.toggle("is-overlay", mode === "overlay");
      if (mode === "inline") ctx.onVolumePopup?.(false);
      else if (barHover || volumeWrap.contains(document.activeElement)) showPopup();
    },
    attach(next) {
      backend = next;
    },
    patch(next) {
      Object.assign(state, next);
      render();
    },
    setStatus(text) {
      status.hidden = text == null;
      status.textContent = text ?? "";
    },
    reportContentSize(width, height) {
      // Portrait clips would fit the window narrower than the control bar;
      // the bar's right-hand controls (volume, window-mode toggle) would be
      // clipped by overflow:hidden. Widen the reported content width instead
      // so fit-to-content gives the window extra width and the video
      // letterboxes on the surface.
      ctx.onContentSize?.(Math.max(width, MIN_SHELL_WIDTH), height, {
        width: 0,
        height: bar.offsetHeight || 48,
      });
    },
    ended() {
      ctx.onEnded();
    },
    fail(message) {
      ctx.onError(message);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      window.clearTimeout(hideTimer);
      if (popupMode === "overlay") ctx.onVolumePopup?.(false);
      unlisteners.forEach((unlisten) => unlisten());
      unbindVolumeRail();
      window.removeEventListener("keydown", onKey);
      ctx.onToolbar?.(null);
      void unmount(view);
    },
  };
}
