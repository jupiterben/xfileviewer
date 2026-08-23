import { describe, expect, it } from "vitest";
import { basename, dirname, extensionOf, naturalCompare } from "./path";

describe("extensionOf", () => {
  it("returns lowercase extension without the dot", () => {
    expect(extensionOf("/photos/Cat.JPG")).toBe("jpg");
  });

  it("returns empty string when there is no extension", () => {
    expect(extensionOf("/photos/README")).toBe("");
  });
});

describe("basename and dirname", () => {
  it("splits unix paths", () => {
    expect(basename("/home/u/img2.jpg")).toBe("img2.jpg");
    expect(dirname("/home/u/img2.jpg")).toBe("/home/u");
  });
});

describe("naturalCompare", () => {
  it("orders img2 before img10", () => {
    const names = ["img10.jpg", "img2.jpg"].sort(naturalCompare);
    expect(names).toEqual(["img2.jpg", "img10.jpg"]);
  });
});
