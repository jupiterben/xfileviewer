export const MODEL_EXTENSIONS = ["fbx", "obj", "glb", "gltf", "ply", "splat", "ksplat"];

export function isGaussianSplatPLY(buffer: ArrayBuffer): boolean {
  const text = new TextDecoder().decode(new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 65536)));
  const end = text.indexOf("end_header");
  if (end < 0) return false;
  const header = text.slice(0, end);
  return ["f_dc_0", "scale_0", "rot_0"].every(name =>
    new RegExp(`^property\\s+\\w+\\s+${name}\\s*$`, "m").test(header),
  );
}
