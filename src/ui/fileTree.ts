import { basename, dirname, naturalCompare, pathKey } from "../core/path";

export interface SidebarFolders {
  session?: number;
  root: string;
  directories: string[];
  loaded: string[];
  loading: string[];
  errors: Record<string, string>;
}

export interface FileNode {
  id: string;
  path: string;
  label: string;
  kind: "file" | "directory";
  index: number;
  count: number;
  children: FileNode[];
}

export interface FileRow {
  node: FileNode;
  level: number;
  parent?: string;
  position: number;
  size: number;
}

export const filePathKey = pathKey;

/** Ancestors below the scan root, excluding the file itself and the root. */
export function fileAncestors(root: string, path: string): string[] {
  const rootKey = filePathKey(root);
  let parent = dirname(path);
  const ancestors: string[] = [];
  while (filePathKey(parent) !== rootKey) {
    const key = filePathKey(parent);
    if (!key.startsWith(`${rootKey}/`)) return [];
    ancestors.unshift(parent);
    const next = dirname(parent);
    if (next === parent) return [];
    parent = next;
  }
  return ancestors;
}

/** Keep original sequence indices: a tree row index is NOT a navigation index. */
export function buildFileTree(root: string, items: string[], directories: string[]): FileNode[] {
  const roots: FileNode[] = [];
  const folders = new Map<string, FileNode>();
  const rootKey = filePathKey(root);
  const ensureFolder = (path: string): FileNode | undefined => {
    const id = filePathKey(path);
    if (id === rootKey) return undefined;
    if (!id.startsWith(`${rootKey}/`)) return undefined;
    const known = folders.get(id);
    if (known) return known;
    const node: FileNode = {
      id, path, label: basename(path), kind: "directory", index: -1, count: 0, children: [],
    };
    folders.set(id, node);
    const parent = ensureFolder(dirname(path));
    (parent?.children ?? roots).push(node);
    return node;
  };
  directories.forEach(ensureFolder);
  items.forEach((path, index) => {
    const parent = ensureFolder(dirname(path));
    (parent?.children ?? roots).push({
      id: filePathKey(path), path, label: basename(path), kind: "file", index, count: 1, children: [],
    });
    for (const ancestor of fileAncestors(root, path)) ensureFolder(ancestor)!.count += 1;
  });
  const sort = (nodes: FileNode[]) => {
    nodes.sort((a, b) => a.kind === b.kind
      ? naturalCompare(a.label, b.label) || naturalCompare(a.path, b.path)
      : a.kind === "directory" ? -1 : 1);
    nodes.forEach(node => { if (node.children.length) sort(node.children); });
  };
  sort(roots);
  return roots;
}

export function visibleFileRows(nodes: FileNode[], expanded: ReadonlySet<string>): FileRow[] {
  const rows: FileRow[] = [];
  const walk = (siblings: FileNode[], level: number, parent?: string) => {
    siblings.forEach((node, index) => {
      rows.push({ node, level, parent, position: index + 1, size: siblings.length });
      if (node.kind === "directory" && expanded.has(node.id)) walk(node.children, level + 1, node.id);
    });
  };
  walk(nodes, 1);
  return rows;
}
