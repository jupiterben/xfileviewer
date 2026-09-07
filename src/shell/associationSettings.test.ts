import { describe, expect, it } from "vitest";
import {
  associationChanges,
  buildAssociationRows,
  groupAssociationRows,
  kindCheckState,
  kindLabel,
  mergeAssociationState,
  setAssociationRowError,
  setKindGranted,
  setRowGranted,
} from "./associationSettings";

const jpg = { ext: "jpg", pluginName: "Image", kindId: "image" };
const png = { ext: "PNG", pluginName: "Image", kindId: "image" };
const mp4 = { ext: "mp4", pluginName: "Video", kindId: "video" };
const md = { ext: "md", pluginName: "Markdown", kindId: "document" };

describe("buildAssociationRows", () => {
  it("lowercases, dedupes, and sorts by extension", () => {
    expect(
      buildAssociationRows([
        png,
        jpg,
        { ext: "png", pluginName: "Other", kindId: "image" },
      ]),
    ).toEqual([
      { ext: "jpg", pluginName: "Image", kindId: "image", granted: false },
      { ext: "png", pluginName: "Image", kindId: "image", granted: false },
    ]);
  });
});

describe("groupAssociationRows", () => {
  it("groups by kind in image / video / document order", () => {
    const rows = buildAssociationRows([md, mp4, jpg]);
    expect(groupAssociationRows(rows).map((group) => group.kindId)).toEqual([
      "image",
      "video",
      "document",
    ]);
    expect(groupAssociationRows(rows).map((group) => group.label)).toEqual([
      "图片",
      "视频",
      "文档",
    ]);
  });

  it("reports each kind checkbox as all / none / mixed", () => {
    const rows = setRowGranted(buildAssociationRows([jpg, png, mp4]), "jpg", true);
    expect(groupAssociationRows(rows).map((group) => [group.kindId, group.checkState])).toEqual([
      ["image", "mixed"],
      ["video", "none"],
    ]);
  });
});

describe("kindCheckState", () => {
  it("is all when every row is granted", () => {
    const rows = setKindGranted(buildAssociationRows([jpg, png]), "image", true);
    expect(kindCheckState(rows)).toBe("all");
  });
});

describe("kindLabel", () => {
  it("names built-in kinds in Chinese", () => {
    expect(kindLabel("image")).toBe("图片");
    expect(kindLabel("video")).toBe("视频");
    expect(kindLabel("document")).toBe("文档");
  });
});

describe("mergeAssociationState", () => {
  const rows = buildAssociationRows([
    jpg,
    { ext: "jpeg", pluginName: "Image", kindId: "image" },
    { ext: "psd", pluginName: "PSD", kindId: "image" },
  ]);

  it("uses OS query results when the OS manages associations", () => {
    expect(
      mergeAssociationState(
        rows,
        { jpg: true, jpeg: true, psd: false },
        { granted: ["psd"], denied: [] },
        true,
      ).map((row) => [row.ext, row.granted]),
    ).toEqual([
      ["jpeg", true],
      ["jpg", true],
      ["psd", false],
    ]);
  });

  it("keeps same-mime extensions in sync after a query refresh", () => {
    const merged = mergeAssociationState(
      rows,
      { jpg: true, jpeg: true, psd: false },
      { granted: [], denied: [] },
      true,
    );
    expect(merged.find((row) => row.ext === "jpg")?.granted).toBe(true);
    expect(merged.find((row) => row.ext === "jpeg")?.granted).toBe(true);
  });

  it("falls back to saved grants when the OS does not manage associations", () => {
    expect(
      mergeAssociationState(
        rows,
        { jpg: false, jpeg: false, psd: false },
        { granted: ["psd"], denied: [] },
        false,
      ).map((row) => [row.ext, row.granted]),
    ).toEqual([
      ["jpeg", false],
      ["jpg", false],
      ["psd", true],
    ]);
  });
});

describe("setAssociationRowError", () => {
  it("attaches an error to one row", () => {
    const rows = buildAssociationRows([{ ext: "xyz", pluginName: "Plug", kindId: "image" }]);
    expect(setAssociationRowError(rows, "xyz", "无法关联")[0]?.error).toBe(
      "无法关联",
    );
  });
});

describe("setRowGranted", () => {
  it("updates draft granted without touching other rows", () => {
    const rows = buildAssociationRows([jpg, mp4]);
    expect(setRowGranted(rows, "mp4", true).map((row) => [row.ext, row.granted])).toEqual([
      ["jpg", false],
      ["mp4", true],
    ]);
  });
});

describe("setKindGranted", () => {
  it("sets every extension of that kind and leaves others", () => {
    const rows = buildAssociationRows([jpg, png, mp4]);
    expect(
      setKindGranted(rows, "image", true).map((row) => [row.ext, row.granted]),
    ).toEqual([
      ["jpg", true],
      ["mp4", false],
      ["png", true],
    ]);
  });
});

describe("associationChanges", () => {
  it("returns grant and revoke diffs between applied and draft", () => {
    const applied = mergeAssociationState(
      buildAssociationRows([jpg, mp4, md]),
      { jpg: true, mp4: false, md: true },
      { granted: [], denied: [] },
      true,
    );
    const draft = setRowGranted(setRowGranted(applied, "mp4", true), "jpg", false);
    expect(associationChanges(applied, draft)).toEqual({
      grant: ["mp4"],
      revoke: ["jpg"],
    });
  });

  it("returns empty diffs when draft matches applied", () => {
    const rows = buildAssociationRows([jpg]);
    expect(associationChanges(rows, rows)).toEqual({ grant: [], revoke: [] });
  });
});
