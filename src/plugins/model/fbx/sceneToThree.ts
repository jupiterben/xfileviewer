/** FbxScene → three.js conversion following the lib-fbx reference viewer
 * (tools/fbx-viewer/src/fbx-sdk-to-three.ts): parse → buildScene → walk
 * FbxNode. Skin binding matches three r184 (`Inverse(TransformLink)` then
 * `bind(skeleton, mesh.matrixWorld)`); Z-up scenes rotate to three's Y-up.
 * On top of the reference we also load diffuse file textures, which the
 * comparison viewer intentionally skips.
 */
import {
  Bone,
  ClampToEdgeWrapping,
  Group,
  Matrix4,
  Mesh,
  RepeatWrapping,
  SkinnedMesh,
  SRGBColorSpace,
  type Material,
  type MeshPhongMaterial,
  type Object3D,
  type Texture,
  type TextureLoader,
} from "three";
import {
  FbxAxisUpVector,
  FbxLayerElementMappingMode,
  FbxLayerElementReferenceMode,
  type FbxFileTexture,
  type FbxLayerElement,
  type FbxMesh,
  type FbxNode,
  type FbxScene,
  type FbxSkin,
  type FbxSurfaceLambert,
  type FbxVideo,
} from "@infloopgame/lib-fbx";
import { DEG, fbxMat, generateTransform, getEulerOrder, maybeVec3 } from "./transform";
import { bindSkin, createPhongMaterial, type SkinBinding } from "./common";
import { buildMeshGeometry, buildSkinInfluences, type LayerData, type SkinClusterData } from "./geometry";

function applyLocal(obj: Object3D, node: FbxNode, parent: Object3D): void {
  parent.updateMatrixWorld(true);
  const m = generateTransform({
    translation: maybeVec3(node.lclTranslation?.value),
    rotation: maybeVec3(node.lclRotation?.value),
    scale: maybeVec3(node.lclScaling?.value),
    preRotation: maybeVec3(node.preRotation?.value),
    postRotation: maybeVec3(node.postRotation?.value),
    rotationOffset: maybeVec3(node.rotationOffset?.value),
    rotationPivot: maybeVec3(node.rotationPivot?.value),
    scalingOffset: maybeVec3(node.scalingOffset?.value),
    scalingPivot: maybeVec3(node.scalingPivot?.value),
    eulerOrder: getEulerOrder(Number(node.rotationOrder?.value ?? 0)),
    inheritType: Number(node.inheritType?.value ?? 0),
    parentMatrix: parent.matrix,
    parentMatrixWorld: parent.matrixWorld,
  });
  obj.matrix.identity();
  obj.applyMatrix4(m);
  obj.updateWorldMatrix(false, false);
  const vis = node.visibility?.value;
  if (typeof vis === "number") obj.visible = vis > 1e-6;
}

function vec3(v: unknown, fallback: [number, number, number]): [number, number, number] {
  if (Array.isArray(v) && v.length >= 3) return [Number(v[0]), Number(v[1]), Number(v[2])];
  return fallback;
}

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function packed(el: FbxLayerElement<unknown> | undefined, comps: number): LayerData | null {
  if (!el) return null;
  let mapping: LayerData["mapping"] = "ByPolygonVertex";
  if (el.mappingMode === FbxLayerElementMappingMode.eByControlPoint) mapping = "ByControlPoint";
  else if (el.mappingMode === FbxLayerElementMappingMode.eByPolygon) mapping = "ByPolygon";
  else if (el.mappingMode === FbxLayerElementMappingMode.eAllSame) mapping = "AllSame";
  return {
    direct: el.directArray as ArrayLike<number>,
    index: el.indexArray,
    comps,
    mapping,
    indexed: el.referenceMode === FbxLayerElementReferenceMode.eIndexToDirect ||
      el.referenceMode === FbxLayerElementReferenceMode.eIndex,
  };
}

function cpInfluences(skin: FbxSkin, cpCount: number, boneOf: Map<FbxNode, number>) {
  const clusters: SkinClusterData[] = [];
  for (const cluster of skin.clusters) {
    const boneIndex = cluster.link ? boneOf.get(cluster.link) : undefined;
    if (boneIndex === undefined) continue;
    clusters.push({ boneIndex, indices: cluster.indexes, weights: cluster.weights });
  }
  return buildSkinInfluences(clusters, cpCount);
}

const IMAGE_MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  bmp: "image/bmp", webp: "image/webp",
};

class TextureBank {
  private readonly cache = new Map<FbxFileTexture, Texture | null>();
  readonly objectURLs: string[] = [];

  constructor(private readonly loader: TextureLoader) {}

  diffuseOf(material: FbxSurfaceLambert | undefined): Texture | null {
    const file = material?.diffuse?.srcObjects?.find(source => source.classId === "FbxFileTexture") as
      FbxFileTexture | undefined;
    if (!file) return null;
    let texture = this.cache.get(file);
    if (texture === undefined) {
      texture = this.load(file);
      this.cache.set(file, texture);
    }
    return texture;
  }

  private load(file: FbxFileTexture): Texture | null {
    const media = file.media as FbxVideo | undefined;
    const name = file.relativeFileName || file.fileName || media?.relativeFileName || media?.fileName || "";
    let texture: Texture;
    const content = media?.content;
    if (content && content.byteLength > 0) {
      const type = IMAGE_MIME[name.split(".").pop()?.toLowerCase() ?? ""];
      if (!type) {
        console.warn(`FBX: 不支持的内嵌贴图格式 "${name}"`);
        return null;
      }
      const url = URL.createObjectURL(new Blob([content], { type }));
      this.objectURLs.push(url);
      // The loader path is for sibling files; blob URLs must pass through untouched.
      const path = this.loader.path;
      this.loader.setPath("");
      texture = this.loader.load(url);
      this.loader.setPath(path);
    } else if (name) {
      texture = this.loader.load(name.replace(/\\/g, "/"));
    } else {
      return null;
    }
    texture.colorSpace = SRGBColorSpace;
    texture.wrapS = file.wrapModeU?.value === 1 ? ClampToEdgeWrapping : RepeatWrapping;
    texture.wrapT = file.wrapModeV?.value === 1 ? ClampToEdgeWrapping : RepeatWrapping;
    const scaling = maybeVec3(file.scaling?.value);
    if (scaling) texture.repeat.set(scaling[0], scaling[1]);
    const translation = maybeVec3(file.translation?.value);
    if (translation) texture.offset.set(translation[0], translation[1]);
    return texture;
  }
}

function phong(node: FbxNode, index: number, vertexColors: boolean, textures: TextureBank): MeshPhongMaterial {
  const mat = (node.materials[index] ?? node.materials[0]) as FbxSurfaceLambert | undefined;
  return createPhongMaterial({
    name: mat?.name,
    diffuse: vec3(mat?.diffuse?.value, [0.75, 0.75, 0.75]),
    specular: vec3((mat as { specular?: { value?: unknown } } | undefined)?.specular?.value, [0.1, 0.1, 0.1]),
    shininess: num((mat as { shininess?: { value?: unknown } } | undefined)?.shininess?.value, 16),
    transparency: num((mat as { transparencyFactor?: { value?: unknown } } | undefined)?.transparencyFactor?.value, 0),
    vertexColors,
    map: textures.diffuseOf(mat),
  });
}

function convertMesh(node: FbxNode, mesh: FbxMesh, bones: Map<FbxNode, Bone>, textures: TextureBank): Mesh | SkinnedMesh | null {
  const cpCount = Math.floor(mesh.controlPoints.length / 3);
  if (cpCount === 0) return null;
  const layer = mesh.layers[0];
  const skin = mesh.deformers.find((d): d is FbxSkin => d.classId === "FbxSkin");

  const boneList: Bone[] = [];
  const transformLinks: Array<ArrayLike<number> | undefined> = [];
  const boneIndex = new Map<FbxNode, number>();
  if (skin) {
    for (const cluster of skin.clusters) {
      const link = cluster.link;
      if (!link) continue;
      const bone = bones.get(link);
      if (!bone || boneIndex.has(link)) continue;
      boneIndex.set(link, boneList.length);
      boneList.push(bone);
      transformLinks.push(cluster.transformLink);
    }
  }
  const influences = skin && boneList.length > 0 ? cpInfluences(skin, cpCount, boneIndex) : null;
  const geo = buildMeshGeometry({
    controlPoints: mesh.controlPoints,
    polygonIndexes: mesh.polygonIndexes,
    normals: packed(layer?.normals, 3),
    uvs: packed(layer?.uvs[0], 2),
    uv2: packed(layer?.uvs[1], 2),
    colors: packed(layer?.vertexColors, 4),
    materials: packed(layer?.materials, 1),
    influences,
  });
  if (!geo) return null;

  const hasColor = Boolean(geo.getAttribute("color"));
  const matCount = Math.max(1, ...geo.groups.map(g => (g.materialIndex ?? 0) + 1), node.materials.length);
  const materials: Material[] = [];
  for (let i = 0; i < matCount; i++) materials.push(phong(node, i, hasColor, textures));
  const material = materials.length === 1 ? materials[0] : materials;

  const gt = vec3(node.geometricTranslation?.value, [0, 0, 0]);
  const gr = vec3(node.geometricRotation?.value, [0, 0, 0]);
  const gs = vec3(node.geometricScaling?.value, [1, 1, 1]);
  const threeMesh = influences && boneList.length > 0 ? new SkinnedMesh(geo, material) : new Mesh(geo, material);
  threeMesh.name = mesh.name || node.name;
  threeMesh.position.set(gt[0], gt[1], gt[2]);
  threeMesh.rotation.set(gr[0] * DEG, gr[1] * DEG, gr[2] * DEG);
  threeMesh.scale.set(gs[0], gs[1], gs[2]);
  if (threeMesh instanceof SkinnedMesh) {
    threeMesh.userData.fbxSkinBind = { bones: boneList, transformLinks } satisfies SkinBinding;
  }
  return threeMesh;
}

function applyBindPose(
  scene: FbxScene,
  attachments: Array<{ node: FbxNode; obj: Object3D }>,
  clustered: Set<FbxNode>,
): void {
  const byNode = new Map(attachments.map(a => [a.node, a.obj]));
  const temp = new Matrix4();
  for (const pose of scene.poses) {
    if (!pose.bindPose) continue;
    for (const info of pose.poseInfos) {
      const obj = byNode.get(info.node);
      if (!obj || obj.type !== "Bone" || clustered.has(info.node) || !info.matrix) continue;
      const bindPose = fbxMat(info.matrix);
      if (!info.matrixIsLocal && obj.parent) {
        temp.copy(obj.parent.matrixWorld).invert().multiply(bindPose);
      } else {
        temp.copy(bindPose);
      }
      temp.decompose(obj.position, obj.quaternion, obj.scale);
      obj.updateMatrix();
      if (!info.matrixIsLocal) obj.matrixWorld.copy(bindPose);
    }
  }
}

export function sceneToThree(scene: FbxScene, textureLoader: TextureLoader): Group {
  const root = new Group();
  root.name = scene.rootNode.name || "RootNode";
  const textures = new TextureBank(textureLoader);
  const bones = new Map<FbxNode, Bone>();
  const attachments: Array<{ node: FbxNode; obj: Object3D }> = [];

  const walk = (fbx: FbxNode, parent: Object3D) => {
    const isBone = fbx.nodeAttributes.some(a => a.classId === "FbxSkeleton");
    const obj: Object3D = isBone ? new Bone() : new Group();
    obj.name = fbx.name;
    parent.add(obj);
    applyLocal(obj, fbx, parent);
    if (isBone) bones.set(fbx, obj as Bone);
    attachments.push({ node: fbx, obj });
    for (const child of fbx.children) walk(child, obj);
  };

  for (const child of scene.rootNode.children) walk(child, root);

  const meshes: Array<Mesh | SkinnedMesh> = [];
  const clustered = new Set<FbxNode>();
  for (const { node, obj } of attachments) {
    for (const attr of node.nodeAttributes) {
      if (attr.classId !== "FbxMesh") continue;
      const mesh = convertMesh(node, attr as FbxMesh, bones, textures);
      if (mesh) {
        obj.add(mesh);
        meshes.push(mesh);
      }
      const skin = (attr as FbxMesh).deformers.find((d): d is FbxSkin => d.classId === "FbxSkin");
      for (const cluster of skin?.clusters ?? []) {
        if (cluster.link) clustered.add(cluster.link);
      }
    }
  }

  root.updateMatrixWorld(true);
  applyBindPose(scene, attachments, clustered);
  root.updateMatrixWorld(true);

  for (const mesh of meshes) {
    if (!(mesh instanceof SkinnedMesh)) continue;
    const pending = mesh.userData.fbxSkinBind as SkinBinding | undefined;
    if (!pending) continue;
    bindSkin(mesh, pending);
    delete mesh.userData.fbxSkinBind;
  }

  // Three.js 是 Y-up；FBX Z-up（UpAxis=2）对齐 FBXLoader：绕 X 转 -90°。
  if (scene.globalSettings.axisSystem.upVector === FbxAxisUpVector.eZAxis) {
    root.rotation.x = -Math.PI / 2;
    root.updateMatrixWorld(true);
  }

  if (textures.objectURLs.length > 0) root.userData.fbxObjectURLs = [...textures.objectURLs];
  return root;
}
