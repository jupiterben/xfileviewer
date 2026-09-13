import * as THREE from "three";
import { extensionOf } from "../../core/path";
import { isGaussianSplatPLY } from "./formats";
import { computeStats, type ModelStats } from "./info";
import { disposeModel, parseModel } from "./load";

export interface ModelContent {
  object: THREE.Object3D;
  box: THREE.Box3;
  bytes: number;
  format: string;
  isSplat: boolean;
  stats: ModelStats;
  dispose(): void;
}

export async function loadContent(src: string, path: string, signal: AbortSignal): Promise<ModelContent> {
  const response = await fetch(src, { signal });
  if (!response.ok) throw new Error(`无法读取模型 (${response.status})`);
  const buffer = await response.arrayBuffer();
  signal.throwIfAborted();
  const extension = extensionOf(path);
  if (extension === "splat" || extension === "ksplat" || (extension === "ply" && isGaussianSplatPLY(buffer))) {
    const { loadSplat } = await import("./splat");
    return loadSplat(buffer, extension, signal);
  }
  const object = await parseModel(buffer, src, path, signal);
  if (signal.aborted) { disposeModel(object); signal.throwIfAborted(); }
  const box = new THREE.Box3().setFromObject(object);
  const stats = computeStats(object);
  let disposed = false;
  return {
    object, box, stats, bytes: buffer.byteLength, isSplat: false,
    format: extension === "ply" ? `PLY (${object instanceof THREE.Points ? "点云" : "网格"})` : extension.toUpperCase(),
    dispose() { if (!disposed) { disposed = true; disposeModel(object); } },
  };
}
