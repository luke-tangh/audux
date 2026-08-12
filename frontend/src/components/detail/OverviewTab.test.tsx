import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "../../i18n/LocaleProvider";
import type { AudioItem, Playlist, Tag } from "../../types";
import OverviewTab from "./OverviewTab";

const audio = {
  id: 1,
  file_path: "/library/episode.mp3",
  file_name: "episode.mp3",
  file_ext: "mp3",
  title_original: "文件标题",
  author_original: "文件作者",
  description_ai: "AI 生成的描述",
  duration_seconds: 120,
  bitrate: 192000,
  sample_rate: 48000,
  channels: 2,
  transcript_status: "done",
  ai_status: "done",
  play_count: 0,
  last_position_seconds: 0,
  is_favorite: false,
  is_missing: false,
  created_at: "2026-08-08T00:00:00Z",
  updated_at: "2026-08-08T00:00:00Z"
} satisfies AudioItem;

const availableTags: Tag[] = [
  { id: 2, name: "知识", source: "user", created_at: "2026-08-08T00:00:00Z" }
];

const playlists: Playlist[] = [
  {
    id: 3,
    name: "稍后收听",
    kind: "manual",
    created_at: "2026-08-08T00:00:00Z",
    updated_at: "2026-08-08T00:00:00Z"
  }
];

function renderOverview(
  overrides: Partial<ComponentProps<typeof OverviewTab>> = {}
) {
  const props: ComponentProps<typeof OverviewTab> = {
    audio,
    editing: {
      title_user: "",
      author_user: "",
      album_user: "",
      description_user: "",
      language: "",
      is_favorite: false
    },
    onEditingChange: vi.fn(),
    tags: [],
    availableExistingTags: availableTags,
    tagInput: "知识",
    onTagInputChange: vi.fn(),
    onAddTags: vi.fn(),
    onRemoveTag: vi.fn(),
    playlists,
    selectedPlaylist: "",
    onSelectedPlaylistChange: vi.fn(),
    selectedPlaylistId: null,
    onAddToPlaylist: vi.fn(),
    onExportPlaylist: vi.fn(),
    transcriptLanguage: "zh-CN",
    isSaving: false,
    ...overrides
  };

  render(
    <LocaleProvider>
      <OverviewTab {...props} />
    </LocaleProvider>
  );

  return props;
}

describe("OverviewTab metadata workflow", () => {
  it("shows file provenance and the effective description source", () => {
    const props = renderOverview();

    expect(screen.getByText(/文件值：文件标题|File value: 文件标题/)).toBeInTheDocument();
    expect(screen.getByText("AI 生成的描述")).toBeInTheDocument();
    expect(screen.getByText(/来源：AI|Source: AI/)).toBeInTheDocument();

    const languageField = screen.getByRole("combobox", { name: /语言|Language/ });
    expect(languageField).toHaveAttribute("list");
    fireEvent.click(
      screen.getByRole("button", {
        name: /采用转写检测值 zh-CN|Use detected transcript language zh-CN/
      })
    );
    expect(props.onEditingChange).toHaveBeenCalledWith({ language: "zh-CN" });
    expect(screen.getByText(/整理与播放列表|Organization and playlists/)).toBeInTheDocument();
  });

  it("adds a suggested or new tag with Enter from one combined field", () => {
    const onAddTags = vi.fn();
    renderOverview({ onAddTags });

    fireEvent.keyDown(
      screen.getByRole("combobox", { name: /添加标签|Add tags/ }),
      { key: "Enter" }
    );

    expect(onAddTags).toHaveBeenCalledOnce();
  });

  it("clears custom values without touching language or favorite state", () => {
    const onEditingChange = vi.fn();
    renderOverview({
      editing: {
        title_user: "自定义标题",
        author_user: "自定义作者",
        album_user: "自定义专辑",
        description_user: "自定义描述",
        language: "zh-CN",
        is_favorite: true
      },
      onEditingChange
    });

    fireEvent.click(
      screen.getByRole("button", { name: /清除自定义值|Clear custom values/ })
    );

    expect(onEditingChange).toHaveBeenCalledWith({
      title_user: "",
      author_user: "",
      album_user: "",
      description_user: ""
    });
  });
});
