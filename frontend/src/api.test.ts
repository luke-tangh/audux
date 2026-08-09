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
    const fetchMock = vi.fn((input: string | URL | Request) => {
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
});
