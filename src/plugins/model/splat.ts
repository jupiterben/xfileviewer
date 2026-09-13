import * as THREE from "three";
import { DropInViewer, SceneFormat } from "@mkkellogg/gaussian-splats-3d";
import type { ModelContent } from "./content";

export async function loadSplat(buffer: ArrayBuffer, extension: string, signal: AbortSignal): Promise<ModelContent> {
  signal.throwIfAborted();
  const viewer = new DropInViewer({ sharedMemoryForWorkers: false, gpuAcceleratedSort: false });
  const url = URL.createObjectURL(new Blob([buffer], { type: "application/octet-stream" }));
  let disposed = false;
  function dispose() {
    if (disposed) return;
    disposed = true;
    viewer.removeFromParent();
    viewer.callbackMesh.geometry.dispose();
    const material = viewer.callbackMesh.material;
    for (const item of Array.isArray(material) ? material : [material]) item.dispose();
    void viewer.dispose().catch(error => console.error("无法释放高斯泼溅资源", error));
  }
  signal.addEventListener("abort", dispose, { once: true });
  try {
    await viewer.addSplatScene(url, {
      format: extension === "ply" ? SceneFormat.Ply : extension === "ksplat" ? SceneFormat.KSplat : SceneFormat.Splat,
      showLoadingUI: false, splatAlphaRemovalThreshold: 1,
    });
    signal.throwIfAborted();
    const splatScene = viewer.getSplatScene(0);
    const splats = splatScene.splatBuffer.getSplatCount();
    splatScene.updateWorldMatrix(true, false);
    const box = new THREE.Box3();
    const center = new THREE.Vector3();
    // Match xmodelviewer: sample large scenes to avoid blocking the UI on framing.
    const step = Math.max(1, Math.ceil(splats / 20000));
    for (let index = 0; index < splats; index += step) {
      splatScene.splatBuffer.getSplatCenter(index, center, splatScene.matrixWorld);
      box.expandByPoint(center);
    }
    return {
      object: viewer, box, bytes: buffer.byteLength, format: `3D Gaussian Splatting (.${extension})`, isSplat: true,
      stats: { meshes: 0, materials: 1, vertices: splats, triangles: 0, splats, animations: 0 },
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  } finally {
    signal.removeEventListener("abort", dispose);
    URL.revokeObjectURL(url);
  }
}
