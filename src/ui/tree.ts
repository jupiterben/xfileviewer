export interface TreeNode {
  id: string;
  label: string;
  value: string;
  children?: () => TreeNode[];
}

const PAGE_SIZE = 100;
const STRING_CHUNK_SIZE = 512;

function ranges(id: string, length: number, item: (index: number) => TreeNode, start = 0, end = length): TreeNode[] {
  if (end - start <= PAGE_SIZE) return Array.from({ length: end - start }, (_, offset) => item(start + offset));
  let size = PAGE_SIZE;
  while (Math.ceil((end - start) / size) > PAGE_SIZE) size *= PAGE_SIZE;
  return Array.from({ length: Math.ceil((end - start) / size) }, (_, offset) => {
    const from = start + offset * size;
    const to = Math.min(from + size, end);
    return {
      id: `${id}/range/${from}-${to}`,
      label: `[${from}..${to - 1}]`,
      value: `${to - from} items`,
      children: () => ranges(id, length, item, from, to),
    };
  });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function sequence(value: unknown): ArrayLike<unknown> | undefined {
  if (Array.isArray(value)) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (value instanceof DataView) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (ArrayBuffer.isView(value)) return value as unknown as ArrayLike<unknown>;
  return undefined;
}

export function summarizeValue(value: unknown): string {
  if (typeof value === "string") return value.length > STRING_CHUNK_SIZE
    ? `${JSON.stringify(value.slice(0, 160))}... (${value.length} chars)`
    : JSON.stringify(value);
  if (typeof value === "bigint") return `${value}n`;
  if (!isObject(value)) return String(value);
  if (value instanceof ArrayBuffer || value instanceof DataView) return `${value.constructor.name} (${value.byteLength} bytes)`;
  const items = sequence(value);
  if (items) return `${Array.isArray(value) ? "Array" : value.constructor.name} (${items.length})`;
  if (value instanceof Map || value instanceof Set) return `${value.constructor.name} (${value.size})`;
  const type = typeof value.classId === "string" ? value.classId : "Object";
  const name = typeof value.name === "string" && value.name ? ` ${summarizeValue(value.name)}` : "";
  const id = typeof value.uniqueId === "number" ? ` #${value.uniqueId}` : "";
  return `${type}${name}${id}`;
}

/** Build only the opened branch. Ranges bound both DOM size and array access. */
export function valueTree(label: string, value: unknown, id = label, ancestors = new Map<object, string>()): TreeNode {
  const node: TreeNode = { id, label, value: summarizeValue(value) };
  if (typeof value === "string" && value.length > STRING_CHUNK_SIZE) {
    node.children = () => ranges(id, Math.ceil(value.length / STRING_CHUNK_SIZE), index => {
      const from = index * STRING_CHUNK_SIZE;
      const to = Math.min(from + STRING_CHUNK_SIZE, value.length);
      return valueTree(`[${from}..${to - 1}]`, value.slice(from, to), `${id}/${index}`);
    });
    return node;
  }
  if (!isObject(value)) return node;
  const reference = ancestors.get(value);
  if (reference !== undefined) {
    node.value += ` [Circular: ${reference}]`;
    return node;
  }
  const lineage = new Map(ancestors).set(value, label);
  let cached: TreeNode[] | undefined;
  const lazy = (build: () => TreeNode[]) => () => cached ??= build();
  const child = (key: string, item: unknown, index: number) => valueTree(key, item, `${id}/${index}`, lineage);
  const items = sequence(value);
  if (items) {
    if (items.length) node.children = lazy(() => ranges(id, items.length, index => child(`[${index}]`, items[index], index)));
  } else if (value instanceof Map || value instanceof Set) {
    if (value.size) node.children = lazy(() => {
      const entries = value instanceof Map ? Array.from(value.entries()) : Array.from(value, item => [item, item]);
      return ranges(id, entries.length, index => child(summarizeValue(entries[index][0]), entries[index][1], index));
    });
  } else {
    const keys = Object.keys(value);
    if (keys.length) node.children = lazy(() => ranges(id, keys.length, index => child(keys[index], value[keys[index]], index)));
  }
  return node;
}

export interface TreeRow {
  node: TreeNode;
  level: number;
  parent?: string;
  position: number;
  size: number;
}

export function visibleTreeRows(nodes: TreeNode[], expanded: ReadonlySet<string>): TreeRow[] {
  const rows: TreeRow[] = [];
  const walk = (siblings: TreeNode[], level: number, parent?: string) => {
    siblings.forEach((node, index) => {
      rows.push({ node, level, parent, position: index + 1, size: siblings.length });
      if (expanded.has(node.id) && node.children) walk(node.children(), level + 1, node.id);
    });
  };
  walk(nodes, 1);
  return rows;
}
