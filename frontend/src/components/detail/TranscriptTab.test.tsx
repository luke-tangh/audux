import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../../api";
import { LocaleProvider } from "../../i18n/LocaleProvider";
import type { Transcript } from "../../types";
import { DialogProvider } from "../dialog/UnifiedDialog";
import TranscriptTab from "./TranscriptTab";

const transcript: Transcript = {
  transcript: {
    id: 11,
    audio_id: 7,
    revision_number: 2,
    parent_revision_id: 10,
    is_current: true,
    source_type: "manual",
    provider_name: "fixture-asr",
    language: "zh",
    full_text: "开场\n结尾",
    model_name: "fixture-model",
    status: "done",
    generated_at: "2026-08-19T00:00:00Z",
    updated_at: "2026-08-19T00:00:00Z"
  },
  segments: [
    {
      id: 21,
      transcript_id: 11,
      segment_index: 0,
      start_seconds: 0,
      end_seconds: 2,
      text: "开场"
    },
    {
      id: 22,
      transcript_id: 11,
      segment_index: 1,
      start_seconds: 2,
      end_seconds: 4,
      text: "结尾"
    }
  ],
  chapters: [
    {
      id: 31,
      transcript_id: 11,
      chapter_index: 0,
      title: "完整章节",
      start_seconds: 0,
      end_seconds: 4,
      source_type: "user",
      created_at: "2026-08-19T00:00:00Z",
      updated_at: "2026-08-19T00:00:00Z"
    }
  ],
  issues: [
    {
      id: 41,
      audio_id: 7,
      transcript_id: 11,
      segment_id: 21,
      code: "review.required",
      severity: "warning",
      evidence: { segment_index: 0 },
      status: "open",
      created_at: "2026-08-19T00:00:00Z",
      updated_at: "2026-08-19T00:00:00Z"
    }
  ]
};

function renderTranscript(
  overrides: Partial<ComponentProps<typeof TranscriptTab>> = {}
) {
  const props: ComponentProps<typeof TranscriptTab> = {
    audioId: 7,
    transcript,
    onTranscriptChanged: vi.fn(),
    onTranscribe: vi.fn(),
    onExportTranscript: vi.fn(),
    onJumpToSegment: vi.fn(),
    onSaveFullTranscript: vi.fn().mockResolvedValue("saved"),
    onSaveTranscriptSegments: vi.fn().mockResolvedValue("saved"),
    canEdit: true,
    ...overrides
  };

  render(
    <LocaleProvider>
      <DialogProvider>
        <TranscriptTab {...props} />
      </DialogProvider>
    </LocaleProvider>
  );
  return props;
}

describe("TranscriptTab revision workspace", () => {
  beforeEach(() => {
    vi.spyOn(api, "listTranscriptRevisions").mockResolvedValue([
      transcript.transcript,
      { ...transcript.transcript, id: 10, revision_number: 1, is_current: false }
    ]);
    vi.spyOn(api, "getTranscript").mockResolvedValue(transcript);
    vi.spyOn(api, "updateTranscriptIssue").mockResolvedValue(transcript.issues![0]);
    vi.spyOn(api, "createTranscriptChapter").mockResolvedValue(transcript.chapters![0]);
  });

  it("shows provenance and closes a structured quality issue", async () => {
    const props = renderTranscript();

    expect(screen.getByText("#2")).toBeInTheDocument();
    expect(screen.getByText(/warning · review.required · open/)).toBeInTheDocument();
    expect(screen.getByText("完整章节")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /标记已解决|Mark resolved/ }));
    await waitFor(() => {
      expect(api.updateTranscriptIssue).toHaveBeenCalledWith(
        7,
        41,
        "resolved",
        "user_confirmed"
      );
      expect(props.onTranscriptChanged).toHaveBeenCalledWith(transcript);
    });
  });

  it("saves a segment revision and creates a chapter from the timeline", async () => {
    const onSaveTranscriptSegments = vi.fn().mockResolvedValue("saved");
    renderTranscript({ onSaveTranscriptSegments });

    fireEvent.click(screen.getByRole("button", { name: /编辑分段|Edit segments/ }));
    const firstSegment = screen.getByRole("textbox", { name: /第 1 段文本|Segment 1 text/ });
    fireEvent.change(firstSegment, { target: { value: "新开场" } });
    fireEvent.click(screen.getByRole("button", { name: /保存分段修订|Save segment edits/ }));
    await waitFor(() => {
      expect(onSaveTranscriptSegments).toHaveBeenCalledWith(
        [{ id: 21, text: "新开场" }],
        "2026-08-19T00:00:00Z"
      );
    });

    fireEvent.click(screen.getByRole("button", { name: /添加章节|Add chapter/ }));
    const titleInput = screen.getByRole("textbox", { name: /章节标题|Chapter title/ });
    fireEvent.change(titleInput, { target: { value: "新章节" } });
    fireEvent.click(screen.getByRole("button", { name: /确认|Confirm/ }));
    await waitFor(() => {
      expect(api.createTranscriptChapter).toHaveBeenCalledWith(7, {
        expected_revision_id: 11,
        title: "新章节",
        start_seconds: 0,
        end_seconds: 4
      });
    });
  });
});
