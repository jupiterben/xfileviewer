import { invoke } from "@tauri-apps/api/core";
import type { PluginManifest, Viewer } from "../core/types";
import { BUILTIN_KINDS } from "../core/types";
import { lazyViewer } from "./lazyViewer";

interface DiskManifest {
  id: string;
  name: string;
  version: string;
  requestAssociation?: boolean;
  viewers: Array<{
    id: string;
    kindId: string;
    extensions: string[];
    entry: string;
  }>;
}

/** Startup reads descriptors only, concurrently and in native directory order.
 * Keeping that order preserves registry override precedence.
 */
export async function loadExternalPlugins(): Promise<PluginManifest[]> {
  let dirs: string[];
  try {
    dirs = await invoke<string[]>("list_plugin_dirs");
  } catch {
    return [];
  }
  const loaded = await Promise.all(dirs.map(async dir => {
    try {
      return await loadOne(dir);
    } catch (err) {
      console.error("plugin load failed", dir, err);
      return null;
    }
  }));
  return loaded.filter((plugin): plugin is PluginManifest => plugin !== null);
}

async function loadOne(dir: string): Promise<PluginManifest> {
  const raw = await invoke<string>("read_plugin_file", { path: `${dir}/manifest.json` });
  const manifest = JSON.parse(raw) as DiskManifest;
  const viewers = manifest.viewers.map(spec => {
    if (!BUILTIN_KINDS.includes(spec.kindId as (typeof BUILTIN_KINDS)[number])) {
      throw new Error(`plugin ${manifest.id} uses unsupported kind ${spec.kindId}`);
    }
    return lazyViewer({ id: spec.id, kindId: spec.kindId, extensions: spec.extensions }, async () => {
      const code = await invoke<string>("read_plugin_file", { path: `${dir}/${spec.entry}` });
      const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
      try {
        const mod = (await import(/* @vite-ignore */ url)) as { mount: Viewer["mount"] };
        if (typeof mod.mount !== "function") throw new Error(`plugin ${manifest.id} entry has no mount()`);
        return { id: spec.id, kindId: spec.kindId, extensions: spec.extensions, mount: (el, ctx) => mod.mount(el, ctx) };
      } finally {
        URL.revokeObjectURL(url);
      }
    });
  });
  return {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    requestAssociation: manifest.requestAssociation ?? true,
    viewers,
  };
}
