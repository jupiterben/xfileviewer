// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import Sidebar from "../../src/ui/Sidebar.svelte";
import type { SidebarFolders } from "../../src/ui/fileTree";

vi.mock("@tauri-apps/plugin-dialog", () => ({ message: vi.fn() }));
vi.mock("../../src/shell/openWith", () => ({
  listOpenWithApps: vi.fn(async () => []), openFileWith: vi.fn(), chooseOtherApplication: vi.fn(),
}));

let target: HTMLElement;
let view: { update: (items: string[], index: number, folders?: SidebarFolders) => void };
const items = ["/root/a.jpg", "/root/album2/b.jpg", "/root/album2/nested/c.jpg", "/root/z.jpg"];
const folders = (overrides: Partial<SidebarFolders> = {}): SidebarFolders => ({
  session: 1, root: "/root", directories: ["/root/album2", "/root/album2/nested", "/root/empty"],
  loaded: ["/root", "/root/album2", "/root/album2/nested", "/root/empty"], loading: [], errors: {}, ...overrides,
});
const button = (title: string) => [...target.querySelectorAll<HTMLButtonElement>("button")].find(el => el.title === title)!;
const fileTitles = () => [...target.querySelectorAll(".sidebar-file")].map(el => el.getAttribute("title"));

beforeEach(() => {
  localStorage.clear();
  target = document.createElement("div");
  document.body.append(target);
});
afterEach(async () => { await unmount(view); target.remove(); });

describe("sidebar directories", () => {
  it("expands and hides nested files, preserving the original selection index", () => {
    const onSelect = vi.fn();
    const onLoadDirectory = vi.fn();
    view = mount(Sidebar, { target, props: { onSelect, onLoadDirectory } });
    flushSync(() => view.update(items, 0, folders()));
    expect(fileTitles()).toEqual([items[0], items[3]]);
    button("/root/album2").click(); flushSync();
    expect(onLoadDirectory).toHaveBeenCalledWith("/root/album2");
    expect(button("/root/album2").getAttribute("aria-expanded")).toBe("true");
    expect(fileTitles()).toEqual([items[1], items[0], items[3]]);
    button(items[1]).click();
    expect(onSelect).toHaveBeenLastCalledWith(1);
    button("/root/album2/nested").click(); flushSync();
    button(items[2]).click();
    expect(onSelect).toHaveBeenLastCalledWith(2);
    button("/root/album2").click(); flushSync();
    expect(fileTitles()).toEqual([items[0], items[3]]);
    expect(button(items[0]).classList.contains("active")).toBe(true);
    flushSync(() => view.update([...items, "/root/album2/d.jpg"], 0, folders()));
    expect(fileTitles()).toEqual([items[0], items[3]]);
    button("/root/album2").click(); flushSync();
    expect(fileTitles()).toContain(items[2]); // Nested expansion retained.
    target.querySelector<HTMLButtonElement>('[aria-label="收起所有子目录"]')!.click(); flushSync();
    expect(fileTitles()).toEqual([items[0], items[3]]);
  });

  it("reveals the current branch on navigation but not after every streamed batch", () => {
    view = mount(Sidebar, { target, props: { onSelect: vi.fn() } });
    flushSync(() => view.update(items, 2, folders()));
    expect(button(items[2]).classList.contains("active")).toBe(true);
    button("/root/album2").click(); flushSync();
    expect(fileTitles()).not.toContain(items[2]);
    flushSync(() => view.update([...items], 2, folders()));
    expect(fileTitles()).not.toContain(items[2]);
    flushSync(() => view.update(items, 1, folders()));
    expect(fileTitles()).toContain(items[1]);
    flushSync(() => view.update(items, 0, folders({ session: 2 })));
    expect(fileTitles()).toEqual([items[0], items[3]]);
  });

  it("shows loading, empty and retry states and remembers whole-list visibility", () => {
    const onLoadDirectory = vi.fn();
    view = mount(Sidebar, { target, props: { onSelect: vi.fn(), onLoadDirectory } });
    flushSync(() => view.update(items, 0, folders({ loaded: ["/root"], loading: ["/root/empty"] })));
    button("/root/empty").click(); flushSync();
    expect(target.textContent).toContain("正在读取…");
    flushSync(() => view.update(items, 0, folders()));
    expect(target.textContent).toContain("没有同类文件");
    flushSync(() => view.update(items, 0, folders({ loaded: ["/root"], errors: { "/root/empty": "permission denied" } })));
    expect(target.textContent).toContain("读取失败");
    button("/root/empty\npermission denied\n收起后再次展开可重试").click(); flushSync();
    button("/root/empty\npermission denied\n收起后再次展开可重试").click(); flushSync();
    expect(onLoadDirectory).toHaveBeenCalledTimes(2);
    target.querySelector<HTMLButtonElement>(".sidebar-header")!.click(); flushSync();
    expect(target.querySelector('[role="tree"]')).toBeNull();
    expect(localStorage.getItem("sidebar-files-open")).toBe("0");
    target.querySelector<HTMLButtonElement>(".sidebar-header")!.click(); flushSync();
    expect(target.querySelector('[role="tree"]')).not.toBeNull();
  });

  it("does not pull scrolling back to the active file when expanding or receiving batches", () => {
    const scroll = vi.fn();
    Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: scroll });
    view = mount(Sidebar, { target, props: { onSelect: vi.fn() } });
    flushSync(() => view.update(items, 0, folders()));
    scroll.mockClear();
    button("/root/album2").click(); flushSync();
    flushSync(() => view.update([...items, "/root/album2/d.jpg"], 0, folders()));
    expect(scroll).not.toHaveBeenCalled();
    delete (Element.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView;
  });

  it("supports keyboard expansion and roving focus without paging the viewer", async () => {
    view = mount(Sidebar, { target, props: { onSelect: vi.fn(), onLoadDirectory: vi.fn() } });
    flushSync(() => view.update(items, 0, folders()));
    const bubbled = vi.fn();
    window.addEventListener("keydown", bubbled);
    const press = async (node: HTMLElement, key: string) => {
      const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      node.dispatchEvent(event); flushSync(); await Promise.resolve(); flushSync();
      expect(event.defaultPrevented).toBe(true);
    };
    button("/root/album2").focus(); flushSync();
    await press(button("/root/album2"), "ArrowRight");
    expect(button("/root/album2").getAttribute("aria-expanded")).toBe("true");
    await press(button("/root/album2"), "ArrowDown");
    expect(document.activeElement).toBe(button("/root/album2/nested"));
    await press(button("/root/album2/nested"), "ArrowLeft");
    expect(document.activeElement).toBe(button("/root/album2"));
    expect(bubbled).not.toHaveBeenCalled();
    window.removeEventListener("keydown", bubbled);
  });
});
