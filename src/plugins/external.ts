import { invoke } from "@tauri-apps/api/core";
import type { PluginManifest, Viewer, ViewerHandle } from "../core/types";
import { BUILTIN_KINDS } from "../core/types";

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

export async function loadExternalPlugins(): Promise<PluginManifest[]> {
  let dirs: string[] = [];
  try {
    dirs = await invoke<string[]>("list_plugin_dirs");
  } catch {
    return [];
  }
  const loaded: PluginManifest[] = [];
  for (const dir of dirs) {
    try {
      loaded.push(await loadOne(dir));
    } catch (err) {
      console.error("plugin load failed", dir, err);
    }
  }
  return loaded;
}

async function loadOne(dir: string): Promise<PluginManifest> {
  const raw = await invoke<string>("read_plugin_file", {
    path: `${dir}/manifest.json`,
  });
  const manifest = JSON.parse(raw) as DiskManifest;
  const viewers: Viewer[] = [];
  for (const spec of manifest.viewers) {
    if (!BUILTIN_KINDS.includes(spec.kindId as (typeof BUILTIN_KINDS)[number])) {
      throw new Error(`plugin ${manifest.id} uses unsupported kind ${spec.kindId}`);
    }
    const code = await invoke<string>("read_plugin_file", {
      path: `${dir}/${spec.entry}`,
    });
    const url = URL.createObjectURL(
      new Blob([code], { type: "text/javascript" }),
    );
    const mod = (await import(/* @vite-ignore */ url)) as {
      mount: Viewer["mount"];
    };
    if (typeof mod.mount !== "function") {
      throw new Error(`plugin ${manifest.id} entry has no mount()`);
    }
    viewers.push({
      id: spec.id,
      kindId: spec.kindId,
      extensions: spec.extensions,
      mount(el, ctx): ViewerHandle {
        try {
          return mod.mount(el, ctx);
        } catch (err) {
          throw err instanceof Error ? err : new Error(String(err));
        }
      },
    });
  }
  return {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    requestAssociation: manifest.requestAssociation ?? true,
    viewers,
  };
}
