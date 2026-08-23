import { describe, expect, it } from "vitest";
import { buildSequence, move } from "./sequence";

const imageExt = new Set(["jpg", "png", "psd"]);

describe("buildSequence", () => {
  it("keeps only the current kind, sorts naturally, and starts at the origin", () => {
    const seq = buildSequence(
      [
        "/album/b.mp4",
        "/album/img10.jpg",
        "/album/img2.jpg",
        "/album/notes.txt",
      ],
      "image",
      imageExt,
      "/album/img2.jpg",
    );
    expect(seq).toMatchObject({
      folder: "/album",
      kindId: "image",
      items: ["/album/img2.jpg", "/album/img10.jpg"],
      index: 0,
      loop: true,
    });
  });

  it("returns null when the origin is not in the kind", () => {
    expect(
      buildSequence(["/album/a.jpg"], "image", imageExt, "/album/a.mp4"),
    ).toBeNull();
  });
});

describe("move", () => {
  it("wraps around when loop is on", () => {
    const seq = buildSequence(
      ["/a/a.jpg", "/a/c.png", "/a/b.mp4"],
      "image",
      imageExt,
      "/a/c.png",
    )!;
    expect(move(seq, 1).items[move(seq, 1).index]).toBe("/a/a.jpg");
    expect(move(seq, -1).items[move(seq, -1).index]).toBe("/a/a.jpg");
  });
});
