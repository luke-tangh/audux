import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const NOW = "2026-08-08T00:00:00Z";

type Mutation = {
  method: string;
  path: string;
  body: unknown;
};

type MockState = {
  roots: Array<{
    id: number;
    path: string;
    is_enabled: boolean;
    created_at: string;
    updated_at: string;
    search_hits?: Array<{
      field: string;
      label: string;
      text: string;
      start_seconds?: number;
      end_seconds?: number;
      segment_index?: number;
      context_before?: string;
      context_after?: string;
    }>;
  }>;
  playlists: Array<{
    id: number;
    name: string;
    description?: string;
    created_at: string;
    updated_at: string;
  }>;
  tags: Array<{
    id: number;
    name: string;
    source: string;
    created_at: string;
  }>;
  audioItems: Array<{
    id: number;
    file_path: string;
    file_name: string;
    title_user: string;
    duration_seconds: number;
    transcript_status: string;
    ai_status: string;
    play_count: number;
    last_position_seconds: number;
    is_favorite: boolean;
    is_missing: boolean;
    created_at: string;
    updated_at: string;
    tags?: Array<{
      id: number;
      name: string;
      source: string;
      created_at: string;
    }>;
  }>;
  transcript: {
    transcript: {
      id: number;
      audio_id: number;
      language: string;
      full_text: string;
      model_name: string;
      status: string;
      generated_at: string;
      updated_at: string;
    };
    segments: Array<{
      id: number;
      transcript_id: number;
      segment_index: number;
      start_seconds: number;
      end_seconds: number;
      text: string;
    }>;
    cleared_segments?: number;
    updated_segments?: number;
  };
  mutations: Mutation[];
  batchErrors: Array<{ audio_id: number; error: string }>;
  transcriptConflictOnce: boolean;
  whisperStatus: "not_installed" | "downloading" | "installed";
  backups: Array<{
    id: string;
    name: string;
    kind: string;
    created_at: string;
    app_version: string;
    schema_version: number;
    size_bytes: number;
    integrity_status: string;
    integrity_error: null;
    sha256: string;
    restore_compatible: boolean;
    compatibility_error: null;
  }>;
  pendingRestore: null | {
    snapshot_id: string;
    safety_snapshot_id: string;
    requested_at: string;
  };
};

function createMockState(): MockState {
  return {
    roots: [
      {
        id: 7,
        path: "/library/podcasts",
        is_enabled: true,
        created_at: NOW,
        updated_at: NOW
      }
    ],
    playlists: [
      {
        id: 11,
        name: "晨间播放",
        description: "测试列表",
        created_at: NOW,
        updated_at: NOW
      }
    ],
    tags: [
      { id: 21, name: "待整理", source: "user", created_at: NOW },
      { id: 22, name: "知识", source: "user", created_at: NOW }
    ],
    audioItems: [
      {
        id: 1,
        file_path: "/library/podcasts/one.mp3",
        file_name: "one.mp3",
        title_user: "测试音频 1",
        duration_seconds: 120,
        transcript_status: "done",
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
        file_path: "/library/podcasts/two.mp3",
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
    ],
    transcript: {
      transcript: {
        id: 31,
        audio_id: 1,
        language: "zh",
        full_text: "开场内容\n原始分段文字\n收尾内容",
        model_name: "test-model",
        status: "done",
        generated_at: NOW,
        updated_at: NOW
      },
      segments: [
        {
          id: 40,
          transcript_id: 31,
          segment_index: 0,
          start_seconds: 0,
          end_seconds: 2.5,
          text: "开场内容"
        },
        {
          id: 41,
          transcript_id: 31,
          segment_index: 1,
          start_seconds: 2.5,
          end_seconds: 5,
          text: "原始分段文字"
        },
        {
          id: 42,
          transcript_id: 31,
          segment_index: 2,
          start_seconds: 5,
          end_seconds: 7.5,
          text: "收尾内容"
        }
      ]
    },
    mutations: [],
    batchErrors: [],
    transcriptConflictOnce: false,
    whisperStatus: "not_installed",
    backups: [],
    pendingRestore: null
  };
}

function parseRequestBody(request: import("@playwright/test").Request): unknown {
  const body = request.postData();
  return body ? JSON.parse(body) : null;
}

async function mockManagementApi(page: Page, state: MockState) {
  await page.route("http://127.0.0.1:8765/**", async (route) => {
    const request = route.request();
    const method = request.method();
    const url = new URL(request.url());
    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers":
        "Content-Type, X-Local-Audio-Client, X-Local-Audio-Token",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS"
    };

    if (method === "OPTIONS") {
      await route.fulfill({ status: 204, headers });
      return;
    }

    if (url.pathname === "/health") {
      await route.fulfill({ json: { status: "ok" }, headers });
      return;
    }

    if (url.pathname === "/auth/token") {
      await route.fulfill({ json: { token: "management-test-token" }, headers });
      return;
    }

    if (method === "GET" && url.pathname === "/audio-items") {
      const hasQuery = Boolean(url.searchParams.get("q"));
      await route.fulfill({
        json: {
          items: state.audioItems.map((item) =>
            hasQuery && item.id === 1
              ? {
                  ...item,
                  search_hits: [
                    {
                      field: "transcript",
                      label: "Transcript",
                      text: "原始分段文字",
                      start_seconds: 2.5,
                      end_seconds: 5,
                      segment_index: 1,
                      context_before: "开场内容",
                      context_after: "收尾内容"
                    }
                  ]
                }
              : item
          ),
          total: state.audioItems.length,
          limit: 120,
          offset: 0,
          has_more: false
        },
        headers
      });
      return;
    }

    if (method === "GET" && url.pathname === "/library-roots") {
      await route.fulfill({ json: state.roots, headers });
      return;
    }

    if (method === "GET" && url.pathname === "/settings") {
      await route.fulfill({ json: [], headers });
      return;
    }

    if (method === "GET" && url.pathname === "/maintenance/database-backups") {
      await route.fulfill({ json: state.backups, headers });
      return;
    }

    if (method === "GET" && url.pathname === "/maintenance/database-restore") {
      await route.fulfill({
        json: { pending: state.pendingRestore, last_result: null },
        headers
      });
      return;
    }

    if (method === "POST" && url.pathname === "/maintenance/database-backups") {
      const body = parseRequestBody(request) as { name?: string };
      const backup = {
        id: "database.manual-visual.sqlite",
        name: body.name || "手动备份",
        kind: "manual",
        created_at: NOW,
        app_version: "0.5.0-beta.1",
        schema_version: 7,
        size_bytes: 1048576,
        integrity_status: "valid",
        integrity_error: null,
        sha256: "visual-sha256",
        restore_compatible: true,
        compatibility_error: null
      };
      state.backups = [backup, ...state.backups];
      state.mutations.push({ method, path: url.pathname, body });
      await route.fulfill({ json: backup, headers });
      return;
    }

    const backupActionMatch = url.pathname.match(
      /^\/maintenance\/database-backups\/([^/]+)\/(validate|restore(?:\/preflight)?)$/
    );
    if (method === "POST" && backupActionMatch) {
      const backup = state.backups.find((row) => row.id === backupActionMatch[1])!;
      const action = backupActionMatch[2];
      state.mutations.push({ method, path: url.pathname, body: null });
      if (action === "validate") {
        await route.fulfill({ json: backup, headers });
        return;
      }
      if (action === "restore/preflight") {
        await route.fulfill({
          json: {
            ok: true,
            backup,
            blockers: [],
            active_ai_tasks: 0,
            active_scan_tasks: 0,
            required_bytes: 2097152,
            free_bytes: 1073741824,
            restart_required: true
          },
          headers
        });
        return;
      }
      state.pendingRestore = {
        snapshot_id: backup.id,
        safety_snapshot_id: "database.pre-restore-visual.sqlite",
        requested_at: NOW
      };
      await route.fulfill({
        json: { ...state.pendingRestore, status: "pending", restart_required: true },
        headers
      });
      return;
    }

    if (method === "GET" && url.pathname === "/scan-tasks") {
      await route.fulfill({ json: [], headers });
      return;
    }

    if (method === "GET" && url.pathname === "/asr/whisper-component") {
      await route.fulfill({
        json: {
          status: state.whisperStatus,
          available: state.whisperStatus === "installed",
          source: state.whisperStatus === "installed" ? "component" : null,
          app_version: "0.5.0-beta.1",
          target: "x86_64-unknown-linux-gnu",
          downloaded_bytes: state.whisperStatus === "downloading" ? 1024 : 0,
          total_bytes: state.whisperStatus === "downloading" ? 4096 : null,
          error_message: null
        },
        headers
      });
      return;
    }

    if (method === "POST" && url.pathname === "/asr/whisper-component/install") {
      state.mutations.push({ method, path: url.pathname, body: null });
      state.whisperStatus = "downloading";
      await route.fulfill({
        json: {
          status: "downloading",
          available: false,
          source: null,
          app_version: "0.5.0-beta.1",
          target: "x86_64-unknown-linux-gnu",
          downloaded_bytes: 0,
          total_bytes: null,
          error_message: null
        },
        headers
      });
      return;
    }

    if (method === "GET" && url.pathname === "/logs/app") {
      await route.fulfill({ json: { file: "app.log", content: "" }, headers });
      return;
    }

    if (method === "GET" && url.pathname === "/tags") {
      await route.fulfill({ json: state.tags, headers });
      return;
    }

    if (method === "GET" && url.pathname === "/playlists") {
      await route.fulfill({ json: state.playlists, headers });
      return;
    }

    const audioDetailMatch = url.pathname.match(/^\/audio-items\/(\d+)$/);
    if (method === "GET" && audioDetailMatch) {
      const audio = state.audioItems.find(
        (item) => item.id === Number(audioDetailMatch[1])
      );
      await route.fulfill({ json: { audio, tags: [] }, headers });
      return;
    }

    if (method === "GET" && url.pathname === "/audio-items/1/ai-suggestions") {
      await route.fulfill({ json: { task_id: null, tags: [] }, headers });
      return;
    }

    if (method === "GET" && url.pathname === "/audio-items/1/transcript") {
      await route.fulfill({ json: state.transcript, headers });
      return;
    }

    if (method === "POST" && url.pathname === "/audio-items/batch/organize") {
      const body = parseRequestBody(request) as {
        audio_ids: number[];
        action: "add_tags" | "remove_tags" | "add_to_playlist" | "set_favorite";
        tag_names?: string[];
        tag_ids?: number[];
        playlist_id?: number;
        is_favorite?: boolean;
      };
      state.mutations.push({ method, path: url.pathname, body });

      if (body.action === "add_tags") {
        for (const name of body.tag_names || []) {
          if (!state.tags.some((tag) => tag.name === name)) {
            state.tags.push({
              id: 100 + state.tags.length,
              name,
              source: "user",
              created_at: NOW
            });
          }
        }
      }

      if (body.action === "set_favorite") {
        state.audioItems = state.audioItems.map((item) =>
          body.audio_ids.includes(item.id)
            ? { ...item, is_favorite: Boolean(body.is_favorite) }
            : item
        );
      }

      await route.fulfill({
        json: {
          action: body.action,
          requested_count: body.audio_ids.length,
          matched_count: body.audio_ids.length,
          changed_count: Math.max(0, body.audio_ids.length - state.batchErrors.length),
          unchanged_count: 0,
          duplicate_count: 0,
          relationship_changes: Math.max(
            0,
            body.audio_ids.length - state.batchErrors.length
          ),
          errors: state.batchErrors
        },
        headers
      });
      return;
    }

    if (method === "PATCH" && url.pathname === "/playlists/11") {
      const body = parseRequestBody(request) as { name?: unknown };
      state.mutations.push({ method, path: url.pathname, body });
      const playlist = state.playlists.find((item) => item.id === 11)!;
      playlist.name = String(body.name);
      playlist.updated_at = "2026-08-08T00:01:00Z";
      await route.fulfill({ json: playlist, headers });
      return;
    }

    if (method === "DELETE" && url.pathname === "/playlists/11") {
      state.mutations.push({ method, path: url.pathname, body: null });
      state.playlists = state.playlists.filter((item) => item.id !== 11);
      await route.fulfill({ json: { ok: true, removed_items: 2 }, headers });
      return;
    }

    if (method === "DELETE" && url.pathname === "/library-roots/7") {
      state.mutations.push({ method, path: url.pathname, body: null });
      state.roots = state.roots.filter((item) => item.id !== 7);
      await route.fulfill({
        json: { ok: true, detached_audio_items: 1, removed_scan_tasks: 3 },
        headers
      });
      return;
    }

    if (method === "POST" && url.pathname === "/tags/21/merge") {
      const body = parseRequestBody(request);
      state.mutations.push({ method, path: url.pathname, body });
      const targetTag = state.tags.find((item) => item.id === 22)!;
      state.tags = state.tags.filter((item) => item.id !== 21);
      await route.fulfill({
        json: {
          ok: true,
          target_tag: targetTag,
          affected_audio_items: 4,
          created_links: 3
        },
        headers
      });
      return;
    }

    if (method === "PATCH" && url.pathname === "/audio-items/1/transcript") {
      const body = parseRequestBody(request) as {
        full_text?: unknown;
        expected_updated_at?: unknown;
      };
      state.mutations.push({ method, path: url.pathname, body });
      const clearedSegments = state.transcript.segments.length;
      state.transcript = {
        transcript: {
          ...state.transcript.transcript,
          full_text: String(body.full_text),
          updated_at: "2026-08-08T00:02:00Z"
        },
        segments: [],
        cleared_segments: clearedSegments
      };
      await route.fulfill({ json: state.transcript, headers });
      return;
    }

    if (
      method === "PATCH" &&
      url.pathname === "/audio-items/1/transcript/segments"
    ) {
      const body = parseRequestBody(request) as {
        expected_updated_at: string;
        segments: Array<{ id: number; text: string }>;
      };
      state.mutations.push({ method, path: url.pathname, body });

      if (state.transcriptConflictOnce) {
        state.transcriptConflictOnce = false;
        state.transcript = {
          transcript: {
            ...state.transcript.transcript,
            full_text: "开场内容\n服务器较新版本\n收尾内容",
            updated_at: "2026-08-08T00:03:00Z"
          },
          segments: state.transcript.segments.map((segment) =>
            segment.id === 41 ? { ...segment, text: "服务器较新版本" } : segment
          )
        };
        await route.fulfill({
          status: 409,
          json: { detail: "Transcript has changed since it was loaded" },
          headers
        });
        return;
      }

      const edits = new Map(body.segments.map((segment) => [segment.id, segment.text]));
      const segments = state.transcript.segments.map((segment) =>
        edits.has(segment.id)
          ? { ...segment, text: String(edits.get(segment.id)) }
          : segment
      );
      state.transcript = {
        transcript: {
          ...state.transcript.transcript,
          full_text: segments.map((segment) => segment.text).join("\n"),
          updated_at: "2026-08-08T00:02:00Z"
        },
        segments,
        updated_segments: body.segments.length
      };
      await route.fulfill({ json: state.transcript, headers });
      return;
    }

    await route.fulfill({
      status: 404,
      json: { detail: `Unhandled test request: ${method} ${url.pathname}` },
      headers
    });
  });
}

async function openSettings(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "设置中心" }).click();
  await expect(page.getByRole("tab", { name: "媒体库" })).toHaveAttribute(
    "aria-selected",
    "true"
  );
}

test.describe("v0.5 management workflows", () => {
  test("selects only loaded audio and submits a batch tag operation", async ({
    page
  }) => {
    const state = createMockState();
    await mockManagementApi(page, state);
    await page.goto("/");

    await page.getByRole("button", { name: "多选整理" }).click();
    await page.getByRole("button", { name: "全选已加载 (2)" }).click();
    await expect(page.getByText("已选择 2 个")).toBeVisible();
    const selectedCheckboxes = page.getByRole("checkbox", { name: /选择 测试音频/ });
    await expect(selectedCheckboxes).toHaveCount(2);
    await expect(selectedCheckboxes.first()).toBeChecked();
    await expect(selectedCheckboxes.last()).toBeChecked();

    await page.getByRole("button", { name: "添加标签" }).click();
    const dialog = page.getByRole("dialog", { name: "批量添加标签" });
    await dialog.getByRole("textbox", { name: "标签名称" }).fill("课程, 重点");
    await dialog.getByRole("button", { name: "添加标签" }).click();

    await expect(page.getByText("已选择 0 个")).toBeVisible();
    await expect(page.getByText(/批量添加标签完成：修改 2 个/)).toBeVisible();
    expect(state.mutations).toContainEqual({
      method: "POST",
      path: "/audio-items/batch/organize",
      body: {
        audio_ids: [1, 2],
        action: "add_tags",
        tag_names: ["课程", "重点"]
      }
    });
  });

  test("submits remove-tag, playlist and favorite actions for explicit selection", async ({
    page
  }) => {
    const state = createMockState();
    await mockManagementApi(page, state);
    await page.goto("/");
    await page.getByRole("button", { name: "多选整理" }).click();

    const firstCheckbox = page.getByRole("checkbox", { name: "选择 测试音频 1" });
    await firstCheckbox.check();
    await page.getByRole("button", { name: "收藏", exact: true }).click();
    let dialog = page.getByRole("dialog", { name: "批量收藏？" });
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await expect(page.getByText("已选择 1 个")).toBeVisible();
    expect(
      state.mutations.filter(
        (mutation) => mutation.path === "/audio-items/batch/organize"
      )
    ).toHaveLength(0);

    await page.getByRole("button", { name: "移除标签" }).click();
    dialog = page.getByRole("dialog", { name: "批量移除标签" });
    await dialog.getByRole("textbox", { name: "标签完整名称" }).fill("待整理");
    await dialog.getByRole("button", { name: "移除标签" }).click();
    await expect(page.getByText(/批量移除标签完成/)).toBeVisible();
    await expect(page.getByText("已选择 0 个")).toBeVisible();

    await firstCheckbox.check();
    await page.getByRole("button", { name: "加入 Playlist" }).click();
    dialog = page.getByRole("dialog", { name: "批量加入 Playlist" });
    await dialog
      .getByRole("textbox", { name: "Playlist 名称或 #ID" })
      .fill("#11");
    await dialog.getByRole("button", { name: "加入 Playlist" }).click();
    await expect(page.getByText(/批量加入 Playlist完成/)).toBeVisible();
    await expect(page.getByText("已选择 0 个")).toBeVisible();

    await firstCheckbox.check();
    state.batchErrors = [{ audio_id: 1, error: "Audio item not found" }];
    await page.getByRole("button", { name: "收藏", exact: true }).click();
    dialog = page.getByRole("dialog", { name: "批量收藏？" });
    await dialog.getByRole("button", { name: "设为收藏" }).click();
    await expect(page.getByText(/错误 1 个/)).toBeVisible();

    const organizationBodies = state.mutations
      .filter((mutation) => mutation.path === "/audio-items/batch/organize")
      .map((mutation) => mutation.body);
    expect(organizationBodies).toEqual([
      { audio_ids: [1], action: "remove_tags", tag_ids: [21] },
      { audio_ids: [1], action: "add_to_playlist", playlist_id: 11 },
      { audio_ids: [1], action: "set_favorite", is_favorite: true }
    ]);
  });

  test("clears selection mode when filters change", async ({ page }) => {
    const state = createMockState();
    await mockManagementApi(page, state);
    await page.goto("/");

    await page.getByRole("button", { name: "多选整理" }).click();
    await page.getByRole("checkbox", { name: "选择 测试音频 1" }).check();
    await expect(page.getByText("已选择 1 个")).toBeVisible();

    await page.getByRole("combobox", { name: "按 transcript 状态筛选" }).click();
    await page.getByRole("option", { name: "已有 transcript" }).click();

    await expect(page.getByRole("button", { name: "多选整理" })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "选择 测试音频 1" })).toHaveCount(0);
  });

  test("renames and deletes a playlist through confirmed UI actions", async ({
    page
  }) => {
    const state = createMockState();
    await mockManagementApi(page, state);
    await openSettings(page);

    const playlistRow = page
      .locator(".playlist-maintenance-row")
      .filter({ hasText: "晨间播放" });
    await playlistRow.getByRole("button", { name: "重命名" }).click();

    const renameDialog = page.getByRole("dialog", { name: "重命名 Playlist" });
    await renameDialog.getByRole("textbox", { name: "Playlist 名称" }).fill("通勤精选");
    await renameDialog.getByRole("button", { name: "保存" }).click();

    const renamedRow = page
      .locator(".playlist-maintenance-row")
      .filter({ hasText: "通勤精选" });
    await expect(renamedRow).toBeVisible();
    expect(state.mutations[0]).toEqual({
      method: "PATCH",
      path: "/playlists/11",
      body: { name: "通勤精选" }
    });

    await renamedRow.getByRole("button", { name: "删除" }).click();
    const deleteDialog = page.getByRole("dialog", { name: "删除 Playlist？" });
    await expect(deleteDialog).toContainText("不会删除任何音频");
    await deleteDialog.getByRole("button", { name: "删除 Playlist" }).click();

    await expect(renamedRow).toHaveCount(0);
    expect(state.mutations[1]).toEqual({
      method: "DELETE",
      path: "/playlists/11",
      body: null
    });
  });

  test("removes a library root without presenting it as audio deletion", async ({
    page
  }) => {
    const state = createMockState();
    await mockManagementApi(page, state);
    await openSettings(page);

    const rootRow = page.locator(".root-card").filter({ hasText: "/library/podcasts" });
    await rootRow.getByRole("button", { name: "移除" }).click();

    const dialog = page.getByRole("dialog", { name: "移除媒体库目录？" });
    await expect(dialog).toContainText("音频文件和数据库中的音频");
    await expect(dialog).toContainText("都会保留");
    await dialog.getByRole("button", { name: "移除目录" }).click();

    await expect(rootRow).toHaveCount(0);
    await expect(page.getByText("目录已移除，保留 1 条音频记录")).toBeVisible();
    expect(state.mutations).toContainEqual({
      method: "DELETE",
      path: "/library-roots/7",
      body: null
    });
  });

  test("offers the optional Whisper component download from ASR settings", async ({
    page
  }) => {
    const state = createMockState();
    await mockManagementApi(page, state);
    await openSettings(page);
    await page.getByRole("tab", { name: "ASR" }).click();

    await expect(page.getByText("未安装", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "下载并安装" }).click();

    await expect(page.getByText("正在下载", { exact: true })).toBeVisible();
    await expect(page.getByRole("progressbar", { name: "Whisper 组件下载进度" })).toBeVisible();
    expect(state.mutations).toContainEqual({
      method: "POST",
      path: "/asr/whisper-component/install",
      body: null
    });
  });

  test("creates a verified snapshot and schedules a restart-safe restore", async ({
    page
  }) => {
    const state = createMockState();
    await mockManagementApi(page, state);
    await openSettings(page);
    await page.getByRole("tab", { name: "维护" }).click();

    await page.getByRole("button", { name: "创建快照" }).click();
    const createDialog = page.getByRole("dialog", { name: "创建数据库快照" });
    await createDialog.getByRole("textbox", { name: "快照名称（可选）" }).fill("恢复演练");
    await createDialog.getByRole("button", { name: "创建快照" }).click();

    const backupRow = page.locator(".backup-row").filter({ hasText: "恢复演练" });
    await expect(backupRow).toContainText("校验通过");
    await backupRow.getByRole("button", { name: "恢复" }).click();

    const restoreDialog = page.getByRole("dialog", { name: "恢复数据库快照？" });
    await expect(restoreDialog).toContainText("不会修改或删除磁盘上的原始音频");
    await expect(restoreDialog).toContainText("自动换回恢复前安全快照");
    await restoreDialog.getByRole("button", { name: "创建安全快照并重启" }).click();

    const restartDialog = page.getByRole("dialog", { name: "需要重启应用" });
    await expect(restartDialog).toContainText("browser-lite 无法自行重启");
    await restartDialog.getByRole("button", { name: "知道了" }).click();
    await expect(page.getByText("数据库恢复等待重启")).toBeVisible();

    expect(state.mutations).toContainEqual({
      method: "POST",
      path: "/maintenance/database-backups",
      body: { name: "恢复演练" }
    });
    expect(state.mutations).toContainEqual({
      method: "POST",
      path: "/maintenance/database-backups/database.manual-visual.sqlite/restore",
      body: null
    });
  });

  test("merges a source tag into an existing target tag", async ({ page }) => {
    const state = createMockState();
    await mockManagementApi(page, state);
    await openSettings(page);
    await page.getByRole("tab", { name: "维护" }).click();

    const sourceTag = page.locator(".tag").filter({ hasText: "#待整理" });
    await sourceTag.getByRole("button", { name: "合并" }).click();

    const dialog = page.getByRole("dialog", { name: "合并标签" });
    await dialog.getByRole("textbox", { name: "目标标签名称" }).fill("知识");
    await dialog.getByRole("button", { name: "合并" }).click();

    await expect(sourceTag).toHaveCount(0);
    await expect(page.locator(".tag").filter({ hasText: "#知识" })).toBeVisible();
    await expect(
      page.getByText("已将 #待整理 合并到 #知识，影响 4 条音频")
    ).toBeVisible();
    expect(state.mutations).toContainEqual({
      method: "POST",
      path: "/tags/21/merge",
      body: { target_tag_id: 22 }
    });
  });

  test("edits transcript segments without clearing the timeline", async ({ page }) => {
    const state = createMockState();
    await mockManagementApi(page, state);
    await page.goto("/");

    await page.getByRole("listitem", { name: "音频：测试音频 1" }).click();
    await page.getByRole("tab", { name: "Transcript" }).click();
    await page.getByRole("button", { name: "编辑分段" }).click();

    const middleDraft = page.getByRole("textbox", { name: "第 2 段文本" });
    await middleDraft.fill("修订后的分段关键词");
    await expect(page.getByText("有未保存修改")).toBeVisible();
    await page.getByRole("button", { name: "保存分段修订" }).click();

    await expect(page.getByText("修订后的分段关键词")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "从 0:02 开始播放" })
    ).toBeVisible();
    await expect(page.getByText("已保存 1 个分段修订")).toBeVisible();
    expect(state.mutations).toContainEqual({
      method: "PATCH",
      path: "/audio-items/1/transcript/segments",
      body: {
        expected_updated_at: NOW,
        segments: [{ id: 41, text: "修订后的分段关键词" }]
      }
    });
  });

  test("confirms before discarding an unsaved segment draft", async ({ page }) => {
    const state = createMockState();
    await mockManagementApi(page, state);
    await page.goto("/");

    await page.getByRole("listitem", { name: "音频：测试音频 1" }).click();
    await page.getByRole("tab", { name: "Transcript" }).click();
    await page.getByRole("button", { name: "编辑分段" }).click();
    await page.getByRole("textbox", { name: "第 2 段文本" }).fill("未保存草稿");
    await page.getByRole("button", { name: "取消" }).click();

    const dialog = page.getByRole("dialog", { name: "放弃未保存修改？" });
    await dialog.getByRole("button", { name: "继续编辑" }).click();
    await expect(page.getByRole("textbox", { name: "第 2 段文本" })).toHaveValue(
      "未保存草稿"
    );

    await page.getByRole("button", { name: "取消" }).click();
    await dialog.getByRole("button", { name: "放弃修改" }).click();
    await expect(page.getByText("原始分段文字")).toBeVisible();
    expect(
      state.mutations.filter(
        (mutation) => mutation.path === "/audio-items/1/transcript/segments"
      )
    ).toHaveLength(0);
  });

  test("keeps the draft visible when a transcript version conflicts", async ({
    page
  }) => {
    const state = createMockState();
    state.transcriptConflictOnce = true;
    await mockManagementApi(page, state);
    await page.goto("/");

    await page.getByRole("listitem", { name: "音频：测试音频 1" }).click();
    await page.getByRole("tab", { name: "Transcript" }).click();
    await page.getByRole("button", { name: "编辑分段" }).click();
    const middleDraft = page.getByRole("textbox", { name: "第 2 段文本" });
    await middleDraft.fill("本地未保存草稿");
    await page.getByRole("button", { name: "保存分段修订" }).click();

    await expect(
      page.getByText("服务器上的 Transcript 已在你编辑期间更新")
    ).toBeVisible();
    await expect(middleDraft).toHaveValue("本地未保存草稿");
    await page
      .getByRole("button", { name: "放弃草稿并加载最新版本" })
      .click();
    await expect(middleDraft).toHaveValue("服务器较新版本");
  });

  test("shows adjacent transcript context in search results", async ({ page }) => {
    const state = createMockState();
    await mockManagementApi(page, state);
    await page.goto("/");

    await page
      .getByRole("searchbox", { name: "搜索标题、作者、标签、描述或 transcript" })
      .fill("分段文字");

    await expect(page.getByText("开场内容")).toBeVisible();
    await expect(page.getByText("原始分段文字")).toBeVisible();
    await expect(page.getByText("收尾内容")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "从 0:02 开始播放 测试音频 1" })
    ).toBeVisible();
  });

  test("confirms segment clearing before saving a full transcript replacement", async ({
    page
  }) => {
    const state = createMockState();
    await mockManagementApi(page, state);
    await page.goto("/");

    await page.getByRole("listitem", { name: "音频：测试音频 1" }).click();
    await page.getByRole("tab", { name: "Transcript" }).click();
    await expect(page.getByText("原始分段文字")).toBeVisible();

    await page.getByRole("button", { name: "替换全文" }).click();
    await page
      .getByRole("textbox", { name: "Transcript 全文（高级替换）" })
      .fill("修订后的 Transcript 全文");
    await page.getByRole("button", { name: "保存全文替换" }).click();

    const dialog = page.getByRole("dialog", { name: "保存 Transcript 修订？" });
    await expect(dialog).toContainText("会清除这些分段");
    await dialog.getByRole("button", { name: "保存并清除分段" }).click();

    await expect(page.getByText("修订后的 Transcript 全文")).toBeVisible();
    await expect(page.getByText("原始分段文字")).toHaveCount(0);
    await expect(
      page.getByText("Transcript 已保存，并清除 3 个旧分段")
    ).toBeVisible();
    expect(state.mutations).toContainEqual({
      method: "PATCH",
      path: "/audio-items/1/transcript",
      body: {
        full_text: "修订后的 Transcript 全文",
        expected_updated_at: NOW
      }
    });
  });
});
