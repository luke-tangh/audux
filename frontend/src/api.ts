import type {
  AISuggestions,
  AITask,
  AudioDetail,
  AudioItem,
  BatchTaskResult,
  LibraryRoot,
  LLMConfigPayload,
  Playlist,
  PlaylistDetail,
  ScanTask,
  Tag,
  Transcript
} from "./types";

export const API_BASE = "http://127.0.0.1:8765";

async function request<T = any>(path: string, options?: RequestInit): Promise<T> {
  const body = options?.body;
  const isFormData = typeof FormData !== "undefined" && body instanceof FormData;

  const headers: Record<string, string> = {
    ...(options?.headers as Record<string, string> | undefined)
  };

  if (!isFormData && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  const resp = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(text || `HTTP ${resp.status}`);
  }

  return resp.json();
}

export const api = {
  health: () => request<{ status: string }>("/health"),

  listLibraryRoots: () => request<LibraryRoot[]>("/library-roots"),

  createLibraryRoot: (path: string) =>
    request<LibraryRoot>("/library-roots", {
      method: "POST",
      body: JSON.stringify({ path })
    }),

  updateLibraryRoot: (id: number, payload: { is_enabled?: boolean }) =>
    request<LibraryRoot>(`/library-roots/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),

  scanLibraryRoot: (id: number) =>
    request<ScanTask>(`/library-roots/${id}/scan`, {
      method: "POST"
    }),

  listScanTasks: (params?: { root_id?: number; limit?: number }) => {
    const sp = new URLSearchParams();
    if (params?.root_id !== undefined) sp.set("root_id", String(params.root_id));
    if (params?.limit !== undefined) sp.set("limit", String(params.limit));
    const qs = sp.toString();
    return request<ScanTask[]>(`/scan-tasks${qs ? `?${qs}` : ""}`);
  },

  cancelScanTask: (id: number) =>
    request<ScanTask>(`/scan-tasks/${id}/cancel`, {
      method: "POST"
    }),

  listAudioItems: (params?: {
    q?: string;
    tag?: string;
    favorite?: boolean;
    missing?: boolean;
    has_transcript?: boolean;
    missing_description?: boolean;
    include_disabled_roots?: boolean;
    limit?: number;
    offset?: number;
  }) => {
    const sp = new URLSearchParams();

    if (params?.q) sp.set("q", params.q);
    if (params?.tag) sp.set("tag", params.tag);
    if (params?.favorite !== undefined) sp.set("favorite", String(params.favorite));
    if (params?.missing !== undefined) sp.set("missing", String(params.missing));
    if (params?.has_transcript !== undefined) {
      sp.set("has_transcript", String(params.has_transcript));
    }
    if (params?.missing_description !== undefined) {
      sp.set("missing_description", String(params.missing_description));
    }
    if (params?.include_disabled_roots !== undefined) {
      sp.set("include_disabled_roots", String(params.include_disabled_roots));
    }
    if (params?.limit !== undefined) sp.set("limit", String(params.limit));
    if (params?.offset !== undefined) sp.set("offset", String(params.offset));

    const qs = sp.toString();
    return request<AudioItem[]>(`/audio-items${qs ? `?${qs}` : ""}`);
  },

  getAudioDetail: (id: number) => request<AudioDetail>(`/audio-items/${id}`),

  getAiSuggestions: (id: number) =>
    request<AISuggestions>(`/audio-items/${id}/ai-suggestions`),

  updateAudio: (id: number, payload: Partial<AudioItem>) =>
    request<AudioItem>(`/audio-items/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),

  deleteAudio: (id: number, deleteFile = false) =>
    request<{ ok: boolean }>(`/audio-items/${id}?delete_file=${String(deleteFile)}`, {
      method: "DELETE"
    }),

  relocateAudio: (id: number, filePath: string) =>
    request<AudioItem>(`/audio-items/${id}/relocate`, {
      method: "POST",
      body: JSON.stringify({ file_path: filePath })
    }),

  uploadCover: (id: number, file: File) => {
    const fd = new FormData();
    fd.append("file", file);

    return request<AudioItem>(`/audio-items/${id}/cover`, {
      method: "POST",
      body: fd
    });
  },

  deleteCover: (id: number) =>
    request<AudioItem>(`/audio-items/${id}/cover`, {
      method: "DELETE"
    }),

  coverUrl: (id: number, version?: string | number) =>
    `${API_BASE}/audio-items/${id}/cover${version ? `?v=${encodeURIComponent(String(version))}` : ""}`,

  updatePlaybackPosition: (id: number, last_position_seconds: number) =>
    request<{ ok: boolean }>(`/audio-items/${id}/playback-position`, {
      method: "POST",
      body: JSON.stringify({ last_position_seconds })
    }),

  incrementPlayCount: (id: number) =>
    request<{ ok: boolean }>(`/audio-items/${id}/play-count`, {
      method: "POST"
    }),

  listTags: () => request<Tag[]>("/tags"),

  addTags: (audioId: number, tags: string[], source: "user" | "ai" | "system" = "user") =>
    request<Tag[]>(`/audio-items/${audioId}/tags`, {
      method: "POST",
      body: JSON.stringify({ tags, source })
    }),

  removeTag: (audioId: number, tagId: number) =>
    request<{ ok: boolean }>(`/audio-items/${audioId}/tags/${tagId}`, {
      method: "DELETE"
    }),

  listPlaylists: () => request<Playlist[]>("/playlists"),

  getPlaylist: (id: number) => request<PlaylistDetail>(`/playlists/${id}`),

  createPlaylist: (name: string, description?: string) =>
    request<Playlist>("/playlists", {
      method: "POST",
      body: JSON.stringify({ name, description })
    }),

  addToPlaylist: (playlistId: number, audioId: number) =>
    request(`/playlists/${playlistId}/items`, {
      method: "POST",
      body: JSON.stringify({ audio_id: audioId })
    }),

  playlistExportUrl: (playlistId: number, format: "json" | "m3u") =>
    `${API_BASE}/playlists/${playlistId}/export?format=${encodeURIComponent(format)}`,

  transcribe: (audioId: number) =>
    request<AITask>(`/audio-items/${audioId}/transcribe`, {
      method: "POST"
    }),

  analyze: (audioId: number) =>
    request<AITask>(`/audio-items/${audioId}/analyze`, {
      method: "POST"
    }),

  batchTranscribe: (audioIds: number[]) =>
    request<BatchTaskResult>("/audio-items/batch/transcribe", {
      method: "POST",
      body: JSON.stringify({ audio_ids: audioIds })
    }),

  batchAnalyze: (audioIds: number[]) =>
    request<BatchTaskResult>("/audio-items/batch/analyze", {
      method: "POST",
      body: JSON.stringify({ audio_ids: audioIds })
    }),

  testLlm: (payload: LLMConfigPayload) =>
    request<{ ok: boolean; content: string }>("/ai/test-llm", {
      method: "POST",
      body: JSON.stringify(payload)
    }),

  getTranscript: (audioId: number) => request<Transcript>(`/audio-items/${audioId}/transcript`),

  transcriptExportUrl: (audioId: number, format: "txt" | "json" | "srt") =>
    `${API_BASE}/audio-items/${audioId}/transcript/export?format=${encodeURIComponent(format)}`,

  metadataExportUrl: (format: "json" | "csv") =>
    `${API_BASE}/export/metadata?format=${encodeURIComponent(format)}`,

  listTasks: () => request<AITask[]>("/ai-tasks"),

  retryTask: (taskId: number) =>
    request<AITask>(`/ai-tasks/${taskId}/retry`, {
      method: "POST"
    }),

  cancelTask: (taskId: number) =>
    request<AITask>(`/ai-tasks/${taskId}/cancel`, {
      method: "POST"
    }),

  setSetting: (key: string, value: string) =>
    request("/settings", {
      method: "PUT",
      body: JSON.stringify({ key, value })
    }),

  listSettings: () => request<{ key: string; value: string; updated_at: string }[]>("/settings"),

  rebuildSearchIndex: () =>
    request<{ ok: boolean; count: number }>("/maintenance/rebuild-search-index", {
      method: "POST"
    }),

  getLogs: (lines = 300) => request<{ file: string; content: string }>(`/logs/app?lines=${lines}`),

  logsFileUrl: () => `${API_BASE}/logs/app/file`
};
