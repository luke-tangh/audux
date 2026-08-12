import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "../i18n/LocaleProvider";
import type { SavedView } from "../types";
import Sidebar from "./Sidebar";


const savedView: SavedView = {
  id: 10,
  name: "待整理",
  schema_version: 1,
  sort_order: 0,
  created_at: "2026-08-10T00:00:00Z",
  updated_at: "2026-08-10T00:00:00Z",
  query: {
    schema_version: 1,
    view: "library",
    q: "meeting",
    tag_id: null,
    library_root_id: null,
    transcript_filter: "all",
    missing_filter: "all",
    sort: "updated_desc",
    display_mode: "list"
  },
  tag_name: null,
  library_root_path: null,
  invalid_references: [],
  definition_error: null
};

describe("saved views in the sidebar", () => {
  it("keeps only primary shortcuts and orders tags, playlists, then saved views", () => {
    const { container } = render(
      <LocaleProvider>
        <Sidebar
          view="library"
          setView={vi.fn()}
          tags={[{ id: 3, name: "工作", source: "user", created_at: "2026-08-10T00:00:00Z" }]}
          selectedTag={undefined}
          setSelectedTag={vi.fn()}
          playlists={[{
            id: 22,
            name: "通勤",
            created_at: "2026-08-10T00:00:00Z",
            updated_at: "2026-08-10T00:00:00Z"
          }]}
          selectedPlaylistId={null}
          setSelectedPlaylistId={vi.fn()}
          savedViews={[savedView]}
          activeSavedViewId={null}
          onApplySavedView={vi.fn()}
          onRenameSavedView={vi.fn()}
          onCopySavedView={vi.fn()}
          onCreateSmartPlaylist={vi.fn()}
          onDeleteSavedView={vi.fn()}
          onMoveSavedView={vi.fn()}
          onDeactivateSavedView={vi.fn()}
          onOpenPlaylist={vi.fn()}
          onCreatePlaylist={vi.fn().mockResolvedValue(true)}
        />
      </LocaleProvider>
    );

    const navigation = container.querySelector(".sidebar-nav");
    expect(navigation).not.toBeNull();
    expect(within(navigation as HTMLElement).queryByText(/已转写|Transcribed/)).toBeNull();
    expect(within(navigation as HTMLElement).queryByText(/文件缺失|Missing files/)).toBeNull();
    expect(within(navigation as HTMLElement).queryByText(/AI 失败|AI failed/)).toBeNull();

    const tagsHeading = screen.getByRole("heading", { name: /标签|Tags/ });
    const playlistsHeading = screen.getByRole("heading", { name: /播放列表|Playlists/ });
    const savedViewsHeading = screen.getByRole("heading", { name: /保存视图|Saved views/ });
    expect(tagsHeading.compareDocumentPosition(playlistsHeading)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
    expect(playlistsHeading.compareDocumentPosition(savedViewsHeading)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );

    expect(
      screen.getByRole("button", { name: /资料库.*全部音频|Library.*All audio/ })
    ).toHaveAttribute("aria-current", "page");
    const allTags = screen.getByRole("button", { name: /全部标签|All tags/ });
    expect(allTags).toHaveAttribute("aria-pressed", "false");
    expect(allTags).not.toHaveClass("active");
  });

  it("applies and exposes explicit management actions for the active view", () => {
    const actions = {
      onApplySavedView: vi.fn(),
      onRenameSavedView: vi.fn(),
      onCopySavedView: vi.fn(),
      onCreateSmartPlaylist: vi.fn(),
      onDeleteSavedView: vi.fn(),
      onMoveSavedView: vi.fn(),
      onDeactivateSavedView: vi.fn(),
      onOpenPlaylist: vi.fn()
    };

    render(
      <LocaleProvider>
        <Sidebar
          view="library"
          setView={vi.fn()}
          tags={[]}
          selectedTag={undefined}
          setSelectedTag={vi.fn()}
          playlists={[]}
          selectedPlaylistId={null}
          setSelectedPlaylistId={vi.fn()}
          savedViews={[savedView, { ...savedView, id: 11, name: "第二个" }]}
          activeSavedViewId={savedView.id}
          {...actions}
          onCreatePlaylist={vi.fn().mockResolvedValue(true)}
        />
      </LocaleProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: savedView.name }));
    fireEvent.click(screen.getByRole("button", { name: /重命名视图|Rename view/ }));
    fireEvent.click(screen.getByRole("button", { name: /复制视图|Copy view/ }));
    fireEvent.click(screen.getByRole("button", { name: /创建智能播放列表|Create a smart playlist/ }));
    fireEvent.click(screen.getByRole("button", { name: /下移视图|Move view.*down/ }));
    fireEvent.click(screen.getByRole("button", { name: /删除视图|Delete view/ }));

    expect(actions.onApplySavedView).toHaveBeenCalledWith(savedView);
    expect(actions.onRenameSavedView).toHaveBeenCalledWith(savedView);
    expect(actions.onCopySavedView).toHaveBeenCalledWith(savedView);
    expect(actions.onCreateSmartPlaylist).toHaveBeenCalledWith(savedView);
    expect(actions.onMoveSavedView).toHaveBeenCalledWith(savedView.id, 1);
    expect(actions.onDeleteSavedView).toHaveBeenCalledWith(savedView);
  });

  it("visually distinguishes and opens a smart playlist", () => {
    const smartPlaylist = {
      id: 22,
      name: "动态通勤",
      kind: "smart" as const,
      current_count: 18,
      created_at: "2026-08-10T00:00:00Z",
      updated_at: "2026-08-10T00:00:00Z"
    };
    const onOpenPlaylist = vi.fn();

    render(
      <LocaleProvider>
        <Sidebar
          view="playlist"
          setView={vi.fn()}
          tags={[]}
          selectedTag={undefined}
          setSelectedTag={vi.fn()}
          playlists={[smartPlaylist]}
          selectedPlaylistId={smartPlaylist.id}
          setSelectedPlaylistId={vi.fn()}
          savedViews={[]}
          activeSavedViewId={null}
          onApplySavedView={vi.fn()}
          onRenameSavedView={vi.fn()}
          onCopySavedView={vi.fn()}
          onCreateSmartPlaylist={vi.fn()}
          onDeleteSavedView={vi.fn()}
          onMoveSavedView={vi.fn()}
          onDeactivateSavedView={vi.fn()}
          onOpenPlaylist={onOpenPlaylist}
          onCreatePlaylist={vi.fn().mockResolvedValue(true)}
        />
      </LocaleProvider>
    );

    const row = screen.getByRole("button", { name: /动态通勤.*18/ });
    expect(row.className).toContain("smart-playlist-row");
    fireEvent.click(row);
    expect(onOpenPlaylist).toHaveBeenCalledWith(smartPlaylist);
  });

  it("creates a playlist from the playlist-section popover", async () => {
    const onCreatePlaylist = vi.fn().mockResolvedValue(true);

    render(
      <LocaleProvider>
        <Sidebar
          view="library"
          setView={vi.fn()}
          tags={[]}
          selectedTag={undefined}
          setSelectedTag={vi.fn()}
          playlists={[]}
          selectedPlaylistId={null}
          setSelectedPlaylistId={vi.fn()}
          savedViews={[]}
          activeSavedViewId={null}
          onApplySavedView={vi.fn()}
          onRenameSavedView={vi.fn()}
          onCopySavedView={vi.fn()}
          onCreateSmartPlaylist={vi.fn()}
          onDeleteSavedView={vi.fn()}
          onMoveSavedView={vi.fn()}
          onDeactivateSavedView={vi.fn()}
          onOpenPlaylist={vi.fn()}
          onCreatePlaylist={onCreatePlaylist}
        />
      </LocaleProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: /创建播放列表|Create playlist/ }));
    const popover = screen.getByRole("dialog", { name: /创建播放列表|Create playlist/ });
    fireEvent.change(within(popover).getByRole("textbox"), {
      target: { value: "通勤精选" }
    });
    fireEvent.click(within(popover).getByRole("button", { name: /创建|Create/ }));

    await waitFor(() => expect(onCreatePlaylist).toHaveBeenCalledWith("通勤精选"));
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: /创建播放列表|Create playlist/ })).toBeNull();
    });
  });
});
