const MAX_PIXELS = 64 * 1024 * 1024;

function checkSize(width: number, height: number) {
  if (width <= 0 || height <= 0 || width * height > MAX_PIXELS) {
    throw new Error("Invalid or oversized image dimensions");
  }
}

// TGALoader accepts truncated payloads. Validate packet boundaries before decoding.
function validateTga(buffer: ArrayBuffer) {
  if (buffer.byteLength < 18) throw new Error("Invalid TGA header");
  const header = new DataView(buffer);
  const type = header.getUint8(2);
  const width = header.getUint16(12, true);
  const height = header.getUint16(14, true);
  checkSize(width, height);
  const pixelSize = header.getUint8(16) / 8;
  if (![1, 2, 3, 4].includes(pixelSize)) throw new Error("Unsupported TGA pixel size");
  if (![1, 2, 3, 9, 10, 11].includes(type)) throw new Error("Unsupported TGA image type");
  const indexed = type === 1 || type === 9;
  if (indexed && (header.getUint16(3, true) !== 0 || pixelSize !== 1)) {
    throw new Error("Unsupported TGA color map");
  }
  let offset = 18 + header.getUint8(0);
  if (indexed) offset += header.getUint16(5, true) * (header.getUint8(7) / 8);
  if (offset > buffer.byteLength) throw new Error("Truncated TGA data");
  let remaining = width * height;
  if (type < 9) {
    if (offset + remaining * pixelSize > buffer.byteLength) throw new Error("Truncated TGA data");
    return;
  }
  while (remaining > 0) {
    if (offset >= buffer.byteLength) throw new Error("Truncated TGA packet");
    const packet = header.getUint8(offset++);
    const count = (packet & 0x7f) + 1;
    offset += (packet & 0x80 ? 1 : count) * pixelSize;
    if (count > remaining || offset > buffer.byteLength) throw new Error("Invalid TGA packet");
    remaining -= count;
  }
}

function validatePsd(buffer: ArrayBuffer) {
  if (buffer.byteLength < 26) throw new Error("Invalid PSD header");
  const header = new DataView(buffer);
  if (header.getUint32(0) !== 0x38425053 || header.getUint16(4) !== 1) {
    throw new Error("Invalid PSD signature or version");
  }
  const width = header.getUint32(18);
  const height = header.getUint32(14);
  checkSize(width, height);
  // Skip color mode, resources, and layer/mask sections to validate the composite.
  // ag-psd otherwise pads missing raw pixel bytes with zeros.
  let offset = 26;
  for (let section = 0; section < 3; section++) {
    if (offset + 4 > buffer.byteLength) throw new Error("Truncated PSD section");
    offset += 4 + header.getUint32(offset);
  }
  if (offset + 2 > buffer.byteLength) throw new Error("PSD has no composite preview");
  const compression = header.getUint16(offset);
  offset += 2;
  const rows = height * header.getUint16(12);
  if (compression === 0) {
    offset += rows * Math.ceil(width * header.getUint16(22) / 8);
  } else if (compression === 1) {
    const tableEnd = offset + rows * 2;
    if (tableEnd > buffer.byteLength) throw new Error("Truncated PSD row table");
    let length = 0;
    for (; offset < tableEnd; offset += 2) length += header.getUint16(offset);
    offset += length;
  }
  if (offset > buffer.byteLength) throw new Error("Truncated PSD composite");
}

export async function decodeImage(buffer: ArrayBuffer, extension: string): Promise<Blob> {
  let canvas: HTMLCanvasElement;
  if (extension === "tga") {
    validateTga(buffer);
    const { TGALoader } = await import("three/addons/loaders/TGALoader.js");
    // Three r169 returns pixel data here, despite @types/three declaring DataTexture.
    const { width, height, data } = new TGALoader().parse(buffer) as unknown as {
      width: number; height: number; data: Uint8Array;
    };
    const header = new DataView(buffer);
    if (header.getUint8(16) === 16 && [2, 10].includes(header.getUint8(2))) {
      // r169 reverses the 1-bit alpha and leaves 5-bit RGB values below full scale.
      const hasAlpha = (header.getUint8(17) & 0x0f) === 1;
      for (let i = 0; i < data.length; i += 4) {
        data[i] |= data[i] >>> 5;
        data[i + 1] |= data[i + 1] >>> 5;
        data[i + 2] |= data[i + 2] >>> 5;
        data[i + 3] = hasAlpha ? 255 - data[i + 3] : 255;
      }
    }
    canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D is unavailable");
    const pixels = context.createImageData(width, height);
    pixels.data.set(data);
    context.putImageData(pixels, 0, 0);
  } else if (extension === "psd") {
    validatePsd(buffer);
    const { readPsd } = await import("ag-psd");
    const psd = readPsd(buffer, {
      skipLayerImageData: true,
      skipThumbnail: true,
      skipLinkedFilesData: true,
      totalMemoryLimit: 512 * 1024 * 1024,
    });
    if (!psd.canvas || psd.imageResources?.versionInfo?.hasRealMergedData === false) {
      throw new Error("PSD has no composite preview; save it with Maximize Compatibility enabled");
    }
    canvas = psd.canvas;
  } else {
    throw new Error(`Unsupported image format: ${extension}`);
  }
  try {
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(blob => {
        if (blob) resolve(blob);
        else reject(new Error("Unable to encode image preview"));
      }, "image/png");
    });
  } finally {
    canvas.width = canvas.height = 0;
  }
}
