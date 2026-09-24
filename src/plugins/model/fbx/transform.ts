/** FBX local-transform math, ported from lib-fbx tools/fbx-viewer/src/fbx-transform.ts.
 * `getEulerOrder` / `generateTransform` derive from the three.js FBXLoader;
 * see THREE-LICENSE.txt in this directory.
 */
import { Euler, Matrix4, Vector3, type EulerOrder } from "three";

export const DEG = Math.PI / 180;

/** FBX 外旋 → three.js 内旋。见 three.js FBXLoader `getEulerOrder`. */
export function getEulerOrder(order: number): EulerOrder {
  const enums: EulerOrder[] = ["ZYX", "YZX", "XZY", "ZXY", "YXZ", "XYZ"];
  return enums[order] ?? "ZYX";
}

export type TransformData = {
  translation?: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number];
  preRotation?: [number, number, number];
  postRotation?: [number, number, number];
  rotationOffset?: [number, number, number];
  rotationPivot?: [number, number, number];
  scalingOffset?: [number, number, number];
  scalingPivot?: [number, number, number];
  eulerOrder: EulerOrder;
  inheritType: number;
  parentMatrix: Matrix4;
  parentMatrixWorld: Matrix4;
};

export function maybeVec3(v: unknown): [number, number, number] | undefined {
  if (v && typeof v === "object" && "length" in v && Number((v as ArrayLike<number>).length) >= 3) {
    const a = v as ArrayLike<number>;
    return [Number(a[0]), Number(a[1]), Number(a[2])];
  }
  return undefined;
}

export function generateTransform(data: TransformData): Matrix4 {
  const lTranslationM = new Matrix4();
  const lPreRotationM = new Matrix4();
  const lRotationM = new Matrix4();
  const lPostRotationM = new Matrix4();
  const lScalingM = new Matrix4();
  const lScalingPivotM = new Matrix4();
  const lScalingOffsetM = new Matrix4();
  const lRotationOffsetM = new Matrix4();
  const lRotationPivotM = new Matrix4();
  const lParentGX = data.parentMatrixWorld.clone();
  const lParentLX = data.parentMatrix.clone();
  const tempVec = new Vector3();
  const tempEuler = new Euler();
  const defaultEulerOrder = getEulerOrder(0);

  if (data.translation) lTranslationM.setPosition(tempVec.fromArray(data.translation));
  if (data.preRotation) {
    tempEuler.set(data.preRotation[0] * DEG, data.preRotation[1] * DEG, data.preRotation[2] * DEG, defaultEulerOrder);
    lPreRotationM.makeRotationFromEuler(tempEuler);
  }
  if (data.rotation) {
    tempEuler.set(data.rotation[0] * DEG, data.rotation[1] * DEG, data.rotation[2] * DEG, data.eulerOrder);
    lRotationM.makeRotationFromEuler(tempEuler);
  }
  if (data.postRotation) {
    tempEuler.set(data.postRotation[0] * DEG, data.postRotation[1] * DEG, data.postRotation[2] * DEG, defaultEulerOrder);
    lPostRotationM.makeRotationFromEuler(tempEuler).invert();
  }
  if (data.scale) lScalingM.scale(tempVec.fromArray(data.scale));
  if (data.scalingOffset) lScalingOffsetM.setPosition(tempVec.fromArray(data.scalingOffset));
  if (data.scalingPivot) lScalingPivotM.setPosition(tempVec.fromArray(data.scalingPivot));
  if (data.rotationOffset) lRotationOffsetM.setPosition(tempVec.fromArray(data.rotationOffset));
  if (data.rotationPivot) lRotationPivotM.setPosition(tempVec.fromArray(data.rotationPivot));

  const lLRM = lPreRotationM.clone().multiply(lRotationM).multiply(lPostRotationM);
  const lParentGRM = new Matrix4().extractRotation(lParentGX);
  const lParentTM = new Matrix4().copyPosition(lParentGX);
  const lParentGRSM = lParentTM.clone().invert().multiply(lParentGX);
  const lParentGSM = lParentGRM.clone().invert().multiply(lParentGRSM);
  const lLSM = lScalingM;
  const lGlobalRS = new Matrix4();
  const inheritType = data.inheritType;
  if (inheritType === 0) {
    lGlobalRS.copy(lParentGRM).multiply(lLRM).multiply(lParentGSM).multiply(lLSM);
  } else if (inheritType === 1) {
    lGlobalRS.copy(lParentGRM).multiply(lParentGSM).multiply(lLRM).multiply(lLSM);
  } else {
    const lParentLSM = new Matrix4().scale(new Vector3().setFromMatrixScale(lParentLX));
    const lParentGSMnoLocal = lParentGSM.clone().multiply(lParentLSM.clone().invert());
    lGlobalRS.copy(lParentGRM).multiply(lLRM).multiply(lParentGSMnoLocal).multiply(lLSM);
  }

  let lTransform = lTranslationM
    .clone()
    .multiply(lRotationOffsetM)
    .multiply(lRotationPivotM)
    .multiply(lPreRotationM)
    .multiply(lRotationM)
    .multiply(lPostRotationM)
    .multiply(lRotationPivotM.clone().invert())
    .multiply(lScalingOffsetM)
    .multiply(lScalingPivotM)
    .multiply(lScalingM)
    .multiply(lScalingPivotM.clone().invert());

  const lLocalT = new Matrix4().copyPosition(lTransform);
  const lGlobalT = new Matrix4().copyPosition(lParentGX.clone().multiply(lLocalT));
  lTransform = lGlobalT.clone().multiply(lGlobalRS);
  lTransform.premultiply(lParentGX.clone().invert());
  return lTransform;
}

/** FBX 文件 16 元与 three.js FBXLoader 一样走 `fromArray`. */
export function fbxMat(a: ArrayLike<number>): Matrix4 {
  const arr = a instanceof Array ? a : Array.from(a);
  return new Matrix4().fromArray(arr);
}
