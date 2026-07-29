import type { ScanTask } from "../../types";

export function scanProgress(task: ScanTask): number {
  if (!task.total_files) return 0;
  return Math.round((task.processed_files / task.total_files) * 100);
}

export function terminalStatus(status: string): boolean {
  return status === "done" || status === "failed" || status === "canceled";
}
