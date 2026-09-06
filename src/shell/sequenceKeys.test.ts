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

  it("uses up/down arrows to switch videos, not left/right arrows", () => {
    expect(sequenceStepForKey(KIND_VIDEO, "ArrowUp")).toBe(-1);
    expect(sequenceStepForKey(KIND_VIDEO, "ArrowDown")).toBe(1);
    expect(sequenceStepForKey(KIND_VIDEO, "ArrowLeft")).toBeNull();
    expect(sequenceStepForKey(KIND_VIDEO, "ArrowRight")).toBeNull();
  });

  it("does not steal arrow keys from documents", () => {
    expect(sequenceStepForKey(KIND_DOCUMENT, "ArrowUp")).toBeNull();
    expect(sequenceStepForKey(KIND_DOCUMENT, "ArrowDown")).toBeNull();
  });
});
