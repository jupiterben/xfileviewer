import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

// GHSA-gcqx-w48m-w2h4: upstream has no fixed release. Keep this small,
// fail-closed patch reproducible after npm ci / pnpm install. Do not hide the
// advisory or falsify its version; security tests exercise the installed code.
const require = createRequire(import.meta.url);
let manifestPath;
try {
  manifestPath = require.resolve("deepmerge/package.json");
} catch (error) {
  // deepmerge belongs only to the build toolchain. A production-only install
  // still runs root postinstall, but has nothing to patch when dev is omitted.
  const omitDev = (process.env.npm_config_omit ?? "").split(/[\s,]+/).includes("dev")
    || process.env.NODE_ENV === "production";
  if (error.code !== "MODULE_NOT_FOUND" || !omitDev) throw error;
  console.info("[security] deepmerge absent from production-only install; no patch needed");
  process.exit(0);
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
if (manifest.version !== "4.3.1") {
  throw new Error(`Review the deepmerge security patch for version ${manifest.version}`);
}
const marker = "// GHSA-gcqx-w48m-w2h4: reject prototype-sensitive keys on both sides.";
const files = ["index.js", "dist/cjs.js", "dist/umd.js"];
// Preflight every file before changing any of them. Package layout/implementation
// changes fail installation rather than silently leaving a vulnerable build.
const patches = files.map(relative => {
  const path = fileURLToPath(new URL(relative, pathToFileURL(manifestPath)));
  const source = readFileSync(path, "utf8");
  if (source.includes(marker)) {
    if (!source.includes("if (key === '__proto__' || key === 'constructor' || key === 'prototype') return true;")
      || !/getKeys\(target\)\.forEach\(function\(key\) \{\r?\n[\t ]*if \(propertyIsUnsafe\(target, key\)\) return;/.test(source)) {
      throw new Error(`Incomplete deepmerge security patch: ${relative}`);
    }
    return { path, source, patched: source };
  }
  const unsafe = /function propertyIsUnsafe\(target, key\) \{\r?\n/;
  const clone = /(getKeys\(target\)\.forEach\(function\(key\) \{\r?\n)([\t ]*)/;
  if (!unsafe.test(source) || !clone.test(source)) {
    throw new Error(`Cannot apply deepmerge security patch: ${relative}`);
  }
  const patched = source.replace(unsafe, match => `${match}\t${marker}\n\tif (key === '__proto__' || key === 'constructor' || key === 'prototype') return true;\n`)
    .replace(clone, (_, prefix, indent) => `${prefix}${indent}if (propertyIsUnsafe(target, key)) return;\n${indent}`);
  return { path, source, patched };
});
for (const { path, source, patched } of patches) {
  if (source !== patched) writeFileSync(path, patched, "utf8");
}
console.info("[security] deepmerge 4.3.1 prototype-poisoning patch verified");
