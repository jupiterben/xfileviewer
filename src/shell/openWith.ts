import { invoke } from "@tauri-apps/api/core";
import { extensionOf } from "../core/path";

export interface OpenWithApp {
  id: string;
  name: string;
  /** PNG data URL of the application icon, when the OS could resolve one. */
  icon: string | null;
}

// The recommended-app list depends only on the file extension, so responses
// are cached per extension for the lifetime of the window.
const cache = new Map<string, OpenWithApp[]>();

export async function listOpenWithApps(path: string): Promise<OpenWithApp[]> {
  const ext = extensionOf(path);
  const cached = ext ? cache.get(ext) : undefined;
  if (cached) return cached;
  const apps = await invoke<OpenWithApp[]>("list_open_with_apps", { path });
  if (ext) cache.set(ext, apps);
  return apps;
}

export function openFileWith(path: string, appId: string): Promise<void> {
  return invoke("open_file_with", { path, appId });
}

export function chooseOtherApplication(path: string): Promise<void> {
  return invoke("choose_file_application", { path });
}
