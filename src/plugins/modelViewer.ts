import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { Viewer } from "../core/types";
import { basename } from "../core/path";
import { loadContent, type ModelContent } from "./model/content";
import { MODEL_EXTENSIONS } from "./model/formats";
import { createInfoPanel } from "./model/info";
import "./model/model.css";

export function modelViewer(): Viewer {
  return {
    id: "model-three", kindId: "3dmodel", extensions: MODEL_EXTENSIONS,
    mount(el, ctx) {
      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      const root = document.createElement("div");
      root.className = "model-viewer";
      const viewport = document.createElement("div");
      viewport.className = "model-viewport";
      viewport.dataset.noWindowDrag = "";
      renderer.domElement.setAttribute("aria-label", "3D 模型：拖动旋转，右键平移，滚轮缩放");
      viewport.append(renderer.domElement);
      const toolbar = document.createElement("div");
      toolbar.className = "model-toolbar";
      const status = document.createElement("span");
      status.textContent = "正在加载模型…";
      status.setAttribute("role", "status");
      const main = document.createElement("div");
      main.className = "model-main";
      const info = createInfoPanel();
      main.append(viewport, info.toggle, info.panel);
      root.append(toolbar, main, status);
      status.className = "model-status";
      const loading = document.createElement("div");
      loading.className = "model-loading";
      loading.textContent = "正在加载模型…";
      viewport.append(loading);
      el.append(root);
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x1e1e22);
      scene.add(new THREE.AmbientLight(0xffffff, 0.6));
      const light = new THREE.DirectionalLight(0xffffff, 1.2);
      light.position.set(5, 10, 7.5);
      scene.add(light);
      const fill = new THREE.DirectionalLight(0xffffff, 0.4);
      fill.position.set(-5, -3, -7.5);
      scene.add(fill);
      const grid = new THREE.GridHelper(10, 20, 0x444448, 0x333338);
      scene.add(grid);
      const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 1000);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      const abort = new AbortController();
      let destroyed = false;
      let model: THREE.Object3D | undefined;
      let content: ModelContent | undefined;
      let radius = 1;
      const center = new THREE.Vector3();
      function reset() {
        const angle = Math.min(THREE.MathUtils.degToRad(camera.fov / 2), Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect));
        const distance = radius / Math.sin(angle) * 1.15;
        camera.position.copy(center).add(new THREE.Vector3(0.7, 0.5, 0.9).normalize().multiplyScalar(distance));
        camera.near = Math.max(radius / 1000, 0.000001);
        camera.far = Math.max(distance * 10, radius * 100);
        camera.updateProjectionMatrix();
        controls.target.copy(center);
        controls.maxDistance = camera.far / 2;
        controls.update();
      }
      if (ctx.onOpen) {
        const openButton = document.createElement("button");
        openButton.type = "button";
        openButton.textContent = "打开";
        openButton.title = "打开模型 (Ctrl/Cmd+O)";
        openButton.onclick = () => ctx.onOpen?.();
        toolbar.append(openButton);
      }
      const fileName = document.createElement("span");
      fileName.className = "model-file-name";
      fileName.textContent = basename(ctx.path);
      fileName.title = ctx.path;
      toolbar.append(fileName);
      const resetButton = document.createElement("button");
      resetButton.textContent = "重置视角";
      resetButton.onclick = reset;
      toolbar.append(resetButton);
      function toggle(label: string, change: (checked: boolean) => void) {
        const wrapper = document.createElement("label");
        const input = document.createElement("input");
        input.type = "checkbox";
        input.onchange = () => change(input.checked);
        wrapper.append(input, label);
        toolbar.append(wrapper);
        return input;
      }
      toggle("自动旋转", checked => { controls.autoRotate = checked; });
      let wireframe = false;
      function applyWireframe(checked: boolean) {
        wireframe = checked;
        model?.traverse(object => {
          const material = (object as THREE.Mesh).material;
          if (material) for (const item of Array.isArray(material) ? material : [material]) {
            if ("wireframe" in item) item.wireframe = checked;
          }
        });
      }
      const wireframeInput = toggle("线框", applyWireframe);
      function resize() {
        const width = Math.max(viewport.clientWidth, 1);
        const height = Math.max(viewport.clientHeight, 1);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height);
      }
      const observer = new ResizeObserver(resize);
      observer.observe(viewport);
      resize();
      reset();
      renderer.setAnimationLoop(() => {
        controls.enabled = !ctx.isInteractionBlocked?.();
        if (controls.enabled) controls.update();
        renderer.render(scene, camera);
      });
      void loadContent(ctx.src, ctx.path, abort.signal).then(loaded => {
        if (destroyed) { loaded.dispose(); return; }
        content = loaded;
        model = loaded.object;
        // Recenter classic models so they align with the reference grid. Splat
        // transforms belong to the splat renderer; aim at their bounds instead.
        const bounds = loaded.box;
        if (!loaded.isSplat && !bounds.isEmpty()) model.position.sub(bounds.getCenter(new THREE.Vector3()));
        wireframeInput.disabled = loaded.isSplat || loaded.stats.meshes === 0;
        wireframeInput.title = wireframeInput.disabled ? "线框仅适用于网格模型" : "显示网格线框";
        info.update(basename(ctx.path), loaded.bytes, loaded.format, bounds, loaded.stats);
        applyWireframe(wireframe);
        const sphere = (loaded.isSplat ? bounds : new THREE.Box3().setFromObject(model)).getBoundingSphere(new THREE.Sphere());
        if (!Number.isFinite(sphere.radius) || sphere.radius < 0) throw new Error("模型没有可显示的几何体");
        radius = Math.max(sphere.radius, 0.00001);
        center.copy(sphere.center);
        scene.add(model);
        reset();
        loading.remove();
        status.textContent = "加载完成 · 拖动旋转 · 右键平移 · 滚轮缩放";
      }).catch(error => {
        if (!destroyed) ctx.onError(`无法加载 3D 模型：${error instanceof Error ? error.message : String(error)}`);
      });
      return {
        destroy() {
          if (destroyed) return;
          destroyed = true;
          abort.abort();
          renderer.setAnimationLoop(null);
          observer.disconnect();
          controls.dispose();
          content?.dispose();
          grid.geometry.dispose();
          for (const material of Array.isArray(grid.material) ? grid.material : [grid.material]) material.dispose();
          scene.clear();
          renderer.dispose();
          renderer.forceContextLoss();
          root.remove();
        },
      };
    },
  };
}
