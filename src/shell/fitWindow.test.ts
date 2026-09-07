import { describe, expect, it } from "vitest";
import { fitWindowToContent, positionKeepingCenter } from "./fitWindow";

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
