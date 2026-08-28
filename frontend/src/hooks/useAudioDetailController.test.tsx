import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import "../i18n";
import type { AudioItem } from "../types";

const apiMocks = vi.hoisted(() => ({
  getAudioDetail: vi.fn(),
  listTags: vi.fn(),
  getTranscript: vi.fn(),
  getAiSuggestions: vi.fn()
}));

vi.mock("../api", async (importOriginal) => ({
  ...await importOriginal<typeof import("../api")>(),
  api: apiMocks
}));

import { ApiError } from "../api";
import { useAudioDetailController } from "./useAudioDetailController";

const audio: AudioItem = {
  id: 7,
  file_path: "/library/detail.mp3",
  file_name: "detail.mp3",
  title_user: "Detail",
  duration_seconds: 120,
  transcript_status: "none",
  ai_status: "none",
  play_count: 0,
  last_position_seconds: 0,
  is_favorite: false,
  is_missing: false,
  created_at: "2026-08-28T00:00:00",
  updated_at: "2026-08-28T00:00:00"
};

describe("useAudioDetailController", () => {
  beforeEach(() => {
    apiMocks.getAudioDetail.mockReset().mockResolvedValue({ audio, tags: [] });
    apiMocks.listTags.mockReset().mockResolvedValue([]);
    apiMocks.getTranscript.mockReset().mockResolvedValue(null);
    apiMocks.getAiSuggestions.mockReset().mockResolvedValue({
      task_id: null,
      description: null,
      tags: [],
      language: null,
      raw_content: null
    });
  });

  it("treats only a missing transcript as an expected empty state", async () => {
    apiMocks.getTranscript.mockRejectedValue(
      new ApiError("Transcript not found", 404)
    );
    const { result } = renderHook(() => useAudioDetailController({
      audio,
      refresh: vi.fn()
    }));

    await waitFor(() => expect(result.current.metadataLoaded).toBe(true));
    expect(result.current.transcript).toBeNull();
    expect(result.current.metadataLoadError).toBe("");
  });

  it("surfaces tag endpoint failures instead of replacing tags with an empty list", async () => {
    apiMocks.listTags.mockRejectedValue(new Error("tags unavailable"));
    const notify = vi.fn();
    const { result } = renderHook(() => useAudioDetailController({
      audio,
      refresh: vi.fn(),
      notify
    }));

    await waitFor(() => expect(result.current.metadataLoadError).toBe("tags unavailable"));
    expect(result.current.metadataLoaded).toBe(false);
    expect(notify).toHaveBeenCalledWith("tags unavailable", "error");
  });
});
