import type { FbxParseResult, FbxScene } from "@infloopgame/lib-fbx";
import type { Object3D } from "three";

export interface FbxDetails {
  document: FbxParseResult;
  scene: FbxScene;
}

// SDK connections are cyclic; keep them out of Three.js's JSON-serialized userData.
const details = new WeakMap<Object3D, FbxDetails>();

export function setFbxDetails(model: Object3D, value: FbxDetails): void {
  details.set(model, value);
}

export function getFbxDetails(model: Object3D): FbxDetails | undefined {
  return details.get(model);
}

export function releaseFbxDetails(model: Object3D): void {
  details.delete(model);
}
