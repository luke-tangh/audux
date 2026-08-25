import { describe, expect, it, vi } from "vitest";

import {
  readStoredPlaybackRate,
  readStoredVolume,
  writePlayerPreference
} from "./playerPreferences";

describe("player preferences", () => {
  it("accepts supported rates and rejects corrupted or unsupported values", () => {
    window.localStorage.setItem("playbackRate", "1.5");
    expect(readStoredPlaybackRate(window.localStorage)).toBe(1.5);

    window.localStorage.setItem("playbackRate", "NaN");
    expect(readStoredPlaybackRate(window.localStorage)).toBe(1);

    window.localStorage.setItem("playbackRate", "3");
    expect(readStoredPlaybackRate(window.localStorage)).toBe(1);
  });

  it("clamps stored volume to the media element range", () => {
    window.localStorage.setItem("volume", "2");
    expect(readStoredVolume(window.localStorage)).toBe(1);

    window.localStorage.setItem("volume", "-0.5");
    expect(readStoredVolume(window.localStorage)).toBe(0);

    window.localStorage.setItem("volume", "invalid");
    expect(readStoredVolume(window.localStorage)).toBe(1);
  });

  it("keeps playback usable when storage access fails", () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readStoredPlaybackRate(window.localStorage)).toBe(1);
    expect(readStoredVolume(window.localStorage)).toBe(1);
    getItem.mockRestore();

    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => writePlayerPreference(window.localStorage, "volume", 0.5)).not.toThrow();
    setItem.mockRestore();
  });
});
