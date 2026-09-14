import { mount, unmount, flushSync } from "svelte";
import ModelInfo from "../../ui/ModelInfo.svelte";
import * as THREE from "three";

export interface ModelStats {
  meshes: number;
  materials: number;
  vertices: number;
  triangles: number;
  splats: number;
  animations: number;
}

export function computeStats(object: THREE.Object3D): ModelStats {
  const stats: ModelStats = { meshes: 0, materials: 0, vertices: 0, triangles: 0, splats: 0, animations: object.animations.length };
  const materials = new Set<THREE.Material>();
  object.traverse(child => {
    if (!(child instanceof THREE.Mesh || child instanceof THREE.Points || child instanceof THREE.Line)) return;
    const count = child.geometry.getAttribute("position")?.count ?? 0;
    stats.vertices += count;
    if (child instanceof THREE.Mesh) {
      stats.meshes++;
      stats.triangles += (child.geometry.index?.count ?? count) / 3;
    }
    for (const material of Array.isArray(child.material) ? child.material : [child.material]) materials.add(material);
  });
  stats.materials = materials.size;
  return stats;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${value.toFixed(value < 10 ? 2 : 1)} ${units[unit]}`;
}

export function formatDimensions(box: THREE.Box3): string {
  if (box.isEmpty()) return "—";
  return box.getSize(new THREE.Vector3()).toArray().map(value =>
    Math.abs(value) < 0.01 ? value.toExponential(1) : value.toFixed(2),
  ).join(" × ");
}

export function createInfoPanel() {
  const target = document.createElement("div");
  const view = mount(ModelInfo, { target });
  const panel = target.querySelector<HTMLElement>(".model-info")!;
  const toggle = target.querySelector<HTMLButtonElement>(".model-info-toggle")!;
  return {
    panel, toggle,
    destroy() { void unmount(view); },
    update(name: string, bytes: number, format: string, box: THREE.Box3, stats: ModelStats) {
      const rows: Array<[string, string | number]> = [
        ["文件名", name], ["文件大小", formatBytes(bytes)], ["格式", format],
        ["尺寸", formatDimensions(box)], ["网格", stats.meshes], ["材质", stats.materials],
        ["顶点", stats.vertices], ["三角形", Math.round(stats.triangles)],
        ["高斯点", stats.splats || "—"], ["动画", stats.animations],
      ];
      flushSync(() => view.update(rows));
    },
  };
}
