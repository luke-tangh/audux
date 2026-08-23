import type {
  ActivityFeed,
  AISuggestions,
  AudioDeleteResult,
  AudioDetail,
  AudioItem,
  AudioListQuery,
  LibraryHealthSummary,
  LibraryHealthTask,
  LibraryImportResult,
  LibraryRoot,
  PaginatedAudioItems,
  PlaybackEvent,
  PlaybackQueueResolution,
  Playlist,
  PlaylistDetail,
  PlaylistListQuery,
  SafeRelinkCandidates,
  SafeRelinkPreview,
  SavedView,
  SavedViewQuery,
  ScanTask,
  StatisticsOverview,
  Tag,
  TagMergeResult
} from "../types";
import type { ApiContext } from "./context";

function audioListQueryString(params?: AudioListQuery): string {
  const query = new URLSearchParams();
  if (params?.q) query.set("q", params.q);
  if (params?.tag) query.set("tag", params.tag);
  for (const tagId of params?.tag_ids || []) query.append("tag_ids", String(tagId));
  for (const tagId of params?.excluded_tag_ids || []) {
    query.append("excluded_tag_ids", String(tagId));
  }
  if (params?.tag_mode) query.set("tag_mode", params.tag_mode);
  if (params?.library_root_id !== undefined) {
    query.set("library_root_id", String(params.library_root_id));
  }
  if (params?.favorite !== undefined) query.set("favorite", String(params.favorite));
  if (params?.missing !== undefined) query.set("missing", String(params.missing));
  if (params?.has_transcript !== undefined) {
    query.set("has_transcript", String(params.has_transcript));
  }
  if (params?.missing_description !== undefined) {
    query.set("missing_description", String(params.missing_description));
  }
  if (params?.include_disabled_roots !== undefined) {
    query.set("include_disabled_roots", String(params.include_disabled_roots));
  }
  if (params?.ai_status) query.set("ai_status", params.ai_status);
  if (params?.transcript_status) query.set("transcript_status", params.transcript_status);
  if (params?.sort) query.set("sort", params.sort);
  if (params?.limit !== undefined) query.set("limit", String(params.limit));
  if (params?.offset !== undefined) query.set("offset", String(params.offset));
  return query.toString();
}

export function createLibraryApi(context: ApiContext) {
  const { request, appendAccessToken, appendQuery, getApiBase } = context;

  return {
    health: () => request<{ status: string }>("/health"),
    listLibraryRoots: () => request<LibraryRoot[]>("/library-roots"),
    createLibraryRoot: (path: string) => request<LibraryRoot>("/library-roots", {
      method: "POST",
      body: JSON.stringify({ path })
    }),
    importLibraryRoot: (path: string) => request<LibraryImportResult>("/library-roots/import", {
      method: "POST",
      body: JSON.stringify({ path })
    }),
    listActivities: (limit = 40) => request<ActivityFeed>(`/activities?limit=${limit}`),
    updateLibraryRoot: (id: number, payload: { is_enabled?: boolean }) =>
      request<LibraryRoot>(`/library-roots/${id}`, {
        method: "PATCH",
        body: JSON.stringify(payload)
      }),
    deleteLibraryRoot: (id: number) => request<{
      ok: boolean;
      detached_audio_items: number;
      removed_scan_tasks: number;
    }>(`/library-roots/${id}`, { method: "DELETE" }),
    scanLibraryRoot: (id: number) => request<ScanTask>(`/library-roots/${id}/scan`, {
      method: "POST"
    }),
    listScanTasks: (params?: { root_id?: number; limit?: number }) => {
      const query = new URLSearchParams();
      if (params?.root_id !== undefined) query.set("root_id", String(params.root_id));
      if (params?.limit !== undefined) query.set("limit", String(params.limit));
      const suffix = query.toString();
      return request<ScanTask[]>(`/scan-tasks${suffix ? `?${suffix}` : ""}`);
    },
    cancelScanTask: (id: number) => request<ScanTask>(`/scan-tasks/${id}/cancel`, {
      method: "POST"
    }),
    getLibraryHealth: () => request<LibraryHealthSummary>("/library-health"),
    listLibraryHealthTasks: (limit = 20) =>
      request<LibraryHealthTask[]>(`/library-health/tasks?limit=${limit}`),
    startLibraryHealthCheck: () =>
      request<LibraryHealthTask>("/library-health/checks", { method: "POST" }),
    confirmDuplicateHashes: (audioIds: number[]) =>
      request<LibraryHealthTask>("/library-health/duplicates/confirm", {
        method: "POST",
        body: JSON.stringify({ audio_ids: audioIds })
      }),
    cancelLibraryHealthTask: (id: number) =>
      request<LibraryHealthTask>(`/library-health/tasks/${id}/cancel`, { method: "POST" }),
    retryLibraryHealthTask: (id: number) =>
      request<LibraryHealthTask>(`/library-health/tasks/${id}/retry`, { method: "POST" }),
    findRelinkCandidates: (audioId: number) =>
      request<SafeRelinkCandidates>(`/library-health/audio/${audioId}/relink-candidates`),
    previewSafeRelink: (audioId: number, candidatePath: string) =>
      request<SafeRelinkPreview>(`/library-health/audio/${audioId}/relink-preview`, {
        method: "POST",
        body: JSON.stringify({ candidate_path: candidatePath })
      }),
    commitSafeRelink: (
      audioId: number,
      candidatePath: string,
      confirmation: SafeRelinkPreview["confirmation"]
    ) => request<{ preserved: boolean }>(`/library-health/audio/${audioId}/relink`, {
      method: "POST",
      body: JSON.stringify({ candidate_path: candidatePath, ...confirmation })
    }),

    listAudioItems: (params?: AudioListQuery) => {
      const suffix = audioListQueryString(params);
      return request<PaginatedAudioItems>(`/audio-items${suffix ? `?${suffix}` : ""}`);
    },
    getAudioDetail: (id: number) => request<AudioDetail>(`/audio-items/${id}`),
    resolvePlaybackQueue: (audioIds: number[]) =>
      request<PlaybackQueueResolution>("/audio-items/playback-queue/resolve", {
        method: "POST",
        body: JSON.stringify({ audio_ids: audioIds })
      }),
    getAiSuggestions: (id: number) =>
      request<AISuggestions>(`/audio-items/${id}/ai-suggestions`),
    updateAudio: (id: number, payload: Partial<AudioItem>) =>
      request<AudioItem>(`/audio-items/${id}`, {
        method: "PATCH",
        body: JSON.stringify(payload)
      }),
    deleteAudio: (id: number, deleteFile = false) =>
      request<AudioDeleteResult>(`/audio-items/${id}?delete_file=${String(deleteFile)}`, {
        method: "DELETE"
      }),
    relocateAudio: (id: number, filePath: string) =>
      request<AudioItem>(`/audio-items/${id}/relocate`, {
        method: "POST",
        body: JSON.stringify({ file_path: filePath })
      }),
    uploadCover: (id: number, file: File) => {
      const body = new FormData();
      body.append("file", file);
      return request<AudioItem>(`/audio-items/${id}/cover`, { method: "POST", body });
    },
    deleteCover: (id: number) => request<AudioItem>(`/audio-items/${id}/cover`, {
      method: "DELETE"
    }),
    coverUrl: (id: number, version?: string | number) => appendAccessToken(
      appendQuery(`${getApiBase()}/audio-items/${id}/cover`, { v: version })
    ),
    audioFileUrl: (id: number) =>
      appendAccessToken(`${getApiBase()}/audio-items/${id}/file`),
    updatePlaybackPosition: (id: number, last_position_seconds: number) =>
      request<{ ok: boolean }>(`/audio-items/${id}/playback-position`, {
        method: "POST",
        body: JSON.stringify({ last_position_seconds })
      }),
    incrementPlayCount: (id: number) => request<{ ok: boolean }>(
      `/audio-items/${id}/play-count`,
      { method: "POST" }
    ),
    startPlaybackEvent: (id: number, startPositionSeconds: number) =>
      request<PlaybackEvent>(`/audio-items/${id}/playback-events`, {
        method: "POST",
        body: JSON.stringify({ start_position_seconds: startPositionSeconds })
      }),
    updatePlaybackEvent: (
      eventId: number,
      payload: {
        listened_seconds: number;
        end_position_seconds: number;
        completed?: boolean;
        finish?: boolean;
        end_reason?: "paused" | "ended" | "track_change" | "closed";
      }
    ) => request<PlaybackEvent>(`/playback-events/${eventId}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),
    getStatisticsOverview: (days = 30) =>
      request<StatisticsOverview>(`/statistics/overview?days=${days}`),

    listTags: () => request<Tag[]>("/tags"),
    updateTag: (tagId: number, payload: { name: string }) => request<Tag>(`/tags/${tagId}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),
    deleteTag: (tagId: number, force = false) => request<{
      ok: boolean;
      affected_audio_items: number;
    }>(`/tags/${tagId}?force=${String(force)}`, { method: "DELETE" }),
    mergeTag: (sourceTagId: number, targetTagId: number) =>
      request<TagMergeResult>(`/tags/${sourceTagId}/merge`, {
        method: "POST",
        body: JSON.stringify({ target_tag_id: targetTagId })
      }),
    addTags: (
      audioId: number,
      tags: string[],
      source: "user" | "ai" | "system" = "user"
    ) => request<Tag[]>(`/audio-items/${audioId}/tags`, {
      method: "POST",
      body: JSON.stringify({ tags, source })
    }),
    removeTag: (audioId: number, tagId: number) =>
      request<{ ok: boolean }>(`/audio-items/${audioId}/tags/${tagId}`, {
        method: "DELETE"
      }),

    listPlaylists: () => request<Playlist[]>("/playlists"),
    listSavedViews: () => request<SavedView[]>("/saved-views"),
    createSavedView: (name: string, query: SavedViewQuery) =>
      request<SavedView>("/saved-views", {
        method: "POST",
        body: JSON.stringify({ name, query })
      }),
    updateSavedView: (viewId: number, payload: { name?: string; query?: SavedViewQuery }) =>
      request<SavedView>(`/saved-views/${viewId}`, {
        method: "PATCH",
        body: JSON.stringify(payload)
      }),
    copySavedView: (viewId: number, name?: string) =>
      request<SavedView>(`/saved-views/${viewId}/copy`, {
        method: "POST",
        body: JSON.stringify({ name })
      }),
    reorderSavedViews: (viewIds: number[]) => request<SavedView[]>("/saved-views/reorder", {
      method: "PATCH",
      body: JSON.stringify({ view_ids: viewIds })
    }),
    deleteSavedView: (viewId: number) => request<{ ok: boolean }>(
      `/saved-views/${viewId}`,
      { method: "DELETE" }
    ),
    getPlaylist: (id: number, params?: { include_disabled_roots?: boolean }) => {
      const query = new URLSearchParams();
      if (params?.include_disabled_roots !== undefined) {
        query.set("include_disabled_roots", String(params.include_disabled_roots));
      }
      const suffix = query.toString();
      return request<PlaylistDetail>(`/playlists/${id}${suffix ? `?${suffix}` : ""}`);
    },
    listPlaylistItems: (id: number, params?: PlaylistListQuery) => {
      const suffix = audioListQueryString(params);
      return request<PaginatedAudioItems>(
        `/playlists/${id}/items${suffix ? `?${suffix}` : ""}`
      );
    },
    createPlaylist: (name: string, description?: string) => request<Playlist>("/playlists", {
      method: "POST",
      body: JSON.stringify({ name, description })
    }),
    createSmartPlaylist: (savedViewId: number, name?: string, description?: string) =>
      request<Playlist>("/playlists/smart", {
        method: "POST",
        body: JSON.stringify({ saved_view_id: savedViewId, name, description })
      }),
    updatePlaylist: (playlistId: number, name: string) =>
      request<Playlist>(`/playlists/${playlistId}`, {
        method: "PATCH",
        body: JSON.stringify({ name })
      }),
    deletePlaylist: (playlistId: number) => request<{ ok: boolean; removed_items: number }>(
      `/playlists/${playlistId}`,
      { method: "DELETE" }
    ),
    addToPlaylist: (playlistId: number, audioId: number) =>
      request(`/playlists/${playlistId}/items`, {
        method: "POST",
        body: JSON.stringify({ audio_id: audioId })
      }),
    removePlaylistItem: (playlistId: number, playlistItemId: number) =>
      request<{ ok: boolean }>(`/playlists/${playlistId}/items/${playlistItemId}`, {
        method: "DELETE"
      }),
    reorderPlaylistItems: (playlistId: number, itemIds: number[]) =>
      request<{ ok: boolean; count: number }>(`/playlists/${playlistId}/items/reorder`, {
        method: "PATCH",
        body: JSON.stringify({ item_ids: itemIds })
      }),
    playlistExportUrl: (playlistId: number, format: "json" | "m3u") =>
      appendAccessToken(
        `${getApiBase()}/playlists/${playlistId}/export?format=${encodeURIComponent(format)}`
      )
  };
}
