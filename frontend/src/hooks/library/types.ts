export type ViewMode =
  | "library"
  | "favorites"
  | "playlist"
  | "statistics"
  | "agent"
  | "organization"
  | "settings"
  | "missingDescription"
  | "transcribed"
  | "missing"
  | "aiFailed";

export type TranscriptFilter = "all" | "yes" | "no";
export type MissingFilter = "all" | "available" | "missing" | "aiFailed";
export type SortMode = AudioSortMode;

export type AudioListParams = import("../../types").AudioListQuery;
export type PlaylistListParams = import("../../types").PlaylistListQuery;
import type { AudioSortMode } from "../../types";
