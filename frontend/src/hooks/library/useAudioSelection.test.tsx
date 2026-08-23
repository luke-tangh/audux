import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { AudioItem } from "../../types";
import "../../i18n";
import { useAudioSelection } from "./useAudioSelection";

function audio(id: number): AudioItem {
  return { id, file_name: `${id}.mp3` } as AudioItem;
}

describe("useAudioSelection", () => {
  it("enters, toggles and resets selection", () => {
    const notify = vi.fn();
    const { result } = renderHook(() =>
      useAudioSelection({ items: [audio(1), audio(2)], notify })
    );

    act(() => {
      result.current.enter();
      result.current.toggle(1);
    });
    expect(result.current.selectionMode).toBe(true);
    expect([...result.current.selectedAudioIds]).toEqual([1]);

    act(() => result.current.toggleAllLoaded());
    expect([...result.current.selectedAudioIds]).toEqual([1, 2]);

    act(() => result.current.reset());
    expect(result.current.selectionMode).toBe(false);
    expect(result.current.selectedAudioIds.size).toBe(0);
  });
});
