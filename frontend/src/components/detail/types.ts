import type { AudioItem } from "../../types";

export type ToastType = "info" | "success" | "error";
export type InspectorTab = "overview" | "ai" | "transcript" | "file";
export type NumericSelection = number | "";

export const INSPECTOR_TABS: { id: InspectorTab; label: string }[] = [
  { id: "overview", label: "概览" },
  { id: "ai", label: "AI" },
  { id: "transcript", label: "Transcript" },
  { id: "file", label: "文件" }
];

export type EditingPatch = Partial<AudioItem>;
