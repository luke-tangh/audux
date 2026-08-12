import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "../../i18n/LocaleProvider";
import type {
  LibraryHealthSummary,
  MissingAudioHealthItem,
  SafeRelinkCandidate
} from "../../types";
import HealthSettingsTab from "./HealthSettingsTab";

const missing: MissingAudioHealthItem = {
  id: 7,
  title: "Moved recording",
  file_path: "/library/old.mp3",
  library_root_id: 1,
  file_size: 1234,
  duration_seconds: 60,
  updated_at: "2026-08-10T00:00:00"
};

const candidate: SafeRelinkCandidate = {
  path: "/library/new.mp3",
  library_root_id: 1,
  library_root_path: "/library",
  file_size: 1234,
  mtime_ns: 100,
  duration_seconds: 60,
  checks: { size: true, duration: true, metadata: null, fingerprint: true },
  eligible: true,
  confidence: "high",
  conflict_audio_id: null
};

const summary: LibraryHealthSummary = {
  generated_at: "2026-08-10T00:00:00",
  roots: [
    {
      root: {
        id: 1,
        path: "/library",
        is_enabled: true,
        created_at: "2026-08-10T00:00:00",
        updated_at: "2026-08-10T00:00:00"
      },
      path_available: true,
      database_total: 2,
      available: 1,
      missing: 1,
      unsupported_count: 0,
      unsupported_examples: [],
      supported_files_on_disk: 2,
      failed_scan_count: 0,
      latest_scan: null
    }
  ],
  totals: {
    roots: 1,
    disabled_roots: 0,
    available: 1,
    missing: 1,
    unsupported: 0,
    scan_failures: 0,
    duplicate_groups: 1,
    detached_audio: 0
  },
  missing_audio: [missing],
  duplicate_groups: [
    {
      candidate_key: "1234:60:title:",
      title: "Possible duplicate",
      audio_items: [
        { id: 8, title: "A", file_path: "/library/a.mp3" },
        { id: 9, title: "B", file_path: "/library/b.mp3" }
      ]
    }
  ],
  active_tasks: [],
  latest_task: null
};

describe("library health settings", () => {
  it("shows health data and exposes explicit repair actions", () => {
    const callbacks = {
      onRefresh: vi.fn(),
      onStartCheck: vi.fn(),
      onCancelTask: vi.fn(),
      onRetryTask: vi.fn(),
      onConfirmDuplicates: vi.fn(),
      onFindCandidates: vi.fn(),
      onRelink: vi.fn()
    };
    render(
      <LocaleProvider>
        <HealthSettingsTab
          summary={summary}
          tasks={[{
            id: 12,
            task_type: "duplicate_hash",
            status: "done",
            input: { audio_ids: [8, 9] },
            result: { confirmed_groups: [{
              hash_prefix: "abc123",
              audio_items: summary.duplicate_groups[0].audio_items
            }] },
            total_items: 2,
            processed_items: 2,
            created_at: "2026-08-10T00:00:00",
            finished_at: "2026-08-10T00:00:01",
            updated_at: "2026-08-10T00:00:01"
          }]}
          candidates={{ 7: [candidate] }}
          action={null}
          {...callbacks}
        />
      </LocaleProvider>
    );

    expect(screen.queryByText(/安全原则|Safety:/)).not.toBeInTheDocument();
    expect(screen.getByText("/library/old.mp3")).toBeInTheDocument();
    expect(screen.getByText("/library/new.mp3")).toBeInTheDocument();
    expect(screen.getByText(/确认 1 组|Confirmed 1 group/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /立即检查|Check now/ }));
    fireEvent.click(screen.getByRole("button", { name: /查找候选|Find candidates/ }));
    fireEvent.click(screen.getByRole("button", { name: /预览并关联|Preview and relink/ }));
    fireEvent.click(screen.getByRole("button", { name: /完整 Hash 确认|Confirm with full hash/ }));

    expect(callbacks.onStartCheck).toHaveBeenCalledOnce();
    expect(callbacks.onFindCandidates).toHaveBeenCalledWith(missing);
    expect(callbacks.onRelink).toHaveBeenCalledWith(missing, candidate);
    expect(callbacks.onConfirmDuplicates).toHaveBeenCalledWith(summary.duplicate_groups[0]);
  });
});
