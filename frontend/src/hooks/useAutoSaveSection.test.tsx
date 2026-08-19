import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useAutoSaveSection } from "./useAutoSaveSection";

type HarnessProps = {
  value: string;
  save: (value: string) => Promise<void>;
};

function Harness({ value, save }: HarnessProps) {
  const autoSave = useAutoSaveSection({
    value,
    signature: value,
    enabled: true,
    resetVersion: 1,
    delay: 800,
    save
  });

  return (
    <div>
      <span data-testid="status">{autoSave.status}</span>
      <span data-testid="dirty">{String(autoSave.isDirty)}</span>
    </div>
  );
}

describe("useAutoSaveSection", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not save the hydrated value and debounces rapid changes", async () => {
    vi.useFakeTimers();
    const save = vi.fn().mockResolvedValue(undefined);
    const view = render(<Harness value="initial" save={save} />);

    await act(async () => {});
    expect(save).not.toHaveBeenCalled();

    view.rerender(<Harness value="one" save={save} />);
    view.rerender(<Harness value="latest" save={save} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(799);
    });
    expect(save).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(save).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledWith("latest");
    expect(screen.getByTestId("status")).toHaveTextContent("saved");
    expect(screen.getByTestId("dirty")).toHaveTextContent("false");
  });

  it("serializes a newer value behind an in-flight save", async () => {
    vi.useFakeTimers();
    let finishFirst: (() => void) | null = null;
    const firstSave = new Promise<void>((resolve) => {
      finishFirst = resolve;
    });
    const save = vi
      .fn<(value: string) => Promise<void>>()
      .mockReturnValueOnce(firstSave)
      .mockResolvedValue(undefined);
    const view = render(<Harness value="initial" save={save} />);
    await act(async () => {});

    view.rerender(<Harness value="one" save={save} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(save).toHaveBeenCalledWith("one");

    view.rerender(<Harness value="two" save={save} />);
    expect(save).toHaveBeenCalledOnce();
    await act(async () => {
      finishFirst?.();
      await firstSave;
    });

    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith("two");
    expect(screen.getByTestId("dirty")).toHaveTextContent("false");
  });
});
