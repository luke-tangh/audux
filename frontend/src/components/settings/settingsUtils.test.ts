import { describe, expect, it } from "vitest";

import type { ScanTask } from "../../types";
import { formatFileSize, scanProgress, terminalStatus } from "./settingsUtils";

function scanTask(totalFiles: number, processedFiles: number): ScanTask {
  return {
    id: 1,
    root_id: 1,
    status: "running",
    total_files: totalFiles,
    processed_files: processedFiles,
    imported: 0,
    updated: 0,
    missing: 0,
    created_at: "2026-08-10T00:00:00Z",
    updated_at: "2026-08-10T00:00:00Z"
  };
}

describe("settings utilities", () => {
  it("formats database backup sizes", () => {
    expect(formatFileSize(0)).toBe("0 B");
    expect(formatFileSize(1024)).toBe("1.00 KB");
    expect(formatFileSize(5 * 1024 * 1024)).toBe("5.00 MB");
    expect(formatFileSize(-1)).toBe("-");
  });

  it("computes rounded scan progress and handles an unknown total", () => {
    expect(scanProgress(scanTask(0, 0))).toBe(0);
    expect(scanProgress(scanTask(3, 2))).toBe(67);
  });

  it("classifies only terminal task states", () => {
    expect(["done", "failed", "canceled"].every(terminalStatus)).toBe(true);
    expect(terminalStatus("running")).toBe(false);
    expect(terminalStatus("cancel_requested")).toBe(false);
  });
});
