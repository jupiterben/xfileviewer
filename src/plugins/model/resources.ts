export function resourceUrl(url: string, base: string): string {
  if (/^(data:|blob:|https?:|asset:)/i.test(url)) return url;
  const normalized = url.replace(/\\/g, "/");
  const origin = new URL(base);
  if (/^[a-z]:\//i.test(normalized) && (origin.protocol === "asset:" || origin.hostname === "asset.localhost")) {
    return `${origin.protocol}//${origin.host}/${encodeURIComponent(normalized)}`;
  }
  return new URL(normalized, base).href;
}

export function modelResourceBase(src: string): string {
  const url = new URL(src);
  // Tauri encodes the entire filesystem path, including directory separators.
  if (url.protocol === "asset:" || url.hostname === "asset.localhost") {
    url.pathname = decodeURIComponent(url.pathname).replace(/\\/g, "/").split("/").map(encodeURIComponent).join("/");
  }
  return new URL(".", url).href;
}
