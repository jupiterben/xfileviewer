import { describe, expect, it } from "vitest";
import { KIND_DOCUMENT, KIND_IMAGE, KIND_VIDEO } from "../core/types";
import { sequenceStepForKey } from "./sequenceKeys";

describe("sequenceStepForKey", () => {
  it("uses arrows to switch images", () => {
    expect(sequenceStepForKey(KIND_IMAGE, "ArrowLeft")).toBe(-1);
    expect(sequenceStepForKey(KIND_IMAGE, "ArrowRight")).toBe(1);
  });

  it("uses arrows to switch documents", () => {
    expect(sequenceStepForKey(KIND_DOCUMENT, "ArrowLeft")).toBe(-1);
    expect(sequenceStepForKey(KIND_DOCUMENT, "ArrowRight")).toBe(1);
  });

  it("uses page keys to switch videos, not arrows", () => {
    expect(sequenceStepForKey(KIND_VIDEO, "PageUp")).toBe(-1);
    expect(sequenceStepForKey(KIND_VIDEO, "PageDown")).toBe(1);
    expect(sequenceStepForKey(KIND_VIDEO, "ArrowLeft")).toBeNull();
    expect(sequenceStepForKey(KIND_VIDEO, "ArrowRight")).toBeNull();
  });

  it("does not steal page keys from documents", () => {
    expect(sequenceStepForKey(KIND_DOCUMENT, "PageUp")).toBeNull();
    expect(sequenceStepForKey(KIND_DOCUMENT, "PageDown")).toBeNull();
  });
});
