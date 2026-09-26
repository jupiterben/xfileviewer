import { afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { disposeModel, loadModel, modelResourceBase, resourceUrl } from "../../../src/plugins/model/load";
import { builtinPlugins } from "../../../src/plugins/builtin";
import { PluginRegistry } from "../../../src/core/registry";
import { BUILTIN_KINDS } from "../../../src/core/types";
import { kindUsesWheelPaging } from "../../../src/shell/wheelPager";

afterEach(() => vi.unstubAllGlobals());

describe("3D models", () => {
  it("groups all model formats and reserves wheel input for zoom", () => {
    const registry = new PluginRegistry();
    builtinPlugins().forEach(plugin => registry.register(plugin));
    expect(BUILTIN_KINDS).toContain("3dmodel");
    for (const ext of ["FBX", "obj", "glb", "gltf"]) expect(registry.kindFor(`/models/test.${ext}`)).toBe("3dmodel");
    expect(kindUsesWheelPaging("3dmodel")).toBe(false);
  });
  it("resolves sidecars and mixed Windows separators without changing embedded URLs", () => {
    expect(resourceUrl("textures\\a b.png", "http://asset.localhost/C:/models/")).toBe("http://asset.localhost/C:/models/textures/a%20b.png");
    expect(resourceUrl("C:\\textures\\a b.png", "http://asset.localhost/C:/models/")).toBe("http://asset.localhost/C%3A%2Ftextures%2Fa%20b.png");
    expect(resourceUrl("../data.bin", "asset://localhost/home/models/")).toBe("asset://localhost/home/data.bin");
    expect(resourceUrl("data:image/png;base64,abc", "https://example.com/")).toBe("data:image/png;base64,abc");
  });
  it("resolves Tauri fully encoded local paths", () => {
    expect(modelResourceBase("asset://localhost/%2Fhome%2Fmodels%2Ftest.glb")).toBe("asset://localhost//home/models/");
    expect(modelResourceBase("http://asset.localhost/C%3A%5Cmodels%5Ctest.glb")).toBe("http://asset.localhost/C%3A/models/");
  });
  it("parses OBJ geometry and its MTL material", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response("mtllib colors.mtl\nv 0 0 0\nv 1 0 0\nv 0 1 0\nusemtl red\nf 1 2 3\n"))
      .mockResolvedValueOnce(new Response("newmtl red\nKd 1 0 0\n"));
    vi.stubGlobal("fetch", fetcher);
    const model = await loadModel("https://example.com/models/a.obj", "a.obj", new AbortController().signal);
    const mesh = model.children[0] as THREE.Mesh;
    expect(mesh.geometry.getAttribute("position").count).toBe(3);
    expect((mesh.material as THREE.MeshPhongMaterial).color.getHex()).toBe(0xff0000);
    expect(fetcher.mock.calls[1][0]).toBe("https://example.com/models/colors.mtl");
    disposeModel(model);
  });
  it("parses a minimal GLB scene", async () => {
    const json = JSON.stringify({ asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name: "test" }] });
    const bytes = new TextEncoder().encode(json.padEnd(Math.ceil(json.length / 4) * 4, " "));
    const buffer = new ArrayBuffer(20 + bytes.length);
    const view = new DataView(buffer);
    [0x46546c67, 2, buffer.byteLength, bytes.length, 0x4e4f534a].forEach((value, i) => view.setUint32(i * 4, value, true));
    new Uint8Array(buffer, 20).set(bytes);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(buffer)));
    const model = await loadModel("https://example.com/a.glb", "a.glb", new AbortController().signal);
    expect(model.children[0].name).toBe("test");
    disposeModel(model);
  });
  it("rejects GLB models that require KTX2 textures with a friendly message", async () => {
    const json = JSON.stringify({ asset: { version: "2.0" }, extensionsRequired: ["KHR_texture_basisu"], scene: 0, scenes: [{ nodes: [] }] });
    const bytes = new TextEncoder().encode(json.padEnd(Math.ceil(json.length / 4) * 4, " "));
    const buffer = new ArrayBuffer(20 + bytes.length);
    const view = new DataView(buffer);
    [0x46546c67, 2, buffer.byteLength, bytes.length, 0x4e4f534a].forEach((value, i) => view.setUint32(i * 4, value, true));
    new Uint8Array(buffer, 20).set(bytes);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(buffer)));
    await expect(loadModel("https://example.com/a.glb", "a.glb", new AbortController().signal))
      .rejects.toThrow("KTX2");
  });
  it("rejects unreadable models and aborted loads", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 404 })));
    await expect(loadModel("https://example.com/a.fbx", "a.fbx", new AbortController().signal)).rejects.toThrow("404");
    const abort = new AbortController();
    abort.abort();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("")));
    await expect(loadModel("https://example.com/a.obj", "a.obj", abort.signal)).rejects.toThrow();
  });
  it("disposes shared geometry, materials and textures once", () => {
    const geometry = new THREE.BoxGeometry();
    const texture = new THREE.Texture();
    const material = new THREE.MeshStandardMaterial({ map: texture });
    const spies = [geometry, texture, material].map(resource => vi.spyOn(resource, "dispose"));
    const root = new THREE.Group();
    root.add(new THREE.Mesh(geometry, material), new THREE.Mesh(geometry, material));
    disposeModel(root);
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
  });
});
