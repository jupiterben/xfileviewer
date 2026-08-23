import { describe, expect, it } from "vitest";
import { formatClock } from "./formatClock";

describe("formatClock", () => {
  it("formats minutes and seconds", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(65)).toBe("1:05");
  });

  it("includes hours when needed", () => {
    expect(formatClock(3661)).toBe("1:01:01");
  });

  it("treats invalid duration as zero", () => {
    expect(formatClock(Number.NaN)).toBe("0:00");
  });
});
