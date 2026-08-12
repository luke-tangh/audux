import type { Page, Request } from "@playwright/test";

const NOW = "2026-08-08T00:00:00Z";

export const PLAYER_AUDIO_ITEMS = [
  {
    id: 901,
    file_path: "/library/player-one.mp3",
    file_name: "player-one.mp3",
    title_user: "一段很长的访谈标题：关于本地优先音频工作流",
    author_user: "示例作者",
    duration_seconds: 3723,
    transcript_status: "none",
    ai_status: "none",
    play_count: 0,
    last_position_seconds: 97,
    is_favorite: false,
    is_missing: false,
    created_at: NOW,
    updated_at: NOW
  },
  {
    id: 902,
    file_path: "/library/player-two.mp3",
    file_name: "player-two.mp3",
    title_user: "第二段音频",
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
] as const;

function parseBody(request: Request): Record<string, unknown> {
  const body = request.postData();
  return body ? JSON.parse(body) as Record<string, unknown> : {};
}

export async function mockPlayerBar(page: Page) {
  await page.addInitScript(({ ids }) => {
    window.localStorage.setItem(
      "local-audio-library-playback-session",
      JSON.stringify({
        version: 1,
        audio_ids: ids,
        current_audio_id: ids[0]
      })
    );
  }, { ids: PLAYER_AUDIO_ITEMS.map((item) => item.id) });

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
      await route.fulfill({ json: { token: "player-visual-token" }, headers });
      return;
    }

    if (url.pathname === "/tags" || url.pathname === "/playlists") {
      await route.fulfill({ json: [], headers });
      return;
    }

    if (url.pathname === "/audio-items/playback-queue/resolve") {
      const requestedIds = (parseBody(request).audio_ids as number[]) || [];
      const items = requestedIds
        .map((id) => PLAYER_AUDIO_ITEMS.find((item) => item.id === id))
        .filter((item): item is (typeof PLAYER_AUDIO_ITEMS)[number] => Boolean(item));
      await route.fulfill({ json: { items, skipped: [] }, headers });
      return;
    }

    if (url.pathname === "/audio-items") {
      await route.fulfill({
        json: {
          items: PLAYER_AUDIO_ITEMS,
          total: PLAYER_AUDIO_ITEMS.length,
          limit: 120,
          offset: 0,
          has_more: false
        },
        headers
      });
      return;
    }

    if (url.pathname.endsWith("/file")) {
      await route.fulfill({
        status: 200,
        contentType: "application/octet-stream",
        body: Buffer.from("invalid visual-test audio"),
        headers
      });
      return;
    }

    await route.fulfill({ status: 204, headers });
  });
}
