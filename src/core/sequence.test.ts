import { describe, expect, it } from "vitest";
import { buildSequence, move, preserveCurrentPath, insertSequenceItem, createSequenceAppender } from "./sequence";

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
  it("adds discoveries directly, filters other kinds, and follows navigation between messages", () => {
    const origin = "Y:\\xx\\2.mp4";
    let seq = buildSequence([], "video", new Set(["mp4"]), origin)!;
    const append = createSequenceAppender(seq, new Set(["mp4"]));
    expect(append(seq, "Y:/xx/2.mp4")).toBe(false);
    expect(append(seq, "Y:/xx/notes.txt")).toBe(false);
    expect(append(seq, "Y:/xx/10.MP4")).toBe(true);
    expect(seq.items.length).toBe(2);
    seq = move(seq, 1);
    expect(append(seq, "Y:/xx/1.mp4")).toBe(true);
    expect(seq.items[seq.index]).toBe("Y:/xx/10.MP4");
    expect(append(seq, "Y:/xx/10.MP4")).toBe(false);
    expect(seq.items).toEqual(["Y:/xx/1.mp4", origin, "Y:/xx/10.MP4"]);
  });
  it("keeps navigation on the playing file during individual insertions", () => {
    let seq = buildSequence([], "image", imageExt, "/a/2.jpg")!;
    insertSequenceItem(seq, "/a/4.jpg", 1);
    seq = move(seq, 1);
    insertSequenceItem(seq, "/a/1.jpg", 0);
    insertSequenceItem(seq, "/a/3.jpg", 2);
    expect(seq.items[seq.index]).toBe("/a/4.jpg");
    insertSequenceItem(seq, "/a/5.jpg", 4);
    const next = move(seq, 1);
    expect(next.items[next.index]).toBe("/a/5.jpg");
  });
  it("keeps the playing file when a later scan batch inserts earlier items", () => {
    const partial = buildSequence(["/a/2.jpg", "/a/4.jpg"], "image", imageExt, "/a/2.jpg")!;
    const playing = move(partial, 1).items[1];
    const expanded = buildSequence(["/a/1.jpg", "/a/2.jpg", "/a/3.jpg", "/a/4.jpg"], "image", imageExt, "/a/2.jpg")!;
    const updated = preserveCurrentPath(expanded, playing);
    expect(updated.index).toBe(3);
    expect(updated.items[updated.index]).toBe("/a/4.jpg");
  });
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
