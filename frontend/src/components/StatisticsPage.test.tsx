import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "../i18n/LocaleProvider";
import { useStatistics } from "../hooks/useStatistics";
import type { StatisticsOverview } from "../types";
import StatisticsPage from "./StatisticsPage";

vi.mock("../hooks/useStatistics", () => ({ useStatistics: vi.fn() }));

const overview: StatisticsOverview = {
  generated_at: "2026-08-18T12:00:00",
  period_days: 30,
  period_started_at: "2026-07-20T00:00:00",
  library: {
    total_items: 10,
    playable_items: 9,
    missing_items: 1,
    disabled_items: 0,
    detached_items: 0,
    favorite_items: 2,
    ai_failed_items: 1,
    total_duration_seconds: 36_000,
    total_size_bytes: 2_000_000_000,
    total_play_count: 21
  },
  coverage: {
    transcript: { count: 6, total: 10 },
    description: { count: 7, total: 10 },
    tags: { count: 8, total: 10 },
    cover: { count: 5, total: 10 },
    metadata: { count: 9, total: 10 }
  },
  formats: [
    { format: "mp3", count: 8, duration_seconds: 30_000, size_bytes: 1_500_000_000 },
    { format: "flac", count: 2, duration_seconds: 6_000, size_bytes: 500_000_000 }
  ],
  duration_buckets: [
    { key: "under_5m", count: 3 },
    { key: "over_60m", count: 2 }
  ],
  roots: [{
    id: 1,
    path: "/library",
    is_enabled: true,
    item_count: 10,
    missing_count: 1,
    duration_seconds: 36_000,
    size_bytes: 2_000_000_000
  }],
  top_tags: [{ id: 1, name: "工作", item_count: 4 }],
  ingest_timeline: [{ period: "2026-08", count: 10 }],
  listening: {
    event_count: 3,
    listened_seconds: 7_200,
    completed_count: 1,
    unique_audio_count: 2,
    active_days: 2,
    top_audio: [{
      audio_id: 1,
      title: "深度访谈",
      author: "作者",
      event_count: 2,
      listened_seconds: 5_400
    }],
    recent_events: [{
      event_id: 4,
      audio_id: 1,
      title: "深度访谈",
      author: "作者",
      started_at: "2026-08-18T11:00:00",
      listened_seconds: 1_800,
      completed: true
    }],
    daily: [{ date: "2026-08-18", event_count: 2, listened_seconds: 7_200, completed_count: 1 }]
  }
};

function renderPage(callbacks = {
  onOpenMissing: vi.fn(),
  onOpenUntranscribed: vi.fn(),
  onOpenMissingDescription: vi.fn(),
  onOpenAiFailed: vi.fn(),
  onOpenSettings: vi.fn()
}) {
  render(
    <LocaleProvider>
      <StatisticsPage {...callbacks} />
    </LocaleProvider>
  );
  return callbacks;
}

describe("StatisticsPage", () => {
  it("renders library, organization, distribution, and listening insights", () => {
    vi.mocked(useStatistics).mockReturnValue({
      data: overview,
      loading: false,
      error: "",
      refresh: vi.fn()
    });

    renderPage();

    expect(screen.getByRole("heading", { name: /资料库统计|Library statistics/ })).toBeInTheDocument();
    expect(screen.getByText("10", { selector: ".statistics-kpi strong" })).toBeInTheDocument();
    expect(screen.getByText("MP3")).toBeInTheDocument();
    expect(screen.getByText("#工作")).toBeInTheDocument();
    expect(screen.getAllByText("深度访谈")).toHaveLength(2);
    expect(screen.getByText(/已播完|Completed/, { selector: ".statistics-completed" })).toBeInTheDocument();
  });

  it("opens focused cleanup views and changes the listening period", () => {
    vi.mocked(useStatistics).mockImplementation((days) => ({
      data: { ...overview, period_days: days },
      loading: false,
      error: "",
      refresh: vi.fn()
    }));
    const callbacks = renderPage();

    fireEvent.click(screen.getByRole("button", { name: /文件缺失|missing files/i }));
    fireEvent.click(screen.getByRole("button", { name: /尚未转写|without transcripts/i }));
    fireEvent.click(screen.getByRole("button", { name: /缺少描述|without descriptions/i }));
    fireEvent.click(screen.getByRole("button", { name: /AI 处理失败|failed AI tasks/i }));
    fireEvent.click(screen.getByRole("button", { name: /7 天|7 days/i }));

    expect(callbacks.onOpenMissing).toHaveBeenCalledOnce();
    expect(callbacks.onOpenUntranscribed).toHaveBeenCalledOnce();
    expect(callbacks.onOpenMissingDescription).toHaveBeenCalledOnce();
    expect(callbacks.onOpenAiFailed).toHaveBeenCalledOnce();
    expect(useStatistics).toHaveBeenLastCalledWith(7);
  });

  it("shows an actionable empty state", () => {
    vi.mocked(useStatistics).mockReturnValue({
      data: { ...overview, library: { ...overview.library, total_items: 0 } },
      loading: false,
      error: "",
      refresh: vi.fn()
    });
    const callbacks = renderPage();

    fireEvent.click(screen.getByRole("button", { name: /打开资料库设置|Open library settings/ }));
    expect(callbacks.onOpenSettings).toHaveBeenCalledOnce();
  });
});
