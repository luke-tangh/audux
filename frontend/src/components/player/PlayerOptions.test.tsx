import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "../../i18n/LocaleProvider";
import PlayerOptions from "./PlayerOptions";

function StatefulOptions() {
  const [rate, setRate] = useState(1);
  const [volume, setVolume] = useState(0.35);

  return (
    <PlayerOptions
      rate={rate}
      volume={volume}
      queue={[]}
      queueIndex={-1}
      queueOpen={false}
      onRateChange={setRate}
      onVolumeChange={setVolume}
      onQueueOpenChange={vi.fn()}
      onQueueSelect={vi.fn()}
      onQueueRemove={vi.fn()}
      onQueueMove={vi.fn()}
      onQueueClear={vi.fn()}
    />
  );
}

describe("PlayerOptions popovers", () => {
  it("opens the volume control, then mutes and restores the previous volume", () => {
    render(
      <LocaleProvider>
        <StatefulOptions />
      </LocaleProvider>
    );

    expect(screen.queryByRole("slider", { name: /音量|Volume/ }))
      .not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /打开音量控制|Open volume control/ })
    );

    const volume = screen.getByRole("slider", { name: /音量|Volume/ });
    expect(volume).toHaveValue("0.35");
    expect(volume).toHaveAttribute(
      "aria-valuetext",
      expect.stringMatching(/35%/)
    );

    fireEvent.click(screen.getByRole("button", { name: /静音|Mute/ }));
    expect(volume).toHaveValue("0");

    fireEvent.click(screen.getByRole("button", { name: /取消静音|Unmute/ }));
    expect(volume).toHaveValue("0.35");
  });

  it("chooses speed from a compact popup control", () => {
    render(
      <LocaleProvider>
        <StatefulOptions />
      </LocaleProvider>
    );

    const trigger = screen.getByRole("button", {
      name: /打开播放速度控制|Open playback speed control/
    });
    expect(trigger).toHaveTextContent("1x");
    expect(screen.queryByRole("dialog", { name: /播放速度|Playback speed/ }))
      .not.toBeInTheDocument();

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("radio", { name: "1.5x" }));

    expect(
      screen.getByRole("button", {
        name: /打开播放速度控制|Open playback speed control/
      })
    ).toHaveTextContent("1.5x");
    expect(screen.queryByRole("dialog", { name: /播放速度|Playback speed/ }))
      .not.toBeInTheDocument();
  });
});
