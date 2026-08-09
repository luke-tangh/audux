import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  listTags: vi.fn(),
  listPlaylists: vi.fn()
}));

vi.mock("../../api", () => ({
  api: apiMocks
}));

import { useNavigationData } from "./useNavigationData";

describe("useNavigationData", () => {
  beforeEach(() => {
    apiMocks.listTags.mockReset();
    apiMocks.listPlaylists.mockReset();
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
    const { result } = renderHook(() => useNavigationData());

    await act(async () => result.current.loadNavigation());

    expect(result.current.tags.map((tag) => tag.name)).toEqual(["work"]);
    expect(result.current.playlists.map((playlist) => playlist.name)).toEqual(["Later"]);
  });

  it("keeps successful navigation data when the other endpoint fails", async () => {
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

    await act(async () => result.current.loadNavigation());

    expect(result.current.tags).toEqual([]);
    expect(result.current.playlists.map((playlist) => playlist.name)).toEqual(["Available"]);
  });
});
