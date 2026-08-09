import { describe, expect, it } from "vitest";
import type { AudioItem } from "../../types";
import {
  buildAudioListParams,
  buildPlaylistListParams,
  buildSavedViewQuery,
  isBusyStatus,
  isSmartView,
  missingFilterToParam,
  transcriptFilterToParam,
  uniqueAudioItems,
  savedViewQueriesEqual
} from "./filters";

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

describe("library filters", () => {
  it("maps tri-state transcript and missing filters", () => {
    expect(transcriptFilterToParam("yes")).toBe(true);
    expect(transcriptFilterToParam("no")).toBe(false);
    expect(transcriptFilterToParam("all")).toBeUndefined();
    expect(missingFilterToParam("missing")).toBe(true);
    expect(missingFilterToParam("available")).toBe(false);
    expect(missingFilterToParam("all")).toBeUndefined();
  });

  it("builds smart-view parameters without leaking unrelated filters", () => {
    expect(
      buildAudioListParams({
        view: "missingDescription",
        debouncedQ: "lecture",
        selectedTag: "work",
        selectedLibraryRootId: 9,
        hasTranscriptFilter: "no",
        missingFilter: "available",
        sortMode: "title_asc"
      })
    ).toEqual({
      q: "lecture",
      tag: "work",
      library_root_id: 9,
      favorite: undefined,
      missing_description: true,
      has_transcript: false,
      missing: false,
      ai_status: undefined,
      sort: "title_asc"
    });

    expect(
      buildAudioListParams({
        view: "transcribed",
        debouncedQ: "",
        hasTranscriptFilter: "no",
        missingFilter: "all",
        sortMode: "default"
      })
    ).toMatchObject({ has_transcript: true, q: undefined });
  });

  it("builds playlist filters and classifies busy and smart states", () => {
    expect(
      buildPlaylistListParams({
        debouncedQ: "meeting",
        selectedTag: "todo",
        selectedLibraryRootId: 4,
        hasTranscriptFilter: "yes",
        missingFilter: "missing",
        sortMode: "duration_desc"
      })
    ).toEqual({
      q: "meeting",
      tag: "todo",
      library_root_id: 4,
      has_transcript: true,
      missing: true,
      sort: "duration_desc"
    });
    expect(["pending", "running", "cancel_requested"].every(isBusyStatus)).toBe(true);
    expect(isBusyStatus("done")).toBe(false);
    expect(isSmartView("aiFailed")).toBe(true);
    expect(isSmartView("library")).toBe(false);
  });

  it("builds and compares versioned saved-view definitions", () => {
    const query = buildSavedViewQuery({
      view: "favorites",
      q: "  meeting  ",
      tagId: 3,
      libraryRootId: 7,
      transcriptFilter: "yes",
      missingFilter: "available",
      sort: "updated_desc"
    });

    expect(query).toEqual({
      schema_version: 1,
      view: "favorites",
      q: "meeting",
      tag_id: 3,
      library_root_id: 7,
      transcript_filter: "yes",
      missing_filter: "available",
      sort: "updated_desc",
      display_mode: "list"
    });
    expect(savedViewQueriesEqual(query, { ...query })).toBe(true);
    expect(savedViewQueriesEqual(query, { ...query, q: "other" })).toBe(false);
  });

  it("deduplicates audio by id while preserving first-seen order", () => {
    const first = audio(1);
    const duplicate = { ...first, file_name: "duplicate.mp3" };
    const second = audio(2);

    expect(uniqueAudioItems([first, second, duplicate])).toEqual([first, second]);
  });
});
