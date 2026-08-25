import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DialogProvider } from "../components/dialog/UnifiedDialog";
import "../i18n";
import type { AudioItem, PaginatedAudioItems, Playlist, PlaylistDetail } from "../types";

const apiMocks = vi.hoisted(() => ({
  health: vi.fn(),
  ensureAuthToken: vi.fn(),
  listTags: vi.fn(),
  listPlaylists: vi.fn(),
  listLibraryRoots: vi.fn(),
  listSavedViews: vi.fn(),
  listAudioItems: vi.fn(),
  listPlaylistItems: vi.fn(),
  getPlaylist: vi.fn(),
  reorderPlaylistItems: vi.fn()
}));

vi.mock("../api", () => ({ api: apiMocks }));

import { useLibraryController } from "./useLibraryController";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function audioItem(id: number, title: string): AudioItem {
  return {
    id,
    file_path: `/library/${id}.mp3`,
    file_name: `${id}.mp3`,
    title_user: title,
    transcript_status: "none",
    ai_status: "none",
    play_count: 0,
    last_position_seconds: 0,
    is_favorite: false,
    is_missing: false,
    created_at: "2026-08-25T00:00:00Z",
    updated_at: "2026-08-25T00:00:00Z"
  };
}

function wrapper({ children }: { children: ReactNode }) {
  return <DialogProvider>{children}</DialogProvider>;
}

describe("useLibraryController", () => {
  beforeEach(() => {
    for (const mock of Object.values(apiMocks)) mock.mockReset();
    apiMocks.health.mockResolvedValue({ status: "ok" });
    apiMocks.ensureAuthToken.mockResolvedValue("token");
    apiMocks.listTags.mockResolvedValue([]);
    apiMocks.listPlaylists.mockResolvedValue([]);
    apiMocks.listLibraryRoots.mockResolvedValue([]);
    apiMocks.listSavedViews.mockResolvedValue([]);
    apiMocks.listAudioItems.mockResolvedValue({
      items: [],
      total: 0,
      has_more: false,
      facets: { tags: [], roots: [] }
    });
    apiMocks.listPlaylistItems.mockResolvedValue({
      items: [],
      total: 0,
      has_more: false,
      facets: { tags: [], roots: [] }
    });
    apiMocks.reorderPlaylistItems.mockResolvedValue({ ok: true, count: 0 });
  });

  it("refreshes the list for a new query without reloading navigation data", async () => {
    const { result } = renderHook(() => useLibraryController(), { wrapper });

    await waitFor(() => expect(apiMocks.listAudioItems).toHaveBeenCalledTimes(1));
    expect(apiMocks.listTags).toHaveBeenCalledTimes(1);
    expect(apiMocks.listPlaylists).toHaveBeenCalledTimes(1);
    expect(apiMocks.listLibraryRoots).toHaveBeenCalledTimes(1);
    expect(apiMocks.listSavedViews).toHaveBeenCalledTimes(1);

    act(() => result.current.setQ("focus"));

    await waitFor(() => expect(apiMocks.listAudioItems).toHaveBeenCalledTimes(2), {
      timeout: 1500
    });
    expect(apiMocks.listAudioItems).toHaveBeenLastCalledWith(
      expect.objectContaining({ q: "focus", limit: 120, offset: 0 })
    );
    expect(apiMocks.listTags).toHaveBeenCalledTimes(1);
    expect(apiMocks.listPlaylists).toHaveBeenCalledTimes(1);
    expect(apiMocks.listLibraryRoots).toHaveBeenCalledTimes(1);
    expect(apiMocks.listSavedViews).toHaveBeenCalledTimes(1);
  });

  it("discards an outdated load-more response after the query changes", async () => {
    const first = audioItem(1, "First page");
    const stale = audioItem(2, "Stale second page");
    const current = audioItem(3, "Current query");
    const pendingPage = deferred<PaginatedAudioItems>();

    apiMocks.listAudioItems
      .mockResolvedValueOnce({
        items: [first],
        total: 2,
        has_more: true,
        facets: { tags: [], roots: [] }
      })
      .mockImplementationOnce(() => pendingPage.promise)
      .mockResolvedValueOnce({
        items: [current],
        total: 1,
        has_more: false,
        facets: { tags: [], roots: [] }
      });

    const { result } = renderHook(() => useLibraryController(), { wrapper });
    await waitFor(() => expect(result.current.audioItems).toEqual([first]));

    act(() => {
      void result.current.loadMoreAudioItems();
    });
    await waitFor(() => expect(apiMocks.listAudioItems).toHaveBeenCalledTimes(2));

    act(() => result.current.setQ("current"));
    await waitFor(() => expect(result.current.audioItems).toEqual([current]), {
      timeout: 1500
    });

    await act(async () => {
      pendingPage.resolve({
        items: [stale],
        total: 2,
        limit: 120,
        offset: 1,
        has_more: false,
        facets: { tags: [], roots: [] }
      });
      await pendingPage.promise;
    });

    expect(result.current.audioItems).toEqual([current]);
    expect(result.current.audioTotal).toBe(1);
    expect(result.current.loadingMore).toBe(false);
  });

  it("does not let an old playlist detail replace the current reorder source", async () => {
    const playlistA: Playlist = {
      id: 10,
      name: "Playlist A",
      kind: "manual",
      created_at: "2026-08-25T00:00:00Z",
      updated_at: "2026-08-25T00:00:00Z"
    };
    const playlistB: Playlist = { ...playlistA, id: 20, name: "Playlist B" };
    const a1 = { ...audioItem(11, "A1"), playlist_item_id: 101 };
    const a2 = { ...audioItem(12, "A2"), playlist_item_id: 102 };
    const b1 = { ...audioItem(21, "B1"), playlist_item_id: 201 };
    const b2 = { ...audioItem(22, "B2"), playlist_item_id: 202 };
    const pendingA = deferred<PlaylistDetail>();
    const detail = (playlist: Playlist, items: AudioItem[]): PlaylistDetail => ({
      playlist,
      items: items.map((item, index) => ({
        playlist_item: {
          id: item.playlist_item_id!,
          playlist_id: playlist.id,
          audio_id: item.id,
          order_index: index,
          created_at: "2026-08-25T00:00:00Z"
        },
        audio: item
      }))
    });

    apiMocks.listPlaylists.mockResolvedValue([playlistA, playlistB]);
    apiMocks.listPlaylistItems.mockImplementation((id: number) => Promise.resolve({
      items: id === playlistA.id ? [a1, a2] : [b1, b2],
      total: 2,
      has_more: false,
      facets: { tags: [], roots: [] }
    }));
    apiMocks.getPlaylist.mockImplementation((id: number) =>
      id === playlistA.id ? pendingA.promise : Promise.resolve(detail(playlistB, [b1, b2]))
    );
    apiMocks.reorderPlaylistItems.mockResolvedValue({ ok: true, count: 2 });

    const { result } = renderHook(() => useLibraryController(), { wrapper });
    await waitFor(() => expect(result.current.initialized).toBe(true));

    act(() => result.current.openPlaylist(playlistA));
    await waitFor(() => expect(apiMocks.getPlaylist).toHaveBeenCalledWith(
      playlistA.id,
      { include_disabled_roots: true }
    ));

    act(() => result.current.openPlaylist(playlistB));
    await waitFor(() => expect(result.current.audioItems).toEqual([b1, b2]));

    await act(async () => {
      pendingA.resolve(detail(playlistA, [a1, a2]));
      await pendingA.promise;
    });

    await act(async () => {
      await result.current.movePlaylistItem(b1, "down");
    });
    expect(apiMocks.reorderPlaylistItems).toHaveBeenCalledWith(
      playlistB.id,
      [202, 201]
    );
  });
});
