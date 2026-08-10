import type { ScanTask } from "../../types";

export function scanProgress(task: ScanTask): number {
  if (!task.total_files) return 0;
  return Math.round((task.processed_files / task.total_files) * 100);
}

export function terminalStatus(status: string): boolean {
  return status === "done" || status === "failed" || status === "canceled";
}

export function validCaseGlossary(value: string): boolean {
  if (value.length > 20_000) return false;

  const sources = new Set<string>();
  for (const rawLine of value.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separator = line.indexOf("=");
    const source = (separator >= 0 ? line.slice(0, separator) : line).trim();
    const canonical = (separator >= 0 ? line.slice(separator + 1) : line).trim();
    if (!source || !canonical || source.length > 100 || canonical.length > 100) {
      return false;
    }

    sources.add(source.toLowerCase());
    if (sources.size > 500) return false;
  }

  return true;
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
