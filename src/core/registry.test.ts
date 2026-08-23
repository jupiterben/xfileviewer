import { describe, expect, it } from "vitest";
import { PluginRegistry } from "./registry";
import { BUILTIN_KINDS } from "./types";
import type { PluginManifest, Viewer } from "./types";

function stub(id: string, kindId: string, extensions: string[]): Viewer {
  return {
    id,
    kindId,
    extensions,
    mount: () => ({ destroy() {} }),
  };
}

function plugin(
  id: string,
  viewers: Viewer[],
): PluginManifest {
  return { id, name: id, version: "1.0.0", viewers };
}

describe("PluginRegistry", () => {
  it("includes document in the kinds external plugins may declare", () => {
    expect(BUILTIN_KINDS).toContain("document");
  });

  it("resolves kind and viewer by extension", () => {
    const reg = new PluginRegistry();
    reg.register(plugin("core-image", [stub("jpeg", "image", ["jpg", "jpeg"])]));
    expect(reg.kindFor("/x/a.JPG")).toBe("image");
    expect(reg.viewerFor("/x/a.JPG")?.id).toBe("jpeg");
    expect([...reg.extensionsForKind("image")].sort()).toEqual(["jpeg", "jpg"]);
  });

  it("lets a later plugin win the same extension", () => {
    const reg = new PluginRegistry();
    reg.register(plugin("a", [stub("first", "image", ["psd"])]));
    reg.register(plugin("b", [stub("second", "image", ["psd"])]));
    expect(reg.viewerFor("x.psd")?.id).toBe("second");
  });

  it("keeps jpeg and psd in the same kind with different viewers", () => {
    const reg = new PluginRegistry();
    reg.register(
      plugin("core", [
        stub("jpeg", "image", ["jpg"]),
        stub("psd", "image", ["psd"]),
      ]),
    );
    expect(reg.kindFor("a.jpg")).toBe("image");
    expect(reg.kindFor("a.psd")).toBe("image");
    expect(reg.viewerFor("a.jpg")?.id).toBe("jpeg");
    expect(reg.viewerFor("a.psd")?.id).toBe("psd");
  });

  it("unregister removes viewers and returns their extensions", () => {
    const reg = new PluginRegistry();
    reg.register(plugin("psd-plug", [stub("psd", "image", ["psd"])]));
    expect(reg.unregister("psd-plug")).toEqual(["psd"]);
    expect(reg.viewerFor("a.psd")).toBeUndefined();
  });

  it("lists each extension with its plugin display name", () => {
    const reg = new PluginRegistry();
    reg.register({
      id: "builtin-image",
      name: "Image",
      version: "1.0.0",
      viewers: [stub("jpeg", "image", ["jpg"])],
    });
    reg.register({
      id: "psd-plug",
      name: "PSD",
      version: "1.0.0",
      viewers: [stub("psd", "image", ["psd"])],
    });
    expect(reg.extensionsWithPlugins().sort((a, b) => a.ext.localeCompare(b.ext))).toEqual([
      { ext: "jpg", pluginName: "Image", kindId: "image" },
      { ext: "psd", pluginName: "PSD", kindId: "image" },
    ]);
  });
});
