export const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 2] as const;

function storedNumber(storage: Storage, key: string): number | null {
  try {
    const raw = storage.getItem(key);
    if (raw === null || raw.trim() === "") return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

export function readStoredPlaybackRate(storage: Storage): number {
  const value = storedNumber(storage, "playbackRate");
  return PLAYBACK_RATES.some((rate) => rate === value) ? value as number : 1;
}

export function readStoredVolume(storage: Storage): number {
  const value = storedNumber(storage, "volume");
  return value === null ? 1 : Math.min(1, Math.max(0, value));
}

export function writePlayerPreference(storage: Storage, key: string, value: number) {
  try {
    storage.setItem(key, String(value));
  } catch {
    // Playback should remain usable when browser preferences are unavailable.
  }
}
