import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DialogProvider } from "../components/dialog/UnifiedDialog";
import "../i18n";

const apiMocks = vi.hoisted(() => ({
  health: vi.fn(),
  ensureAuthToken: vi.fn(),
  listTags: vi.fn(),
  listPlaylists: vi.fn(),
  listLibraryRoots: vi.fn(),
  listSavedViews: vi.fn(),
  listAudioItems: vi.fn()
}));

vi.mock("../api", () => ({ api: apiMocks }));

import { useLibraryController } from "./useLibraryController";

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
});
