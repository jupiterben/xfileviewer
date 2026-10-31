import { describe, expect, it } from "vitest";
import { buildFileTree, fileAncestors, filePathKey, visibleFileRows } from "../../src/ui/fileTree";

describe("sidebar file tree", () => {
  it("sorts folders first and hides descendants until each branch is expanded", () => {
    const tree = buildFileTree("/root", [
      "/root/file10.jpg", "/root/album2/photo.jpg", "/root/file2.jpg", "/root/album2/nested/photo.jpg",
    ], ["/root/album10", "/root/album2", "/root/album2/nested"]);
    expect(tree.map(node => node.label)).toEqual(["album2", "album10", "file2.jpg", "file10.jpg"]);
    expect(visibleFileRows(tree, new Set()).map(row => row.node.index)).toEqual([-1, -1, 2, 0]);
    const rows = visibleFileRows(tree, new Set(["/root/album2"]));
    expect(rows.map(row => row.node.label)).toEqual(["album2", "nested", "photo.jpg", "album10", "file2.jpg", "file10.jpg"]);
    expect(rows[2]).toMatchObject({ level: 2, parent: "/root/album2", node: { index: 1 } });
    expect(tree[0].count).toBe(2);
    expect(visibleFileRows(tree, new Set(["/root/album2/nested"]))).toHaveLength(4);
    expect(visibleFileRows(tree, new Set(["/root/album2", "/root/album2/nested"])).filter(row => row.node.kind === "file")).toHaveLength(4);
  });

  it("handles drive roots, UNC paths, mixed separators and duplicate basenames", () => {
    expect(filePathKey("C:\\Photos\\")).toBe("c:/photos");
    expect(fileAncestors("C:\\", "C:\\Photos\\nested\\a.jpg")).toEqual(["C:\\Photos", "C:\\Photos\\nested"]);
    expect(fileAncestors("/", "/photos/a.jpg")).toEqual(["/photos"]);
    expect(fileAncestors("/root", "/root-other/a.jpg")).toEqual([]);
    const tree = buildFileTree("\\\\Server\\Share", [
      "\\\\Server\\Share\\Album\\same.jpg", "//server/share/same.jpg",
    ], ["//server/share/Album"]);
    expect(tree).toHaveLength(2);
    expect(tree[0].children[0].index).toBe(0);
    expect(tree[1].index).toBe(1);
    expect(filePathKey("/Photos")).not.toBe(filePathKey("/photos"));
  });
});
