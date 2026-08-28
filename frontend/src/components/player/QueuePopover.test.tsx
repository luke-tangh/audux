import { createRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { AudioItem } from "../../types";
import QueuePopover from "./QueuePopover";

function audio(id: number, title: string): AudioItem {
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
    created_at: "2026-08-20T00:00:00Z",
    updated_at: "2026-08-20T00:00:00Z"
  };
}

describe("QueuePopover", () => {
  it("supports selection, removal, clearing and keyboard reordering", () => {
    const onSelect = vi.fn();
    const onRemove = vi.fn();
    const onMove = vi.fn();
    const onClear = vi.fn();
    const { container } = render(
      <QueuePopover
        queue={[audio(1, "First"), audio(2, "Second")]}
        queueIndex={0}
        triggerRef={createRef<HTMLButtonElement>()}
        onClose={vi.fn()}
        onSelect={onSelect}
        onRemove={onRemove}
        onMove={onMove}
        onClear={onClear}
      />
    );

    expect(screen.getByRole("dialog")).toHaveAccessibleName(/^(播放队列|Play queue)$/);

    fireEvent.click(container.querySelectorAll<HTMLButtonElement>(".queue-row-main")[1]);
    fireEvent.click(container.querySelectorAll<HTMLButtonElement>(".queue-remove")[1]);
    fireEvent.click(container.querySelector<HTMLButtonElement>(".queue-popover-header button")!);
    fireEvent.keyDown(container.querySelectorAll<HTMLButtonElement>(".queue-drag-handle")[1], {
      key: "ArrowUp"
    });

    expect(onSelect).toHaveBeenCalledWith(1);
    expect(onRemove).toHaveBeenCalledWith(1);
    expect(onClear).toHaveBeenCalled();
    expect(onMove).toHaveBeenCalledWith(1, 0);
  });

  it("closes with Escape and an outside pointer press", () => {
    const onClose = vi.fn();
    const { container } = render(
      <QueuePopover
        queue={[audio(1, "First")]}
        queueIndex={0}
        triggerRef={createRef<HTMLButtonElement>()}
        onClose={onClose}
        onSelect={vi.fn()}
        onRemove={vi.fn()}
        onMove={vi.fn()}
        onClear={vi.fn()}
      />
    );

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    fireEvent.pointerDown(document.body);

    expect(onClose).toHaveBeenCalledWith(true);
    expect(onClose).toHaveBeenCalledWith(false);
    expect(container.querySelector('[aria-current="true"]')).toHaveFocus();
  });
});
