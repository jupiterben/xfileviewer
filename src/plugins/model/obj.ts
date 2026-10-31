import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { MTLLoader } from "three/examples/jsm/loaders/MTLLoader.js";
import type { LoadingManager, Object3D } from "three";
import { resourceUrl } from "./resources";

export async function parseObj(buffer: ArrayBuffer, base: string, manager: LoadingManager, signal: AbortSignal): Promise<Object3D> {
  const source = new TextDecoder().decode(buffer);
  const loader = new OBJLoader(manager);
  const materials = new MTLLoader(manager).parse("", base);
  for (const match of source.matchAll(/^\s*mtllib\s+(.+?)\s*$/gm)) {
    signal.throwIfAborted();
    const url = resourceUrl(match[1].trim(), base);
    const mtl = await fetch(url, { signal });
    if (!mtl.ok) throw new Error(`无法读取材质 ${match[1]} (${mtl.status})`);
    const parsed = new MTLLoader(manager).parse(await mtl.text(), new URL(".", url).href);
    Object.assign(materials.materials, parsed.materials);
    for (const name of Object.keys(parsed.materialsInfo)) materials.materials[name] = parsed.create(name);
  }
  signal.throwIfAborted();
  loader.setMaterials(materials);
  return loader.parse(source);
}
