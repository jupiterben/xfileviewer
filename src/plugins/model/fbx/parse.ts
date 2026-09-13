import { parse, type FbxTreeData } from "@infloopgame/lib-fbx";
import { TextureLoader, type Group, type LoadingManager } from "three";
import { treeToThree } from "./treeToThree.js";

/** The r169 converter expects mutable number arrays (e.g. animation times).
 * lib-fbx deliberately returns Float64Array; copy those at the renderer boundary.
 * Keep embedded binary texture content as ArrayBuffer.
 */
function rendererTree(value: unknown): unknown {
  if (value instanceof Float64Array) return Array.from(value);
  if (value instanceof ArrayBuffer) return value;
  if (Array.isArray(value)) return value.map(rendererTree);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, rendererTree(child)]));
  }
  return value;
}

export function parseFbx(buffer: ArrayBuffer, base: string, manager: LoadingManager, signal: AbortSignal): Group {
  signal.throwIfAborted();
  const document = parse(buffer);
  const tree = rendererTree(document.tree) as FbxTreeData;
  const loader = new TextureLoader(manager).setPath(base).setCrossOrigin("anonymous");
  const model = treeToThree(tree, loader, manager);
  model.userData.fbxParser = "@infloopgame/lib-fbx";
  model.userData.fbxVersion = document.version;
  model.userData.fbxFormat = document.format;
  return model;
}
