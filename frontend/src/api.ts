import type {
  AudioDetail,
  AudioItem,
  LibraryRoot,
  Playlist,
  PlaylistDetail,
  Tag,
  Transcript
} from "./types";

export const API_BASE = "http://127.0.0.1:8765";

async function request<T = any>(path: string, options?: RequestInit): Promise<T> {
  const resp = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers || {})
    },
    ...options
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
    request<{ imported: number; updated: number; missing: number }>(`/library-roots/${id}/scan`, {
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

  updateAudio: (id: number, payload: Partial<AudioItem>) =>
    request<AudioItem>(`/audio-items/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),

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

  addTags: (audioId: number, tags: string[]) =>
    request<Tag[]>(`/audio-items/${audioId}/tags`, {
      method: "POST",
      body: JSON.stringify({ tags, source: "user" })
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

  transcribe: (audioId: number) =>
    request(`/audio-items/${audioId}/transcribe`, {
      method: "POST"
    }),

  analyze: (audioId: number) =>
    request(`/audio-items/${audioId}/analyze`, {
      method: "POST"
    }),

  getTranscript: (audioId: number) => request<Transcript>(`/audio-items/${audioId}/transcript`),

  listTasks: () => request<any[]>("/ai-tasks"),

  setSetting: (key: string, value: string) =>
    request("/settings", {
      method: "PUT",
      body: JSON.stringify({ key, value })
    }),

  listSettings: () => request<{ key: string; value: string; updated_at: string }[]>("/settings")
};
