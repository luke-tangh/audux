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
          onBatchTranscribe={vi.fn()}
          onBatchAnalyze={vi.fn()}
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
        name: /处理当前结果中的 2 个音频|Process all 2 current results/
      }),
      screen.getByRole("button", { name: /保存视图|Save view/ })
    ];
    for (let index = 0; index < orderedControls.length - 1; index += 1) {
      expect(
        orderedControls[index].compareDocumentPosition(orderedControls[index + 1])
      ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    }
    fireEvent.click(orderedControls[2]);
    expect(
      screen.getByRole("menuitem", {
        name: /转写当前结果中的 2 项|Transcribe 2 current results/
      })
    ).toBeVisible();
    expect(
      screen.getByRole("menuitem", {
        name: /AI 分析当前结果中的 2 项|Analyze 2 current results with AI/
      })
    ).toBeVisible();

    fireEvent.click(
      screen.getByRole("combobox", { name: /按资料库文件筛选|Filter library files/ })
    );
    fireEvent.click(screen.getByRole("option", { name: /已有转写|Has transcript/ }));

    expect(setMissingFilter).toHaveBeenCalledWith("all");
    expect(setHasTranscriptFilter).toHaveBeenCalledWith("yes");
    expect(
      screen.queryByRole("button", { name: /打开设置|Open settings/ })
    ).toBeNull();
  });
});
