export function formatAppVersion(version: string): string {
  const trimmed = version.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("v") ? trimmed : `v${trimmed}`;
}

export async function resolveAppVersion(
  getVersion: () => Promise<string> = readTauriVersion,
): Promise<string> {
  try {
    return formatAppVersion(await getVersion());
  } catch {
    return formatAppVersion(fallbackPackageVersion());
  }
}

async function readTauriVersion(): Promise<string> {
  const { getVersion } = await import("@tauri-apps/api/app");
  return getVersion();
}

function fallbackPackageVersion(): string {
  return typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "";
}
