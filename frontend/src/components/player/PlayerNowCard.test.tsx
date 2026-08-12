import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LocaleProvider } from "../../i18n/LocaleProvider";
import type { AudioItem } from "../../types";
import PlayerNowCard from "./PlayerNowCard";

const audio: AudioItem = {
  id: 1,
  file_path: "/library/one.mp3",
  file_name: "one.mp3",
  title_user: "一段会被播放器截断的很长音频标题",
  author_user: "示例作者",
  transcript_status: "none",
  ai_status: "none",
  play_count: 0,
  last_position_seconds: 0,
  is_favorite: false,
  is_missing: false,
  created_at: "2026-08-08T00:00:00Z",
  updated_at: "2026-08-08T00:00:00Z"
};

describe("PlayerNowCard", () => {
  it("exposes truncated metadata through native tooltips", () => {
    render(
      <LocaleProvider>
        <PlayerNowCard audio={audio} />
      </LocaleProvider>
    );

    expect(screen.getByText(audio.title_user!)).toHaveAttribute(
      "title",
      audio.title_user
    );
    expect(screen.getByText(audio.author_user!)).toHaveAttribute(
      "title",
      audio.author_user
    );
  });
});
