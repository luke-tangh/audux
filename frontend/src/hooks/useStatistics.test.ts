import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../api";
import type { StatisticsOverview } from "../types";
import { useBackendReady } from "./useBackendReady";
import { useStatistics } from "./useStatistics";

vi.mock("../api", () => ({
  api: { getStatisticsOverview: vi.fn() }
}));
vi.mock("./useBackendReady", () => ({ useBackendReady: vi.fn() }));

const overview = { period_days: 30 } as StatisticsOverview;
const ensureBackendReady = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useBackendReady).mockReturnValue({
    ensureBackendReady,
    resetBackendReady: vi.fn()
  });
});

describe("useStatistics", () => {
  it("loads a period and supports explicit refresh", async () => {
    vi.mocked(api.getStatisticsOverview).mockResolvedValue(overview);
    const { result } = renderHook(() => useStatistics(30));

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.data).toBe(overview));
    expect(ensureBackendReady).toHaveBeenCalledOnce();
    expect(api.getStatisticsOverview).toHaveBeenCalledWith(30);

    act(() => result.current.refresh());
    await waitFor(() => expect(api.getStatisticsOverview).toHaveBeenCalledTimes(2));
  });

  it("keeps a readable load error", async () => {
    vi.mocked(api.getStatisticsOverview).mockRejectedValue(new Error("statistics offline"));
    const { result } = renderHook(() => useStatistics(90));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBe("statistics offline");
  });
});
