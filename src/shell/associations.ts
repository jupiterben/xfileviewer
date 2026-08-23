export interface AssociationSettings {
  granted: string[];
  denied: string[];
}

export function associationDecision(
  settings: AssociationSettings,
  extensions: string[],
): "granted" | "denied" | "ask" {
  const exts = extensions.map((e) => e.toLowerCase());
  if (exts.every((ext) => settings.granted.includes(ext))) return "granted";
  if (exts.some((ext) => settings.denied.includes(ext))) return "denied";
  return "ask";
}

export function rememberAssociation(
  settings: AssociationSettings,
  extensions: string[],
  granted: boolean,
): AssociationSettings {
  const exts = extensions.map((e) => e.toLowerCase());
  const grantedSet = new Set(settings.granted);
  const deniedSet = new Set(settings.denied);
  for (const ext of exts) {
    if (granted) {
      grantedSet.add(ext);
      deniedSet.delete(ext);
    } else {
      deniedSet.add(ext);
      grantedSet.delete(ext);
    }
  }
  return { granted: [...grantedSet], denied: [...deniedSet] };
}
