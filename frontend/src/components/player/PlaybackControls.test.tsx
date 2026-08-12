import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "../../i18n/LocaleProvider";
import PlaybackControls from "./PlaybackControls";

function renderControls(overrides: Partial<Parameters<typeof PlaybackControls>[0]> = {}) {
  const props = {
    hasAudio: true,
    isPlaying: false,
    canPrevious: true,
    canNext: true,
    current: 97,
    duration: 3723,
    progress: (97 / 3723) * 100,
    onPrevious: vi.fn(),
    onNext: vi.fn(),
    onToggle: vi.fn(),
    onSeek: vi.fn(),
    ...overrides
  };

  render(
    <LocaleProvider>
      <PlaybackControls {...props} />
    </LocaleProvider>
  );

  return props;
}

describe("PlaybackControls", () => {
  it("keeps play between the previous and next controls without a reset action", () => {
    renderControls();
    const group = screen.getByRole("group", {
      name: /播放器控制|Player controls/
    });
    const buttons = Array.from(group.querySelectorAll("button"));

    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      expect.stringMatching(/上一条|previous/i),
      expect.stringMatching(/开始播放|start playback/i),
      expect.stringMatching(/下一条|next/i)
    ]);
    expect(screen.queryByRole("button", { name: /停止播放|stop playback/i }))
      .not.toBeInTheDocument();
  });

  it("gives the seek slider an accessible time value", () => {
    const props = renderControls();
    const seek = screen.getByRole("slider", {
      name: /播放进度|Playback position/
    });

    expect(seek).toHaveAttribute(
      "aria-valuetext",
      expect.stringMatching(/1:37.*1:02:03|1:37 elapsed of 1:02:03/)
    );

    fireEvent.change(seek, { target: { value: "120" } });
    expect(props.onSeek).toHaveBeenCalledWith(120);
  });

  it("disables seeking until a usable duration is available", () => {
    renderControls({ duration: 0 });

    expect(
      screen.getByRole("slider", { name: /播放进度|Playback position/ })
    ).toBeDisabled();
  });
});
