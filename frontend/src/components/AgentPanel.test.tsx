import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../api";
import { LocaleProvider } from "../i18n/LocaleProvider";
import type { AgentConversation } from "../types";
import AgentPanel from "./AgentPanel";

vi.mock("../api", () => ({
  api: {
    listAgentConversations: vi.fn(),
    createAgentConversation: vi.fn(),
    getAgentConversation: vi.fn(),
    updateAgentConversation: vi.fn(),
    deleteAgentConversation: vi.fn(),
    createAgentRun: vi.fn(),
    getAgentRun: vi.fn(),
    cancelAgentRun: vi.fn(),
    agentConversationExportUrl: vi.fn((id: number) => `http://test/agent/${id}`)
  }
}));

const conversation: AgentConversation = {
  id: 7,
  title: "新会话",
  scope: { kind: "library" },
  scope_label: "整个资料库",
  scope_audio_count: 2,
  created_at: "2026-08-20T00:00:00Z",
  updated_at: "2026-08-20T00:00:00Z",
  messages: [],
  runs: []
};

function renderPanel(onPlayCitation = vi.fn().mockResolvedValue(undefined)) {
  render(
    <LocaleProvider>
      <AgentPanel
        selected={null}
        selectedAudioIds={new Set()}
        selectedPlaylistId={null}
        activeSavedViewId={null}
        playlists={[]}
        savedViews={[]}
        tags={[]}
        roots={[]}
        notify={vi.fn()}
        onPlayCitation={onPlayCitation}
      />
    </LocaleProvider>
  );
  return onPlayCitation;
}

describe("AgentPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.listAgentConversations).mockResolvedValue([]);
    vi.mocked(api.createAgentConversation).mockResolvedValue(conversation);
    vi.mocked(api.getAgentConversation).mockResolvedValue(conversation);
    vi.mocked(api.createAgentRun).mockResolvedValue({
      id: 9,
      conversation_id: 7,
      user_message_id: 8,
      status: "pending",
      scope: { kind: "library" },
      retrieval_mode: "fts",
      created_at: "2026-08-20T00:00:00Z",
      updated_at: "2026-08-20T00:00:00Z"
    });
  });

  it("creates a scoped conversation and starts a persistent run", async () => {
    renderPanel();
    const question = await screen.findByLabelText(/问题|Question/);
    fireEvent.change(question, { target: { value: "长期记忆有哪些建议？" } });
    fireEvent.click(screen.getByRole("button", { name: /发送|Send/ }));

    await waitFor(() => {
      expect(api.createAgentConversation).toHaveBeenCalledWith({ scope: { kind: "library" } });
      expect(api.createAgentRun).toHaveBeenCalledWith(7, "长期记忆有哪些建议？");
    });
  });

  it("opens a validated citation at its timestamp", async () => {
    const withCitation: AgentConversation = {
      ...conversation,
      messages: [{
        id: 11,
        conversation_id: 7,
        role: "assistant",
        content: "练习有帮助。[C1]",
        created_at: "2026-08-20T00:00:01Z",
        citations: [{
          id: 12,
          run_id: 9,
          message_id: 11,
          audio_id: 3,
          audio_title: "记忆访谈",
          transcript_id: 5,
          segment_id: 6,
          start_seconds: 42,
          end_seconds: 48,
          quote: "间隔练习能改善长期记忆",
          label: "C1",
          created_at: "2026-08-20T00:00:01Z"
        }]
      }]
    };
    vi.mocked(api.listAgentConversations).mockResolvedValue([conversation]);
    vi.mocked(api.getAgentConversation).mockResolvedValue(withCitation);
    const onPlayCitation = renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: /C1.*记忆访谈/ }));
    expect(onPlayCitation).toHaveBeenCalledWith(3, 42);
  });
});
