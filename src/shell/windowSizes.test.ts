import { describe, expect, it } from "vitest";
import { rememberSize, sizeForKind, type WindowSize } from "./windowSizes";

const fallback: WindowSize = { width: 1100, height: 720 };

describe("sizeForKind", () => {
  it("returns the saved size for a kind and otherwise the fallback", () => {
    expect(sizeForKind({}, "document", fallback)).toEqual(fallback);
    expect(
      sizeForKind(
        { document: { width: 900, height: 600 } },
        "document",
        fallback,
      ),
    ).toEqual({ width: 900, height: 600 });
  });
});

describe("rememberSize", () => {
  it("stores a kind size without mutating the previous map", () => {
    const prev = { image: { width: 400, height: 300 } };
    const next = rememberSize(prev, "document", { width: 800, height: 500 });
    expect(next).toEqual({
      image: { width: 400, height: 300 },
      document: { width: 800, height: 500 },
    });
    expect(prev).toEqual({ image: { width: 400, height: 300 } });
  });
});
