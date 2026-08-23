import { describe, expect, it } from "vitest";
import { KIND_DOCUMENT, KIND_IMAGE, KIND_VIDEO } from "../core/types";
import {
  loadMediaWindowMode,
  mediaWindowModeLabel,
  resolveMediaWindowMode,
  saveMediaWindowMode,
  shouldFitWindowToContent,
  shouldRememberWindowSize,
  toggleMediaWindowMode,
} from "./mediaWindow";

describe("resolveMediaWindowMode", () => {
  it("treats unknown values as fit-to-content", () => {
    expect(resolveMediaWindowMode("fit")).toBe("fit");
    expect(resolveMediaWindowMode("fixed")).toBe("fixed");
    expect(resolveMediaWindowMode(null)).toBe("fit");
    expect(resolveMediaWindowMode("nope")).toBe("fit");
  });
});

describe("load/save media window mode", () => {
  it("round-trips through storage", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    };
    expect(loadMediaWindowMode(storage)).toBe("fit");
    saveMediaWindowMode(storage, "fixed");
    expect(loadMediaWindowMode(storage)).toBe("fixed");
  });
});

describe("toggleMediaWindowMode", () => {
  it("switches between fit and fixed", () => {
    expect(toggleMediaWindowMode("fit")).toBe("fixed");
    expect(toggleMediaWindowMode("fixed")).toBe("fit");
  });
});

describe("mediaWindowModeLabel", () => {
  it("labels the two modes in Chinese", () => {
    expect(mediaWindowModeLabel("fit")).toBe("适应尺寸");
    expect(mediaWindowModeLabel("fixed")).toBe("固定窗口");
  });
});

describe("shouldFitWindowToContent", () => {
  it("fits only image and video when mode is fit", () => {
    expect(shouldFitWindowToContent(KIND_IMAGE, "fit")).toBe(true);
    expect(shouldFitWindowToContent(KIND_VIDEO, "fit")).toBe(true);
    expect(shouldFitWindowToContent(KIND_IMAGE, "fixed")).toBe(false);
    expect(shouldFitWindowToContent(KIND_VIDEO, "fixed")).toBe(false);
    expect(shouldFitWindowToContent(KIND_DOCUMENT, "fit")).toBe(false);
  });
});

describe("shouldRememberWindowSize", () => {
  it("remembers documents always, and media only when fixed", () => {
    expect(shouldRememberWindowSize(KIND_DOCUMENT, "fit")).toBe(true);
    expect(shouldRememberWindowSize(KIND_DOCUMENT, "fixed")).toBe(true);
    expect(shouldRememberWindowSize(KIND_IMAGE, "fixed")).toBe(true);
    expect(shouldRememberWindowSize(KIND_VIDEO, "fixed")).toBe(true);
    expect(shouldRememberWindowSize(KIND_IMAGE, "fit")).toBe(false);
    expect(shouldRememberWindowSize(KIND_VIDEO, "fit")).toBe(false);
  });
});
