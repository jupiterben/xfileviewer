import { describe, expect, it } from "vitest";
import { resolveLocalPath, rewriteSrc } from "./assets";

describe("resolveLocalPath", () => {
  it("joins a relative image to the markdown file directory", () => {
    expect(resolveLocalPath("/notes/readme.md", "./img/a.png")).toBe(
      "/notes/img/a.png",
    );
  });

  it("resolves parent segments", () => {
    expect(resolveLocalPath("/notes/sub/a.md", "../pic.png")).toBe(
      "/notes/pic.png",
    );
  });

  it("keeps an absolute unix path", () => {
    expect(resolveLocalPath("/notes/a.md", "/tmp/x.png")).toBe("/tmp/x.png");
  });

  it("returns null for remote, data, and hash hrefs", () => {
    expect(resolveLocalPath("/notes/a.md", "https://ex.com/a.png")).toBeNull();
    expect(resolveLocalPath("/notes/a.md", "data:image/png;base64,xx")).toBeNull();
    expect(resolveLocalPath("/notes/a.md", "#section")).toBeNull();
    expect(resolveLocalPath("/notes/a.md", "")).toBeNull();
  });
});

describe("rewriteSrc", () => {
  it("rewrites local hrefs through toSrc and leaves remotes alone", () => {
    const toSrc = (abs: string) => `asset:${abs}`;
    expect(rewriteSrc("/notes/a.md", "./b.png", toSrc)).toBe(
      "asset:/notes/b.png",
    );
    expect(rewriteSrc("/notes/a.md", "https://ex.com/b.png", toSrc)).toBe(
      "https://ex.com/b.png",
    );
  });
});
