// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { imageViewer } from "./imageViewer";
import type { ViewerHandle } from "../core/types";

let handle: ViewerHandle | undefined;

afterEach(() => {
  handle?.destroy();
  handle = undefined;
  document.body.replaceChildren();
});

function fireLoad(img: HTMLImageElement, width: number, height: number) {
  Object.defineProperty(img, "naturalWidth", { configurable: true, value: width });
  Object.defineProperty(img, "naturalHeight", { configurable: true, value: height });
  img.dispatchEvent(new Event("load"));
}

it("keeps the first image hidden until the window resize has settled", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const onContentSize = vi.fn(() => gate);
  handle = imageViewer("image", ["png"]).mount(document.body, {
    path: "/tmp/a.png",
    src: "asset:/tmp/a.png",
    onEnded: () => {},
    onError: () => {},
    onContentSize,
  });
  const img = document.querySelector("img")!;
  fireLoad(img, 800, 600);
  await Promise.resolve();
  expect(onContentSize).toHaveBeenCalledWith(800, 600);
  expect(img.classList.contains("image-pending")).toBe(true);
  release();
  await vi.waitFor(() => expect(img.classList.contains("image-pending")).toBe(false));
});
