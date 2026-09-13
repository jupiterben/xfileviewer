import { afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";

const state = vi.hoisted(() => ({ load: vi.fn(), dispose: vi.fn(), instances: [] as THREE.Group[] }));
vi.mock("@mkkellogg/gaussian-splats-3d", async () => {
  const THREE = await import("three");
  return {
    SceneFormat: { Ply: 0, Splat: 1, KSplat: 2 },
    DropInViewer: class extends THREE.Group {
      callbackMesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
      constructor() { super(); state.instances.push(this); }
      addSplatScene = state.load;
      dispose = state.dispose;
      getSplatScene() {
        return Object.assign(new THREE.Group(), { splatBuffer: {
          getSplatCount: () => 2,
          getSplatCenter: (index: number, target: THREE.Vector3) => target.set(100 + index, 5, 8),
        } });
      }
    },
  };
});
import { loadSplat } from "./splat";

afterEach(() => { vi.restoreAllMocks(); state.load.mockReset(); state.dispose.mockReset(); state.instances.length = 0; });

describe("splat lifetime", () => {
  it("frames off-origin splats and disposes only once", async () => {
    state.load.mockResolvedValue(undefined); state.dispose.mockResolvedValue(undefined);
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    const content = await loadSplat(new ArrayBuffer(32), "ksplat", new AbortController().signal);
    expect(state.load).toHaveBeenCalledWith(expect.stringContaining("blob:"), expect.objectContaining({ format: 2, showLoadingUI: false }));
    expect(content.box.min.toArray()).toEqual([100, 5, 8]);
    expect(content.box.max.toArray()).toEqual([101, 5, 8]);
    expect(content.stats.splats).toBe(2);
    expect(revoke).toHaveBeenCalledOnce();
    content.dispose(); content.dispose();
    expect(state.dispose).toHaveBeenCalledOnce();
  });
  it("disposes failed loads and revokes their object URL", async () => {
    state.load.mockRejectedValue(new Error("invalid splat")); state.dispose.mockResolvedValue(undefined);
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    await expect(loadSplat(new ArrayBuffer(0), "ply", new AbortController().signal)).rejects.toThrow("invalid splat");
    expect(state.dispose).toHaveBeenCalledOnce(); expect(revoke).toHaveBeenCalledOnce();
  });
  it("cancels an in-flight load without mounting a stale scene", async () => {
    let finish!: () => void;
    state.load.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    state.dispose.mockResolvedValue(undefined);
    const controller = new AbortController();
    const pending = loadSplat(new ArrayBuffer(32), "splat", controller.signal);
    controller.abort();
    expect(state.dispose).toHaveBeenCalledOnce();
    finish();
    await expect(pending).rejects.toThrow();
    expect(state.dispose).toHaveBeenCalledOnce();
  });
});
