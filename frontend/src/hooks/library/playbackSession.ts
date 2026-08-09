import type { AudioItem } from "../../types";

export type PlaybackSession = {
  version: 1;
  audio_ids: number[];
  current_audio_id: number | null;
};

export const MAX_PLAYBACK_QUEUE_SIZE = 500;

export function parsePlaybackSession(raw: string | null): PlaybackSession | null {
  if (!raw) return null;

  try {
    const value = JSON.parse(raw) as Partial<PlaybackSession>;
    if (value.version !== 1 || !Array.isArray(value.audio_ids)) return null;

    const audioIds = value.audio_ids
      .filter(
        (audioId): audioId is number => Number.isInteger(audioId) && audioId > 0
      )
      .slice(0, MAX_PLAYBACK_QUEUE_SIZE);
    const currentAudioId =
      Number.isInteger(value.current_audio_id) && Number(value.current_audio_id) > 0
        ? Number(value.current_audio_id)
        : null;

    return {
      version: 1,
      audio_ids: audioIds,
      current_audio_id: currentAudioId
    };
  } catch {
    return null;
  }
}

export function readPlaybackSession(
  storage: Pick<Storage, "getItem">,
  key: string
): PlaybackSession | null {
  try {
    return parsePlaybackSession(storage.getItem(key));
  } catch {
    return null;
  }
}

export function writePlaybackSession(
  storage: Pick<Storage, "setItem" | "removeItem">,
  key: string,
  queue: AudioItem[],
  currentAudioId: number | null
) {
  try {
    if (queue.length === 0) {
      storage.removeItem(key);
      return;
    }

    const session: PlaybackSession = {
      version: 1,
      audio_ids: queue.map((item) => item.id),
      current_audio_id: currentAudioId
    };
    storage.setItem(key, JSON.stringify(session));
  } catch (error) {
    console.error("Failed to persist playback session", error);
  }
}

export function restoredCurrentIndex(
  storedIds: number[],
  currentAudioId: number | null,
  resolved: AudioItem[]
): number {
  if (currentAudioId === null || resolved.length === 0) return -1;

  const exactIndex = resolved.findIndex((item) => item.id === currentAudioId);
  if (exactIndex >= 0) return exactIndex;

  const storedIndex = storedIds.indexOf(currentAudioId);
  if (storedIndex < 0) return -1;

  const resolvedIds = new Set(resolved.map((item) => item.id));
  const fallbackId =
    storedIds.slice(storedIndex + 1).find((audioId) => resolvedIds.has(audioId)) ??
    [...storedIds.slice(0, storedIndex)]
      .reverse()
      .find((audioId) => resolvedIds.has(audioId));

  return fallbackId === undefined
    ? -1
    : resolved.findIndex((item) => item.id === fallbackId);
}
