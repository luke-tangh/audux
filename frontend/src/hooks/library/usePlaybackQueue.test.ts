import { act, renderHook, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AudioItem } from "../../types";
import {
  PLAYBACK_SESSION_STORAGE_KEY,
  usePlaybackQueue
} from "./usePlaybackQueue";

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  ensureBackendReady: vi.fn(),
  notify: vi.fn(),
  resolvePlaybackQueue: vi.fn()
}));

vi.mock("../../api", () => ({
  api: {
    resolvePlaybackQueue: mocks.resolvePlaybackQueue
  }
}));

vi.mock("../../components/dialog/UnifiedDialog", () => ({
  useDialog: () => ({ confirm: mocks.confirm })
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: { count?: number; error?: string }) =>
      values?.count !== undefined
        ? `${key}:${values.count}`
        : values?.error !== undefined
          ? `${key}:${values.error}`
          : key
  })
}));

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
    created_at: "2026-08-19T00:00:00Z",
    updated_at: "2026-08-19T00:00:00Z"
  };
}

function useQueueHarness(initialItems: AudioItem[] = []) {
  const [audioItems, setAudioItems] = useState(initialItems);
  const [playlistItems, setPlaylistItemsRaw] = useState(initialItems);
  const [selected, setSelected] = useState<AudioItem | null>(null);
  const queue = usePlaybackQueue({
    audioItems,
    setAudioItems,
    setPlaylistItemsRaw,
    setSelected,
    ensureBackendReady: mocks.ensureBackendReady,
    validationToken: 0,
    notify: mocks.notify
  });

  return { ...queue, audioItems, playlistItems, selected };
}

describe("usePlaybackQueue", () => {
  beforeEach(() => {
    mocks.confirm.mockReset();
    mocks.ensureBackendReady.mockReset().mockResolvedValue(undefined);
    mocks.notify.mockReset();
    mocks.resolvePlaybackQueue.mockReset();
  });

  it("restores surviving queue items and selects the nearest current item", async () => {
    window.localStorage.setItem(
      PLAYBACK_SESSION_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        audio_ids: [1, 2, 3],
        current_audio_id: 2
      })
    );
    mocks.resolvePlaybackQueue
      .mockResolvedValueOnce({ items: [audio(1), audio(3)], skipped: [2] })
      .mockResolvedValueOnce({ items: [audio(1), audio(3)], skipped: [] });

    const { result } = renderHook(() => useQueueHarness());

    await waitFor(() => expect(result.current.playbackQueue.map((item) => item.id)).toEqual([1, 3]));
    expect(result.current.playing?.id).toBe(3);
    expect(result.current.playingIndex).toBe(1);
    expect(mocks.notify).toHaveBeenCalledWith("queue.restoredSkipped:1", "info");

    await waitFor(() => expect(mocks.resolvePlaybackQueue).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(
      JSON.parse(window.localStorage.getItem(PLAYBACK_SESSION_STORAGE_KEY) ?? "null")
    ).toEqual({
      version: 1,
      audio_ids: [1, 3],
      current_audio_id: 3
    }));
  });

  it("preserves the stored session when restoration fails", async () => {
    const stored = JSON.stringify({
      version: 1,
      audio_ids: [1, 2],
      current_audio_id: 1
    });
    window.localStorage.setItem(PLAYBACK_SESSION_STORAGE_KEY, stored);
    mocks.resolvePlaybackQueue.mockRejectedValue(new Error("backend unavailable"));

    renderHook(() => useQueueHarness());

    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(
      "queue.restoreFailed:backend unavailable",
      "error"
    ));
    expect(window.localStorage.getItem(PLAYBACK_SESSION_STORAGE_KEY)).toBe(stored);
  });

  it("advances to the next item when the current queue entry is removed", async () => {
    const items = [audio(1), audio(2), audio(3)];
    const { result } = renderHook(() => useQueueHarness(items));

    await act(async () => result.current.playAudio(items[1], items));
    expect(result.current.playing?.id).toBe(2);
    expect(result.current.playingIndex).toBe(1);
    expect(result.current.playRequestId).toBe(1);

    await act(async () => result.current.removeQueueItem(1));
    expect(result.current.playbackQueue.map((item) => item.id)).toEqual([1, 3]);
    expect(result.current.playing?.id).toBe(3);
    expect(result.current.selected?.id).toBe(3);
    expect(result.current.playingIndex).toBe(1);
    expect(result.current.playRequestId).toBe(2);
    expect(mocks.notify).toHaveBeenLastCalledWith("queue.removedCurrent", "info");
  });

  it("keeps the current item stable while queue entries are reordered", async () => {
    const items = [audio(1), audio(2), audio(3)];
    const { result } = renderHook(() => useQueueHarness(items));
    await act(async () => result.current.playAudio(items[1], items));

    act(() => result.current.moveQueueItem(0, 2));
    expect(result.current.playbackQueue.map((item) => item.id)).toEqual([2, 3, 1]);
    expect(result.current.playing?.id).toBe(2);
    expect(result.current.playingIndex).toBe(0);

    act(() => result.current.moveQueueItem(0, 2));
    expect(result.current.playbackQueue.map((item) => item.id)).toEqual([3, 1, 2]);
    expect(result.current.playing?.id).toBe(2);
    expect(result.current.playingIndex).toBe(2);
  });

  it("moves an existing item directly after the current item", async () => {
    const items = [audio(1), audio(2), audio(3), audio(4)];
    const { result } = renderHook(() => useQueueHarness(items));
    await act(async () => result.current.playAudio(items[1], items));

    act(() => result.current.playNextAudio(items[3]));
    expect(result.current.playbackQueue.map((item) => item.id)).toEqual([1, 2, 4, 3]);
    expect(result.current.playingIndex).toBe(1);
    expect(mocks.notify).toHaveBeenLastCalledWith("queue.playNext", "success");

    act(() => result.current.playNextAudio(items[1]));
    expect(result.current.playbackQueue.map((item) => item.id)).toEqual([1, 2, 4, 3]);
    expect(mocks.notify).toHaveBeenLastCalledWith("queue.playing", "info");
  });

  it("patches playback position across every item collection", async () => {
    const items = [audio(1), audio(2)];
    const { result } = renderHook(() => useQueueHarness(items));
    await act(async () => result.current.playAudio(items[1], items));

    act(() => result.current.handlePlaybackPositionSaved(2, 37.5));

    const changedItems = [
      result.current.audioItems[1],
      result.current.playlistItems[1],
      result.current.playbackQueue[1],
      result.current.selected,
      result.current.playing
    ];
    for (const item of changedItems) {
      expect(item).toMatchObject({
        id: 2,
        last_position_seconds: 37.5,
        last_played_at: expect.any(String)
      });
    }
    expect(result.current.audioItems[0]).toEqual(items[0]);
  });

  it("honors clear confirmation and resets playback state", async () => {
    const items = [audio(1), audio(2)];
    mocks.confirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const { result } = renderHook(() => useQueueHarness(items));
    await act(async () => result.current.playAudio(items[0], items));

    await act(async () => result.current.clearQueue());
    expect(result.current.playbackQueue).toHaveLength(2);

    await act(async () => result.current.clearQueue());
    expect(result.current.playbackQueue).toEqual([]);
    expect(result.current.playing).toBeNull();
    expect(result.current.playingIndex).toBe(-1);
    expect(mocks.notify).toHaveBeenLastCalledWith("queue.cleared", "info");
  });

  it("removes a deleted current item and clears its selection", async () => {
    const items = [audio(1), audio(2), audio(3)];
    const { result } = renderHook(() => useQueueHarness(items));
    await act(async () => result.current.playAudio(items[2], items));

    act(() => result.current.handleAudioDeleted(3));

    expect(result.current.playbackQueue.map((item) => item.id)).toEqual([1, 2]);
    expect(result.current.playing?.id).toBe(2);
    expect(result.current.playingIndex).toBe(1);
    expect(result.current.selected).toBeNull();
  });
});
