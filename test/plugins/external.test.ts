// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { loadExternalPlugins } from "../../src/plugins/external";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
afterEach(() => vi.resetAllMocks());

const manifest = (id: string, kindId = "document") => JSON.stringify({
  id, name: id, version: "1", viewers: [{ id: `${id}-viewer`, kindId, extensions: ["txt"], entry: "viewer.js" }],
});

it("reads only manifests during discovery and preserves override order despite concurrent reads", async () => {
  let finish!: (raw: string) => void;
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "list_plugin_dirs") return ["/first", "/second"];
    const path = (args as { path: string }).path;
    if (path === "/first/manifest.json") return new Promise(resolve => { finish = resolve; });
    if (path === "/second/manifest.json") return manifest("second");
    throw new Error(`Unexpected entry read: ${path}`);
  });
  const pending = loadExternalPlugins();
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("read_plugin_file", { path: "/second/manifest.json" }));
  finish(manifest("first"));
  expect((await pending).map(plugin => plugin.id)).toEqual(["first", "second"]);
  expect(invoke).toHaveBeenCalledTimes(3);
});

it("reads an entry only on mount, reports read failure and retries on the next mount", async () => {
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "list_plugin_dirs") return ["/plugin"];
    if ((args as { path: string }).path.endsWith("manifest.json")) return manifest("plugin");
    throw new Error("entry unavailable");
  });
  const [plugin] = await loadExternalPlugins();
  expect(invoke).toHaveBeenCalledTimes(2);
  const context = { path: "a.txt", src: "", onEnded: vi.fn(), onError: vi.fn() };
  const first = plugin.viewers[0].mount(document.createElement("div"), context);
  await vi.waitFor(() => expect(context.onError).toHaveBeenCalledWith("entry unavailable"));
  first.destroy();
  plugin.viewers[0].mount(document.createElement("div"), context);
  await vi.waitFor(() => expect(context.onError).toHaveBeenCalledTimes(2));
  expect(invoke).toHaveBeenCalledTimes(4);
});

it("skips invalid manifests without stopping other plugins", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "list_plugin_dirs") return ["/bad", "/good"];
    return manifest("plugin", (args as { path: string }).path.startsWith("/bad") ? "unknown" : "image");
  });
  expect(await loadExternalPlugins()).toHaveLength(1);
  expect(log).toHaveBeenCalledOnce();
  log.mockRestore();
});
