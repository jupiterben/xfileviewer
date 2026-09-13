declare module "@mkkellogg/gaussian-splats-3d" {
  import { Group, Mesh, Matrix4, Vector3 } from "three";
  export const SceneFormat: { Ply: number; Splat: number; KSplat: number };
  export class DropInViewer extends Group {
    constructor(options: { sharedMemoryForWorkers: boolean; gpuAcceleratedSort: boolean });
    callbackMesh: Mesh;
    addSplatScene(url: string, options: { format: number; showLoadingUI: boolean; splatAlphaRemovalThreshold: number }): PromiseLike<void>;
    getSplatScene(index: number): Group & {
      splatBuffer: {
        getSplatCount(): number;
        getSplatCenter(index: number, target: Vector3, transform?: Matrix4): void;
      };
    };
    dispose(): Promise<void>;
  }
}
