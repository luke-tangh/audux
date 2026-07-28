export type ViewMode =
  | "library"
  | "favorites"
  | "playlist"
  | "settings"
  | "missingDescription"
  | "transcribed"
  | "missing"
  | "aiFailed";

export type TranscriptFilter = "all" | "yes" | "no";
export type MissingFilter = "all" | "available" | "missing";

export type AudioListParams = Parameters<typeof import("../../api").api.listAudioItems>[0];
export type PlaylistListParams = Parameters<typeof import("../../api").api.listPlaylistItems>[1];
