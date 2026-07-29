export type ToastType = "info" | "success" | "error";
export type SettingsTab = "library" | "asr" | "llm" | "tasks" | "maintenance" | "logs";

export const SETTINGS_TABS: { id: SettingsTab; label: string }[] = [
  { id: "library", label: "媒体库" },
  { id: "asr", label: "ASR" },
  { id: "llm", label: "LLM" },
  { id: "tasks", label: "任务" },
  { id: "maintenance", label: "维护" },
  { id: "logs", label: "日志" }
];

export const THEME_OPTIONS = [
  { value: "system", label: "跟随系统" },
  { value: "dark", label: "深色" },
  { value: "light", label: "浅色" }
] as const;
