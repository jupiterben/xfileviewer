import { invoke } from "@tauri-apps/api/core";
import { LogicalPosition } from "@tauri-apps/api/dpi";
import { getCurrentWindow, type Window } from "@tauri-apps/api/window";
import { Menu } from "@tauri-apps/api/menu";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { message } from "@tauri-apps/plugin-dialog";
import { basename } from "../core/path";

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const input = document.createElement("textarea");
    input.value = text;
    input.style.cssText = "position:fixed;opacity:0;pointer-events:none";
    document.body.append(input);
    const previous = document.activeElement;
    try {
      input.select();
      if (!document.execCommand("copy")) throw new Error("无法写入剪贴板");
    } finally {
      input.remove();
      if (previous instanceof HTMLElement) previous.focus();
    }
  }
}

/**
 * Offset from the GdkWindow / HWND origin to the WebView origin.
 *
 * muda on GTK uses `gtk_menu.popup_at_rect(&gdk_window, …)`. That rectangle
 * is relative to the GtkWindow's GdkWindow, which includes the CSD HeaderBar
 * tao installs on Wayland. `event.clientX/Y` are relative to the WebView
 * (the GtkWindow child below the header). Adding the child's translation
 * puts the menu on the cursor. tauri-apps/tauri#13608.
 *
 * inner−outer is the wrong delta: on X11 that is SSD chrome *outside*
 * GdkWindow (already excluded by popup_at_rect); on Wayland both positions
 * are often 0. The GTK content-child origin is the actual gap.
 */
async function chromeOffset(window: Window): Promise<{ x: number; y: number }> {
  try {
    const offset = await invoke<{ x: number; y: number }>("menu_popup_chrome_offset", {
      label: window.label,
    });
    if (offset && Number.isFinite(offset.x) && Number.isFinite(offset.y)) return offset;
  } catch {
    // Non-Linux / older builds: no chrome inside the native window.
  }
  return { x: 0, y: 0 };
}

export function createFileContextMenu(getPath: () => string | null) {
  let selectedPath: string | null = null;
  let menu: Promise<Menu> | undefined;
  const action = (run: (path: string) => Promise<unknown>) => () => {
    const path = selectedPath;
    if (path) void run(path).catch(error => message(String(error), { title: "操作失败", kind: "error" }));
  };
  return async (position: { x: number; y: number }, owner?: Window) => {
    const path = getPath();
    if (!path) return;
    selectedPath = path;
    menu ??= Menu.new({ items: [
      { id: "copy-file-path", text: "复制地址", action: action(copyText) },
      { id: "copy-file-name", text: "复制文件名", action: action(path => copyText(basename(path))) },
      { item: "Separator" },
      { id: "reveal-file", text: "打开文件所在的位置", action: action(revealItemInDir) },
      { id: "open-file-with", text: "使用其他程序打开…", action: action(path => invoke("choose_file_application", { path })) },
    ] }).catch(error => { menu = undefined; throw error; });
    try {
      const target = owner ?? getCurrentWindow();
      const offset = await chromeOffset(target);
      await (await menu).popup(new LogicalPosition(position.x + offset.x, position.y + offset.y), owner);
    } catch (error) {
      await message(String(error), { title: "无法打开右键菜单", kind: "error" });
    }
  };
}
