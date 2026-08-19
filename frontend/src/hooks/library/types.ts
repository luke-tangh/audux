export type ViewMode =
  | "library"
  | "favorites"
  | "playlist"
  | "statistics"
  | "agent"
  | "settings"
  | "missingDescription"
  | "transcribed"
  | "missing"
  | "aiFailed";

export type TranscriptFilter = "all" | "yes" | "no";
export type MissingFilter = "all" | "available" | "missing" | "aiFailed";
export type SortMode = AudioSortMode;

export type AudioListParams = Parameters<typeof import("../../api").api.listAudioItems>[0];
export type PlaylistListParams = Parameters<typeof import("../../api").api.listPlaylistItems>[1];
import type { AudioSortMode } from "../../types";
