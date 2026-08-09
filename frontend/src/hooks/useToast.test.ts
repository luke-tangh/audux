import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useToast } from "./useToast";

describe("useToast", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    vi.spyOn(Math, "random").mockReturnValue(0.25);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("adds and explicitly closes a toast", () => {
    const { result } = renderHook(() => useToast());

    act(() => result.current.notify("Saved", "success"));
    expect(result.current.toasts).toEqual([
      { id: 1000.25, message: "Saved", type: "success" }
    ]);

    act(() => result.current.closeToast(1000.25));
    expect(result.current.toasts).toEqual([]);
  });

  it("uses the normal and extended error timeouts", () => {
    vi.mocked(Math.random)
      .mockReturnValueOnce(0.1)
      .mockReturnValueOnce(0.2);
    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.notify("Info");
      result.current.notify("Failure", "error");
    });
    expect(result.current.toasts.map((toast) => toast.type)).toEqual(["info", "error"]);

    act(() => vi.advanceTimersByTime(3_800));
    expect(result.current.toasts.map((toast) => toast.message)).toEqual(["Failure"]);

    act(() => vi.advanceTimersByTime(4_200));
    expect(result.current.toasts).toEqual([]);
  });
});
