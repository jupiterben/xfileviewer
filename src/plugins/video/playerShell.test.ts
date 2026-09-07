// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPlayerShell, type VideoBackend } from "./playerShell";
import type { ViewerContext } from "../../core/types";

let shell: ReturnType<typeof createPlayerShell> | undefined;
let calls: string[] = [];

function makeCtx(): ViewerContext {
  return {
    path: "a.mp4",
    src: "",
    onEnded: vi.fn(),
    onError: vi.fn(),
    onContentSize: vi.fn(),
  };
}

function fakeBackend(): VideoBackend {
  return {
    open: async () => undefined,
    setPaused: (paused) => calls.push(`paused:${paused}`),
    setVolume: (volume, muted) => calls.push(`volume:${volume}:${muted}`),
    seek: (time) => calls.push(`seek:${time}`),
    destroy: () => calls.push("destroy"),
  };
}

function setup() {
  const ctx = makeCtx();
  shell = createPlayerShell(ctx);
  document.body.append(shell.el);
  shell.attach(fakeBackend());
  return ctx;
}

function q<T extends Element>(selector: string): T {
  return shell!.el.querySelector<T>(selector)!;
}

beforeEach(() => {
  localStorage.clear();
  calls = [];
});

afterEach(() => {
  shell?.destroy();
  shell = undefined;
  document.body.replaceChildren();
});

describe("player shell", () => {
  it("toggles playback through the attached backend", () => {
    setup();
    const play = q<HTMLButtonElement>(".video-play");
    expect(play.textContent).toBe("▶");
    play.click();
    expect(calls).toEqual(["paused:false"]);
    expect(play.textContent).toBe("❚❚");
    play.click();
    expect(calls).toEqual(["paused:false", "paused:true"]);
  });

  it("commits a seek on release rather than while dragging", () => {
    setup();
    shell!.patch({ duration: 20 });
    const seek = q<HTMLInputElement>(".video-seek");
    seek.value = "5";
    seek.dispatchEvent(new Event("input"));
    expect(calls).toEqual([]);
    seek.dispatchEvent(new Event("change"));
    expect(calls).toEqual(["seek:5"]);
  });

  it("restores the last audible volume when unmuting", () => {
    setup();
    const volume = q<HTMLInputElement>(".video-volume");
    const mute = q<HTMLButtonElement>(".video-mute");
    volume.value = "60";
    volume.dispatchEvent(new Event("input"));
    mute.click();
    mute.click();
    expect(calls).toEqual([
      "volume:0.6:false",
      "volume:0.6:true",
      "volume:0.6:false",
    ]);
  });

  it("keeps the same accessible slider in native mode and unmutes on adjustment", () => {
    setup();
    shell!.setPopupMode("overlay");
    q<HTMLButtonElement>(".video-mute").click();
    const volume = q<HTMLInputElement>(".video-volume");
    volume.value = "35";
    volume.dispatchEvent(new Event("input"));
    expect(shell!.state.muted).toBe(false);
    expect(calls[calls.length - 1]).toBe("volume:0.35:false");
    expect(q(".video-volume-value").textContent).toBe("35%");
    expect(volume.getAttribute("aria-valuetext")).toBe("35%");
    expect(q(".video-volume-wrap").classList.contains("is-overlay")).toBe(true);
  });

  it("adjusts volume with the wheel without navigating files and clamps the limits", () => {
    setup();
    const navigated = vi.fn();
    window.addEventListener("wheel", navigated);
    const volume = q<HTMLInputElement>(".video-volume");
    volume.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, bubbles: true, cancelable: true }));
    expect(shell!.state.volume).toBe(1);
    volume.dispatchEvent(new WheelEvent("wheel", { deltaY: 100, bubbles: true, cancelable: true }));
    expect(shell!.state.volume).toBeCloseTo(0.95);
    expect(navigated).not.toHaveBeenCalled();
    window.removeEventListener("wheel", navigated);
  });

  it("restores audible volume after dragging to zero", () => {
    setup();
    const volume = q<HTMLInputElement>(".video-volume");
    for (const value of ["60", "0"]) {
      volume.value = value;
      volume.dispatchEvent(new Event("input"));
    }
    q<HTMLButtonElement>(".video-mute").click();
    expect(calls[calls.length - 1]).toBe("volume:0.6:false");
  });

  it("persists audio settings", () => {
    setup();
    const volume = q<HTMLInputElement>(".video-volume");
    volume.value = "25";
    volume.dispatchEvent(new Event("input"));
    const saved = JSON.parse(localStorage.getItem("xfileviewer.videoAudio")!);
    expect(saved.volume).toBeCloseTo(0.25);
    expect(saved.muted).toBe(false);
  });

  it("seeks with arrow keys and toggles with space", () => {
    setup();
    shell!.patch({ duration: 30, time: 0 });
    window.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    expect(calls).toEqual(["paused:false", "seek:5"]);
  });

  it("ignores keys while the association overlay is open", () => {
    setup();
    const overlay = document.createElement("div");
    overlay.id = "assoc-overlay";
    overlay.hidden = false;
    document.body.append(overlay);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));
    expect(calls).toEqual([]);
  });

  it("reports the control bar as window chrome", () => {
    const ctx = setup();
    shell!.reportContentSize(1920, 1080);
    expect(ctx.onContentSize).toHaveBeenCalledWith(1920, 1080, {
      width: 0,
      height: 48,
    });
  });

  it("widens narrow (portrait) clips so the control bar never clips", () => {
    const ctx = setup();
    shell!.reportContentSize(300, 900);
    expect(ctx.onContentSize).toHaveBeenCalledWith(470, 900, {
      width: 0,
      height: 48,
    });
  });

  it("routes ended and errors to the viewer context", () => {
    const ctx = setup();
    shell!.ended();
    shell!.fail("boom");
    expect(ctx.onEnded).toHaveBeenCalledTimes(1);
    expect(ctx.onError).toHaveBeenCalledWith("boom");
  });

  it("routes control-bar nav clicks to onNavigate", () => {
    const ctx = makeCtx();
    ctx.onNavigate = vi.fn();
    shell = createPlayerShell(ctx);
    document.body.append(shell.el);
    // Navigation starts disabled; main.ts enables it once a sequence exists.
    expect(shell.nav.prev.disabled).toBe(true);
    expect(shell.nav.next.disabled).toBe(true);
    shell.nav.prev.disabled = false;
    shell.nav.next.disabled = false;
    shell.nav.prev.click();
    shell.nav.next.click();
    expect(ctx.onNavigate).toHaveBeenCalledWith(-1);
    expect(ctx.onNavigate).toHaveBeenCalledWith(1);
  });
});
