import { buildScene, parse } from "@infloopgame/lib-fbx";
import { AnimationClip, TextureLoader, type Group, type LoadingManager } from "three";
import { sceneToThree } from "./sceneToThree";

/** FBX loading follows the lib-fbx reference viewer: parse → buildScene →
 * SDK scene graph → three.js. The library does not sample animation curves,
 * so stacks surface as empty clips (name + count only).
 */
export function parseFbx(buffer: ArrayBuffer, base: string, manager: LoadingManager, signal: AbortSignal): Group {
  signal.throwIfAborted();
  const document = parse(buffer);
  const scene = buildScene(document);
  signal.throwIfAborted();
  const loader = new TextureLoader(manager).setPath(base).setCrossOrigin("anonymous");
  const model = sceneToThree(scene, loader);
  model.animations = scene.animStacks.map((stack, index) => new AnimationClip(stack.name || `Take ${index + 1}`, -1, []));
  model.userData.fbxParser = "@infloopgame/lib-fbx";
  model.userData.fbxVersion = document.version;
  model.userData.fbxFormat = document.format;
  return model;
}
