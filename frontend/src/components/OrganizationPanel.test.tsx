import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../api";
import { LocaleProvider } from "../i18n/LocaleProvider";
import type { OrganizationRun } from "../types";
import OrganizationPanel from "./OrganizationPanel";

vi.mock("../api", () => ({
  api: {
    listOrganizationRuns: vi.fn(),
    getOrganizationRun: vi.fn(),
    createOrganizationRun: vi.fn(),
    decideOrganizationProposal: vi.fn(),
    applyOrganizationRun: vi.fn()
  }
}));

const run: OrganizationRun = {
  id: 8,
  status: "awaiting_review",
  current_stage: "review",
  scope: { kind: "audio", audio_id: 7 },
  options: {
    transcribe_missing: false,
    generate_corrections: true,
    generate_tags: true,
    generate_description: true,
    generate_chapters: true
  },
  target_count: 1,
  processed_count: 1,
  failed_count: 0,
  pending_review_count: 1,
  remote_characters: 12,
  created_at: "2026-08-23T00:00:00Z",
  updated_at: "2026-08-23T00:00:01Z",
  steps: [{
    id: 1,
    run_id: 8,
    stage: "review",
    step_index: 3,
    status: "running",
    processed_count: 1,
    failed_count: 0,
    updated_at: "2026-08-23T00:00:01Z"
  }],
  proposals: [{
    id: 20,
    run_id: 8,
    audio_id: 7,
    source_transcript_id: 3,
    source_segment_id: 4,
    kind: "correction",
    status: "pending",
    original_value: { text: "Audx" },
    proposed_value: { text: "Audux" },
    evidence: [{ segment_id: 4, start_seconds: 2, end_seconds: 3, quote: "Audx" }],
    diff: [{ op: "insert", before: "", after: "u" }],
    rationale: "品牌名拼写",
    confidence: "high",
    created_at: "2026-08-23T00:00:01Z",
    updated_at: "2026-08-23T00:00:01Z"
  }]
};

const props = {
  selected: { id: 7, file_path: "/library/a.mp3", file_name: "a.mp3", title_original: "A", transcript_status: "done", ai_status: "none", play_count: 0, last_position_seconds: 0, is_favorite: false, is_missing: false, created_at: "", updated_at: "" },
  selectedAudioIds: new Set<number>(),
  selectedPlaylistId: null,
  activeSavedViewId: null,
  playlists: [],
  savedViews: [],
  tags: [],
  roots: [],
  notify: vi.fn(),
  onPlayEvidence: vi.fn().mockResolvedValue(undefined)
};

function renderPanel() {
  return render(
    <LocaleProvider>
      <OrganizationPanel {...props} />
    </LocaleProvider>
  );
}

describe("OrganizationPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.listOrganizationRuns).mockResolvedValue([run]);
    vi.mocked(api.getOrganizationRun).mockResolvedValue(run);
    vi.mocked(api.createOrganizationRun).mockResolvedValue({ ...run, id: 9, status: "pending", proposals: [] });
    vi.mocked(api.decideOrganizationProposal).mockResolvedValue({ ...run.proposals![0], status: "accepted" });
    vi.mocked(api.applyOrganizationRun).mockResolvedValue({ ...run, status: "done", pending_review_count: 0 });
  });

  it("creates a frozen run for the selected scope", async () => {
    renderPanel();
    await screen.findByText(/整理 Run #8|Organization run #8/);
    fireEvent.click(screen.getByRole("button", { name: /创建整理 Run|Create organization run/ }));

    await waitFor(() => expect(api.createOrganizationRun).toHaveBeenCalledWith(
      { kind: "library" },
      expect.objectContaining({ generate_corrections: true, transcribe_missing: false })
    ));
  });

  it("accepts an edited correction and plays its evidence", async () => {
    renderPanel();
    const editor = await screen.findByRole("textbox", { name: /接受前编辑|Edit before accepting/ });
    expect(screen.getByLabelText(/逐字勘误差异|Exact correction diff/)).toHaveTextContent("u");
    fireEvent.change(editor, { target: { value: "Audux App" } });
    fireEvent.click(screen.getByRole("button", { name: /^(接受|Accept)$/ }));
    await waitFor(() => expect(api.decideOrganizationProposal).toHaveBeenCalledWith(
      20,
      "accepted",
      { text: "Audux App" }
    ));

    fireEvent.click(screen.getByRole("button", { name: /Audx/ }));
    expect(props.onPlayEvidence).toHaveBeenCalledWith(7, 2);
  });
});
