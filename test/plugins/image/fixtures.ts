export function tgaFixture({
  type = 2, width = 2, height = 1, depth = 24, flags = 0x20,
  pixels = [0, 0, 255, 0, 255, 0],
} = {}): ArrayBuffer {
  const bytes = new Uint8Array(18 + pixels.length);
  const header = new DataView(bytes.buffer);
  header.setUint8(2, type);
  header.setUint16(12, width, true);
  header.setUint16(14, height, true);
  header.setUint8(16, depth);
  header.setUint8(17, flags);
  bytes.set(pixels, 18);
  return bytes.buffer;
}

// Minimal RGB PSD with raw planar composite data and no layers.
export function psdFixture(depth = 8): ArrayBuffer {
  const bytes = new Uint8Array(40 + 6 * (depth / 8));
  const header = new DataView(bytes.buffer);
  bytes.set([0x38, 0x42, 0x50, 0x53]);
  header.setUint16(4, 1);
  header.setUint16(12, 3);
  header.setUint32(14, 1);
  header.setUint32(18, 2);
  header.setUint16(22, depth);
  header.setUint16(24, 3);
  const channels = [255, 0, 0, 255, 0, 0];
  channels.forEach((value, i) => {
    if (depth === 16) header.setUint16(40 + i * 2, value * 257);
    else header.setUint8(40 + i, value);
  });
  return bytes.buffer;
}
