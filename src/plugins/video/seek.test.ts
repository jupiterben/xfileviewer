import { describe, expect, it } from "vitest";
import { seekDeltaForKey, seekTime } from "./seek";

describe("seekDeltaForKey", () => {
  it("maps arrows to five-second jumps", () => {
    expect(seekDeltaForKey("ArrowLeft")).toBe(-5);
    expect(seekDeltaForKey("ArrowRight")).toBe(5);
    expect(seekDeltaForKey("PageUp")).toBeNull();
  });
});

describe("seekTime", () => {
  it("clamps to the duration range", () => {
    expect(seekTime(3, 10, -5)).toBe(0);
    expect(seekTime(8, 10, 5)).toBe(10);
    expect(seekTime(4, 10, 5)).toBe(9);
  });

  it("stays at zero when duration is unknown", () => {
    expect(seekTime(0, Number.NaN, -5)).toBe(0);
    expect(seekTime(2, Number.NaN, 5)).toBe(7);
  });
});
