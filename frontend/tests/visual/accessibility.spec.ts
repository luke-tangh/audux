import { expect, test } from "@playwright/test";

const MOCK_AUDIO_ITEMS = [
  {
    id: 1,
    file_path: "/library/one.mp3",
    file_name: "one.mp3",
    title_user: "测试音频 1",
    duration_seconds: 120,
    transcript_status: "none",
    ai_status: "none",
    play_count: 0,
    last_position_seconds: 0,
    is_favorite: false,
    is_missing: false,
    created_at: "2026-07-30T00:00:00Z",
    updated_at: "2026-07-30T00:00:00Z"
  },
  {
    id: 2,
    file_path: "/library/two.mp3",
    file_name: "two.mp3",
    title_user: "测试音频 2",
    duration_seconds: 180,
    transcript_status: "none",
    ai_status: "none",
    play_count: 0,
    last_position_seconds: 0,
    is_favorite: false,
    is_missing: false,
    created_at: "2026-07-30T00:00:00Z",
    updated_at: "2026-07-30T00:00:00Z"
  }
];

async function mockLibraryApi(page: import("@playwright/test").Page) {
  await page.route("http://127.0.0.1:8765/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers":
        "Content-Type, X-Local-Audio-Client, X-Local-Audio-Token",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS"
    };

    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers });
      return;
    }

    if (url.pathname === "/health") {
      await route.fulfill({ json: { status: "ok" }, headers });
      return;
    }

    if (url.pathname === "/auth/token") {
      await route.fulfill({ json: { token: "visual-test-token" }, headers });
      return;
    }

    if (url.pathname === "/tags" || url.pathname === "/playlists") {
      await route.fulfill({ json: [], headers });
      return;
    }

    if (url.pathname === "/audio-items") {
      await route.fulfill({
        json: {
          items: MOCK_AUDIO_ITEMS,
          total: MOCK_AUDIO_ITEMS.length,
          limit: 120,
          offset: 0,
          has_more: false
        },
        headers
      });
      return;
    }

    if (url.pathname.endsWith("/play-count")) {
      await route.fulfill({ json: { ok: true }, headers });
      return;
    }

    if (url.pathname.endsWith("/ai-suggestions")) {
      await route.fulfill({
        json: { task_id: null, tags: [] },
        headers
      });
      return;
    }

    if (url.pathname.endsWith("/file")) {
      await route.fulfill({
        status: 200,
        contentType: "audio/wav",
        body: Buffer.from(
          "UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=",
          "base64"
        ),
        headers
      });
      return;
    }

    const audioDetailMatch = url.pathname.match(/^\/audio-items\/(\d+)$/);

    if (audioDetailMatch) {
      const item = MOCK_AUDIO_ITEMS.find(
        (audioItem) => audioItem.id === Number(audioDetailMatch[1])
      );

      await route.fulfill({
        json: { audio: item, tags: [] },
        headers
      });
      return;
    }

    await route.fulfill({ status: 204, headers });
  });
}

test.describe("MD3 accessibility behavior", () => {
  test("applies the stored theme during bootstrap", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("local-audio-library-theme", "light");
    });

    await page.goto("/");

    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(page.locator("html")).toHaveAttribute("data-theme-mode", "light");
  });

  test("reduces motion when requested", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");

    const motion = await page.locator(".top-settings-button").evaluate((element) => {
      const style = window.getComputedStyle(element);
      const durationInSeconds = style.transitionDuration
        .split(",")
        .map((value) => {
          const duration = Number.parseFloat(value);
          return value.trim().endsWith("ms") ? duration / 1000 : duration;
        });

      return Math.max(...durationInSeconds);
    });

    expect(motion).toBeLessThanOrEqual(0.001);
  });

  test("closes an open SelectField menu when tabbing away", async ({ page }) => {
    await page.goto("/");

    const playbackRate = page.getByRole("combobox", { name: "播放速度" });
    await playbackRate.click();

    await expect(page.getByRole("listbox", { name: "播放速度" })).toBeVisible();
    await playbackRate.press("Tab");
    await expect(page.getByRole("listbox", { name: "播放速度" })).toBeHidden();
  });

  test("manages focus while opening and closing the playback queue", async ({
    page
  }) => {
    await mockLibraryApi(page);
    await page.goto("/");

    await page.getByRole("button", { name: "播放 测试音频 1" }).click();

    const openQueue = page.getByRole("button", { name: "打开播放队列" });
    await openQueue.click();

    const currentQueueItem = page.locator(
      '#player-queue-popover [aria-current="true"]'
    );
    await expect(currentQueueItem).toBeFocused();

    await currentQueueItem.press("Escape");

    const restoredTrigger = page.getByRole("button", { name: "打开播放队列" });
    await expect(restoredTrigger).toBeFocused();
    await expect(page.getByRole("dialog", { name: "播放队列" })).toBeHidden();

    await restoredTrigger.click();
    await expect(currentQueueItem).toBeFocused();

    const firstQueueControl = page.getByRole("button", {
      name: "清空播放队列"
    });
    await firstQueueControl.focus();
    await firstQueueControl.press("Shift+Tab");

    await expect(page.getByRole("dialog", { name: "播放队列" })).toBeHidden();
    await expect(page.getByRole("button", { name: "打开播放队列" })).toBeFocused();

    await page.getByRole("button", { name: "打开播放队列" }).click();

    const lastQueueControl = page
      .getByRole("button", { name: /从队列移除/ })
      .last();
    await lastQueueControl.focus();
    await lastQueueControl.press("Tab");

    await expect(page.getByRole("dialog", { name: "播放队列" })).toBeHidden();
  });
});
