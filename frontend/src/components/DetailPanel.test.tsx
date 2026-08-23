import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AudioItem } from "../types";
import { DialogProvider } from "./dialog/UnifiedDialog";
import "../i18n";

const apiMocks = vi.hoisted(() => ({
  getAudioDetail: vi.fn(),
  listTags: vi.fn(),
  getTranscript: vi.fn(),
  getAiSuggestions: vi.fn()
}));

vi.mock("../api", () => ({
  api: apiMocks,
  endpointPrivacyWarning: () => null,
  ApiError: class ApiError extends Error {}
}));
vi.mock("../tauri", () => ({ pickAudioFile: vi.fn() }));
vi.mock("./detail/DetailHero", () => ({ default: () => <div>detail-hero</div> }));
vi.mock("./detail/OverviewTab", () => ({
  default: ({ editing }: { editing: Partial<AudioItem> }) => (
    <div>overview:{editing.title_user}</div>
  )
}));
vi.mock("./detail/TranscriptTab", () => ({ default: () => <div>transcript-tab</div> }));
vi.mock("./detail/AiTab", () => ({ default: () => <div>ai-tab</div> }));
vi.mock("./detail/FileTab", () => ({ default: () => <div>file-tab</div> }));
vi.mock("./detail/DetailEmptyState", () => ({ default: () => <div>detail-empty</div> }));

import DetailPanel from "./DetailPanel";

function wrapper({ children }: { children: ReactNode }) {
  return <DialogProvider>{children}</DialogProvider>;
}

describe("DetailPanel", () => {
  beforeEach(() => {
    for (const mock of Object.values(apiMocks)) mock.mockReset();
    apiMocks.listTags.mockResolvedValue([]);
    apiMocks.getTranscript.mockResolvedValue(null);
    apiMocks.getAiSuggestions.mockResolvedValue(null);
  });

  it("hydrates editable metadata from audio detail", async () => {
    const audio = {
      id: 4,
      file_name: "episode.mp3",
      title_original: "Original",
      updated_at: "2026-08-23T00:00:00Z"
    } as AudioItem;
    apiMocks.getAudioDetail.mockResolvedValue({
      audio: { ...audio, title_user: "Loaded title", is_favorite: false },
      tags: []
    });

    render(
      <DetailPanel
        audio={audio}
      refresh={vi.fn()}
      onPlay={vi.fn()}
      onPlayAt={vi.fn()}
        onAddToQueue={vi.fn()}
        onPlayNext={vi.fn()}
        playlists={[]}
        onDeleted={vi.fn()}
        onClose={vi.fn()}
      />,
      { wrapper }
    );

    await waitFor(() => expect(apiMocks.getAudioDetail).toHaveBeenCalledWith(4));
    expect(await screen.findByText("overview:Loaded title")).toBeInTheDocument();
    expect(screen.getByText("detail-hero")).toBeInTheDocument();
  });
});
