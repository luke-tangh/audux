import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "../i18n/LocaleProvider";
import OnboardingWizard from "./OnboardingWizard";

const mocks = vi.hoisted(() => ({
  importLibraryRoot: vi.fn(),
  listActivities: vi.fn(),
  pickAudioFolder: vi.fn()
}));

vi.mock("../api", () => ({
  api: {
    importLibraryRoot: mocks.importLibraryRoot,
    listActivities: mocks.listActivities
  }
}));

vi.mock("../tauri", () => ({
  pickAudioFolder: mocks.pickAudioFolder
}));

describe("OnboardingWizard", () => {
  it("chooses a folder and starts an immediate background scan", async () => {
    mocks.pickAudioFolder.mockResolvedValue("/audio/interviews");
    mocks.importLibraryRoot.mockResolvedValue({
      root: {
        id: 4,
        path: "/audio/interviews",
        is_enabled: true,
        created_at: "2026-08-18T00:00:00Z"
      },
      scan_task: {
        id: 12,
        root_id: 4,
        status: "pending",
        imported: 0,
        updated: 0,
        missing: 0,
        processed_files: 0,
        total_files: 0,
        created_at: "2026-08-18T00:00:00Z",
        updated_at: "2026-08-18T00:00:00Z"
      }
    });
    mocks.listActivities.mockResolvedValue({
      items: [],
      active_count: 1,
      failed_count: 0
    });
    const onImported = vi.fn();

    render(
      <LocaleProvider>
        <OnboardingWizard open onClose={vi.fn()} onImported={onImported} />
      </LocaleProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: /选择文件夹|Choose folder/ }));
    await waitFor(() =>
      expect(screen.getByLabelText(/音频文件夹|Audio folder/)).toHaveValue(
        "/audio/interviews"
      )
    );
    fireEvent.click(
      screen.getByRole("button", { name: /导入.*扫描|start scanning/i })
    );

    await waitFor(() =>
      expect(mocks.importLibraryRoot).toHaveBeenCalledWith("/audio/interviews")
    );
    expect(onImported).toHaveBeenCalledOnce();
    expect(await screen.findByText("/audio/interviews")).toBeInTheDocument();
  });

  it("traps focus, closes with Escape, and restores the opener", async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <div>
          <button type="button" onClick={() => setOpen(true)}>Open onboarding</button>
          <OnboardingWizard
            open={open}
            onClose={() => setOpen(false)}
            onImported={vi.fn()}
          />
        </div>
      );
    }

    render(
      <LocaleProvider>
        <Harness />
      </LocaleProvider>
    );

    const opener = screen.getByRole("button", { name: "Open onboarding" });
    opener.focus();
    fireEvent.click(opener);

    const dialog = await screen.findByRole("dialog");
    const input = screen.getByLabelText(/音频文件夹|Audio folder/);
    await waitFor(() => expect(input).toHaveFocus());
    expect(opener).toHaveAttribute("inert");
    expect(opener).toHaveAttribute("aria-hidden", "true");

    const dialogButtons = Array.from(dialog.querySelectorAll("button:not([disabled])"));
    const lastButton = dialogButtons[dialogButtons.length - 1] as HTMLButtonElement;
    lastButton.focus();
    fireEvent.keyDown(lastButton, { key: "Tab" });
    expect(input).toHaveFocus();

    input.focus();
    fireEvent.keyDown(input, { key: "Tab", shiftKey: true });
    expect(lastButton).toHaveFocus();

    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(opener).not.toHaveAttribute("inert");
    expect(opener).not.toHaveAttribute("aria-hidden");
    expect(opener).toHaveFocus();
  });
});
