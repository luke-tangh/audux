import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  listTags: vi.fn(),
  listPlaylists: vi.fn(),
  listLibraryRoots: vi.fn(),
  listSavedViews: vi.fn()
}));

vi.mock("../../api", () => ({
  api: apiMocks
}));

import { useNavigationData } from "./useNavigationData";

describe("useNavigationData", () => {
  beforeEach(() => {
    apiMocks.listTags.mockReset();
    apiMocks.listPlaylists.mockReset();
    apiMocks.listLibraryRoots.mockReset();
    apiMocks.listSavedViews.mockReset();
    apiMocks.listLibraryRoots.mockResolvedValue([]);
    apiMocks.listSavedViews.mockResolvedValue([]);
  });

  it("loads tags and playlists together", async () => {
    apiMocks.listTags.mockResolvedValue([
      { id: 1, name: "work", source: "user", created_at: "2026-08-10T00:00:00Z" }
    ]);
    apiMocks.listPlaylists.mockResolvedValue([
      {
        id: 2,
        name: "Later",
        created_at: "2026-08-10T00:00:00Z",
        updated_at: "2026-08-10T00:00:00Z"
      }
    ]);
    apiMocks.listLibraryRoots.mockResolvedValue([
      {
        id: 3,
        path: "/library",
        is_enabled: true,
        created_at: "2026-08-10T00:00:00Z",
        updated_at: "2026-08-10T00:00:00Z"
      }
    ]);
    apiMocks.listSavedViews.mockResolvedValue([
      {
        id: 4,
        name: "Work",
        schema_version: 1,
        sort_order: 0,
        created_at: "2026-08-10T00:00:00Z",
        updated_at: "2026-08-10T00:00:00Z",
        query: null,
        tag_name: null,
        library_root_path: null,
        invalid_references: [],
        definition_error: "test"
      }
    ]);
    const { result } = renderHook(() => useNavigationData());

    await act(async () => result.current.loadNavigation());

    expect(result.current.tags.map((tag) => tag.name)).toEqual(["work"]);
    expect(result.current.playlists.map((playlist) => playlist.name)).toEqual(["Later"]);
    expect(result.current.roots.map((root) => root.path)).toEqual(["/library"]);
    expect(result.current.savedViews.map((view) => view.name)).toEqual(["Work"]);
  });

  it("preserves successful slices but surfaces partial navigation failures", async () => {
    apiMocks.listTags.mockRejectedValue(new Error("tags unavailable"));
    apiMocks.listPlaylists.mockResolvedValue([
      {
        id: 2,
        name: "Available",
        created_at: "2026-08-10T00:00:00Z",
        updated_at: "2026-08-10T00:00:00Z"
      }
    ]);
    const { result } = renderHook(() => useNavigationData());

    let loadError: unknown;
    await act(async () => {
      try {
        await result.current.loadNavigation();
      } catch (error) {
        loadError = error;
      }
    });

    expect(loadError).toEqual(new Error("tags unavailable"));
    expect(result.current.tags).toEqual([]);
    expect(result.current.playlists.map((playlist) => playlist.name)).toEqual(["Available"]);
    expect(result.current.navigationReady).toBe(false);
  });

  it("coalesces concurrent navigation loads", async () => {
    let resolveTags: ((value: never[]) => void) | undefined;
    apiMocks.listTags.mockReturnValue(new Promise<never[]>((resolve) => {
      resolveTags = resolve;
    }));
    apiMocks.listPlaylists.mockResolvedValue([]);
    const { result } = renderHook(() => useNavigationData());

    let loads: Promise<unknown>[] = [];
    act(() => {
      loads = [result.current.loadNavigation(), result.current.loadNavigation()];
    });
    expect(apiMocks.listTags).toHaveBeenCalledTimes(1);
    expect(apiMocks.listPlaylists).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveTags?.([]);
      await Promise.all(loads);
    });
  });
});
