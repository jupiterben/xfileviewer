import { describe, expect, it } from "vitest";
import { loadAudioSettings, saveAudioSettings } from "./audioSettings";

describe("video audio preferences", () => {
  it.each([
    { volume: 0.35, muted: true, lastAudibleVolume: 0.35 },
    { volume: 0, muted: false, lastAudibleVolume: 0.6 },
    { volume: 0.8, muted: false, lastAudibleVolume: 0.8 },
  ])("restores saved settings in a new player: %j", (settings) => {
    const data = new Map<string, string>();
    saveAudioSettings({ setItem: (key, value) => { data.set(key, value); } }, settings);
    expect(loadAudioSettings({ getItem: (key) => data.get(key) ?? null })).toEqual(settings);
  });

  it.each([null, "broken", "null", '{"volume":2,"muted":"false","lastAudibleVolume":-1}'])(
    "uses safe defaults for missing or invalid settings: %s", (raw) => {
      expect(loadAudioSettings({ getItem: () => raw })).toEqual({
        volume: 1, muted: false, lastAudibleVolume: 1,
      });
    },
  );

  it("tolerates unavailable storage", () => {
    expect(loadAudioSettings({ getItem: () => { throw new Error("unavailable"); } }).muted).toBe(false);
    expect(() => saveAudioSettings({ setItem: () => { throw new Error("unavailable"); } }, {
      volume: 0.5, muted: true, lastAudibleVolume: 0.5,
    })).not.toThrow();
  });
});
