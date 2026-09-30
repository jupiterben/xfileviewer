// @vitest-environment jsdom
import { mount, unmount } from "svelte";
import { afterEach, expect, it, vi } from "vitest";
import EmptyState from "../../src/ui/EmptyState.svelte";

let view: ReturnType<typeof mount> | undefined;

afterEach(async () => {
  if (view) await unmount(view);
  view = undefined;
  document.body.replaceChildren();
});

it("exposes open and settings actions with the current version", () => {
  const onOpen = vi.fn();
  const onSettings = vi.fn();
  view = mount(EmptyState, { target: document.body, props: {
    message: "No file open", version: "v-test", onOpen, onSettings,
  } });
  expect(document.querySelector(".empty")?.textContent).toBe("No file open");
  expect(document.querySelector(".app-version")?.textContent).toBe("v-test");
  document.querySelector<HTMLButtonElement>(".empty-settings")!.click();
  document.querySelector<HTMLButtonElement>(".empty-open")!.click();
  expect(onSettings).toHaveBeenCalledOnce();
  expect(onOpen).toHaveBeenCalledOnce();
});

it("prevents duplicate opens and restores controls when the picker is cancelled", async () => {
  let finish!: () => void;
  const onOpen = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  view = mount(EmptyState, { target: document.body, props: {
    message: "No file open", onOpen, onSettings: vi.fn(),
  } });
  const button = document.querySelector<HTMLButtonElement>(".empty-open")!;
  button.click();
  button.click();
  expect(onOpen).toHaveBeenCalledOnce();
  await vi.waitFor(() => expect(button.disabled).toBe(true));
  expect(button.getAttribute("aria-busy")).toBe("true");
  expect(document.querySelector<HTMLButtonElement>(".empty-settings")!.disabled).toBe(true);
  finish();
  await vi.waitFor(() => expect(button.disabled).toBe(false));
  expect(document.querySelector<HTMLButtonElement>(".empty-settings")!.disabled).toBe(false);
});
