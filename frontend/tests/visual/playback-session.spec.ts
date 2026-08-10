import { expect, test } from "@playwright/test";
import type { Page, Request } from "@playwright/test";

const NOW = "2026-08-08T00:00:00Z";
const SESSION_KEY = "local-audio-library-playback-session";

const AUDIO_ITEMS = [
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
    created_at: NOW,
    updated_at: NOW
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
    created_at: NOW,
    updated_at: NOW
  }
];

type MockPlaybackState = {
  playCountRequests: number;
  savedPositions: Array<{ audioId: number; position: number }>;
  unavailableIds: Set<number>;
};

function parseBody(request: Request): Record<string, unknown> {
  const body = request.postData();
  return body ? JSON.parse(body) as Record<string, unknown> : {};
}

async function mockPlaybackApi(page: Page, state: MockPlaybackState) {
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
      await route.fulfill({ json: { token: "playback-session-token" }, headers });
      return;
    }

    if (url.pathname === "/tags" || url.pathname === "/playlists") {
      await route.fulfill({ json: [], headers });
      return;
    }

    if (url.pathname === "/audio-items/playback-queue/resolve") {
      const ids = (parseBody(request).audio_ids as number[]) || [];
      const items = ids
        .map((id) =>
          state.unavailableIds.has(id)
            ? undefined
            : AUDIO_ITEMS.find((item) => item.id === id)
        )
        .filter((item): item is (typeof AUDIO_ITEMS)[number] => Boolean(item));
      const skipped = ids
        .filter(
          (id) =>
            state.unavailableIds.has(id) ||
            !AUDIO_ITEMS.some((item) => item.id === id)
        )
        .map((audioId) => ({
          audio_id: audioId,
          reason: state.unavailableIds.has(audioId) ? "disabled_root" : "deleted"
        }));

      await route.fulfill({ json: { items, skipped }, headers });
      return;
    }

    if (url.pathname === "/audio-items") {
      await route.fulfill({
        json: {
          items: AUDIO_ITEMS,
          total: AUDIO_ITEMS.length,
          limit: 120,
          offset: 0,
          has_more: false
        },
        headers
      });
      return;
    }

    if (url.pathname.endsWith("/play-count")) {
      state.playCountRequests += 1;
      await route.fulfill({ json: { ok: true }, headers });
      return;
    }

    const positionMatch = url.pathname.match(
      /^\/audio-items\/(\d+)\/playback-position$/
    );
    if (positionMatch) {
      state.savedPositions.push({
        audioId: Number(positionMatch[1]),
        position: Number(parseBody(request).last_position_seconds)
      });
      await route.fulfill({ json: { ok: true }, headers });
      return;
    }

    if (url.pathname.endsWith("/ai-suggestions")) {
      await route.fulfill({ json: { task_id: null, tags: [] }, headers });
      return;
    }

    if (url.pathname.endsWith("/file")) {
      await route.fulfill({
        status: 200,
        contentType: "application/octet-stream",
        body: Buffer.from("invalid test audio"),
        headers
      });
      return;
    }

    const detailMatch = url.pathname.match(/^\/audio-items\/(\d+)$/);
    if (detailMatch) {
      const item = AUDIO_ITEMS.find((row) => row.id === Number(detailMatch[1]));
      await route.fulfill({ json: { audio: item, tags: [] }, headers });
      return;
    }

    await route.fulfill({ status: 204, headers });
  });
}

async function storedSession(page: Page) {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  }, SESSION_KEY);
}

test.describe("playback queue session", () => {
  test("restores, filters and persists keyboard and drag ordering", async ({ page }) => {
    const state: MockPlaybackState = {
      playCountRequests: 0,
      savedPositions: [],
      unavailableIds: new Set()
    };
    await page.addInitScript(({ key }) => {
      if (window.localStorage.getItem(key)) return;
      window.localStorage.setItem(
        key,
        JSON.stringify({
          version: 1,
          audio_ids: [2, 999, 1],
          current_audio_id: 2
        })
      );
    }, { key: SESSION_KEY });
    await mockPlaybackApi(page, state);
    await page.goto("/");

    await expect(page.getByText("已恢复播放队列，并跳过 1 个不可用项目。")).toBeVisible();
    await expect(page.locator(".player-now-card strong")).toHaveText("测试音频 2");
    await expect(page.getByRole("button", { name: "开始播放" })).toBeVisible();
    expect(state.playCountRequests).toBe(0);

    await page.getByRole("button", { name: "打开播放队列" }).click();
    const queueTitles = page.locator("#player-queue-popover .queue-title");
    await expect(queueTitles).toHaveText(["测试音频 2", "测试音频 1"]);

    const firstHandle = page.getByRole("button", {
      name: "调整 测试音频 2 的队列顺序"
    });
    await firstHandle.press("ArrowDown");
    await expect(queueTitles).toHaveText(["测试音频 1", "测试音频 2"]);
    await expect.poll(() => storedSession(page)).toMatchObject({
      audio_ids: [1, 2],
      current_audio_id: 2
    });

    const movedHandle = page.getByRole("button", {
      name: "调整 测试音频 2 的队列顺序"
    });
    const firstRow = page.locator("#player-queue-popover .queue-row").first();
    const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
    await movedHandle.dispatchEvent("dragstart", { dataTransfer });
    await firstRow.dispatchEvent("dragover", { dataTransfer });
    await firstRow.dispatchEvent("drop", { dataTransfer });
    await movedHandle.dispatchEvent("dragend", { dataTransfer });
    await expect(queueTitles).toHaveText(["测试音频 2", "测试音频 1"]);
    await expect.poll(() => storedSession(page)).toMatchObject({
      audio_ids: [2, 1],
      current_audio_id: 2
    });

    await page.reload();
    await page.getByRole("button", { name: "打开播放队列" }).click();
    await expect(page.locator("#player-queue-popover .queue-title")).toHaveText([
      "测试音频 2",
      "测试音频 1"
    ]);
    await expect(
      page.locator('#player-queue-popover .queue-row-main[aria-current="true"]')
    ).toContainText("测试音频 2");

    state.unavailableIds.add(2);
    await page.getByRole("combobox", { name: "按资料库文件筛选" }).click();
    await page.getByRole("option", { name: "已有转写文本" }).click();
    await expect(page.getByText("播放队列已更新，并移除 1 个不可用项目。")).toBeVisible();
    await page.getByRole("button", { name: "打开播放队列" }).click();
    await expect(page.locator("#player-queue-popover .queue-title")).toHaveText([
      "测试音频 1"
    ]);
    await expect(
      page.locator('#player-queue-popover .queue-row-main[aria-current="true"]')
    ).toContainText("测试音频 1");
  });

  test("offers list and detail enqueue actions", async ({ page }) => {
    const state: MockPlaybackState = {
      playCountRequests: 0,
      savedPositions: [],
      unavailableIds: new Set()
    };
    await mockPlaybackApi(page, state);
    await page.goto("/");

    await page.getByRole("button", { name: "加入播放队列 测试音频 1" }).click();
    await page.getByRole("button", { name: "将 测试音频 2 设为下一首播放" }).click();
    await page.getByRole("button", { name: "打开播放队列" }).click();
    await expect(page.locator("#player-queue-popover .queue-title")).toHaveText([
      "测试音频 2",
      "测试音频 1"
    ]);

    await page.getByRole("button", { name: "关闭播放队列" }).click();
    await expect(page.getByRole("button", { name: "下一首播放", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "加入队列", exact: true })).toBeVisible();
  });

  test("stops without clearing and clears only after confirmation", async ({ page }) => {
    const state: MockPlaybackState = {
      playCountRequests: 0,
      savedPositions: [],
      unavailableIds: new Set()
    };
    await page.addInitScript(({ key }) => {
      window.localStorage.setItem(
        key,
        JSON.stringify({
          version: 1,
          audio_ids: [1, 2],
          current_audio_id: 1
        })
      );
    }, { key: SESSION_KEY });
    await mockPlaybackApi(page, state);
    await page.goto("/");

    await expect(page.locator(".player-now-card strong")).toHaveText("测试音频 1");
    await page.getByRole("button", { name: "停止播放并回到开头" }).click();

    await expect.poll(() => state.savedPositions).toContainEqual({
      audioId: 1,
      position: 0
    });
    await expect.poll(() => storedSession(page)).toMatchObject({
      audio_ids: [1, 2],
      current_audio_id: 1
    });
    await expect(page.locator(".player-now-card strong")).toHaveText("测试音频 1");

    await page.getByRole("button", { name: "打开播放队列" }).click();
    await page.getByRole("button", { name: "清空播放队列" }).click();
    const dialog = page.getByRole("dialog", { name: "清空播放队列？" });
    await expect(dialog).toContainText("若只想停止当前音频");
    await dialog.getByRole("button", { name: "清空队列" }).click();

    await expect(page.getByRole("button", { name: "打开播放队列" })).toBeDisabled();
    await expect(page.locator(".player-now-card strong")).toHaveText("选择一个音频开始播放");
    await expect.poll(() => storedSession(page)).toBeNull();
  });
});
