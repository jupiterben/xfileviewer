import { describe, expect, it } from "vitest";
import { builtinPlugins } from "./builtin";

describe("builtinPlugins", () => {
  it("registers a document markdown viewer", () => {
    const plugin = builtinPlugins().find((p) => p.id === "builtin-markdown");
    expect(plugin?.viewers[0]?.kindId).toBe("document");
    expect(plugin?.viewers[0]?.extensions).toEqual(["md", "markdown"]);
  });
});
