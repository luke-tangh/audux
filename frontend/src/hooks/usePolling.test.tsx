import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { usePolling } from "./usePolling";

afterEach(() => {
  vi.useRealTimers();
});

describe("usePolling", () => {
  it("does not overlap slow tasks", async () => {
    vi.useFakeTimers();
    let finish: (() => void) | undefined;
    const task = vi.fn(() => new Promise<void>((resolve) => {
      finish = resolve;
    }));

    renderHook(() => usePolling({ task, intervalMs: 100, immediate: true }));
    expect(task).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(task).toHaveBeenCalledTimes(1);

    await act(async () => {
      finish?.();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(99);
    });
    expect(task).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(task).toHaveBeenCalledTimes(2);
  });

  it("stops scheduling after unmount", async () => {
    vi.useFakeTimers();
    const task = vi.fn(async () => undefined);
    const { unmount } = renderHook(() =>
      usePolling({ task, intervalMs: 100, immediate: false })
    );

    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(task).not.toHaveBeenCalled();
  });

  it("reports failures and continues polling", async () => {
    vi.useFakeTimers();
    const error = new Error("offline");
    const task = vi.fn().mockRejectedValueOnce(error).mockResolvedValue(undefined);
    const onError = vi.fn();

    renderHook(() => usePolling({ task, onError, intervalMs: 100, immediate: true }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(onError).toHaveBeenCalledWith(error);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(task).toHaveBeenCalledTimes(2);
  });
});
