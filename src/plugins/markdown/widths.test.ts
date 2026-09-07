import { describe, expect, it } from "vitest";
import {
  DEFAULT_WIDTH_ID,
  MARKDOWN_WIDTHS,
  resolveWidth,
  widthCss,
} from "./widths";

describe("resolveWidth", () => {
  it("returns named presets and falls back to medium", () => {
    expect(resolveWidth("wide").id).toBe("wide");
    expect(resolveWidth("full").css).toBe("none");
    expect(resolveWidth("nope").id).toBe(DEFAULT_WIDTH_ID);
    expect(resolveWidth(undefined).id).toBe(DEFAULT_WIDTH_ID);
  });

  it("maps the four reading widths", () => {
    expect(MARKDOWN_WIDTHS.map((w) => w.id)).toEqual([
      "narrow",
      "medium",
      "wide",
      "full",
    ]);
    expect(widthCss("narrow")).toBe("640px");
    expect(widthCss("medium")).toBe("860px");
    expect(widthCss("wide")).toBe("1100px");
    expect(widthCss("full")).toBe("none");
  });
});
