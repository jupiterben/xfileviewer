// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ViewerHandle } from "../../src/core/types";
import { decodedImageViewer } from "../../src/plugins/decodedImageViewer";
import { decodeImage } from "../../src/plugins/image/decode";

vi.mock("../../src/plugins/image/decode", () => ({ decodeImage: vi.fn() }));
let handle: ViewerHandle | undefined;
const onError = vi.fn();
const onContentSize = vi.fn();
const fetchMock = vi.fn();
const revoke = vi.fn();
const createURL = vi.fn();
const buffer = new ArrayBuffer(24);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("URL", { createObjectURL: createURL, revokeObjectURL: revoke });
  createURL.mockReturnValue("blob:preview");
  fetchMock.mockResolvedValue({ ok: true, arrayBuffer: async () => buffer });
  vi.mocked(decodeImage).mockResolvedValue(new Blob(["png"]));
});

afterEach(() => {
  handle?.destroy();
  handle = undefined;
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

function mount(path = "/images/sample.PSD") {
  handle = decodedImageViewer().mount(document.body, {
    path, src: "asset:/sample", onEnded: () => {}, onError, onContentSize,
  });
}

it.each(["PSD", "TGA"])("mounts a decoded %s using the existing image viewer", async ext => {
  mount(`/images/sample.${ext}`);
  await vi.waitFor(() => expect(document.querySelector("img")).not.toBeNull());
  const img = document.querySelector("img")!;
  expect(img.getAttribute("src")).toBe("blob:preview");
  expect(decodeImage).toHaveBeenCalledWith(buffer, ext.toLowerCase());
  Object.defineProperties(img, { naturalWidth: { value: 640 }, naturalHeight: { value: 480 } });
  img.dispatchEvent(new Event("load"));
  await vi.waitFor(() => expect(img.classList.contains("image-pending")).toBe(false));
  expect(onContentSize).toHaveBeenCalledWith(640, 480);
  handle!.destroy();
  handle!.destroy();
  expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:preview");
});

it("reports fetch failures without decoding", async () => {
  fetchMock.mockResolvedValue({ ok: false, status: 404 });
  mount();
  await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(expect.stringContaining("404")));
  expect(decodeImage).not.toHaveBeenCalled();
});

it("reports decoding errors", async () => {
  vi.mocked(decodeImage).mockRejectedValue(new Error("Invalid PSD"));
  mount();
  await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(expect.stringContaining("Invalid PSD")));
});

it("aborts reads and ignores failures after navigating away", async () => {
  let fail!: (error: Error) => void;
  fetchMock.mockReturnValue(new Promise((_, reject) => { fail = reject; }));
  mount();
  const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
  handle!.destroy();
  fail(new Error("aborted"));
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(signal.aborted).toBe(true);
  expect(onError).not.toHaveBeenCalled();
  expect(decodeImage).not.toHaveBeenCalled();
});

it("does not mount a stale decoded image or leak its URL", async () => {
  let finish!: (blob: Blob) => void;
  vi.mocked(decodeImage).mockReturnValue(new Promise(resolve => { finish = resolve; }));
  mount();
  await vi.waitFor(() => expect(decodeImage).toHaveBeenCalled());
  handle!.destroy();
  finish(new Blob(["png"]));
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(createURL).not.toHaveBeenCalled();
  expect(document.querySelector("img")).toBeNull();
  expect(onError).not.toHaveBeenCalled();
});
