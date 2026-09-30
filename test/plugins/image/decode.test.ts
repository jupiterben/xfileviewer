// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { initializeCanvas, writePsd } from "ag-psd";
import { decodeImage } from "../../../src/plugins/image/decode";
import { psdFixture, tgaFixture } from "./fixtures";

const putImageData = vi.fn();
const png = new Blob(["png"], { type: "image/png" });
const createImageData = (width: number, height: number) => ({
  width, height, data: new Uint8ClampedArray(width * height * 4),
  colorSpace: "srgb" as const,
});

beforeEach(() => {
  putImageData.mockClear();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => ({
    createImageData, putImageData,
  })) as unknown as HTMLCanvasElement["getContext"]);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(callback => callback(png));
  initializeCanvas((width, height) => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }, createImageData);
});

afterEach(() => vi.restoreAllMocks());

function expectPixels(values: number[], width = 2, height = 1) {
  const pixels = putImageData.mock.calls[putImageData.mock.calls.length - 1][0] as ImageData;
  expect(pixels.width).toBe(width);
  expect(pixels.height).toBe(height);
  expect(Array.from(pixels.data)).toEqual(values);
}

it("decodes raw TGA BGR pixels to an RGB preview", async () => {
  expect(await decodeImage(tgaFixture(), "tga")).toBe(png);
  expectPixels([255, 0, 0, 255, 0, 255, 0, 255]);
});

it("preserves TGA RLE alpha", async () => {
  await decodeImage(tgaFixture({ type: 10, depth: 32, flags: 0x28, pixels: [0x81, 0, 0, 255, 128] }), "tga");
  expectPixels([255, 0, 0, 128, 255, 0, 0, 128]);
});

it.each([2, 10])("decodes 16-bit TGA RGB and 1-bit alpha (type %i)", async type => {
  const pixels = [0, 252, 224, 3];
  await decodeImage(tgaFixture({
    type, depth: 16, flags: 0x21, pixels: type === 10 ? [1, ...pixels] : pixels,
  }), "tga");
  expectPixels([255, 0, 0, 255, 0, 255, 0, 0]);
});

it("ignores the unused high bit in a 16-bit TGA without alpha", async () => {
  await decodeImage(tgaFixture({ depth: 16, pixels: [0, 252, 224, 3] }), "tga");
  expectPixels([255, 0, 0, 255, 0, 255, 0, 255]);
});

it("normalizes a bottom-origin TGA to top-to-bottom pixels", async () => {
  await decodeImage(tgaFixture({ width: 1, height: 2, flags: 0 }), "tga");
  expectPixels([0, 255, 0, 255, 255, 0, 0, 255], 1, 2);
});

it("decodes grayscale TGA", async () => {
  await decodeImage(tgaFixture({ type: 3, depth: 8, pixels: [64, 192] }), "tga");
  expectPixels([64, 64, 64, 255, 192, 192, 192, 255]);
});

it.each([8, 16])("decodes a %i-bit PSD composite", async depth => {
  expect(await decodeImage(psdFixture(depth), "psd")).toBe(png);
  expectPixels([255, 0, 0, 255, 0, 255, 0, 255]);
});

it("reads RLE PSD composite pixels without decoding layer canvases", async () => {
  const imageData = { ...createImageData(2, 1), data: new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]) };
  const buffer = writePsd({ width: 2, height: 1, imageData, children: [{ name: "Layer", imageData }] });
  await decodeImage(buffer, "psd");
  expect(putImageData).toHaveBeenCalledTimes(1);
  expectPixels(Array.from(imageData.data));
});

it("preserves transparency in a PSD composite", async () => {
  const imageData = {
    ...createImageData(4, 1),
    data: new Uint8ClampedArray([255, 0, 0, 128, 0, 255, 0, 255, 255, 0, 0, 128, 0, 255, 0, 255]),
  };
  await decodeImage(writePsd({ width: 4, height: 1, imageData }), "psd");
  expectPixels(Array.from(imageData.data), 4, 1);
});

it("rejects a PSD explicitly saved without a real composite preview", async () => {
  const buffer = writePsd({
    width: 4, height: 1,
    imageData: createImageData(4, 1),
    imageResources: {
      versionInfo: {
        hasRealMergedData: false,
        writerName: "test", readerName: "test", fileVersion: 1,
      },
    },
  });
  await expect(decodeImage(buffer, "psd")).rejects.toThrow("Maximize Compatibility");
});

it.each([
  new ArrayBuffer(0),
  tgaFixture({ pixels: [0, 0, 255] }),
  tgaFixture({ type: 10, pixels: [0x81, 0] }),
  tgaFixture({ type: 10, pixels: [0x82, 0, 0, 255] }),
  tgaFixture({ width: 65535, height: 65535 }),
])("rejects invalid TGA data before allocating a canvas", async buffer => {
  await expect(decodeImage(buffer, "tga")).rejects.toThrow();
  expect(putImageData).not.toHaveBeenCalled();
});

it("rejects invalid PSD data and unsupported extensions", async () => {
  await expect(decodeImage(new ArrayBuffer(0), "psd")).rejects.toThrow("Invalid PSD");
  await expect(decodeImage(psdFixture().slice(0, 40), "psd")).rejects.toThrow();
  await expect(decodeImage(psdFixture(), "unknown")).rejects.toThrow("Unsupported image format");
});

it("reports a failed PNG encoding", async () => {
  vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation(callback => callback(null));
  await expect(decodeImage(tgaFixture(), "tga")).rejects.toThrow("Unable to encode");
});
