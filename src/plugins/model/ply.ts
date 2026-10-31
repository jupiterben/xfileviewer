import * as THREE from "three";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";

export function parsePly(buffer: ArrayBuffer, _base: string, _manager: THREE.LoadingManager, signal: AbortSignal): THREE.Object3D {
  signal.throwIfAborted();
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
