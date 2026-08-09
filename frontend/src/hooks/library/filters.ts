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
  return status === "pending" || status === "running" || status === "cancel_requested";
}

export function isSmartView(view: ViewMode): boolean {
  return (
    view === "missingDescription" ||
    view === "transcribed" ||
    view === "missing" ||
    view === "aiFailed"
  );
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
  selectedLibraryRootId,
  hasTranscriptFilter,
  missingFilter,
  sortMode
}: {
  view: ViewMode;
  debouncedQ: string;
  selectedTag?: string;
  selectedLibraryRootId?: number;
  hasTranscriptFilter: TranscriptFilter;
  missingFilter: MissingFilter;
  sortMode: SortMode;
}): AudioListParams {
  return {
    q: debouncedQ || undefined,
    tag: selectedTag,
    library_root_id: selectedLibraryRootId,
    favorite: view === "favorites" ? true : undefined,
    missing_description: view === "missingDescription" ? true : undefined,
    has_transcript:
      view === "transcribed" ? true : transcriptFilterToParam(hasTranscriptFilter),
    missing: view === "missing" ? true : missingFilterToParam(missingFilter),
    ai_status: view === "aiFailed" ? "failed" : undefined,
    sort: sortMode === "default" ? undefined : sortMode
  };
}

export function buildPlaylistListParams({
  debouncedQ,
  selectedTag,
  selectedLibraryRootId,
  hasTranscriptFilter,
  missingFilter,
  sortMode
}: {
  debouncedQ: string;
  selectedTag?: string;
  selectedLibraryRootId?: number;
  hasTranscriptFilter: TranscriptFilter;
  missingFilter: MissingFilter;
  sortMode: SortMode;
}): PlaylistListParams {
  return {
    q: debouncedQ || undefined,
    tag: selectedTag,
    library_root_id: selectedLibraryRootId,
    has_transcript: transcriptFilterToParam(hasTranscriptFilter),
    missing: missingFilterToParam(missingFilter),
    sort: sortMode === "default" ? undefined : sortMode
  };
}

export function buildSavedViewQuery({
  view,
  q,
  tagId,
  libraryRootId,
  transcriptFilter,
  missingFilter,
  sort
}: {
  view: SavedViewQuery["view"];
  q: string;
  tagId?: number;
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
