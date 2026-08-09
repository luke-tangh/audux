import type { ScanTask } from "../../types";

export function scanProgress(task: ScanTask): number {
  if (!task.total_files) return 0;
  return Math.round((task.processed_files / task.total_files) * 100);
}

export function terminalStatus(status: string): boolean {
  return status === "done" || status === "failed" || status === "canceled";
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "-";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${unit}`;
}
