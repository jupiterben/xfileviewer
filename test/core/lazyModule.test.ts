import { expect, it, vi } from "vitest";
import { lazyModule } from "../../src/core/lazyModule";

it("does not load during registration and shares concurrent and subsequent requests", async () => {
  const factory = vi.fn(async () => ({ value: 42 }));
  const load = lazyModule(factory);
  expect(factory).not.toHaveBeenCalled();
  const first = load();
  expect(load()).toBe(first);
  expect(await first).toEqual({ value: 42 });
  expect(load()).toBe(first);
  expect(factory).toHaveBeenCalledOnce();
});

it("clears a failed request so the next call can retry", async () => {
  const factory = vi.fn<() => Promise<string>>()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue("ready");
  const load = lazyModule(factory);
  const first = load();
  expect(load()).toBe(first);
  await expect(first).rejects.toThrow("offline");
  await expect(load()).resolves.toBe("ready");
  expect(factory).toHaveBeenCalledTimes(2);
});

it("converts synchronous factory errors into rejections and allows retry", async () => {
  const factory = vi.fn(() => { throw new Error("broken factory"); });
  const load = lazyModule(factory);
  await expect(load()).rejects.toThrow("broken factory");
  await expect(load()).rejects.toThrow("broken factory");
  expect(factory).toHaveBeenCalledTimes(2);
});
