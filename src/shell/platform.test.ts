// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { isTauri, isWindows } from "./platform";

const WEBVIEW2_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0";
const JSDOM_UA =
  "Mozilla/5.0 (win32) AppleWebKit/537.36 (KHTML, like Gecko) jsdom/26.1.0";

describe("platform", () => {
  it("detects a Windows WebView user agent", () => {
    expect(isWindows(WEBVIEW2_UA)).toBe(true);
  });

  it("does not mistake jsdom's platform string for Windows", () => {
    expect(isWindows(JSDOM_UA)).toBe(false);
  });

  it("detects the Tauri runtime marker", () => {
    expect(isTauri()).toBe(false);
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    expect(isTauri()).toBe(true);
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
    expect(isTauri()).toBe(false);
  });
});
