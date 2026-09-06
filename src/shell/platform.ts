/**
 * Platform checks that stay honest outside a real Tauri webview: jsdom must
 * land on the WebView backend so the viewer tests exercise the HTML path.
 */

/** Tauri v2 injects `window.__TAURI_INTERNALS__` into its webviews. */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function isWindows(userAgent: string = navigator.userAgent): boolean {
  return /Windows NT/i.test(userAgent);
}
