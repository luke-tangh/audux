export type LibraryRoot = {
  id: number;
  path: string;
  is_enabled: boolean;
  created_at: string;
  updated_at: string;
};

export type Tag = {
  id: number;
  name: string;
  source: string;
  created_at: string;
};

export type SearchHit = {
  field: "title" | "author" | "description" | "tags" | "transcript" | string;
  label: string;
  text: string;
  start_seconds?: number;
  end_seconds?: number;
};

export type AudioItem = {
  id: number;
  file_path: string;
  file_name: string;
  file_ext?: string;
  file_size?: number;
  file_mtime?: string;
  file_hash?: string;

  library_root_id?: number;

  title_original?: string;
  title_user?: string;

  author_original?: string;
  author_user?: string;

  album_original?: string;
  album_user?: string;

  description_original?: string;
  description_user?: string;
  description_ai?: string;

  cover_path?: string;
  cover_source?: string;

  duration_seconds?: number;
  bitrate?: number;
  sample_rate?: number;
  channels?: number;

  language?: string;

  transcript_status: string;
  ai_status: string;

  play_count: number;
  last_played_at?: string;
  last_position_seconds: number;

  is_favorite: boolean;
  is_missing: boolean;

  created_at: string;
  updated_at: string;

  tags?: Tag[];
  search_hits?: SearchHit[];

  playlist_item_id?: number;
  playlist_order_index?: number;
};

export type AudioDetail = {
  audio: AudioItem;
  tags: Tag[];
};

export type Playlist = {
  id: number;
  name: string;
  description?: string;
  created_at: string;
  updated_at: string;
};

export type PlaylistDetail = {
  playlist: Playlist;
  items: {
    playlist_item: {
      id: number;
      playlist_id: number;
      audio_id: number;
      order_index: number;
      created_at: string;
    };
    audio: AudioItem;
  }[];
};

export type Transcript = {
  transcript: {
    id: number;
    audio_id: number;
    language?: string;
    full_text: string;
    model_name?: string;
    status: string;
    generated_at: string;
    updated_at: string;
  };
  segments: {
    id: number;
    transcript_id: number;
    segment_index: number;
    start_seconds: number;
    end_seconds: number;
    text: string;
  }[];
};

export type AITask = {
  id: number;
  audio_id: number;
  task_type: "transcribe" | "analyze" | string;
  status: "pending" | "running" | "done" | "failed" | "canceled" | string;
  input_payload?: string;
  output_payload?: string;
  error_message?: string;
  retry_count: number;
  created_at: string;
  started_at?: string;
  finished_at?: string;
  updated_at: string;
  privacy_warning?: string;
};

export type ScanTask = {
  id: number;
  root_id: number;
  status: "pending" | "running" | "done" | "failed" | "canceled" | string;

  total_files: number;
  processed_files: number;

  imported: number;
  updated: number;
  missing: number;

  error_message?: string;

  created_at: string;
  started_at?: string;
  finished_at?: string;
  updated_at: string;
};

export type AISuggestions = {
  task_id: number | null;
  description?: string;
  tags: string[];
  language?: string;
  raw_content?: string;
};

export type LLMConfigPayload = {
  endpoint: string;
  model_name: string;
  api_key?: string;
  timeout: number;
  max_tokens?: number;
  temperature?: number;
};

export type LLMTestResult = {
  ok: boolean;
  content: string;
  is_local_endpoint?: boolean;
  privacy_warning?: string;
};

export type BatchTaskResult = {
  created: number;
  skipped: number;
  privacy_warning?: string;
  errors: {
    audio_id: number;
    error: string;
  }[];
  tasks: AITask[];
};

export function displayTitle(a: AudioItem): string {
  return a.title_user || a.title_original || a.file_name;
}

export function displayAuthor(a: AudioItem): string {
  return a.author_user || a.author_original || "";
}

export function displayDescription(a: AudioItem): string {
  return a.description_user || a.description_ai || a.description_original || "";
}

export function formatDuration(seconds?: number): string {
  if (!seconds && seconds !== 0) return "--:--";

  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;

  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }

  return `${m}:${String(sec).padStart(2, "0")}`;
}
