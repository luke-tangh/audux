import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "../i18n/LocaleProvider";
import TopBar from "./TopBar";

describe("TopBar file filter", () => {
  it("offers AI failures in the library-file dropdown", () => {
    const setMissingFilter = vi.fn();
    const setHasTranscriptFilter = vi.fn();
    const setSelectedLibraryRootId = vi.fn();

    render(
      <LocaleProvider>
        <TopBar
          title="资料库"
          totalCount={2}
          q=""
          setQ={vi.fn()}
          hasActiveFilter={false}
          onClearFilters={vi.fn()}
          hasTranscriptFilter="all"
          setHasTranscriptFilter={setHasTranscriptFilter}
          missingFilter="all"
          setMissingFilter={setMissingFilter}
          roots={[{
            id: 4,
            path: "/audio/interviews",
            is_enabled: true,
            created_at: "2026-08-18T00:00:00Z",
            updated_at: "2026-08-18T00:00:00Z"
          }]}
          selectedLibraryRootId={undefined}
          setSelectedLibraryRootId={setSelectedLibraryRootId}
          sortMode="default"
          setSortMode={vi.fn()}
          savedViewDirty={false}
          canSaveView={false}
          onSaveView={vi.fn()}
          onUpdateSavedView={vi.fn()}
        />
      </LocaleProvider>
    );

    fireEvent.click(
      screen.getByRole("combobox", { name: /按音频处理状态筛选|Filter by audio processing status/ })
    );
    fireEvent.click(screen.getByRole("option", { name: /AI.*失败|AI.*Failed/ }));

    expect(setMissingFilter).toHaveBeenCalledWith("aiFailed");
    expect(setHasTranscriptFilter).toHaveBeenCalledWith("all");
    fireEvent.click(
      screen.getByRole("combobox", {
        name: /按库目录筛选|Filter by library folder/
      })
    );
    fireEvent.click(screen.getByRole("option", { name: "/audio/interviews" }));
    expect(setSelectedLibraryRootId).toHaveBeenCalledWith(4);
    expect(
      screen.queryByRole("combobox", {
        name: /按转写状态筛选|Filter by transcript status/
      })
    ).toBeNull();
  });

  it("moves transcript states into the library-file dropdown", () => {
    const setMissingFilter = vi.fn();
    const setHasTranscriptFilter = vi.fn();

    render(
      <LocaleProvider>
        <TopBar
          title="资料库"
          totalCount={2}
          q=""
          setQ={vi.fn()}
          hasActiveFilter
          onClearFilters={vi.fn()}
          hasTranscriptFilter="all"
          setHasTranscriptFilter={setHasTranscriptFilter}
          missingFilter="all"
          setMissingFilter={setMissingFilter}
          sortMode="default"
          setSortMode={vi.fn()}
          savedViewDirty={false}
          canSaveView
          onSaveView={vi.fn()}
          onUpdateSavedView={vi.fn()}
        />
      </LocaleProvider>
    );

    const orderedControls = [
      screen.getByRole("combobox", {
        name: /按音频处理状态筛选|Filter by audio processing status/
      }),
      screen.getByRole("combobox", {
        name: /选择资料库排序方式|Choose library sort order/
      }),
      screen.getByRole("button", { name: /保存视图|Save view/ })
    ];
    for (let index = 0; index < orderedControls.length - 1; index += 1) {
      expect(
        orderedControls[index].compareDocumentPosition(orderedControls[index + 1])
      ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    }
    fireEvent.click(
      screen.getByRole("combobox", { name: /按音频处理状态筛选|Filter by audio processing status/ })
    );
    fireEvent.click(screen.getByRole("option", { name: /转写.*已完成|Transcript.*Complete/ }));

    expect(setMissingFilter).toHaveBeenCalledWith("all");
    expect(setHasTranscriptFilter).toHaveBeenCalledWith("yes");
    expect(
      screen.queryByRole("button", { name: /打开设置|Open settings/ })
    ).toBeNull();
  });

  it("shows removable chips for active search and sort criteria", () => {
    const setQ = vi.fn();
    const setSortMode = vi.fn();

    render(
      <LocaleProvider>
        <TopBar
          title="资料库"
          totalCount={2}
          q="meeting"
          setQ={setQ}
          hasActiveFilter
          onClearFilters={vi.fn()}
          hasTranscriptFilter="all"
          setHasTranscriptFilter={vi.fn()}
          missingFilter="all"
          setMissingFilter={vi.fn()}
          sortMode="updated_desc"
          setSortMode={setSortMode}
          savedViewDirty={false}
          canSaveView
          onSaveView={vi.fn()}
          onUpdateSavedView={vi.fn()}
        />
      </LocaleProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: /移除搜索条件|Remove search filter/ }));
    fireEvent.click(screen.getByRole("button", { name: /恢复默认排序|Restore default order/ }));

    expect(setQ).toHaveBeenCalledWith("");
    expect(setSortMode).toHaveBeenCalledWith("default");
  });
});
