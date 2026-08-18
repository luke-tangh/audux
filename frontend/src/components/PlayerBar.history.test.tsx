import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../api";
import { DialogProvider } from "./dialog/UnifiedDialog";
import { LocaleProvider } from "../i18n/LocaleProvider";
import type { AudioItem, PlaybackEvent } from "../types";
import PlayerBar from "./PlayerBar";

vi.mock("../api", () => ({
  api: {
    audioFileUrl: vi.fn(() => "http://127.0.0.1/audio.mp3"),
    updatePlaybackPosition: vi.fn().mockResolvedValue({ ok: true }),
    startPlaybackEvent: vi.fn(),
    updatePlaybackEvent: vi.fn()
  }
}));

const audio: AudioItem = {
  id: 7,
  file_path: "/library/history.mp3",
  file_name: "history.mp3",
  title_user: "History",
  duration_seconds: 120,
  transcript_status: "none",
  ai_status: "none",
  play_count: 0,
  last_position_seconds: 0,
  is_favorite: false,
  is_missing: false,
  created_at: "2026-08-18T00:00:00",
  updated_at: "2026-08-18T00:00:00"
};

const playbackEvent: PlaybackEvent = {
  id: 44,
  audio_id: audio.id,
  started_at: "2026-08-18T00:00:00",
  start_position_seconds: 0,
  end_position_seconds: 0,
  listened_seconds: 0,
  completed: false
};

beforeEach(() => {
  vi.mocked(api.startPlaybackEvent).mockResolvedValue(playbackEvent);
  vi.mocked(api.updatePlaybackEvent).mockResolvedValue(playbackEvent);
  vi.mocked(api.updatePlaybackPosition).mockResolvedValue({ ok: true });
  vi.stubGlobal("HTMLMediaElement", window.HTMLMediaElement);
  vi.spyOn(window.HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
  vi.spyOn(window.HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
});

describe("PlayerBar listening history", () => {
  it("starts on real playback and records active wall-clock time across pause and close", async () => {
    let now = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const { container, unmount } = render(
      <LocaleProvider>
        <DialogProvider>
          <PlayerBar
            audio={audio}
            queue={[audio]}
            queueIndex={0}
            playRequestId={0}
            canPrevious={false}
            canNext={false}
            onPrevious={vi.fn()}
            onNext={vi.fn()}
            onQueueSelect={vi.fn()}
            onQueueRemove={vi.fn()}
            onQueueMove={vi.fn()}
            onQueueClear={vi.fn()}
            onPositionSaved={vi.fn()}
          />
        </DialogProvider>
      </LocaleProvider>
    );
    const element = container.querySelector("audio") as HTMLAudioElement;

    expect(api.startPlaybackEvent).not.toHaveBeenCalled();
    fireEvent.play(element);
    await waitFor(() => expect(api.startPlaybackEvent).toHaveBeenCalledWith(audio.id, 0));

    now = 4_500;
    element.currentTime = 3.5;
    fireEvent.pause(element);
    await waitFor(() => expect(api.updatePlaybackEvent).toHaveBeenCalledWith(
      playbackEvent.id,
      expect.objectContaining({
        listened_seconds: 3.5,
        end_position_seconds: 3.5,
        finish: false,
        end_reason: "paused"
      })
    ));

    await act(async () => unmount());
    expect(api.updatePlaybackEvent).toHaveBeenLastCalledWith(
      playbackEvent.id,
      expect.objectContaining({
        listened_seconds: 3.5,
        finish: true,
        end_reason: "track_change"
      })
    );
  });
});
