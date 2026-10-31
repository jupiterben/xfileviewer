interface GltfDocument {
  extensionsRequired?: string[];
  extensionsUsed?: string[];
}

/** Inspect the JSON chunk without importing Three or any geometry decoder. */
export function readGltfDocument(buffer: ArrayBuffer): GltfDocument {
  const view = new DataView(buffer);
  const bytes = buffer.byteLength >= 20 && view.getUint32(0, true) === 0x46546c67
    ? new Uint8Array(buffer, 20, view.getUint32(12, true))
    : new Uint8Array(buffer);
  return JSON.parse(new TextDecoder().decode(bytes)) as GltfDocument;
}

export function gltfRequiredExtensions(buffer: ArrayBuffer): string[] {
  try {
    return readGltfDocument(buffer).extensionsRequired ?? [];
  } catch {
    return [];
  }
}
