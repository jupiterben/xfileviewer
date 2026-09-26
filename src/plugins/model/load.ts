import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";
import { MTLLoader } from "three/examples/jsm/loaders/MTLLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { extensionOf } from "../../core/path";

/** Draco WASM decoder served from public/draco (see vite publicDir). */
const DRACO_DECODER_PATH = "/draco/";

export function resourceUrl(url: string, base: string): string {
  if (/^(data:|blob:|https?:|asset:)/i.test(url)) return url;
  const normalized = url.replace(/\\/g, "/");
  const origin = new URL(base);
  if (/^[a-z]:\//i.test(normalized) && (origin.protocol === "asset:" || origin.hostname === "asset.localhost")) {
    return `${origin.protocol}//${origin.host}/${encodeURIComponent(normalized)}`;
  }
  return new URL(normalized, base).href;
}

export function modelResourceBase(src: string): string {
  const url = new URL(src);
  // Tauri encodes the entire filesystem path, including directory separators.
  if (url.protocol === "asset:" || url.hostname === "asset.localhost") {
    url.pathname = decodeURIComponent(url.pathname).replace(/\\/g, "/").split("/").map(encodeURIComponent).join("/");
  }
  return new URL(".", url).href;
}

/** Required extensions that GLTFLoader cannot satisfy in this build. */
const UNSUPPORTED_REQUIRED: Record<string, string> = {
  // KTX2Loader needs a renderer for detectSupport, which parseModel does not own.
  KHR_texture_basisu: "该模型使用 KTX2 压缩纹理（KHR_texture_basisu），暂不支持",
};

/** Read extensionsRequired without full GLTFLoader involvement, for friendly errors. */
export function gltfRequiredExtensions(buffer: ArrayBuffer): string[] {
  try {
    const view = new DataView(buffer);
    let json: string;
    if (buffer.byteLength >= 12 && view.getUint32(0, true) === 0x46546c67) {
      // GLB: magic, version, length, chunk length, chunk type, JSON payload.
      json = new TextDecoder().decode(new Uint8Array(buffer, 20, view.getUint32(12, true)));
    } else {
      json = new TextDecoder().decode(buffer);
    }
    const doc = JSON.parse(json) as { extensionsRequired?: string[] };
    return doc.extensionsRequired ?? [];
  } catch {
    return [];
  }
}

function configureGltfLoader(manager: THREE.LoadingManager): { loader: GLTFLoader; draco: DRACOLoader } {
  // Decoders for compressed geometry: Draco (KHR_draco_mesh_compression) and
  // meshopt (EXT_meshopt_compression). Workers spawn lazily on first decode.
  const draco = new DRACOLoader();
  draco.setDecoderPath(DRACO_DECODER_PATH);
  const loader = new GLTFLoader(manager);
  loader.setDRACOLoader(draco);
  loader.setMeshoptDecoder(MeshoptDecoder);
  return { loader, draco };
}

export async function loadModel(src: string, path: string, signal: AbortSignal): Promise<THREE.Object3D> {
  const response = await fetch(src, { signal });
  if (!response.ok) throw new Error(`无法读取模型 (${response.status})`);
  const buffer = await response.arrayBuffer();
  signal.throwIfAborted();
  return parseModel(buffer, src, path, signal);
}

export async function parseModel(buffer: ArrayBuffer, src: string, path: string, signal: AbortSignal): Promise<THREE.Object3D> {
  const base = modelResourceBase(src);
  const manager = new THREE.LoadingManager();
  manager.setURLModifier(url => resourceUrl(url, base));
  switch (extensionOf(path)) {
    case "fbx": {
      const { parseFbx } = await import("./fbx/parse");
      return parseFbx(buffer, base, manager, signal);
    }
    case "glb":
    case "gltf": {
      for (const ext of gltfRequiredExtensions(buffer)) {
        const message = UNSUPPORTED_REQUIRED[ext];
        if (message) throw new Error(message);
      }
      const { loader, draco } = configureGltfLoader(manager);
      try {
        const gltf = await loader.parseAsync(buffer, base);
        gltf.scene.animations = gltf.animations;
        return gltf.scene;
      } finally {
        // All decoding (including Draco workers) is settled once parseAsync
        // resolves or rejects, so the worker pool can be torn down.
        draco.dispose();
      }
    }
    case "ply": {
      const geometry = new PLYLoader().parse(buffer);
      const vertexColors = !!geometry.getAttribute("color");
      if (geometry.index) {
        if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();
        return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors, roughness: 0.85 }));
      }
      geometry.computeBoundingBox();
      const size = geometry.boundingBox!.getSize(new THREE.Vector3());
      return new THREE.Points(geometry, new THREE.PointsMaterial({
        vertexColors, size: (Math.max(size.x, size.y, size.z) || 1) / 250, sizeAttenuation: true,
      }));
    }
    case "obj": {
      const source = new TextDecoder().decode(buffer);
      const loader = new OBJLoader(manager);
      // OBJ files can reference multiple material libraries. Merge them before parsing.
      const materials = new MTLLoader(manager).parse("", base);
      for (const match of source.matchAll(/^\s*mtllib\s+(.+?)\s*$/gm)) {
        signal.throwIfAborted();
        const url = resourceUrl(match[1].trim(), base);
        const mtl = await fetch(url, { signal });
        if (!mtl.ok) throw new Error(`无法读取材质 ${match[1]} (${mtl.status})`);
        const parsed = new MTLLoader(manager).parse(await mtl.text(), new URL(".", url).href);
        Object.assign(materials.materials, parsed.materials);
        // Keep each library's own base URL when materials are created lazily.
        for (const name of Object.keys(parsed.materialsInfo)) materials.materials[name] = parsed.create(name);
      }
      loader.setMaterials(materials);
      return loader.parse(source);
    }
    default: throw new Error("不支持的 3D 模型格式");
  }
}

export function disposeModel(root: THREE.Object3D): void {
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
