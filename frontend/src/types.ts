export type LibraryRoot = {
  id: number;
  path: string;
  is_enabled: boolean;
  created_at: string;
  updated_at: string;
};

export type AudioSortMode =
  | "default"
  | "title_asc"
  | "title_desc"
  | "author_asc"
  | "created_desc"
  | "updated_desc"
  | "duration_asc"
  | "duration_desc"
  | "play_count_desc";

export type SavedViewMode =
  | "library"
  | "favorites"
  | "missingDescription"
  | "transcribed"
  | "missing"
  | "aiFailed";

export type SavedViewQuery = {
  schema_version: 1;
  view: SavedViewMode;
  q: string;
  tag_id: number | null;
  library_root_id: number | null;
  transcript_filter: "all" | "yes" | "no";
  missing_filter: "all" | "available" | "missing";
  sort: AudioSortMode;
  display_mode: "list";
};

export type SavedView = {
  id: number;
  name: string;
  schema_version: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
  query: SavedViewQuery | null;
  tag_name: string | null;
  library_root_path: string | null;
  invalid_references: Array<"tag" | "library_root" | string>;
  definition_error: string | null;
};

export type Tag = {
  id: number;
  name: string;
  source: string;
  created_at: string;
};

export type TagMergeResult = {
  ok: boolean;
  target_tag: Tag;
  affected_audio_items: number;
  created_links: number;
};

export type SearchHit = {
  field: "title" | "author" | "description" | "tags" | "transcript" | string;
  label: string;
  text: string;
  start_seconds?: number;
  end_seconds?: number;
  segment_index?: number;
  context_before?: string;
  context_after?: string;
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

export type PaginatedAudioItems = {
  items: AudioItem[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
  search_limited?: boolean;
  search_limit?: number | null;
  playlist_kind?: "manual" | "smart";
  refreshed_at?: string | null;
};

export type AudioDetail = {
  audio: AudioItem;
  tags: Tag[];
};

export type PlaybackQueueResolution = {
  items: AudioItem[];
  skipped: Array<{
    audio_id: number;
    reason: "deleted" | "missing" | "disabled_root" | "duplicate" | string;
  }>;
};

export type Playlist = {
  id: number;
  name: string;
  description?: string;
  kind?: "manual" | "smart";
  query_schema_version?: number | null;
  last_refreshed_at?: string | null;
  query?: SavedViewQuery | null;
  tag_name?: string | null;
  library_root_path?: string | null;
  invalid_references?: Array<"tag" | "library_root">;
  definition_error?: string | null;
  current_count?: number | null;
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

export type TranscriptSegment = {
  id: number;
  transcript_id: number;
  segment_index: number;
  start_seconds: number;
  end_seconds: number;
  text: string;
};

export type TranscriptSegmentEdit = Pick<TranscriptSegment, "id" | "text">;

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
  segments: TranscriptSegment[];
  cleared_segments?: number;
  updated_segments?: number;
};

export type AITask = {
  id: number;
  audio_id: number;
  task_type: "transcribe" | "analyze" | string;
  status: "pending" | "running" | "done" | "failed" | "canceled" | string;
  input_payload?: string;
  output_payload?: string;
  error_message?: string;
  error_code?: string;
  error_params?: string;
  retry_count: number;
  created_at: string;
  started_at?: string;
  finished_at?: string;
  updated_at: string;
  privacy_warning?: string;
  privacy_warning_code?: string;
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
  error_code?: string;
  error_params?: string;

  created_at: string;
  started_at?: string;
  finished_at?: string;
  updated_at: string;
};

export type LibraryHealthTask = {
  id: number;
  task_type: "health_check" | "duplicate_hash" | string;
  status: "pending" | "running" | "done" | "failed" | "canceled" | "cancel_requested" | string;
  input: { audio_ids?: number[] };
  result?: {
    confirmed_groups?: LibraryDuplicateGroup[];
    errors?: Array<{ audio_id: number; code: string; error?: string }>;
  } | null;
  total_items: number;
  processed_items: number;
  error_message?: string;
  error_code?: string;
  created_at: string;
  started_at?: string;
  finished_at?: string;
  updated_at: string;
};

export type LibraryDuplicateAudio = {
  id: number;
  title: string;
  file_path: string;
  library_root_id?: number | null;
};

export type LibraryDuplicateGroup = {
  candidate_key?: string;
  reason?: string;
  hash_prefix?: string;
  file_size?: number;
  duration_seconds?: number;
  title?: string;
  audio_items: LibraryDuplicateAudio[];
};

export type LibraryHealthRoot = {
  root: LibraryRoot;
  path_available: boolean;
  database_total: number;
  available: number;
  missing: number;
  unsupported_count: number | null;
  unsupported_examples: string[];
  supported_files_on_disk: number | null;
  failed_scan_count: number;
  latest_scan: ScanTask | null;
};

export type MissingAudioHealthItem = {
  id: number;
  title: string;
  file_path: string;
  library_root_id?: number | null;
  file_size?: number | null;
  duration_seconds?: number | null;
  updated_at: string;
};

export type LibraryHealthSummary = {
  generated_at: string | null;
  roots: LibraryHealthRoot[];
  totals: {
    roots: number;
    disabled_roots: number;
    available: number;
    missing: number;
    unsupported: number;
    scan_failures: number;
    duplicate_groups: number;
    detached_audio: number;
  };
  missing_audio: MissingAudioHealthItem[];
  duplicate_groups: LibraryDuplicateGroup[];
  active_tasks: LibraryHealthTask[];
  latest_task: LibraryHealthTask | null;
};

export type SafeRelinkCandidate = {
  path: string;
  library_root_id: number;
  library_root_path: string;
  file_size: number;
  mtime_ns: number;
  duration_seconds?: number | null;
  title?: string | null;
  author?: string | null;
  album?: string | null;
  checks: {
    size: boolean | null;
    duration: boolean | null;
    metadata: boolean | null;
    fingerprint: boolean | null;
  };
  eligible: boolean;
  confidence: "high" | "medium" | "rejected";
  conflict_audio_id?: number | null;
};

export type SafeRelinkCandidates = {
  audio: MissingAudioHealthItem;
  candidates: SafeRelinkCandidate[];
};

export type SafeRelinkPreview = {
  audio: { id: number; title: string; old_path: string; updated_at: string };
  candidate: SafeRelinkCandidate;
  impacts: {
    transcript_preserved: boolean;
    transcript_segments: number;
    tags_preserved: number;
    manual_playlists_preserved: number;
    cover_preserved: boolean;
    cover_source?: string | null;
    play_count_preserved: number;
    playback_position_preserved: number;
    user_metadata_preserved: boolean;
    files_deleted: number;
    database_records_deleted: number;
  };
  confirmation: {
    expected_audio_updated_at: string;
    expected_file_size: number;
    expected_mtime_ns: number;
  };
};

export type WhisperComponentStatus = {
  status: "not_installed" | "downloading" | "installing" | "installed" | "failed";
  available: boolean;
  source: "component" | "development" | null;
  app_version: string;
  target: string;
  downloaded_bytes: number;
  total_bytes: number | null;
  error_message: string | null;
};

export type ExternalAsrPreprocessingStatus = {
  available: boolean;
  ffmpeg_available: boolean;
  ffprobe_available: boolean;
  missing: string[];
};

export type DatabaseBackup = {
  id: string;
  name: string;
  kind: "manual" | "pre_migration" | "pre_restore" | string;
  created_at: string;
  app_version: string | null;
  schema_version: number | null;
  size_bytes: number;
  integrity_status: "unchecked" | "valid" | "invalid" | string;
  integrity_error: string | null;
  sha256: string | null;
  restore_compatible: boolean;
  compatibility_error: string | null;
};

export type DatabaseRestoreBlocker = {
  code: string;
  message: string;
  params?: Record<string, unknown>;
};

export type DatabaseRestorePreflight = {
  ok: boolean;
  backup: DatabaseBackup;
  blockers: DatabaseRestoreBlocker[];
  active_ai_tasks: number;
  active_scan_tasks: number;
  active_health_tasks: number;
  required_bytes: number;
  free_bytes: number;
  restart_required: boolean;
};

export type PendingDatabaseRestore = {
  snapshot_id: string;
  safety_snapshot_id: string;
  requested_at: string;
};

export type DatabaseRestoreResult = {
  status: "succeeded" | "failed" | "rolled_back" | "rollback_failed" | string;
  snapshot_id: string | null;
  safety_snapshot_id: string | null;
  requested_at: string | null;
  completed_at: string;
  error: string | null;
};

export type DatabaseRestoreStatus = {
  pending: PendingDatabaseRestore | null;
  last_result: DatabaseRestoreResult | null;
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
  privacy_warning_code?: string;
};

export type BatchTaskResult = {
  created: number;
  skipped: number;
  privacy_warning?: string;
  privacy_warning_code?: string;
  errors: {
    audio_id: number;
    error: string;
  }[];
  task_ids?: number[];
  /**
   * Kept optional for compatibility with older backend responses.
   * New batch endpoints return task_ids only to avoid huge responses.
   */
  tasks?: AITask[];
};

export type BatchOrganizationAction =
  | "add_tags"
  | "remove_tags"
  | "add_to_playlist"
  | "set_favorite";

export type BatchOrganizationPayload = {
  audio_ids: number[];
  action: BatchOrganizationAction;
  tag_names?: string[];
  tag_ids?: number[];
  playlist_id?: number;
  is_favorite?: boolean;
};

export type BatchOrganizationResult = {
  action: BatchOrganizationAction;
  requested_count: number;
  matched_count: number;
  changed_count: number;
  unchanged_count: number;
  duplicate_count: number;
  relationship_changes: number;
  errors: Array<{
    audio_id: number;
    error: string;
  }>;
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
