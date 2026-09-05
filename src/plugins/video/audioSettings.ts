export interface VideoAudioSettings {
  volume: number;
  muted: boolean;
  lastAudibleVolume: number;
}

const STORAGE_KEY = "xfileviewer.videoAudio";

export function loadAudioSettings(storage: Pick<Storage, "getItem">): VideoAudioSettings {
  const defaults = { volume: 1, muted: false, lastAudibleVolume: 1 };
  try {
    const value = JSON.parse(storage.getItem(STORAGE_KEY) ?? "null");
    if (!value || typeof value !== "object") return defaults;
    const validVolume = (n: unknown): n is number =>
      typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1;
    const volume = validVolume(value.volume) ? value.volume : 1;
    return {
      volume,
      muted: typeof value.muted === "boolean" ? value.muted : false,
      lastAudibleVolume: validVolume(value.lastAudibleVolume) && value.lastAudibleVolume > 0
        ? value.lastAudibleVolume : volume || 1,
    };
  } catch {
    return defaults;
  }
}

export function saveAudioSettings(
  storage: Pick<Storage, "setItem">,
  settings: VideoAudioSettings,
): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage failures should not interrupt playback.
  }
}
