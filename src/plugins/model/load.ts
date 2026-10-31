import * as THREE from "three";
import { lazyModule } from "../../core/lazyModule";
import { extensionOf } from "../../core/path";
import { releaseFbxDetails } from "./fbx/details";
import { modelResourceBase, resourceUrl } from "./resources";

// Preserve the public loading API while keeping helpers free of parser cycles.
export { modelResourceBase, resourceUrl } from "./resources";
export { gltfRequiredExtensions } from "./gltfMetadata";

// Only the selected format loads its parser; glTF's compression decoders are
// another boundary inside gltf.ts. The common Three runtime stays shared.
const parsers = {
  fbx: lazyModule(async () => (await import("./fbx/parse")).parseFbx),
  gltf: lazyModule(async () => (await import("./gltf")).parseGltf),
  obj: lazyModule(async () => (await import("./obj")).parseObj),
  ply: lazyModule(async () => (await import("./ply")).parsePly),
};
export async function loadModel(src: string, path: string, signal: AbortSignal): Promise<THREE.Object3D> {
  const response = await fetch(src, { signal });
  if (!response.ok) throw new Error(`无法读取模型 (${response.status})`);
  const buffer = await response.arrayBuffer();
  signal.throwIfAborted();
  return parseModel(buffer, src, path, signal);
}

export async function parseModel(buffer: ArrayBuffer, src: string, path: string, signal: AbortSignal): Promise<THREE.Object3D> {
  signal.throwIfAborted();
  const extension = extensionOf(path);
  const format = extension === "glb" ? "gltf" : extension;
  if (!Object.prototype.hasOwnProperty.call(parsers, format)) throw new Error("不支持的 3D 模型格式");
  const parse = await parsers[format as keyof typeof parsers]();
  // import() cannot be aborted; do not start parsing a stale selection.
  signal.throwIfAborted();
  const base = modelResourceBase(src);
  const manager = new THREE.LoadingManager();
  manager.setURLModifier(url => resourceUrl(url, base));
  return parse(buffer, base, manager, signal);
}

export function disposeModel(root: THREE.Object3D): void {
  releaseFbxDetails(root);
  const objectURLs: unknown = root.userData.fbxObjectURLs;
  if (Array.isArray(objectURLs)) {
    for (const url of objectURLs) if (typeof url === "string") URL.revokeObjectURL(url);
    delete root.userData.fbxObjectURLs;
  }
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse(object => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    if (mesh.material) for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(material);
    if (object instanceof THREE.SkinnedMesh) object.skeleton.dispose();
  });
  for (const material of materials) {
    for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    material.dispose();
  }
  for (const texture of textures) {
    texture.dispose();
    if (typeof ImageBitmap !== "undefined" && texture.image instanceof ImageBitmap) texture.image.close();
  }
  for (const geometry of geometries) geometry.dispose();
}
