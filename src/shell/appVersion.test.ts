import { describe, expect, it } from "vitest";
import { formatAppVersion, resolveAppVersion } from "./appVersion";

describe("formatAppVersion", () => {
  it("prefixes v", () => {
    expect(formatAppVersion("0.1.12")).toBe("v0.1.12");
  });

  it("keeps an existing v", () => {
    expect(formatAppVersion("v0.1.12")).toBe("v0.1.12");
  });

  it("returns empty for blank input", () => {
    expect(formatAppVersion("  ")).toBe("");
  });
});

describe("resolveAppVersion", () => {
  it("uses the provided getter", async () => {
    await expect(resolveAppVersion(async () => "0.1.8")).resolves.toBe("v0.1.8");
  });

  it("falls back when getter throws", async () => {
    await expect(
      resolveAppVersion(async () => {
        throw new Error("no tauri");
      }),
    ).resolves.toMatch(/^v\d+\.\d+\.\d+$/);
  });
});
