import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import type { LoadingManager, Object3D } from "three";
import { lazyModule } from "../../core/lazyModule";
import { readGltfDocument } from "./gltfMetadata";

const loadDraco = lazyModule(() => import("three/examples/jsm/loaders/DRACOLoader.js"));
const loadMeshopt = lazyModule(() => import("three/examples/jsm/libs/meshopt_decoder.module.js"));

export async function parseGltf(buffer: ArrayBuffer, base: string, manager: LoadingManager, signal: AbortSignal): Promise<Object3D> {
  const doc = readGltfDocument(buffer);
  const required = doc.extensionsRequired ?? [];
  if (required.includes("KHR_texture_basisu")) {
    throw new Error("该模型使用 KTX2 压缩纹理（KHR_texture_basisu），暂不支持");
  }
  // Inspect the JSON declaration before loading optional geometry decoders.
  const extensions = new Set([...required, ...(doc.extensionsUsed ?? [])]);
  const loader = new GLTFLoader(manager);
  let draco: DRACOLoader | undefined;
  try {
    const [dracoModule, meshoptModule] = await Promise.all([
      extensions.has("KHR_draco_mesh_compression") ? loadDraco() : undefined,
      extensions.has("EXT_meshopt_compression") ? loadMeshopt() : undefined,
    ]);
    signal.throwIfAborted();
    // Allocate workers only after both imports succeed, so a rejected optional
    // import cannot leave a late-created decoder outside the finally block.
    if (dracoModule) {
      draco = new dracoModule.DRACOLoader().setDecoderPath("/draco/");
      loader.setDRACOLoader(draco);
    }
    if (meshoptModule) loader.setMeshoptDecoder(meshoptModule.MeshoptDecoder);
    const gltf = await loader.parseAsync(buffer, base);
    gltf.scene.animations = gltf.animations;
    return gltf.scene;
  } finally {
    // parseAsync settles geometry decoding before its promise resolves/rejects.
    draco?.dispose();
  }
}
