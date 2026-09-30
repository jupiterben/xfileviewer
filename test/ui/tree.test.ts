// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import Tree from "../../src/ui/Tree.svelte";
import { summarizeValue, valueTree, visibleTreeRows } from "../../src/ui/tree";

describe("SDK value tree", () => {
  it("preserves SDK identity, scalar values and empty collections", () => {
    expect(summarizeValue({ classId: "FbxNode", name: "mesh", uniqueId: 42 })).toBe('FbxNode "mesh" #42');
    expect(summarizeValue(1234567890123456789n)).toBe("1234567890123456789n");
    const root = valueTree("values", { zero: 0, flag: false, none: null, missing: undefined, empty: [] });
    expect(root.children!().map(node => node.value)).toEqual(["0", "false", "null", "undefined", "Array (0)"]);
    expect(root.children!()[4].children).toBeUndefined();
  });

  it("stops ancestor cycles without hiding shared objects in other branches", () => {
    const shared = { name: "material" };
    const root: Record<string, unknown> = { first: shared, second: shared };
    root.self = root;
    const nodes = valueTree("scene", root).children!();
    expect(nodes[0].children!()[0].value).toBe('"material"');
    expect(nodes[1].children!()[0].value).toBe('"material"');
    expect(nodes[2].value).toContain("[Circular: scene]");
    expect(nodes[2].children).toBeUndefined();
  });

  it("reads properties only when opened and caches loaded branches", () => {
    const read = vi.fn(() => 12);
    const root = valueTree("lazy", { get value() { return read(); } });
    expect(read).not.toHaveBeenCalled();
    expect(visibleTreeRows([root], new Set())).toHaveLength(1);
    root.children!();
    root.children!();
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("bounds each array branch while keeping the final value accessible", () => {
    const values = new Float64Array(1_000_001);
    values[1_000_000] = 42.25;
    let node = valueTree("controlPoints", values);
    expect(node.value).toBe("Float64Array (1000001)");
    while (node.children) {
      const children = node.children();
      expect(children.length).toBeLessThanOrEqual(100);
      node = children[children.length - 1];
    }
    expect(node.label).toBe("[1000000]");
    expect(node.value).toBe("42.25");
  });

  it("inspects maps, sets and byte buffers including view offsets", () => {
    const buffer = new Uint8Array([11, 22, 33]).buffer;
    expect(valueTree("map", new Map([[9, "mesh"]])).children!()[0]).toMatchObject({ label: "9", value: '"mesh"' });
    expect(valueTree("set", new Set(["a"])).children!()[0].value).toBe('"a"');
    expect(valueTree("bytes", buffer).children!().map(node => node.value)).toEqual(["11", "22", "33"]);
    expect(valueTree("view", new DataView(buffer, 1, 1)).children!()[0].value).toBe("22");
  });

  it("chunks long embedded strings without losing their contents", () => {
    const text = "x".repeat(1500) + "end";
    const node = valueTree("Content", text);
    expect(node.value.length).toBeLessThan(200);
    expect(node.children!().map(child => JSON.parse(child.value)).join("")).toBe(text);
  });

  it("renders escaped values and supports tree keyboard navigation without bubbling", async () => {
    const target = document.createElement("div");
    document.body.append(target);
    const view = mount(Tree, { target, props: {
      label: "SDK", nodes: [valueTree("scene", { name: "<img src=x>", children: [1] })],
    } });
    flushSync();
    const row = () => target.querySelector<HTMLElement>('[tabindex="0"]')!;
    const press = (key: string) => {
      const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      row().dispatchEvent(event);
      flushSync();
      expect(event.defaultPrevented).toBe(true);
    };
    const bubbled = vi.fn();
    window.addEventListener("keydown", bubbled);
    expect(target.querySelectorAll('[role="treeitem"]')).toHaveLength(1);
    press("ArrowRight");
    expect(row().getAttribute("aria-expanded")).toBe("true");
    expect(target.querySelectorAll('[role="treeitem"]')).toHaveLength(3);
    press("ArrowDown");
    expect(row().textContent).toContain("<img src=x>");
    expect(row().getAttribute("aria-level")).toBe("2");
    expect(target.querySelector("img")).toBeNull();
    press("End");
    expect(row().textContent).toContain("children");
    press("ArrowRight");
    press("ArrowRight");
    expect(row().textContent).toContain("[0]");
    press("ArrowLeft");
    expect(row().textContent).toContain("children");
    press("Home");
    press("ArrowLeft");
    expect(target.querySelectorAll('[role="treeitem"]')).toHaveLength(1);
    expect(bubbled).not.toHaveBeenCalled();
    window.removeEventListener("keydown", bubbled);
    await unmount(view);
    target.remove();
  });
});
