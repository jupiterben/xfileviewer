import { describe, expect, it } from "vitest";
import { builtinPlugins } from "../../src/plugins/builtin";
import { PluginRegistry } from "../../src/core/registry";
import config from "../../src-tauri/tauri.conf.json";

describe("builtinPlugins", () => {
  it("registers TGA and PSD as images with matching installer associations", () => {
    const registry = new PluginRegistry();
    builtinPlugins().forEach(plugin => registry.register(plugin));
    for (const ext of ["tga", "psd"]) {
      expect(registry.kindFor(`/images/sample.${ext.toUpperCase()}`)).toBe("image");
      expect(registry.viewerFor(`sample.${ext}`)?.id).toBe("image-decoded");
      expect(registry.extensionsForKind("image").has(ext)).toBe(true);
      expect(config.bundle.fileAssociations.some(item => item.ext.includes(ext))).toBe(true);
    }
    expect(registry.viewerFor("sample.png")?.id).toBe("image-raster");
  });

  it("registers a document markdown viewer", () => {
    const plugin = builtinPlugins().find((p) => p.id === "builtin-markdown");
    expect(plugin?.viewers[0]?.kindId).toBe("document");
    expect(plugin?.viewers[0]?.extensions).toEqual(["md", "markdown"]);
  });
});
