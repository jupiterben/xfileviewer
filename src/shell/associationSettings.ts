import { BUILTIN_KINDS, KIND_DOCUMENT, KIND_IMAGE, KIND_VIDEO } from "../core/types";
import type { AssociationSettings } from "./associations";

export interface AssociationEntry {
  ext: string;
  pluginName: string;
  kindId: string;
}

export interface AssociationRow extends AssociationEntry {
  granted: boolean;
  error?: string;
}

export interface AssociationKindGroup {
  kindId: string;
  label: string;
  rows: AssociationRow[];
  checkState: KindCheckState;
}

export type KindCheckState = "all" | "none" | "mixed";

export function kindLabel(kindId: string): string {
  switch (kindId) {
    case KIND_IMAGE:
      return "图片";
    case KIND_VIDEO:
      return "视频";
    case KIND_DOCUMENT:
      return "文档";
    default:
      return kindId;
  }
}

export function buildAssociationRows(entries: AssociationEntry[]): AssociationRow[] {
  const seen = new Set<string>();
  const rows: AssociationRow[] = [];
  for (const entry of entries) {
    const ext = entry.ext.toLowerCase();
    if (seen.has(ext)) continue;
    seen.add(ext);
    rows.push({
      ext,
      pluginName: entry.pluginName,
      kindId: entry.kindId,
      granted: false,
    });
  }
  rows.sort((a, b) => a.ext.localeCompare(b.ext));
  return rows;
}

export function groupAssociationRows(rows: AssociationRow[]): AssociationKindGroup[] {
  const byKind = new Map<string, AssociationRow[]>();
  for (const row of rows) {
    const list = byKind.get(row.kindId) ?? [];
    list.push(row);
    byKind.set(row.kindId, list);
  }
  const extras = [...byKind.keys()]
    .filter((kindId) => !(BUILTIN_KINDS as readonly string[]).includes(kindId))
    .sort();
  const groups: AssociationKindGroup[] = [];
  for (const kindId of [...BUILTIN_KINDS, ...extras]) {
    const items = byKind.get(kindId);
    if (!items?.length) continue;
    groups.push({
      kindId,
      label: kindLabel(kindId),
      rows: items,
      checkState: kindCheckState(items),
    });
  }
  return groups;
}

export function mergeAssociationState(
  rows: AssociationRow[],
  queried: Record<string, boolean>,
  settings: AssociationSettings,
  osManaged: boolean,
): AssociationRow[] {
  return rows.map((row) => ({
    ext: row.ext,
    pluginName: row.pluginName,
    kindId: row.kindId,
    granted: osManaged
      ? (queried[row.ext] ?? false)
      : settings.granted.includes(row.ext),
  }));
}

export function setAssociationRowError(
  rows: AssociationRow[],
  ext: string,
  error: string,
): AssociationRow[] {
  return rows.map((row) =>
    row.ext === ext ? { ...row, error } : row,
  );
}

export function setRowGranted(
  rows: AssociationRow[],
  ext: string,
  granted: boolean,
): AssociationRow[] {
  return rows.map((row) =>
    row.ext === ext ? { ...row, granted, error: undefined } : row,
  );
}

export function setKindGranted(
  rows: AssociationRow[],
  kindId: string,
  granted: boolean,
): AssociationRow[] {
  return rows.map((row) =>
    row.kindId === kindId ? { ...row, granted, error: undefined } : row,
  );
}

export function kindCheckState(rows: AssociationRow[]): KindCheckState {
  const granted = rows.filter((row) => row.granted).length;
  if (granted === 0) return "none";
  if (granted === rows.length) return "all";
  return "mixed";
}

export function associationChanges(
  applied: AssociationRow[],
  draft: AssociationRow[],
): { grant: string[]; revoke: string[] } {
  const appliedMap = new Map(applied.map((row) => [row.ext, row.granted]));
  const grant: string[] = [];
  const revoke: string[] = [];
  for (const row of draft) {
    const was = appliedMap.get(row.ext) ?? false;
    if (row.granted && !was) grant.push(row.ext);
    if (!row.granted && was) revoke.push(row.ext);
  }
  return { grant, revoke };
}
