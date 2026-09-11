// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { createAssociationController } from "./associationController";
import { PluginRegistry } from "../core/registry";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  document.body.innerHTML = `
    <div id="settings" hidden><div id="settings-list"></div><button id="settings-back"></button><button id="settings-apply"></button></div>
    <div id="assoc-overlay" hidden><span id="assoc-text"></span><button id="assoc-yes"></button><button id="assoc-no"></button></div>`;
});

it("keeps the settings view usable when persisted settings are malformed", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.mocked(invoke).mockResolvedValue({ granted: null, denied: [] });
  const visibility = vi.fn();
  const controller = createAssociationController(new PluginRegistry(), visibility);
  await controller.load();
  await controller.open();
  expect(controller.isInteractionBlocked()).toBe(true);
  document.querySelector<HTMLButtonElement>("#settings-back")!.click();
  expect(controller.isInteractionBlocked()).toBe(false);
  expect(visibility.mock.calls).toEqual([[true], [false]]);
  expect(vi.mocked(invoke).mock.calls.some(([command]) => command === "save_association_settings")).toBe(false);
  warn.mockRestore();
});

it("prevents duplicate submissions while an association change is pending", async () => {
  const registry = new PluginRegistry();
  registry.register({
    id: "image", name: "Image", version: "1",
    viewers: [{ id: "jpg", kindId: "image", extensions: ["jpg"], mount: () => ({ destroy() {} }) }],
  });
  let finish!: () => void;
  vi.mocked(invoke).mockImplementation(async command => {
    if (command === "query_file_associations") return { osManaged: false, granted: {} };
    if (command === "grant_file_associations") return new Promise<void>(resolve => { finish = resolve; });
  });
  const controller = createAssociationController(registry, () => {});
  await controller.open();
  document.querySelector<HTMLInputElement>(".assoc-row input")!.click();
  const apply = document.querySelector<HTMLButtonElement>("#settings-apply")!;
  apply.click();
  apply.click();
  expect(apply.disabled).toBe(true);
  expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === "grant_file_associations")).toHaveLength(1);
  finish();
  await vi.waitFor(() => expect(document.querySelector<HTMLInputElement>(".assoc-row input")!.disabled).toBe(false));
});
