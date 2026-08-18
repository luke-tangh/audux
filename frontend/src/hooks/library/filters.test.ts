import { describe, expect, it } from "vitest";
import type { AudioItem } from "../../types";
import {
  buildAudioListParams,
  buildPlaylistListParams,
  describeSmartPlaylistRules,
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
    expect(missingFilterToParam("aiFailed")).toBeUndefined();
  });

  it("describes smart playlist rules and invalid references", () => {
    const t = ((key: string, params?: Record<string, unknown>) => {
      if (key === "smartPlaylists.searchRule") return `search ${params?.query}`;
      if (key === "smartPlaylists.tagRule") return `tag ${params?.name}`;
      if (key === "smartPlaylists.invalidRule") return "invalid ignored";
      if (key === "smartPlaylists.sortRule") return `sort ${params?.sort}`;
      if (key === "topbar.sortUpdatedDesc") return "updated";
      return key;
    }) as never;

    expect(
      describeSmartPlaylistRules(
        {
          id: 8,
          name: "Smart",
          kind: "smart",
          created_at: "2026-08-10T00:00:00Z",
          updated_at: "2026-08-10T00:00:00Z",
          query: {
            schema_version: 1,
            view: "library",
            q: "meeting",
            tag_id: 3,
            library_root_id: null,
            transcript_filter: "all",
            missing_filter: "all",
            sort: "updated_desc",
            display_mode: "list"
          },
          tag_name: "work",
          invalid_references: ["library_root"]
        },
        t
      )
    ).toBe("search meeting · tag work · sort updated · invalid ignored");
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

    expect(
      buildAudioListParams({
        view: "library",
        debouncedQ: "",
        hasTranscriptFilter: "all",
        missingFilter: "aiFailed",
        sortMode: "default"
      })
    ).toMatchObject({ missing: undefined, ai_status: "failed" });
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
      ai_status: undefined,
      sort: "duration_desc"
    });

    expect(
      buildPlaylistListParams({
        debouncedQ: "",
        hasTranscriptFilter: "all",
        missingFilter: "aiFailed",
        sortMode: "default"
      })
    ).toMatchObject({ missing: undefined, ai_status: "failed" });
    expect(["pending", "running", "cancel_requested"].every(isBusyStatus)).toBe(true);
    expect(isBusyStatus("done")).toBe(false);
    expect(isSmartView("aiFailed")).toBe(true);
    expect(isSmartView("library")).toBe(false);
  });

  it("describes the AI-failed file rule", () => {
    const t = ((key: string) => key) as never;

    expect(
      describeSmartPlaylistRules(
        {
          id: 9,
          name: "AI failures",
          kind: "smart",
          created_at: "2026-08-10T00:00:00Z",
          updated_at: "2026-08-10T00:00:00Z",
          query: {
            schema_version: 1,
            view: "library",
            q: "",
            tag_id: null,
            library_root_id: null,
            transcript_filter: "all",
            missing_filter: "aiFailed",
            sort: "default",
            display_mode: "list"
          }
        },
        t
      )
    ).toBe("smartPlaylists.aiFailedRule");
  });

  it("describes included and excluded multi-tag rules", () => {
    const t = ((key: string, params?: Record<string, unknown>) =>
      `${key}:${params?.names || ""}`) as never;

    expect(
      describeSmartPlaylistRules(
        {
          id: 10,
          name: "Multi tag",
          kind: "smart",
          created_at: "2026-08-10T00:00:00Z",
          updated_at: "2026-08-10T00:00:00Z",
          query: {
            schema_version: 1,
            view: "library",
            q: "",
            tag_id: null,
            tag_ids: [1, 2],
            excluded_tag_ids: [3],
            tag_mode: "or",
            library_root_id: null,
            transcript_filter: "all",
            missing_filter: "all",
            sort: "default",
            display_mode: "list"
          },
          tag_names: ["work", "review"],
          excluded_tag_names: ["archive"]
        },
        t
      )
    ).toContain("smartPlaylists.tagOrRule:#work、#review");
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
      tag_ids: [],
      excluded_tag_ids: [],
      tag_mode: "and",
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
