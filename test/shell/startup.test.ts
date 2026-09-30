// @vitest-environment jsdom
import { mount } from "svelte";
import { expect, it, vi } from "vitest";
import App from "../../src/ui/App.svelte";
import type { ViewerContext } from "../../src/core/types";

const mocks = vi.hoisted(() => ({
  open: vi.fn<() => Promise<string | null>>(),
  contexts: [] as ViewerContext[],
  drop: undefined as undefined | ((event: { payload: { type: string; paths: string[] } }) => void),
  batch: undefined as undefined | { onmessage: (batch: { files: string[]; scanned: number; done: boolean }) => void },
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.open }));
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset:${path}`,
  Channel: class { onmessage = () => {}; },
  invoke: vi.fn(async (command, args) => {
    if (command === "load_association_settings") return { granted: [], denied: [] };
    if (command === "load_window_sizes") return {};
    if (command === "query_file_associations") return { granted: {}, osManaged: false };
    if (command === "take_launch_path") return null;
    if (command === "parent_dir") return "/fixtures";
    if (command === "list_dir_files") mocks.batch = args.onBatch;
    return [];
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(async () => {}),
  listen: vi.fn(async () => () => {}),
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: async (handler: typeof mocks.drop) => { mocks.drop = handler; },
  }),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ setTitle: vi.fn(async () => {}), onResized: vi.fn(async () => {}) }),
}));
vi.mock("../../src/shell/appVersion", () => ({ resolveAppVersion: async () => "v-test" }));
vi.mock("../../src/plugins/external", () => ({ loadExternalPlugins: async () => [] }));
vi.mock("../../src/plugins/builtin", () => ({
  builtinPlugins: () => [{
    id: "image", name: "Image", version: "1",
    viewers: [{
      id: "image", kindId: "image", extensions: ["jpg", "tga", "psd"],
      mount(_element: HTMLElement, ctx: ViewerContext) {
        mocks.contexts.push(ctx);
        return { destroy() {} };
      },
    }],
  }],
}));

const button = (selector: string) => document.querySelector<HTMLButtonElement>(selector)!;

it("opens from the empty startup screen, recovers from picker errors and resets empty-page controls", async () => {
  mount(App, { target: document.body });
  const { bootApplication } = await import("../../src/shell/application");
  await bootApplication();
  expect(button(".empty-open").disabled).toBe(false);
  expect(button("#prev").disabled).toBe(true);
  expect(button("#next").disabled).toBe(true);
  expect(document.querySelector(".app-version")?.textContent).toBe("v-test");

  button(".empty-settings").click();
  await vi.waitFor(() => expect(document.querySelector<HTMLElement>(".main-row")!.hidden).toBe(true));
  expect(document.querySelector<HTMLElement>("#settings")!.hidden).toBe(false);
  button("#settings-back").click();
  expect(document.querySelector<HTMLElement>(".main-row")!.hidden).toBe(false);
  expect(document.querySelector<HTMLElement>("#settings")!.hidden).toBe(true);

  mocks.open.mockResolvedValueOnce(null);
  button(".empty-open").click();
  await vi.waitFor(() => expect(mocks.open).toHaveBeenCalledTimes(1));
  await vi.waitFor(() => expect(button(".empty-open").disabled).toBe(false));
  expect(mocks.contexts).toHaveLength(0);

  mocks.open.mockRejectedValueOnce(new Error("picker failed"));
  button(".empty-open").click();
  await vi.waitFor(() => expect(document.querySelector(".empty")?.textContent).toContain("picker failed"));
  expect(button(".empty-open").disabled).toBe(false);
  expect(button(".empty-settings")).not.toBeNull();

  let select!: (path: string) => void;
  mocks.open.mockReturnValueOnce(new Promise(resolve => { select = resolve; }));
  button(".empty-open").click();
  button(".empty-open").click();
  await vi.waitFor(() => expect(mocks.open).toHaveBeenCalledTimes(3));
  select("/fixtures/sample.TGA");
  await vi.waitFor(() => expect(mocks.contexts[0]?.path).toBe("/fixtures/sample.TGA"));
  expect(document.querySelector(".empty-wrap")).toBeNull();
  expect(mocks.open).toHaveBeenLastCalledWith({
    multiple: false, directory: false,
    filters: [{ name: "支持的文件", extensions: ["jpg", "tga", "psd"] }],
  });

  await vi.waitFor(() => expect(mocks.batch).toBeDefined());
  mocks.batch!.onmessage({ files: ["/fixtures/second.psd"], scanned: 2, done: true });
  expect(button("#next").disabled).toBe(false);
  mocks.drop!({ payload: { type: "drop", paths: ["/fixtures/unsupported.xyz"] } });
  await vi.waitFor(() => expect(document.querySelector(".empty")?.textContent).toContain("unsupported.xyz"));
  expect(button("#prev").disabled).toBe(true);
  expect(button("#next").disabled).toBe(true);
  expect(document.querySelector<HTMLElement>(".scan-status")!.hidden).toBe(true);
  expect(document.querySelector<HTMLElement>("#sidebar")!.hidden).toBe(true);
  expect(button(".empty-open").disabled).toBe(false);
});
