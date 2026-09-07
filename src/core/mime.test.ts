import { describe, expect, it } from "vitest";
import { mimeForExt } from "./mime";

describe("mimeForExt", () => {
  it("maps mp4 to video/mp4", () => {
    expect(mimeForExt("mp4")).toBe("video/mp4");
    expect(mimeForExt("MP4")).toBe("video/mp4");
  });

  it("maps common video containers", () => {
    expect(mimeForExt("webm")).toBe("video/webm");
    expect(mimeForExt("mov")).toBe("video/quicktime");
  });
});
