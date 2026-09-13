// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { computeStats, createInfoPanel, formatBytes } from "./info";
import { isGaussianSplatPLY, MODEL_EXTENSIONS } from "./formats";
import { parseModel, disposeModel } from "./load";

const header = "ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\n";
const bytes = (text: string) => { const encoded = new TextEncoder().encode(text); const buffer = new ArrayBuffer(encoded.length); new Uint8Array(buffer).set(encoded); return buffer; };

describe("model feature parity", () => {
  it("registers every reference format plus OBJ", () => {
    expect(MODEL_EXTENSIONS).toEqual(expect.arrayContaining(["glb", "gltf", "fbx", "obj", "ply", "splat", "ksplat"]));
  });
  it("detects Gaussian PLY properties only in the header", () => {
    expect(isGaussianSplatPLY(bytes(header + "property float f_dc_0\nproperty float scale_0\nproperty float rot_0\nend_header\n"))).toBe(true);
    expect(isGaussianSplatPLY(bytes(header + "end_header\nproperty float f_dc_0\nproperty float scale_0\nproperty float rot_0\n"))).toBe(false);
  });
  it("loads PLY faces as a mesh and vertex-only PLY as points", async () => {
    const signal = new AbortController().signal;
    const points = await parseModel(bytes(header + "end_header\n0 0 0\n1 0 0\n0 1 0\n"), "https://example.com/a.ply", "a.ply", signal);
    const mesh = await parseModel(bytes(header + "element face 1\nproperty list uchar int vertex_indices\nend_header\n0 0 0\n1 0 0\n0 1 0\n3 0 1 2\n"), "https://example.com/a.ply", "a.ply", signal);
    expect(points).toBeInstanceOf(THREE.Points);
    expect(computeStats(points)).toMatchObject({ vertices: 3, triangles: 0, meshes: 0 });
    expect(mesh).toBeInstanceOf(THREE.Mesh);
    expect(computeStats(mesh)).toMatchObject({ vertices: 3, triangles: 1, meshes: 1 });
    disposeModel(points); disposeModel(mesh);
  });
  it("counts shared materials once and includes animation clips", () => {
    const root = new THREE.Group();
    const material = new THREE.MeshBasicMaterial();
    const geometry = new THREE.BoxGeometry();
    root.add(new THREE.Mesh(geometry, material), new THREE.Mesh(geometry, material));
    root.animations = [new THREE.AnimationClip("idle", 1, [])];
    expect(computeStats(root)).toMatchObject({ meshes: 2, materials: 1, triangles: 24, animations: 1 });
    disposeModel(root);
  });
  it("renders safe metadata and collapses the info panel accessibly", () => {
    const info = createInfoPanel();
    info.update("<b>model.glb</b>", 2048, "GLB", new THREE.Box3(new THREE.Vector3(), new THREE.Vector3(1, 2, 3)), { meshes: 1, materials: 2, vertices: 3, triangles: 1, splats: 0, animations: 4 });
    expect(info.panel.querySelector("b")).toBeNull();
    expect(info.panel.textContent).toContain("2.00 KB");
    expect(info.panel.textContent).toContain("1.00 × 2.00 × 3.00");
    info.toggle.click();
    expect(info.panel.hidden).toBe(true);
    expect(info.toggle.getAttribute("aria-expanded")).toBe("false");
    info.toggle.click();
    expect(info.panel.hidden).toBe(false);
    expect(formatBytes(20)).toBe("20 B");
  });
});
