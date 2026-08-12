import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "../i18n/LocaleProvider";
import type { AudioItem } from "../types";
import AudioList from "./AudioList";

const item: AudioItem = {
  id: 1,
  file_path: "/library/example.mp3",
  file_name: "example.mp3",
  title_user: "示例音频",
  author_user: "示例作者",
  duration_seconds: 120,
  language: "zh",
  transcript_status: "none",
  ai_status: "none",
  play_count: 0,
  last_position_seconds: 0,
  is_favorite: false,
  is_missing: false,
  created_at: "2026-08-10T00:00:00Z",
  updated_at: "2026-08-10T00:00:00Z"
};

function renderList(overrides: Partial<React.ComponentProps<typeof AudioList>> = {}) {
  const props: React.ComponentProps<typeof AudioList> = {
    title: "资料库",
    q: "",
    onOpenSettings: vi.fn(),
    onClearFilters: vi.fn(),
    hasActiveFilter: false,
    items: [item],
    totalCount: 1,
    selectionMode: false,
    selectedAudioIds: new Set<number>(),
    onSelect: vi.fn(),
    onPlay: vi.fn(),
    onPlayAt: vi.fn(),
    onAddToQueue: vi.fn(),
    onPlayNext: vi.fn(),
    onEnterSelectionMode: vi.fn(),
    onExitSelectionMode: vi.fn(),
    onToggleAudioSelection: vi.fn(),
    onToggleSelectAllLoaded: vi.fn(),
    onClearAudioSelection: vi.fn(),
    onBatchAddTags: vi.fn(),
    onBatchRemoveTag: vi.fn(),
    onBatchAddToPlaylist: vi.fn(),
    onBatchSetFavorite: vi.fn(),
    onBatchTranscribe: vi.fn(),
    onBatchAnalyze: vi.fn(),
    ...overrides
  };

  render(
    <LocaleProvider>
      <AudioList {...props} />
    </LocaleProvider>
  );
  return props;
}

describe("AudioList hierarchy and actions", () => {
  it("uses an explicit details button and de-emphasizes idle processing", () => {
    const props = renderList();

    fireEvent.click(screen.getByRole("button", { name: /查看音频详情|Open audio details/ }));

    expect(props.onSelect).toHaveBeenCalledWith(item);
    expect(screen.getByText(/尚未处理|Not processed/)).toBeVisible();
    expect(screen.queryByText(/转写.*未开始|Transcript.*Not started/)).toBeNull();
  });

  it("exposes result-wide processing from the list toolbar", () => {
    const onBatchTranscribe = vi.fn();
    renderList({ onBatchTranscribe });

    fireEvent.click(
      screen.getByRole("button", {
        name: /处理当前结果中的 1 个音频|Process all 1 current results/
      })
    );
    fireEvent.click(
      screen.getByRole("menuitem", {
        name: /转写当前结果中的 1 项|Transcribe 1 current results/
      })
    );

    expect(onBatchTranscribe).toHaveBeenCalledOnce();
  });
});
