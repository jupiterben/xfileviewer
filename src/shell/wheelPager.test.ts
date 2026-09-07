import { describe, expect, it } from "vitest";
import { createWheelPager, kindUsesWheelPaging } from "./wheelPager";

describe("createWheelPager", () => {
  it("maps down to next and up to previous", () => {
    const page = createWheelPager(() => 0, 200);
    expect(page(80)).toBe(1);
    expect(createWheelPager(() => 0, 200)(-80)).toBe(-1);
  });

  it("ignores extra ticks inside the cooldown", () => {
    let t = 0;
    const page = createWheelPager(() => t, 200);
    expect(page(40)).toBe(1);
    t = 100;
    expect(page(40)).toBeNull();
    t = 200;
    expect(page(40)).toBe(1);
  });
});

describe("kindUsesWheelPaging", () => {
  it("pages images and videos but lets documents scroll", () => {
    expect(kindUsesWheelPaging("image")).toBe(true);
    expect(kindUsesWheelPaging("video")).toBe(true);
    expect(kindUsesWheelPaging("document")).toBe(false);
  });
});
