import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "../../i18n/LocaleProvider";
import PlayerOptions from "./PlayerOptions";

function StatefulOptions() {
  const [volume, setVolume] = useState(0.35);

  return (
    <PlayerOptions
      rate={1}
      volume={volume}
      queue={[]}
      queueIndex={-1}
      queueOpen={false}
      onRateChange={vi.fn()}
      onVolumeChange={setVolume}
      onQueueOpenChange={vi.fn()}
      onQueueSelect={vi.fn()}
      onQueueRemove={vi.fn()}
      onQueueMove={vi.fn()}
      onQueueClear={vi.fn()}
    />
  );
}

describe("PlayerOptions volume control", () => {
  it("mutes and restores the previous non-zero volume", () => {
    render(
      <LocaleProvider>
        <StatefulOptions />
      </LocaleProvider>
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
});
