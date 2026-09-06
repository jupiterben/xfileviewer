import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";

interface PopupCmd {
  show: boolean;
  x?: number;
  bottom?: number;
  volume?: number;
  muted?: boolean;
}

interface PopupState {
  volume?: number;
  muted?: boolean;
}

/**
 * Boot for the "video-overlay" webview: a transparent hit-surface laid
 * exactly over the native video rectangle (Rust keeps it above the mpv
 * HWND). The app chrome is stripped and only floating popups are rendered;
 * every other interaction is forwarded to the main webview so the overlay
 * behaves like the video area it covers.
 */
export async function bootVideoOverlay(): Promise<void> {
  document.documentElement.classList.add("overlay-mode");

  const layer = document.createElement("div");
  layer.className = "video-overlay-layer";
  const pop = document.createElement("div");
  pop.className = "video-overlay-pop";
  const volume = document.createElement("input");
  volume.type = "range";
  volume.className = "video-overlay-volume";
  volume.min = "0";
  volume.max = "100";
  volume.step = "1";
  volume.value = "100";
  volume.setAttribute("aria-label", "音量");
  const value = document.createElement("span");
  value.className = "video-volume-value";
  value.setAttribute("aria-hidden", "true");
  pop.append(volume, value);
  layer.append(pop);
  document.body.append(layer);

  let muted = false;
  let dragging = false;
  let hoverHideTimer: number | undefined;

  const hidePopup = () => {
    pop.classList.remove("show");
    volume.blur();
    // Give keyboard focus back to the main webview (space/arrows live there).
    void emit("video-overlay-closed").catch(() => undefined);
  };

  const renderValue = () => {
    value.textContent = muted || Number(volume.value) === 0 ? "静音" : `${volume.value}%`;
    volume.setAttribute("aria-valuetext", `${volume.value}%${muted ? "（已静音）" : ""}`);
  };
  const applyState = (state: PopupState) => {
    if (typeof state.volume === "number" && Number.isFinite(state.volume)) {
      volume.value = String(Math.round(state.volume * 100));
    }
    if (typeof state.muted === "boolean") muted = state.muted;
    renderValue();
  };

  volume.addEventListener("input", () => {
    muted = false;
    renderValue();
    void emit("video-overlay-volume", {
      volume: Number(volume.value) / 100,
      muted,
    }).catch(() => undefined);
  });

  // Hover continuity across the webview boundary: entering the popup must
  // cancel the hide the main webview scheduled when the pointer left the bar.
  pop.addEventListener("pointerenter", () => {
    window.clearTimeout(hoverHideTimer);
    void emit("video-overlay-hover", { active: true }).catch(() => undefined);
  });
  pop.addEventListener("pointerleave", () => {
    if (dragging || pop.contains(document.activeElement)) return;
    void emit("video-overlay-hover", { active: false }).catch(() => undefined);

  });

  volume.addEventListener("pointerdown", () => { dragging = true; });
  const release = () => {
    dragging = false;
    if (!pop.matches(":hover") && !pop.contains(document.activeElement)) {
      void emit("video-overlay-hover", { active: false }).catch(() => undefined);
    }
  };
  window.addEventListener("pointerup", release);
  window.addEventListener("pointercancel", release);
  pop.addEventListener("focusin", () => {
    void emit("video-overlay-hover", { active: true }).catch(() => undefined);
  });
  pop.addEventListener("focusout", release);

  // Wheel over the popup adjusts volume; elsewhere it pages the sequence.
  layer.addEventListener(
    "wheel",
    (event) => {
      if (!(event.target instanceof Element) || !pop.contains(event.target)) {
        return;
      }
      event.preventDefault();
      const delta = event.deltaY < 0 ? 5 : -5;
      const next = Math.min(100, Math.max(0, Number(volume.value) + delta));
      volume.value = String(next);
      volume.dispatchEvent(new Event("input"));
    },
    { passive: false },
  );
  window.addEventListener("wheel", (event) => {
    if (event.target instanceof Element && pop.contains(event.target)) return;
    void emit("video-overlay-wheel", { deltaY: event.deltaY }).catch(
      () => undefined,
    );
  });

  // Capture-phase Escape handling: with the popup visible, Escape must close
  // only the popup. The generic main.ts window handler (registered earlier on
  // the same window) would otherwise close the whole window; stopping the
  // event here in the capture phase keeps it from firing at all.
  window.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Escape" || !pop.classList.contains("show")) return;
      event.preventDefault();
      event.stopPropagation();
      window.clearTimeout(hoverHideTimer);
      hidePopup();
      void emit("video-overlay-hover", { active: false }).catch(
        () => undefined,
      );
    },
    true,
  );

  // Popup-critical listeners go first: the main webview may fire commands the
  // moment popupMode flips, and events emitted before registration are lost.
  await listen<PopupCmd>("video-overlay-cmd", (event) => {
    const cmd = event.payload;
    if (!cmd || typeof cmd.show !== "boolean") return;
    window.clearTimeout(hoverHideTimer);
    if (!cmd.show) {
      hidePopup();
      return;
    }
    applyState(cmd);
    if (typeof cmd.x === "number") pop.style.left = `${cmd.x}px`;
    if (typeof cmd.bottom === "number") pop.style.bottom = `${cmd.bottom}px`;
    pop.classList.add("show");
  });

  await listen<PopupState>("video-overlay-state", (event) => {
    if (pop.classList.contains("show")) applyState(event.payload ?? {});
  });

  // Drops over the video area land on this webview; replay the paths through
  // the shared event the main webview already listens to. Registered last and
  // non-fatal: losing file drops must never take the popup pipeline down.
  try {
    await getCurrentWebview().onDragDropEvent((event) => {
      const payload = event.payload;
      if (payload.type === "drop" && payload.paths.length > 0) {
        void emit("video-file-drop", payload.paths).catch(() => undefined);
      }
    });
  } catch (err) {
    console.warn("[video-overlay] drag-drop forwarding unavailable", err);
  }

  // Handshake: the main webview gates the popupMode switch on this signal so
  // it never routes popup commands into a page that cannot receive them.
  void emit("video-overlay-ready").catch(() => undefined);
}
