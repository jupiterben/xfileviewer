import { describe, expect, it } from "vitest";
import { clampPositionToWorkArea, fitWindowToContent, positionKeepingCenter } from "../../src/shell/fitWindow";

describe("fitWindowToContent", () => {
  it("sizes the window to the full image plus chrome when it fits the screen", () => {
    expect(
      fitWindowToContent(
        { width: 800, height: 600 },
        { width: 0, height: 48 },
        { width: 1920, height: 1080 },
      ),
    ).toEqual({ width: 800, height: 648 });
  });

  it("scales the window down uniformly so a large image stays fully visible", () => {
    expect(
      fitWindowToContent(
        { width: 4000, height: 2000 },
        { width: 0, height: 40 },
        { width: 1000, height: 1000 },
      ),
    ).toEqual({ width: 1000, height: 540 });
  });

  it("fits a 16:9 video plus control bar inside the work area", () => {
    expect(
      fitWindowToContent(
        { width: 1920, height: 1080 },
        { width: 0, height: 48 },
        { width: 1920, height: 1080 },
      ),
    ).toEqual({ width: 1835, height: 1080 });
  });

  it("does not upscale a small image beyond its pixel size", () => {
    expect(
      fitWindowToContent(
        { width: 120, height: 80 },
        { width: 0, height: 40 },
        { width: 1920, height: 1080 },
        { width: 100, height: 80 },
      ),
    ).toEqual({ width: 120, height: 120 });
  });

  it("subtracts the OS window frame so the outer window fits the work area", () => {
    // 40px of OS decorations: a 300x3000 tall image would otherwise yield an
    // inner height of 1080 and an outer window taller than the work area.
    // The min-width floor (240) applies, but the height is capped so that
    // inner (1040) + frame (40) == work area height (1080).
    expect(
      fitWindowToContent(
        { width: 300, height: 3000 },
        { width: 0, height: 0 },
        { width: 1920, height: 1080 },
        { width: 240, height: 160 },
        { width: 0, height: 40 },
      ),
    ).toEqual({ width: 240, height: 1040 });
  });

  it("still returns the content size plus chrome when content fits despite the frame", () => {
    expect(
      fitWindowToContent(
        { width: 300, height: 1000 },
        { width: 0, height: 0 },
        { width: 1920, height: 1080 },
        { width: 240, height: 160 },
        { width: 0, height: 40 },
      ),
    ).toEqual({ width: 300, height: 1000 });
  });
});

describe("clampPositionToWorkArea", () => {
  const work = { x: 0, y: 0, width: 1920, height: 1080 };

  it("keeps a position that already fits unchanged", () => {
    expect(
      clampPositionToWorkArea({ x: 400, y: 40 }, { width: 300, height: 1000 }, work),
    ).toEqual({ x: 400, y: 40 });
  });

  it("clamps a position that would push the window off the top edge", () => {
    expect(
      clampPositionToWorkArea({ x: 400, y: -140 }, { width: 300, height: 1000 }, work),
    ).toEqual({ x: 400, y: 0 });
  });

  it("clamps a position that would push the window past the bottom edge", () => {
    expect(
      clampPositionToWorkArea({ x: 400, y: 200 }, { width: 300, height: 1000 }, work),
    ).toEqual({ x: 400, y: 80 });
  });

  it("pins to the work area origin when the window is larger than the work area", () => {
    expect(
      clampPositionToWorkArea({ x: -50, y: -90 }, { width: 1200, height: 900 }, { x: 0, y: 0, width: 1000, height: 800 }),
    ).toEqual({ x: 0, y: 0 });
  });

  it("respects a non-zero work area origin (secondary monitor)", () => {
    const secondary = { x: -1920, y: 0, width: 1920, height: 1080 };
    expect(
      clampPositionToWorkArea({ x: -2100, y: 50 }, { width: 800, height: 600 }, secondary),
    ).toEqual({ x: -1920, y: 50 });
  });
});

describe("positionKeepingCenter", () => {
  it("keeps the window center when the size changes", () => {
    expect(
      positionKeepingCenter(
        { x: 400, y: 200, width: 800, height: 600 },
        { width: 400, height: 300 },
      ),
    ).toEqual({ x: 600, y: 350 });
  });

  it("keeps the center even when growing past the top and left edges", () => {
    expect(
      positionKeepingCenter(
        { x: 0, y: 0, width: 200, height: 160 },
        { width: 800, height: 600 },
      ),
    ).toEqual({ x: -300, y: -220 });
  });

  it("keeps the center even when growing past the right and bottom edges", () => {
    expect(
      positionKeepingCenter(
        { x: 1800, y: 980, width: 120, height: 100 },
        { width: 400, height: 300 },
      ),
    ).toEqual({ x: 1660, y: 880 });
  });
});
