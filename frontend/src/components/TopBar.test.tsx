import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "../i18n/LocaleProvider";
import TopBar from "./TopBar";

describe("TopBar file filter", () => {
  it("offers AI failures in the library-file dropdown", () => {
    const setMissingFilter = vi.fn();
    const setHasTranscriptFilter = vi.fn();

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
          sortMode="default"
          setSortMode={vi.fn()}
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
      screen.getByRole("combobox", { name: /按资料库文件筛选|Filter library files/ })
    );
    fireEvent.click(screen.getByRole("option", { name: /AI 失败|AI failed/ }));

    expect(setMissingFilter).toHaveBeenCalledWith("aiFailed");
    expect(setHasTranscriptFilter).toHaveBeenCalledWith("all");
    expect(
      screen.queryByRole("combobox", {
        name: /按库目录筛选|Filter by library folder/
      })
    ).toBeNull();
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
          hasActiveFilter={false}
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
          onBatchTranscribe={vi.fn()}
          onBatchAnalyze={vi.fn()}
          onOpenSettings={vi.fn()}
        />
      </LocaleProvider>
    );

    const orderedControls = [
      screen.getByRole("combobox", {
        name: /按资料库文件筛选|Filter library files/
      }),
      screen.getByRole("combobox", {
        name: /选择资料库排序方式|Choose library sort order/
      }),
      screen.getByRole("button", {
        name: /批量转写当前筛选结果|Transcribe current filtered results/
      }),
      screen.getByRole("button", {
        name: /批量 AI 分析当前筛选结果|Run AI analysis/
      }),
      screen.getByRole("button", { name: /保存视图|Save view/ }),
      screen.getByRole("button", { name: /打开设置|Open settings/ })
    ];
    for (let index = 0; index < orderedControls.length - 1; index += 1) {
      expect(
        orderedControls[index].compareDocumentPosition(orderedControls[index + 1])
      ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    }
    expect(orderedControls[2]).toHaveTextContent(/批量转写|Batch transcribe/);
    expect(orderedControls[3]).toHaveTextContent(/批量 AI|Batch AI/);

    fireEvent.click(
      screen.getByRole("combobox", { name: /按资料库文件筛选|Filter library files/ })
    );
    fireEvent.click(screen.getByRole("option", { name: /已有转写|Has transcript/ }));

    expect(setMissingFilter).toHaveBeenCalledWith("all");
    expect(setHasTranscriptFilter).toHaveBeenCalledWith("yes");
  });
});
