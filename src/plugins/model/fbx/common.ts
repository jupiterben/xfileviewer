/** Phong material creation and skin binding, ported from
 * lib-fbx tools/fbx-viewer/src/fbx-three-common.ts.
 */
import { Color, DoubleSide, MeshPhongMaterial, Skeleton, type Bone, type SkinnedMesh, type Texture } from "three";
import { fbxMat } from "./transform";

export type SkinBinding = {
  bones: Bone[];
  transformLinks: Array<ArrayLike<number> | undefined>;
};

type PhongData = {
  name?: string;
  diffuse: [number, number, number];
  specular: [number, number, number];
  shininess: number;
  transparency: number;
  vertexColors: boolean;
  map?: Texture | null;
};

export function createPhongMaterial(data: PhongData): MeshPhongMaterial {
  const m = new MeshPhongMaterial({
    color: new Color(...data.diffuse),
    specular: new Color(...data.specular),
    shininess: data.shininess,
    side: DoubleSide,
    vertexColors: data.vertexColors,
  });
  if (data.name) m.name = data.name;
  if (data.map) {
    m.map = data.map;
    // DCC exporters often keep a dark scene diffuse next to the texture; let the map win.
    m.color.set(0xffffff);
  }
  if (data.transparency > 0 && data.transparency < 1) {
    m.transparent = true;
    m.opacity = 1 - data.transparency;
  }
  return m;
}

export function bindSkin(mesh: SkinnedMesh, binding: SkinBinding): void {
  mesh.updateMatrixWorld(true);
  const inverses = binding.bones.map((bone, i) => {
    const link = binding.transformLinks[i];
    return link ? fbxMat(link).invert() : bone.matrixWorld.clone().invert();
  });
  // Bind only after local transforms, with an explicit bind matrix to preserve the inverses.
  mesh.bind(new Skeleton(binding.bones, inverses), mesh.matrixWorld);
}
