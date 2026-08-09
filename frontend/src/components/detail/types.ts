import type { AudioItem } from "../../types";

export type ToastType = "info" | "success" | "error";
export type InspectorTab = "overview" | "ai" | "transcript" | "file";
export type NumericSelection = number | "";

export const INSPECTOR_TABS: InspectorTab[] = ["overview", "ai", "transcript", "file"];

export type EditingPatch = Partial<AudioItem>;
