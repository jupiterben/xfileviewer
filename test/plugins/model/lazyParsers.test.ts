import { afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  imported: [] as string[],
  parse: vi.fn(),
}));
vi.mock("../../../src/plugins/model/gltf", () => {
  state.imported.push("gltf"); return { parseGltf: state.parse };
});
vi.mock("../../../src/plugins/model/obj", () => {
  state.imported.push("obj"); return { parseObj: state.parse };
});
vi.mock("../../../src/plugins/model/ply", () => {
  state.imported.push("ply"); return { parsePly: state.parse };
});
vi.mock("../../../src/plugins/model/fbx/parse", () => {
  state.imported.push("fbx"); return { parseFbx: state.parse };
});
afterEach(() => { vi.resetModules(); state.imported.length = 0; state.parse.mockReset(); });

it("registration and common cleanup load no format parsers", async () => {
  await import("../../../src/plugins/model/load");
  expect(state.imported).toEqual([]);
});

it.each(["obj", "ply", "fbx", "gltf"])("loads only the selected %s parser", async extension => {
  const { parseModel } = await import("../../../src/plugins/model/load");
  const signal = new AbortController().signal;
  await parseModel(new ArrayBuffer(0), `https://example.com/a.${extension}`, `a.${extension}`, signal);
  expect(state.imported).toEqual([extension === "glb" ? "gltf" : extension]);
  expect(state.parse).toHaveBeenCalledOnce();
  if (extension === "gltf") {
    await parseModel(new ArrayBuffer(0), "https://example.com/a.glb", "a.glb", signal);
    expect(state.parse).toHaveBeenCalledTimes(2);
    expect(state.imported).toEqual(["gltf"]);
  }
});

it("rejects unsupported or cancelled requests before loading a parser", async () => {
  const { parseModel } = await import("../../../src/plugins/model/load");
  await expect(parseModel(new ArrayBuffer(0), "https://example.com/a.xyz", "a.xyz", new AbortController().signal))
    .rejects.toThrow("不支持");
  const abort = new AbortController(); abort.abort();
  await expect(parseModel(new ArrayBuffer(0), "https://example.com/a.obj", "a.obj", abort.signal)).rejects.toThrow();
  expect(state.imported).toEqual([]);
  expect(state.parse).not.toHaveBeenCalled();
});
