import { describe, expect, it, vi } from "vitest";
import type { AudioItem } from "../../types";
import {
  MAX_PLAYBACK_QUEUE_SIZE,
  parsePlaybackSession,
  readPlaybackSession,
  restoredCurrentIndex,
  writePlaybackSession
} from "./playbackSession";

function audio(id: number): AudioItem {
  return {
    id,
    file_path: `/library/${id}.mp3`,
    file_name: `${id}.mp3`,
    transcript_status: "none",
    ai_status: "none",
    play_count: 0,
    last_position_seconds: 0,
    is_favorite: false,
    is_missing: false,
    created_at: "2026-08-09T00:00:00Z",
    updated_at: "2026-08-09T00:00:00Z"
  };
}

describe("playback session persistence", () => {
  it("rejects malformed and unsupported sessions", () => {
    expect(parsePlaybackSession(null)).toBeNull();
    expect(parsePlaybackSession("not-json")).toBeNull();
    expect(parsePlaybackSession(JSON.stringify({ version: 2, audio_ids: [1] }))).toBeNull();
    expect(parsePlaybackSession(JSON.stringify({ version: 1, audio_ids: "1" }))).toBeNull();
  });

  it("normalizes ids, current item and maximum queue size", () => {
    const ids = Array.from({ length: MAX_PLAYBACK_QUEUE_SIZE + 10 }, (_, index) => index + 1);
    const parsed = parsePlaybackSession(
      JSON.stringify({
        version: 1,
        audio_ids: [0, -1, 1.5, "2", ...ids],
        current_audio_id: -3
      })
    );

    expect(parsed?.audio_ids).toHaveLength(MAX_PLAYBACK_QUEUE_SIZE);
    expect(parsed?.audio_ids.slice(0, 3)).toEqual([1, 2, 3]);
    expect(parsed?.current_audio_id).toBeNull();
  });

  it("reads and writes through storage without exposing storage failures", () => {
    const storage = new Map<string, string>();
    const adapter = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key)
    };

    writePlaybackSession(adapter, "session", [audio(2), audio(1)], 2);
    expect(readPlaybackSession(adapter, "session")).toEqual({
      version: 1,
      audio_ids: [2, 1],
      current_audio_id: 2
    });

    writePlaybackSession(adapter, "session", [], null);
    expect(readPlaybackSession(adapter, "session")).toBeNull();

    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(
      readPlaybackSession({ getItem: () => { throw new Error("blocked"); } }, "session")
    ).toBeNull();
    writePlaybackSession(
      {
        setItem: () => { throw new Error("blocked"); },
        removeItem: () => { throw new Error("blocked"); }
      },
      "session",
      [audio(1)],
      1
    );
    expect(error).toHaveBeenCalledOnce();
  });

  it("restores the exact item or the nearest surviving neighbor", () => {
    const resolved = [audio(1), audio(3), audio(5)];

    expect(restoredCurrentIndex([1, 2, 3, 4, 5], 3, resolved)).toBe(1);
    expect(restoredCurrentIndex([1, 2, 3, 4, 5], 2, resolved)).toBe(1);
    expect(restoredCurrentIndex([1, 2, 3, 4, 5], 4, resolved)).toBe(2);
    expect(restoredCurrentIndex([1, 2], 2, [audio(1)])).toBe(0);
    expect(restoredCurrentIndex([1, 2], 9, resolved)).toBe(-1);
    expect(restoredCurrentIndex([1, 2], null, resolved)).toBe(-1);
  });
});
