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
    onStop: vi.fn(),
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
  it("groups the primary controls in a familiar order and demotes stop", () => {
    const props = renderControls();
    const group = screen.getByRole("group", {
      name: /播放器控制|Player controls/
    });
    const buttons = Array.from(group.querySelectorAll("button"));

    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      expect.stringMatching(/上一条|previous/i),
      expect.stringMatching(/开始播放|start playback/i),
      expect.stringMatching(/下一条|next/i),
      expect.stringMatching(/停止播放|stop playback/i)
    ]);
    expect(buttons[3]).toHaveClass("player-stop-button");

    fireEvent.click(buttons[3]);
    expect(props.onStop).toHaveBeenCalledOnce();
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
