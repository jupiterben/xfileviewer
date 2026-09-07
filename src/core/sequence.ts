import { basename, dirname, extensionOf, naturalCompare } from "./path";
import type { Sequence } from "./types";

function samePath(a: string, b: string): boolean {
  return a.split("\\").join("/") === b.split("\\").join("/");
}

export function buildSequence(
  files: string[],
  kindId: string,
  kindExtensions: Set<string>,
  originPath: string,
  loop = true,
): Sequence | null {
  const folder = dirname(originPath);
  const items = files
    .filter((file) => kindExtensions.has(extensionOf(file)))
    .sort((a, b) => naturalCompare(basename(a), basename(b)));

  if (
    kindExtensions.has(extensionOf(originPath)) &&
    !items.some((file) => samePath(file, originPath))
  ) {
    items.push(originPath);
    items.sort((a, b) => naturalCompare(basename(a), basename(b)));
  }

  const index = items.findIndex((file) => samePath(file, originPath));
  if (index < 0) return null;

  return { folder, kindId, items, index, loop };
}

export function nextIndex(seq: Sequence): number {
  const n = seq.items.length;
  if (n === 0) return 0;
  if (seq.loop) return (seq.index + 1) % n;
  return Math.min(seq.index + 1, n - 1);
}

export function prevIndex(seq: Sequence): number {
  const n = seq.items.length;
  if (n === 0) return 0;
  if (seq.loop) return (seq.index - 1 + n) % n;
  return Math.max(seq.index - 1, 0);
}

export function move(seq: Sequence, direction: 1 | -1): Sequence {
  const index = direction === 1 ? nextIndex(seq) : prevIndex(seq);
  return { ...seq, index };
}

export function preserveCurrentPath(seq: Sequence, path: string): Sequence {
  const index = seq.items.findIndex((item) => samePath(item, path));
  return index < 0 ? seq : { ...seq, index };
}

// Apply ordered worker insertions without copying the entire growing list.
export function insertSequenceItem(seq: Sequence, file: string, index: number): void {
  seq.items.splice(index, 0, file);
  if (index <= seq.index) seq.index += 1;
}

export function createSequenceAppender(seq: Sequence, extensions: Set<string>) {
  const key = (path: string) => path.split("\\").join("/");
  const seen = new Set(seq.items.map(key));
  return (current: Sequence, file: string): boolean => {
    if (!extensions.has(extensionOf(file)) || seen.has(key(file))) return false;
    seen.add(key(file));
    let low = 0;
    let high = current.items.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (naturalCompare(basename(current.items[mid]), basename(file)) <= 0) low = mid + 1;
      else high = mid;
    }
    insertSequenceItem(current, file, low);
    return true;
  };
}
