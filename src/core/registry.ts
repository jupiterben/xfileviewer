import { extensionOf } from "./path";
import type { PluginManifest, Viewer } from "./types";

interface Binding {
  pluginId: string;
  viewer: Viewer;
}

export class PluginRegistry {
  private plugins = new Map<string, PluginManifest>();
  private byExt = new Map<string, Binding>();

  register(plugin: PluginManifest): void {
    this.unregister(plugin.id);
    this.plugins.set(plugin.id, plugin);
    for (const viewer of plugin.viewers) {
      for (const ext of viewer.extensions) {
        this.byExt.set(ext.toLowerCase(), { pluginId: plugin.id, viewer });
      }
    }
  }

  unregister(pluginId: string): string[] {
    if (!this.plugins.delete(pluginId)) return [];
    const removed: string[] = [];
    for (const [ext, binding] of [...this.byExt.entries()]) {
      if (binding.pluginId === pluginId) {
        this.byExt.delete(ext);
        removed.push(ext);
      }
    }
    return removed;
  }

  viewerFor(path: string): Viewer | undefined {
    return this.byExt.get(extensionOf(path))?.viewer;
  }

  kindFor(path: string): string | undefined {
    return this.viewerFor(path)?.kindId;
  }

  extensionsForKind(kindId: string): Set<string> {
    const exts = new Set<string>();
    for (const [ext, binding] of this.byExt) {
      if (binding.viewer.kindId === kindId) exts.add(ext);
    }
    return exts;
  }

  pluginsWithAssociationRequest(): PluginManifest[] {
    return [...this.plugins.values()].filter((p) => p.requestAssociation);
  }

  pluginFor(path: string): PluginManifest | undefined {
    const binding = this.byExt.get(extensionOf(path));
    return binding ? this.plugins.get(binding.pluginId) : undefined;
  }

  extensionsWithPlugins(): Array<{
    ext: string;
    pluginName: string;
    kindId: string;
  }> {
    const out: Array<{ ext: string; pluginName: string; kindId: string }> = [];
    for (const [ext, binding] of this.byExt) {
      const plugin = this.plugins.get(binding.pluginId);
      out.push({
        ext,
        pluginName: plugin?.name ?? binding.pluginId,
        kindId: binding.viewer.kindId,
      });
    }
    return out;
  }
}
