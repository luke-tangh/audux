import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "../i18n/LocaleProvider";
import TopBar from "./TopBar";

describe("TopBar file filter", () => {
  it("offers AI failures in the library-file dropdown", () => {
    const setMissingFilter = vi.fn();

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
          setHasTranscriptFilter={vi.fn()}
          missingFilter="all"
          setMissingFilter={setMissingFilter}
          sortMode="default"
          setSortMode={vi.fn()}
          roots={[]}
          setSelectedLibraryRootId={vi.fn()}
          savedViewDirty={false}
          canSaveView={false}
          onSaveView={vi.fn()}
          onUpdateSavedView={vi.fn()}
          onBatchTranscribe={vi.fn()}
          onBatchAnalyze={vi.fn()}
          onOpenSettings={vi.fn()}
        />
      </LocaleProvider>
    );

    fireEvent.click(
      screen.getByRole("combobox", { name: /按文件状态筛选|Filter by file status/ })
    );
    fireEvent.click(screen.getByRole("option", { name: /AI 失败|AI failed/ }));

    expect(setMissingFilter).toHaveBeenCalledWith("aiFailed");
  });
});
