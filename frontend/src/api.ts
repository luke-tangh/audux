import type {
  AISuggestions,
  AITask,
  AudioDetail,
  AudioItem,
  BatchTaskResult,
  BatchOrganizationPayload,
  BatchOrganizationResult,
  LibraryRoot,
  LLMConfigPayload,
  LLMTestResult,
  PaginatedAudioItems,
  Playlist,
  PlaylistDetail,
  ScanTask,
  Tag,
  TagMergeResult,
  Transcript
} from "./types";

export const DEFAULT_API_BASE = "http://127.0.0.1:8765";
export let API_BASE = DEFAULT_API_BASE;

let apiBaseResolved = false;
let apiBasePromise: Promise<string> | null = null;

function isTauriRuntimeSync(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function resolveApiBase(): Promise<string> {
  if (apiBaseResolved) {
    return API_BASE;
  }

  if (apiBasePromise) {
    return apiBasePromise;
  }

  apiBasePromise = (async () => {
    try {
      if (isTauriRuntimeSync()) {
        const { invoke } = await import("@tauri-apps/api/core");
        const value = await invoke<string>("backend_base_url");
        const normalized = String(value || "").trim().replace(/\/+$/, "");

        if (normalized) {
          API_BASE = normalized;
        }
      }
    } catch (err) {
      console.warn("Failed to resolve Tauri backend base URL; using default", err);
    } finally {
      apiBaseResolved = true;
    }

    return API_BASE;
  })().finally(() => {
    apiBasePromise = null;
  });

  return apiBasePromise;
}

export async function ensureApiBase(): Promise<string> {
  return resolveApiBase();
}

export const LOCAL_AUDIO_CLIENT_HEADER = "X-Local-Audio-Client";
export const LOCAL_AUDIO_CLIENT_ID = "local-audio-library";

export const LOCAL_AUDIO_TOKEN_HEADER = "X-Local-Audio-Token";
export const LOCAL_AUDIO_TOKEN_QUERY = "access_token";

let localApiToken: string | null = null;
let localApiTokenPromise: Promise<string> | null = null;

export class ApiError extends Error {
  status: number;
  detail?: unknown;
  raw?: string;

  constructor(message: string, status: number, detail?: unknown, raw?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
    this.raw = raw;
  }
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readableErrorFromJson(value: unknown): string {
  if (!isJsonObject(value)) {
    if (value === null || value === undefined) return "";

    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  if (typeof value.detail === "string") {
    return value.detail;
  }

  if (Array.isArray(value.detail)) {
    return value.detail
      .map((item) => {
        if (isJsonObject(item) && typeof item.msg === "string") return item.msg;
        return JSON.stringify(item);
      })
      .join("; ");
  }

  if (value.detail !== undefined) {
    try {
      return JSON.stringify(value.detail, null, 2);
    } catch {
      return String(value.detail);
    }
  }

  if (typeof value.message === "string") {
    return value.message;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

async function parseErrorResponse(resp: Response): Promise<ApiError> {
  const text = await resp.text();

  if (!text) {
    return new ApiError(`HTTP ${resp.status}`, resp.status);
  }

  try {
    const json = JSON.parse(text);
    const message = readableErrorFromJson(json) || `HTTP ${resp.status}`;
    const detail = isJsonObject(json) ? json.detail : undefined;
    return new ApiError(message, resp.status, detail, text);
  } catch {
    return new ApiError(text, resp.status, undefined, text);
  }
}

function isTokenFreePath(path: string): boolean {
  return path === "/health" || path === "/auth/token";
}

export async function ensureLocalApiToken(): Promise<string> {
  if (localApiToken) {
    return localApiToken;
  }

  if (localApiTokenPromise) {
    return localApiTokenPromise;
  }

  const base = await resolveApiBase();

  localApiTokenPromise = fetch(`${base}/auth/token`, {
    headers: {
      [LOCAL_AUDIO_CLIENT_HEADER]: LOCAL_AUDIO_CLIENT_ID
    }
  })
    .then(async (resp) => {
      if (!resp.ok) {
        throw await parseErrorResponse(resp);
      }

      const json = await resp.json();
      const token = String(json.token || "").trim();

      if (!token) {
        throw new Error("Local API token is empty");
      }

      localApiToken = token;
      return token;
    })
    .finally(() => {
      localApiTokenPromise = null;
    });

  return localApiTokenPromise;
}

function resetLocalApiToken() {
  localApiToken = null;
  localApiTokenPromise = null;
}

function authQuery(): string {
  if (!localApiToken) return "";
  return `${LOCAL_AUDIO_TOKEN_QUERY}=${encodeURIComponent(localApiToken)}`;
}

function appendQuery(url: string, params: Record<string, string | number | undefined>) {
  const entries = Object.entries(params).filter(
    ([, value]) => value !== undefined && value !== ""
  );

  if (entries.length === 0) {
    return url;
  }

  const sp = new URLSearchParams();

  for (const [key, value] of entries) {
    if (value !== undefined) {
      sp.set(key, String(value));
    }
  }

  return `${url}${url.includes("?") ? "&" : "?"}${sp.toString()}`;
}

function appendAccessToken(url: string): string {
  const tokenQuery = authQuery();
  if (!tokenQuery) return url;

  return `${url}${url.includes("?") ? "&" : "?"}${tokenQuery}`;
}

async function request<T = any>(
  path: string,
  options?: RequestInit,
  retryOnUnauthorized = true
): Promise<T> {
  const body = options?.body;
  const isFormData = typeof FormData !== "undefined" && body instanceof FormData;

  const headers: Record<string, string> = {
    ...(options?.headers as Record<string, string> | undefined)
  };

  headers[LOCAL_AUDIO_CLIENT_HEADER] = LOCAL_AUDIO_CLIENT_ID;

  if (!isTokenFreePath(path)) {
    headers[LOCAL_AUDIO_TOKEN_HEADER] = await ensureLocalApiToken();
  }

  if (!isFormData && !headers["Content-Type"] && body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const base = await resolveApiBase();

  const resp = await fetch(`${base}${path}`, {
    ...options,
    headers
  });

  if (resp.status === 401 && retryOnUnauthorized && !isTokenFreePath(path)) {
    resetLocalApiToken();
    await ensureLocalApiToken();
    return request<T>(path, options, false);
  }

  if (!resp.ok) {
    throw await parseErrorResponse(resp);
  }

  if (resp.status === 204) {
    return undefined as T;
  }

  const text = await resp.text();
  if (!text) {
    return undefined as T;
  }

  return JSON.parse(text);
}

export function isProbablyLocalEndpoint(endpoint: string): boolean {
  try {
    const parsed = new URL(endpoint);
    const host = parsed.hostname.toLowerCase();

    return (
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host === "127.0.0.1" ||
      host.startsWith("127.") ||
      host === "::1" ||
      host === "[::1]"
    );
  } catch {
    return false;
  }
}

export function endpointPrivacyWarning(endpoint: string): string | null {
  if (!endpoint.trim()) return null;

  if (isProbablyLocalEndpoint(endpoint.trim())) {
    return null;
  }

  return "当前 LLM endpoint 不是 localhost / 127.0.0.1。AI 分析会把音频 metadata 和 transcript 发送到该地址。请确认这是你信任的本地或内网模型服务。";
}

export function asrEndpointPrivacyWarning(endpoint: string): string | null {
  if (!endpoint.trim()) return null;

  if (isProbablyLocalEndpoint(endpoint.trim())) {
    return null;
  }

  return "当前 ASR endpoint 不是 localhost / 127.0.0.1。转写会把完整音频文件发送到该地址。请确认这是你信任的本地或内网模型服务。";
}

export const api = {
  ensureAuthToken: ensureLocalApiToken,

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

  deleteLibraryRoot: (id: number) =>
    request<{
      ok: boolean;
      detached_audio_items: number;
      removed_scan_tasks: number;
    }>(`/library-roots/${id}`, {
      method: "DELETE"
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
    ai_status?: string;
    transcript_status?: string;
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
    if (params?.ai_status) sp.set("ai_status", params.ai_status);
    if (params?.transcript_status) sp.set("transcript_status", params.transcript_status);
    if (params?.limit !== undefined) sp.set("limit", String(params.limit));
    if (params?.offset !== undefined) sp.set("offset", String(params.offset));

    const qs = sp.toString();
    return request<PaginatedAudioItems>(`/audio-items${qs ? `?${qs}` : ""}`);
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
    appendAccessToken(
      appendQuery(`${API_BASE}/audio-items/${id}/cover`, {
        v: version
      })
    ),

  audioFileUrl: (id: number) => appendAccessToken(`${API_BASE}/audio-items/${id}/file`),

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

  updateTag: (tagId: number, payload: { name: string }) =>
    request<Tag>(`/tags/${tagId}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),

  deleteTag: (tagId: number, force = false) =>
    request<{ ok: boolean; affected_audio_items: number }>(
      `/tags/${tagId}?force=${String(force)}`,
      {
        method: "DELETE"
      }
    ),

  mergeTag: (sourceTagId: number, targetTagId: number) =>
    request<TagMergeResult>(`/tags/${sourceTagId}/merge`, {
      method: "POST",
      body: JSON.stringify({ target_tag_id: targetTagId })
    }),

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

  getPlaylist: (id: number, params?: { include_disabled_roots?: boolean }) => {
    const sp = new URLSearchParams();

    if (params?.include_disabled_roots !== undefined) {
      sp.set("include_disabled_roots", String(params.include_disabled_roots));
    }

    const qs = sp.toString();
    return request<PlaylistDetail>(`/playlists/${id}${qs ? `?${qs}` : ""}`);
  },

  listPlaylistItems: (
    id: number,
    params?: {
      q?: string;
      tag?: string;
      favorite?: boolean;
      missing?: boolean;
      has_transcript?: boolean;
      missing_description?: boolean;
      ai_status?: string;
      transcript_status?: string;
      limit?: number;
      offset?: number;
    }
  ) => {
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
    if (params?.ai_status) sp.set("ai_status", params.ai_status);
    if (params?.transcript_status) sp.set("transcript_status", params.transcript_status);
    if (params?.limit !== undefined) sp.set("limit", String(params.limit));
    if (params?.offset !== undefined) sp.set("offset", String(params.offset));

    const qs = sp.toString();
    return request<PaginatedAudioItems>(`/playlists/${id}/items${qs ? `?${qs}` : ""}`);
  },

  createPlaylist: (name: string, description?: string) =>
    request<Playlist>("/playlists", {
      method: "POST",
      body: JSON.stringify({ name, description })
    }),

  updatePlaylist: (playlistId: number, name: string) =>
    request<Playlist>(`/playlists/${playlistId}`, {
      method: "PATCH",
      body: JSON.stringify({ name })
    }),

  deletePlaylist: (playlistId: number) =>
    request<{ ok: boolean; removed_items: number }>(`/playlists/${playlistId}`, {
      method: "DELETE"
    }),

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
      `${API_BASE}/playlists/${playlistId}/export?format=${encodeURIComponent(format)}`
    ),

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

  organizeAudioBatch: (payload: BatchOrganizationPayload) =>
    request<BatchOrganizationResult>("/audio-items/batch/organize", {
      method: "POST",
      body: JSON.stringify(payload)
    }),

  testLlm: (payload: LLMConfigPayload) =>
    request<LLMTestResult>("/ai/test-llm", {
      method: "POST",
      body: JSON.stringify(payload)
    }),

  getTranscript: (audioId: number) => request<Transcript>(`/audio-items/${audioId}/transcript`),

  updateTranscript: (audioId: number, fullText: string) =>
    request<Transcript>(`/audio-items/${audioId}/transcript`, {
      method: "PATCH",
      body: JSON.stringify({ full_text: fullText })
    }),

  transcriptExportUrl: (audioId: number, format: "txt" | "json" | "srt") =>
    appendAccessToken(
      `${API_BASE}/audio-items/${audioId}/transcript/export?format=${encodeURIComponent(format)}`
    ),

  metadataExportUrl: (format: "json" | "csv") =>
    appendAccessToken(`${API_BASE}/export/metadata?format=${encodeURIComponent(format)}`),

  listTasks: (params?: {
    status?: string;
    task_type?: string;
    audio_id?: number;
    limit?: number;
    offset?: number;
  }) => {
    const sp = new URLSearchParams();

    if (params?.status) sp.set("status", params.status);
    if (params?.task_type) sp.set("task_type", params.task_type);
    if (params?.audio_id !== undefined) sp.set("audio_id", String(params.audio_id));
    if (params?.limit !== undefined) sp.set("limit", String(params.limit));
    if (params?.offset !== undefined) sp.set("offset", String(params.offset));

    const qs = sp.toString();
    return request<AITask[]>(`/ai-tasks${qs ? `?${qs}` : ""}`);
  },

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

  cleanupTags: () =>
    request<{ ok: boolean; deleted: number }>("/maintenance/cleanup-tags", {
      method: "POST"
    }),

  getLogs: (lines = 300) => request<{ file: string; content: string }>(`/logs/app?lines=${lines}`),

  logsFileUrl: () => appendAccessToken(`${API_BASE}/logs/app/file`)
};
