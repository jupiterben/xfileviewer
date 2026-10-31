import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, it } from "vitest";

const require = createRequire(import.meta.url);
type Merge = ((target: unknown, source: unknown, options?: Record<string, unknown>) => Record<string, unknown>) & {
  all: (values: unknown[]) => Record<string, unknown>;
};
const merge = require("deepmerge") as Merge;

it("allows omitted build dependencies only for production-only installs", () => {
  const url = new URL("../scripts/patch-deepmerge.mjs", import.meta.url);
  const source = readFileSync(url, "utf8")
    .replace(/^import .*?;\r?\n/gm, "")
    .split("import.meta.url").join(JSON.stringify(url.href));
  const missing = Object.assign(new Error("deepmerge not installed"), { code: "MODULE_NOT_FOUND" });
  const exit = new Error("production postinstall completed");
  const run = (env: Record<string, string>, error = missing) => runInNewContext(source, {
    createRequire: () => ({ resolve: () => { throw error; } }),
    process: { env, exit: (code: number) => { expect(code).toBe(0); throw exit; } },
    console: { info: () => {} },
  });
  expect(() => run({ npm_config_omit: "dev" })).toThrow(exit);
  expect(() => run({ NODE_ENV: "production" })).toThrow(exit);
  expect(() => run({})).toThrow(missing);
  expect(() => run({ npm_config_omit: "dev" }, Object.assign(new Error("invalid package"), { code: "ERR_INVALID_PACKAGE_CONFIG" }))).toThrow("invalid package");
});

it("rejects prototype poisoning with null-prototype targets, own keys and nested objects", () => {
  const payload = JSON.parse('{"__proto__":{"securityPoison":true},"constructor":{"prototype":{"securityPoison":true}},"prototype":{"securityPoison":true},"safe":1}');
  const targets = [Object.create(null), JSON.parse('{"__proto__":null}'), JSON.parse('{"__proto__":{}}'), {}];
  for (const target of targets) {
    for (const result of [merge(target, payload), merge(payload, target), merge.all([target, payload])]) {
      expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
      expect(result.securityPoison).toBeUndefined();
      expect(Object.prototype.hasOwnProperty.call(result, "__proto__")).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(result, "constructor")).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(result, "prototype")).toBe(false);
      expect(result.safe).toBe(1);
    }
  }
  const nested = merge({ nested: Object.create(null) }, { nested: payload }).nested as Record<string, unknown>;
  expect(nested.securityPoison).toBeUndefined();
  expect(({} as Record<string, unknown>).securityPoison).toBeUndefined();
});

it("preserves plugin config merge semantics, arrays, symbols and custom merging", () => {
  const key = Symbol("config");
  const result = merge({ options: { enabled: true }, list: [1], [key]: { a: 1 } },
    { options: { mode: "safe" }, list: [2], [key]: { b: 2 } });
  expect(result.options).toEqual({ enabled: true, mode: "safe" });
  expect(result.list).toEqual([1, 2]);
  expect((result as Record<symbol, unknown>)[key]).toEqual({ a: 1, b: 2 });
  expect(merge({ list: [1] }, { list: [2] }, { arrayMerge: (_target: unknown[], source: unknown[]) => source }).list).toEqual([2]);
  expect(merge.all([{ a: 1 }, { b: 2 }])).toEqual({ a: 1, b: 2 });
});

it("applies the security patch idempotently and covers every distributed entry", () => {
  const script = fileURLToPath(new URL("../scripts/patch-deepmerge.mjs", import.meta.url));
  const base = pathToFileURL(require.resolve("deepmerge/package.json"));
  const files = ["index.js", "dist/cjs.js", "dist/umd.js"];
  const before = files.map(relative => readFileSync(new URL(relative, base), "utf8"));
  execFileSync(process.execPath, [script], { stdio: "pipe" });
  execFileSync(process.execPath, [script], { stdio: "pipe" });
  files.forEach((relative, index) => {
    const content = readFileSync(new URL(relative, base), "utf8");
    expect(content).toContain("GHSA-gcqx-w48m-w2h4");
    expect(content).toBe(before[index]);
    // Exercise source and UMD too, without depending on their build-only imports.
    const module = { exports: {} as unknown };
    runInNewContext(content, {
      module, exports: module.exports,
      require: (name: string) => name === "is-mergeable-object"
        ? (value: unknown) => value !== null && typeof value === "object" : require(name),
    });
    const entryMerge = module.exports as Merge;
    const result = entryMerge(Object.create(null), JSON.parse('{"__proto__":{"poisoned":true}}'));
    expect(result.poisoned).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(result, "__proto__")).toBe(false);
  });
});
