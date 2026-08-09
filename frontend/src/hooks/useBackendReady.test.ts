import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  health: vi.fn(),
  ensureAuthToken: vi.fn()
}));

vi.mock("../api", () => ({
  api: apiMocks
}));

import { useBackendReady } from "./useBackendReady";

describe("useBackendReady", () => {
  beforeEach(() => {
    apiMocks.health.mockReset();
    apiMocks.ensureAuthToken.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("caches readiness until explicitly reset", async () => {
    apiMocks.health.mockResolvedValue({ status: "ok" });
    apiMocks.ensureAuthToken.mockResolvedValue("token");
    const { result } = renderHook(() => useBackendReady());

    await act(async () => result.current.ensureBackendReady());
    await act(async () => result.current.ensureBackendReady());
    expect(apiMocks.health).toHaveBeenCalledOnce();
    expect(apiMocks.ensureAuthToken).toHaveBeenCalledOnce();

    act(() => result.current.resetBackendReady());
    await act(async () => result.current.ensureBackendReady());
    expect(apiMocks.health).toHaveBeenCalledTimes(2);
    expect(apiMocks.ensureAuthToken).toHaveBeenCalledTimes(2);
  });

  it("retries a failed health check before authenticating", async () => {
    vi.useFakeTimers();
    apiMocks.health
      .mockRejectedValueOnce(new Error("starting"))
      .mockResolvedValueOnce({ status: "ok" });
    apiMocks.ensureAuthToken.mockResolvedValue("token");
    const { result } = renderHook(() => useBackendReady());

    const ready = result.current.ensureBackendReady();
    await vi.advanceTimersByTimeAsync(500);
    await expect(ready).resolves.toBeUndefined();

    expect(apiMocks.health).toHaveBeenCalledTimes(2);
    expect(apiMocks.ensureAuthToken).toHaveBeenCalledOnce();
  });

  it("returns the final Error after the retry budget is exhausted", async () => {
    vi.useFakeTimers();
    const finalError = new Error("backend unavailable");
    apiMocks.health.mockRejectedValue(finalError);
    const { result } = renderHook(() => useBackendReady());

    const ready = result.current.ensureBackendReady();
    const rejected = expect(ready).rejects.toBe(finalError);
    await vi.advanceTimersByTimeAsync(60_000);
    await rejected;

    expect(apiMocks.health).toHaveBeenCalledTimes(120);
    expect(apiMocks.ensureAuthToken).not.toHaveBeenCalled();
  });
});
