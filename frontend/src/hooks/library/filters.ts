import type { AudioItem, Playlist, SavedViewQuery } from "../../types";
import type { TFunction } from "i18next";
import type {
  AudioListParams,
  MissingFilter,
  PlaylistListParams,
  SortMode,
  TranscriptFilter,
  ViewMode
} from "./types";
import { isActiveTaskStatus } from "../../constants";

export function transcriptFilterToParam(value: TranscriptFilter): boolean | undefined {
  if (value === "yes") return true;
  if (value === "no") return false;
  return undefined;
}

export function missingFilterToParam(value: MissingFilter): boolean | undefined {
  if (value === "missing") return true;
  if (value === "available") return false;
  return undefined;
}

export function isBusyStatus(status?: string): boolean {
  return Boolean(status && isActiveTaskStatus(status));
}

export function isSmartView(view: ViewMode): boolean {
  return (
    view === "missingDescription" ||
    view === "transcribed" ||
    view === "missing" ||
    view === "aiFailed"
  );
}

export function isAudioListView(view: ViewMode): boolean {
  return !["settings", "statistics", "agent", "organization"].includes(view);
}

export function uniqueAudioItems(items: AudioItem[]): AudioItem[] {
  const seen = new Set<number>();
  const result: AudioItem[] = [];

  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    result.push(item);
  }

  return result;
}

export function buildAudioListParams({
  view,
  debouncedQ,
  selectedTag,
  includedTagIds,
  excludedTagIds,
  tagMode,
  selectedLibraryRootId,
  hasTranscriptFilter,
  missingFilter,
  sortMode
}: {
  view: ViewMode;
  debouncedQ: string;
  selectedTag?: string;
  includedTagIds?: number[];
  excludedTagIds?: number[];
  tagMode?: "and" | "or";
  selectedLibraryRootId?: number;
  hasTranscriptFilter: TranscriptFilter;
  missingFilter: MissingFilter;
  sortMode: SortMode;
}): AudioListParams {
  return {
    q: debouncedQ || undefined,
    tag: selectedTag,
    ...(includedTagIds?.length ? { tag_ids: includedTagIds } : {}),
    ...(excludedTagIds?.length ? { excluded_tag_ids: excludedTagIds } : {}),
    ...(includedTagIds?.length || excludedTagIds?.length ? { tag_mode: tagMode || "and" } : {}),
    library_root_id: selectedLibraryRootId,
    favorite: view === "favorites" ? true : undefined,
    missing_description: view === "missingDescription" ? true : undefined,
    has_transcript:
      view === "transcribed" ? true : transcriptFilterToParam(hasTranscriptFilter),
    missing: view === "missing" ? true : missingFilterToParam(missingFilter),
    ai_status: view === "aiFailed" || missingFilter === "aiFailed" ? "failed" : undefined,
    sort: sortMode === "default" ? undefined : sortMode
  };
}

export function buildPlaylistListParams({
  debouncedQ,
  selectedTag,
  includedTagIds,
  excludedTagIds,
  tagMode,
  selectedLibraryRootId,
  hasTranscriptFilter,
  missingFilter,
  sortMode
}: {
  debouncedQ: string;
  selectedTag?: string;
  includedTagIds?: number[];
  excludedTagIds?: number[];
  tagMode?: "and" | "or";
  selectedLibraryRootId?: number;
  hasTranscriptFilter: TranscriptFilter;
  missingFilter: MissingFilter;
  sortMode: SortMode;
}): PlaylistListParams {
  return {
    q: debouncedQ || undefined,
    tag: selectedTag,
    ...(includedTagIds?.length ? { tag_ids: includedTagIds } : {}),
    ...(excludedTagIds?.length ? { excluded_tag_ids: excludedTagIds } : {}),
    ...(includedTagIds?.length || excludedTagIds?.length ? { tag_mode: tagMode || "and" } : {}),
    library_root_id: selectedLibraryRootId,
    has_transcript: transcriptFilterToParam(hasTranscriptFilter),
    missing: missingFilterToParam(missingFilter),
    ai_status: missingFilter === "aiFailed" ? "failed" : undefined,
    sort: sortMode === "default" ? undefined : sortMode
  };
}

export function buildSavedViewQuery({
  view,
  q,
  tagId,
  tagIds,
  excludedTagIds,
  tagMode,
  libraryRootId,
  transcriptFilter,
  missingFilter,
  sort
}: {
  view: SavedViewQuery["view"];
  q: string;
  tagId?: number;
  tagIds?: number[];
  excludedTagIds?: number[];
  tagMode?: "and" | "or";
  libraryRootId?: number;
  transcriptFilter: TranscriptFilter;
  missingFilter: MissingFilter;
  sort: SortMode;
}): SavedViewQuery {
  return {
    schema_version: 1,
    view,
    q: q.trim(),
    tag_id: tagId ?? null,
    tag_ids: tagIds || [],
    excluded_tag_ids: excludedTagIds || [],
    tag_mode: tagMode || "and",
    library_root_id: libraryRootId ?? null,
    transcript_filter: transcriptFilter,
    missing_filter: missingFilter,
    sort,
    display_mode: "list"
  };
}

export function savedViewQueriesEqual(
  left: SavedViewQuery,
  right: SavedViewQuery
): boolean {
  return (
    left.schema_version === right.schema_version &&
    left.view === right.view &&
    left.q === right.q &&
    left.tag_id === right.tag_id &&
    JSON.stringify(left.tag_ids || []) === JSON.stringify(right.tag_ids || []) &&
    JSON.stringify(left.excluded_tag_ids || []) === JSON.stringify(right.excluded_tag_ids || []) &&
    (left.tag_mode || "and") === (right.tag_mode || "and") &&
    left.library_root_id === right.library_root_id &&
    left.transcript_filter === right.transcript_filter &&
    left.missing_filter === right.missing_filter &&
    left.sort === right.sort &&
    left.display_mode === right.display_mode
  );
}

export function listCopyForView(
  view: ViewMode,
  playlists: Playlist[],
  selectedPlaylistId: number | null,
  t: TFunction
): { listTitle: string; listSubtitle: string } {
  const activePlaylist = playlists.find((playlist) => playlist.id === selectedPlaylistId);

  if (view === "favorites") {
    return {
      listTitle: t("library.views.favoritesTitle"),
      listSubtitle: t("library.views.favoritesSubtitle")
    };
  }

  if (view === "playlist") {
    return {
      listTitle: activePlaylist ? activePlaylist.name : t("library.views.playlistTitle"),
      listSubtitle: activePlaylist?.description || t("library.views.playlistSubtitle")
    };
  }

  if (view === "missingDescription") {
    return {
      listTitle: t("library.views.missingDescriptionTitle"),
      listSubtitle: t("library.views.missingDescriptionSubtitle")
    };
  }

  if (view === "transcribed") {
    return {
      listTitle: t("library.views.transcribedTitle"),
      listSubtitle: t("library.views.transcribedSubtitle")
    };
  }

  if (view === "missing") {
    return {
      listTitle: t("library.views.missingTitle"),
      listSubtitle: t("library.views.missingSubtitle")
    };
  }

  if (view === "aiFailed") {
    return {
      listTitle: t("library.views.aiFailedTitle"),
      listSubtitle: t("library.views.aiFailedSubtitle")
    };
  }

  return {
    listTitle: t("library.views.libraryTitle"),
    listSubtitle: t("library.views.librarySubtitle")
  };
}

export function describeSmartPlaylistRules(
  playlist: Playlist,
  t: TFunction
): string {
  const query = playlist.query;
  if (!query) return t("smartPlaylists.invalidRule");

  const parts: string[] = [];
  const viewRules: Partial<Record<SavedViewQuery["view"], string>> = {
    favorites: t("library.views.favoritesTitle"),
    missingDescription: t("library.views.missingDescriptionTitle"),
    transcribed: t("library.views.transcribedTitle"),
    missing: t("library.views.missingTitle"),
    aiFailed: t("library.views.aiFailedTitle")
  };
  const viewRule = viewRules[query.view];
  if (viewRule) parts.push(viewRule);
  if (query.q) parts.push(t("smartPlaylists.searchRule", { query: query.q }));
  const includedTagNames = playlist.tag_names?.length
    ? playlist.tag_names
    : playlist.tag_name
      ? [playlist.tag_name]
      : [];
  if (includedTagNames.length === 1) {
    parts.push(t("smartPlaylists.tagRule", { name: includedTagNames[0] }));
  } else if (includedTagNames.length > 1) {
    parts.push(t(
      query.tag_mode === "or"
        ? "smartPlaylists.tagOrRule"
        : "smartPlaylists.tagAndRule",
      { names: includedTagNames.map((name) => `#${name}`).join("、") }
    ));
  }
  if (playlist.excluded_tag_names?.length) {
    parts.push(t("smartPlaylists.tagExcludeRule", {
      names: playlist.excluded_tag_names.map((name) => `#${name}`).join("、")
    }));
  }
  if (playlist.library_root_path) {
    parts.push(t("smartPlaylists.rootRule", { path: playlist.library_root_path }));
  }
  if (query.view !== "transcribed" && query.transcript_filter !== "all") {
    parts.push(
      t(
        query.transcript_filter === "yes"
          ? "smartPlaylists.transcriptYesRule"
          : "smartPlaylists.transcriptNoRule"
      )
    );
  }
  if (
    query.view !== "missing" &&
    query.view !== "aiFailed" &&
    query.missing_filter !== "all"
  ) {
    if (query.missing_filter === "aiFailed") {
      parts.push(t("smartPlaylists.aiFailedRule"));
    } else {
      parts.push(
        t(
          query.missing_filter === "missing"
            ? "smartPlaylists.missingRule"
            : "smartPlaylists.availableRule"
        )
      );
    }
  }
  if (query.sort !== "default") {
    const sortKeys: Record<Exclude<SortMode, "default">, string> = {
      title_asc: "topbar.sortTitleAsc",
      title_desc: "topbar.sortTitleDesc",
      author_asc: "topbar.sortAuthorAsc",
      created_desc: "topbar.sortCreatedDesc",
      updated_desc: "topbar.sortUpdatedDesc",
      duration_asc: "topbar.sortDurationAsc",
      duration_desc: "topbar.sortDurationDesc",
      play_count_desc: "topbar.sortPlayCountDesc"
    };
    parts.push(t("smartPlaylists.sortRule", { sort: t(sortKeys[query.sort]) }));
  }
  if (playlist.invalid_references?.length) {
    parts.push(t("smartPlaylists.invalidRule"));
  }
  return parts.join(" · ") || t("smartPlaylists.allAudioRule");
}
