import { dirname } from "../../core/path";

export function resolveLocalPath(fromFile: string, href: string): string | null {
  const raw = stripQueryAndHash(href.trim());
  if (!shouldRewrite(raw)) return null;
  if (isAbsolutePath(raw)) return normalizePath(raw);
  return normalizePath(`${dirname(fromFile)}/${raw}`);
}

export function rewriteSrc(
  fromFile: string,
  href: string,
  toSrc: (abs: string) => string,
): string {
  const abs = resolveLocalPath(fromFile, href);
  return abs ? toSrc(abs) : href;
}

function shouldRewrite(href: string): boolean {
  if (!href || href.startsWith("#")) return false;
  if (href.startsWith("//")) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return false;
  return true;
}

function stripQueryAndHash(href: string): string {
  const i = href.search(/[?#]/);
  return i < 0 ? href : href.slice(0, i);
}

function isAbsolutePath(href: string): boolean {
  return href.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(href);
}

function normalizePath(path: string): string {
  const unix = path.replace(/\\/g, "/");
  const abs = unix.startsWith("/");
  const out: string[] = [];
  for (const part of unix.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      out.pop();
      continue;
    }
    out.push(part);
  }
  return (abs ? "/" : "") + out.join("/");
}
