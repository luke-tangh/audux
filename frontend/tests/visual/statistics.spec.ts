import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const NOW = "2026-08-18T12:00:00";

const STATISTICS = {
  generated_at: NOW,
  period_days: 30,
  period_started_at: "2026-07-20T00:00:00",
  library: {
    total_items: 1284,
    playable_items: 1260,
    missing_items: 24,
    disabled_items: 0,
    detached_items: 0,
    favorite_items: 82,
    ai_failed_items: 5,
    total_duration_seconds: 1_174_000,
    total_size_bytes: 51_753_687_091,
    total_play_count: 3721
  },
  coverage: {
    transcript: { count: 924, total: 1284 },
    description: { count: 1012, total: 1284 },
    tags: { count: 1104, total: 1284 },
    cover: { count: 870, total: 1284 },
    metadata: { count: 1190, total: 1284 }
  },
  formats: [
    { format: "mp3", count: 810, duration_seconds: 700_000, size_bytes: 30_000_000_000 },
    { format: "m4a", count: 274, duration_seconds: 300_000, size_bytes: 8_000_000_000 },
    { format: "flac", count: 200, duration_seconds: 174_000, size_bytes: 13_753_687_091 }
  ],
  duration_buckets: [
    { key: "under_5m", count: 210 },
    { key: "5_to_20m", count: 420 },
    { key: "20_to_60m", count: 514 },
    { key: "over_60m", count: 140 }
  ],
  roots: [{
    id: 1,
    path: "/Users/example/Audio Knowledge Base",
    is_enabled: true,
    item_count: 1284,
    missing_count: 24,
    duration_seconds: 1_174_000,
    size_bytes: 51_753_687_091
  }],
  top_tags: [
    { id: 1, name: "访谈", item_count: 184 },
    { id: 2, name: "技术", item_count: 142 },
    { id: 3, name: "待复习", item_count: 96 }
  ],
  ingest_timeline: Array.from({ length: 12 }, (_, index) => ({
    period: `${index < 4 ? 2025 : 2026}-${String(((index + 8) % 12) + 1).padStart(2, "0")}`,
    count: 30 + index * 8
  })),
  listening: {
    event_count: 42,
    listened_seconds: 64_800,
    completed_count: 18,
    unique_audio_count: 27,
    active_days: 12,
    top_audio: [{
      audio_id: 1,
      title: "关于本地优先软件的深度访谈",
      author: "Local First Podcast",
      event_count: 4,
      listened_seconds: 14_400
    }],
    recent_events: [{
      event_id: 8,
      audio_id: 1,
      title: "关于本地优先软件的深度访谈",
      author: "Local First Podcast",
      started_at: NOW,
      listened_seconds: 3600,
      completed: true
    }],
    daily: [
      { date: "2026-08-16", event_count: 3, listened_seconds: 3600, completed_count: 1 },
      { date: "2026-08-17", event_count: 5, listened_seconds: 7200, completed_count: 2 },
      { date: "2026-08-18", event_count: 2, listened_seconds: 5400, completed_count: 1 }
    ]
  }
};

async function mockStatisticsApi(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("audux-language", "zh-CN");
  });
  await page.route("http://127.0.0.1:8765/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, X-Audux-Client, X-Audux-Token",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS"
    };

    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers });
    } else if (url.pathname === "/health") {
      await route.fulfill({ json: { status: "ok" }, headers });
    } else if (url.pathname === "/auth/token") {
      await route.fulfill({ json: { token: "statistics-test-token" }, headers });
    } else if (url.pathname === "/statistics/overview") {
      await route.fulfill({
        json: { ...STATISTICS, period_days: Number(url.searchParams.get("days") || 30) },
        headers
      });
    } else if (["/tags", "/playlists", "/saved-views"].includes(url.pathname)) {
      await route.fulfill({ json: [], headers });
    } else if (url.pathname === "/library-roots") {
      await route.fulfill({
        json: [{
          id: 1,
          path: "/Users/example/Audio Knowledge Base",
          is_enabled: true,
          created_at: NOW,
          updated_at: NOW
        }],
        headers
      });
    } else if (url.pathname === "/activities") {
      await route.fulfill({
        json: { items: [], active_count: 0, failed_count: 0 },
        headers
      });
    } else if (url.pathname === "/audio-items") {
      await route.fulfill({
        json: { items: [], total: 0, limit: 120, offset: 0, has_more: false },
        headers
      });
    } else if (url.pathname === "/audio-items/playback-queue/resolve") {
      await route.fulfill({ json: { items: [], skipped: [] }, headers });
    } else {
      await route.fulfill({ status: 404, json: { detail: url.pathname }, headers });
    }
  });
}

test.describe("statistics dashboard", () => {
  test("shows actionable library and listening insights", async ({ page }) => {
    await mockStatisticsApi(page);
    await page.goto("/");
    await page.getByRole("button", { name: /统计.*馆藏与聆听概览/ }).click();

    await expect(page.getByRole("heading", { name: "资料库统计" })).toBeVisible();
    await expect(page.locator(".statistics-kpi strong")).toHaveText([
      "1,284",
      "326 小时",
      "48.2 GB",
      "3,721"
    ]);
    await expect(page.getByRole("heading", { name: "聆听历史" })).toBeVisible();
    await expect(page.getByText("关于本地优先软件的深度访谈")).toHaveCount(2);

    await page.getByRole("button", { name: "90 天" }).click();
    await expect(page.getByRole("button", { name: "90 天" })).toHaveClass(/ui-button-filled/);

    await page.getByRole("button", { name: /24 个文件缺失/ }).click();
    await expect(page.getByRole("heading", { name: "文件缺失" })).toBeVisible();
  });

  test("uses a single-column dashboard on compact screens", async ({ page }) => {
    await page.setViewportSize({ width: 720, height: 900 });
    await mockStatisticsApi(page);
    await page.goto("/");
    await page.getByRole("button", { name: "打开导航" }).click();
    await page.getByRole("button", { name: "统计", exact: true }).click();

    await expect(page.getByRole("heading", { name: "资料库统计" })).toBeVisible();
    await expect.poll(() => page.locator(".statistics-dashboard-grid").evaluate(
      (element) => getComputedStyle(element).gridTemplateColumns.split(" ").length
    )).toBe(1);
    await expect(page.getByRole("group", { name: "聆听统计时间范围" })).toBeVisible();
  });
});
