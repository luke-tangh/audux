import { afterEach, describe, expect, it, vi } from "vitest";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function requestHeaders(fetchMock: ReturnType<typeof vi.fn>, callIndex: number) {
  const init = fetchMock.mock.calls[callIndex]?.[1] as RequestInit | undefined;
  return init?.headers as Record<string, string>;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.doUnmock("@tauri-apps/api/core");
  delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  vi.resetModules();
});

describe("local API client", () => {
  it("serializes library and playlist sorting parameters", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ token: "sort-token" }))
      .mockResolvedValueOnce(jsonResponse({ items: [], total: 0 }))
      .mockResolvedValueOnce(jsonResponse({ items: [], total: 0 }));
    vi.stubGlobal("fetch", fetchMock);

    const { api } = await import("./api");
    await api.listAudioItems({ sort: "title_asc", limit: 20 });
    await api.listPlaylistItems(7, { sort: "duration_desc", offset: 20 });

    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "http://127.0.0.1:8765/audio-items?sort=title_asc&limit=20"
    );
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      "http://127.0.0.1:8765/playlists/7/items?sort=duration_desc&offset=20"
    );
  });

  it("shares one token request across concurrent protected calls", async () => {
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = String(input);
      return Promise.resolve(
        url.endsWith("/auth/token")
          ? jsonResponse({ token: "shared-token" })
          : jsonResponse([])
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const { api, LOCAL_AUDIO_CLIENT_HEADER, LOCAL_AUDIO_TOKEN_HEADER } = await import("./api");
    await Promise.all([api.listLibraryRoots(), api.listTags()]);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://127.0.0.1:8765/auth/token");
    expect(requestHeaders(fetchMock, 0)[LOCAL_AUDIO_CLIENT_HEADER]).toBe(
      "local-audio-library"
    );
    expect(requestHeaders(fetchMock, 1)[LOCAL_AUDIO_TOKEN_HEADER]).toBe("shared-token");
    expect(requestHeaders(fetchMock, 2)[LOCAL_AUDIO_TOKEN_HEADER]).toBe("shared-token");
  });

  it("refreshes an expired token once and retries the protected request", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ token: "expired-token" }))
      .mockResolvedValueOnce(jsonResponse({ detail: "Unauthorized" }, 401))
      .mockResolvedValueOnce(jsonResponse({ token: "fresh-token" }))
      .mockResolvedValueOnce(jsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    const { api, LOCAL_AUDIO_TOKEN_HEADER } = await import("./api");
    await expect(api.listLibraryRoots()).resolves.toEqual([]);

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(requestHeaders(fetchMock, 1)[LOCAL_AUDIO_TOKEN_HEADER]).toBe("expired-token");
    expect(requestHeaders(fetchMock, 3)[LOCAL_AUDIO_TOKEN_HEADER]).toBe("fresh-token");
  });

  it("shares one refresh when concurrent requests reject the same token", async () => {
    let tokenRequests = 0;
    let protectedRequests = 0;
    const fetchMock = vi.fn((input: string | URL | Request, _init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/auth/token")) {
        tokenRequests += 1;
        return Promise.resolve(
          jsonResponse({ token: tokenRequests === 1 ? "old-token" : "new-token" })
        );
      }

      protectedRequests += 1;
      return Promise.resolve(
        protectedRequests <= 2
          ? jsonResponse({ detail: "Unauthorized" }, 401)
          : jsonResponse([])
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const { api, LOCAL_AUDIO_TOKEN_HEADER } = await import("./api");
    await api.ensureAuthToken();
    await Promise.all([api.listLibraryRoots(), api.listTags()]);

    expect(tokenRequests).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(requestHeaders(fetchMock, 4)[LOCAL_AUDIO_TOKEN_HEADER]).toBe("new-token");
    expect(requestHeaders(fetchMock, 5)[LOCAL_AUDIO_TOKEN_HEADER]).toBe("new-token");
  });

  it("does not set a JSON content type for cover FormData", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ token: "cover-token" }))
      .mockResolvedValueOnce(jsonResponse({ id: 7 }));
    vi.stubGlobal("fetch", fetchMock);

    const { api, LOCAL_AUDIO_CLIENT_HEADER, LOCAL_AUDIO_TOKEN_HEADER } = await import("./api");
    await api.uploadCover(7, new File(["cover"], "cover.png", { type: "image/png" }));

    const init = fetchMock.mock.calls[1]?.[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(init.body).toBeInstanceOf(FormData);
    expect(headers["Content-Type"]).toBeUndefined();
    expect(headers[LOCAL_AUDIO_CLIENT_HEADER]).toBe("local-audio-library");
    expect(headers[LOCAL_AUDIO_TOKEN_HEADER]).toBe("cover-token");
  });

  it("preserves structured backend error details", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ token: "error-token" }))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            detail: {
              code: "playlist.conflict",
              fallback: "Playlist changed",
              params: { playlist_id: 3 }
            }
          },
          409
        )
      );
    vi.stubGlobal("fetch", fetchMock);

    const { api, ApiError } = await import("./api");
    const request = api.getPlaylist(3);

    await expect(request).rejects.toBeInstanceOf(ApiError);
    await expect(request).rejects.toMatchObject({
      name: "ApiError",
      status: 409,
      code: "playlist.conflict",
      params: { playlist_id: 3 }
    });
  });

  it("adds the token only to browser media and download URLs after authentication", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ token: "a token/+" }));
    vi.stubGlobal("fetch", fetchMock);

    const { api } = await import("./api");
    await api.ensureAuthToken();

    expect(api.audioFileUrl(8)).toBe(
      "http://127.0.0.1:8765/audio-items/8/file?access_token=a%20token%2F%2B"
    );
    expect(api.coverUrl(8, "v 2")).toBe(
      "http://127.0.0.1:8765/audio-items/8/cover?v=v+2&access_token=a%20token%2F%2B"
    );
    expect(api.metadataExportUrl("csv")).toContain(
      "format=csv&access_token=a%20token%2F%2B"
    );
  });

  it("classifies loopback endpoints and produces remote privacy warnings", async () => {
    const {
      asrEndpointPrivacyWarning,
      endpointPrivacyWarning,
      isProbablyLocalEndpoint
    } = await import("./api");

    for (const endpoint of [
      "http://localhost:1234/v1",
      "http://model.localhost/v1",
      "http://127.9.8.7:9000/v1",
      "http://[::1]:8080/v1"
    ]) {
      expect(isProbablyLocalEndpoint(endpoint)).toBe(true);
      expect(endpointPrivacyWarning(endpoint)).toBeNull();
      expect(asrEndpointPrivacyWarning(endpoint)).toBeNull();
    }

    expect(isProbablyLocalEndpoint("not-a-url")).toBe(false);
    expect(isProbablyLocalEndpoint("https://example.com/v1")).toBe(false);
    expect(endpointPrivacyWarning("https://example.com/v1")).toBeTruthy();
    expect(asrEndpointPrivacyWarning("https://example.com/v1")).toBeTruthy();
    expect(endpointPrivacyWarning("   ")).toBeNull();
  });

  it("serializes audio filters and pagination without dropping false values", async () => {
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = String(input);
      return Promise.resolve(
        url.endsWith("/auth/token")
          ? jsonResponse({ token: "query-token" })
          : jsonResponse({ items: [], total: 0, limit: 25, offset: 50, has_more: false })
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const { api } = await import("./api");
    await api.listAudioItems({
      q: "meeting notes",
      tag: "待办",
      library_root_id: 12,
      favorite: false,
      missing: true,
      has_transcript: false,
      missing_description: true,
      include_disabled_roots: false,
      ai_status: "failed",
      transcript_status: "none",
      limit: 25,
      offset: 50
    });

    const requestUrl = new URL(String(fetchMock.mock.calls[1]?.[0]));
    expect(Object.fromEntries(requestUrl.searchParams)).toEqual({
      q: "meeting notes",
      tag: "待办",
      library_root_id: "12",
      favorite: "false",
      missing: "true",
      has_transcript: "false",
      missing_description: "true",
      include_disabled_roots: "false",
      ai_status: "failed",
      transcript_status: "none",
      limit: "25",
      offset: "50"
    });
  });

  it("uses the saved-view CRUD and reorder contracts", async () => {
    const fetchMock = vi.fn((input: string | URL | Request, _init?: RequestInit) => {
      const url = String(input);
      return Promise.resolve(
        url.endsWith("/auth/token")
          ? jsonResponse({ token: "saved-view-token" })
          : jsonResponse({ id: 1 })
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const { api } = await import("./api");
    const query = {
      schema_version: 1 as const,
      view: "library" as const,
      q: "ambient",
      tag_id: null,
      library_root_id: 2,
      transcript_filter: "all" as const,
      missing_filter: "available" as const,
      sort: "title_asc" as const,
      display_mode: "list" as const
    };
    await api.createSavedView("Ambient", query);
    await api.updateSavedView(1, { query });
    await api.copySavedView(1, "Ambient copy");
    await api.reorderSavedViews([2, 1]);
    await api.deleteSavedView(1);

    expect(fetchMock.mock.calls.slice(1).map((call) => [call[0], call[1]?.method])).toEqual([
      ["http://127.0.0.1:8765/saved-views", "POST"],
      ["http://127.0.0.1:8765/saved-views/1", "PATCH"],
      ["http://127.0.0.1:8765/saved-views/1/copy", "POST"],
      ["http://127.0.0.1:8765/saved-views/reorder", "PATCH"],
      ["http://127.0.0.1:8765/saved-views/1", "DELETE"]
    ]);
  });

  it("uses playback history and statistics contracts", async () => {
    const fetchMock = vi.fn((input: string | URL | Request, _init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/auth/token")) {
        return Promise.resolve(jsonResponse({ token: "history-token" }));
      }
      if (url.includes("/statistics/overview")) {
        return Promise.resolve(jsonResponse({ period_days: 90 }));
      }
      return Promise.resolve(jsonResponse({ id: 44 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const { api, LOCAL_AUDIO_CLIENT_HEADER } = await import("./api");
    await api.startPlaybackEvent(7, 12.5);
    await api.updatePlaybackEvent(44, {
      listened_seconds: 30,
      end_position_seconds: 42.5,
      completed: false,
      finish: true,
      end_reason: "track_change"
    });
    await api.getStatisticsOverview(90);

    expect(fetchMock.mock.calls.slice(1).map((call) => [call[0], call[1]?.method])).toEqual([
      ["http://127.0.0.1:8765/audio-items/7/playback-events", "POST"],
      ["http://127.0.0.1:8765/playback-events/44", "PATCH"],
      ["http://127.0.0.1:8765/statistics/overview?days=90", undefined]
    ]);
    expect(requestHeaders(fetchMock, 1)[LOCAL_AUDIO_CLIENT_HEADER]).toBe(
      "local-audio-library"
    );
    expect(requestHeaders(fetchMock, 2)[LOCAL_AUDIO_CLIENT_HEADER]).toBe(
      "local-audio-library"
    );
    expect(JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body))).toEqual({
      start_position_seconds: 12.5
    });
  });

  it("handles empty success responses and plain-text backend errors", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ token: "response-token" }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response("gateway unavailable", { status: 502 }));
    vi.stubGlobal("fetch", fetchMock);

    const { api } = await import("./api");
    await expect(api.deleteCover(4)).resolves.toBeUndefined();
    await expect(api.getPlaylist(4)).rejects.toMatchObject({
      status: 502,
      message: "gateway unavailable",
      raw: "gateway unavailable"
    });
  });

  it("normalizes the dynamic backend URL supplied by Tauri", async () => {
    const invoke = vi.fn().mockResolvedValue("http://127.0.0.1:49152///");
    vi.doMock("@tauri-apps/api/core", () => ({ invoke }));
    (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};

    const { ensureApiBase } = await import("./api");
    await expect(ensureApiBase()).resolves.toBe("http://127.0.0.1:49152");
    expect(invoke).toHaveBeenCalledWith("backend_base_url");
  });

  it("encodes managed database backup ids in maintenance requests", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ token: "backup-token" }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, blockers: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const { api } = await import("./api");
    await api.preflightDatabaseRestore("database manual.sqlite");

    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "http://127.0.0.1:8765/maintenance/database-backups/database%20manual.sqlite/restore/preflight"
    );
    expect((fetchMock.mock.calls[1]?.[1] as RequestInit).method).toBe("POST");
  });
});
