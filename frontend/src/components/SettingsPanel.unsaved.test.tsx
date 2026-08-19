import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "../i18n/LocaleProvider";
import { ThemeProvider } from "../theme";
import { DialogProvider } from "./dialog/UnifiedDialog";
import SettingsPanel from "./SettingsPanel";

const apiMocks = vi.hoisted(() => ({
  health: vi.fn(),
  listLibraryRoots: vi.fn(),
  listSettings: vi.fn(),
  listScanTasks: vi.fn(),
  listTags: vi.fn(),
  listPlaylists: vi.fn(),
  getWhisperComponentStatus: vi.fn(),
  getExternalAsrPreprocessingStatus: vi.fn(),
  listDatabaseBackups: vi.fn(),
  getDatabaseRestoreStatus: vi.fn(),
  getLogs: vi.fn(),
  getLibraryHealth: vi.fn(),
  listLibraryHealthTasks: vi.fn(),
  setSetting: vi.fn()
}));

vi.mock("../api", () => ({
  api: apiMocks,
  asrEndpointPrivacyWarning: () => null,
  endpointPrivacyWarning: () => null
}));

function renderPanel(
  onBeforeLeaveChange?: (handler: (() => Promise<boolean>) | null) => void,
  onDirtyChange = vi.fn()
) {
  render(
    <LocaleProvider>
      <ThemeProvider>
        <DialogProvider>
          <SettingsPanel
            refresh={vi.fn()}
            onBeforeLeaveChange={onBeforeLeaveChange}
            onDirtyChange={onDirtyChange}
          />
        </DialogProvider>
      </ThemeProvider>
    </LocaleProvider>
  );

  return { onDirtyChange };
}

async function editLlmModel() {
  fireEvent.click(screen.getByRole("button", { name: "LLM" }));
  const model = await screen.findByLabelText(/模型名称|Model name/);
  fireEvent.change(model, { target: { value: "local-model" } });
}

describe("unsaved settings navigation", () => {
  beforeEach(() => {
    for (const mock of Object.values(apiMocks)) mock.mockReset();

    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({
      matches: false,
      media: "",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn()
    }));

    apiMocks.health.mockResolvedValue({ status: "ok" });
    apiMocks.listLibraryRoots.mockResolvedValue([]);
    apiMocks.listSettings.mockResolvedValue([]);
    apiMocks.listScanTasks.mockResolvedValue([]);
    apiMocks.listTags.mockResolvedValue([]);
    apiMocks.listPlaylists.mockResolvedValue([]);
    apiMocks.getWhisperComponentStatus.mockResolvedValue({
      available: true,
      source: "development",
      status: "installed"
    });
    apiMocks.getExternalAsrPreprocessingStatus.mockResolvedValue({
      available: true,
      ffmpeg_available: true,
      ffprobe_available: true,
      vad_available: true,
      vad_model_available: true,
      missing: []
    });
    apiMocks.listDatabaseBackups.mockResolvedValue([]);
    apiMocks.getDatabaseRestoreStatus.mockResolvedValue(null);
    apiMocks.getLogs.mockResolvedValue({ content: "" });
    apiMocks.getLibraryHealth.mockResolvedValue(null);
    apiMocks.listLibraryHealthTasks.mockResolvedValue([]);
    apiMocks.setSetting.mockResolvedValue({});
  });

  it("prompts to save before switching settings sections", async () => {
    const { onDirtyChange } = renderPanel();
    await waitFor(() => expect(apiMocks.listSettings).toHaveBeenCalled());
    await editLlmModel();
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true));

    fireEvent.click(screen.getByRole("button", { name: "ASR" }));
    const dialog = await screen.findByRole("dialog", {
      name: /保存未保存的设置|Save unsaved settings/
    });
    expect(dialog).toHaveTextContent("LLM");

    fireEvent.click(screen.getByRole("button", { name: /继续编辑|Keep editing/ }));
    expect(screen.getByRole("button", { name: "LLM" })).toHaveAttribute(
      "aria-current",
      "page"
    );
    expect(screen.getByLabelText(/模型名称|Model name/)).toHaveValue("local-model");

    fireEvent.click(screen.getByRole("button", { name: "ASR" }));
    fireEvent.click(
      await screen.findByRole("button", { name: /保存并离开|Save and leave/ })
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "ASR" })).toHaveAttribute(
        "aria-current",
        "page"
      );
    });
    expect(apiMocks.setSetting).toHaveBeenCalledWith("llm.model_name", "local-model");
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
  });

  it("exposes the same save guard when leaving the settings page", async () => {
    let beforeLeave: (() => Promise<boolean>) | null = null;
    const onBeforeLeaveChange = vi.fn((handler: (() => Promise<boolean>) | null) => {
      beforeLeave = handler;
    });
    renderPanel(onBeforeLeaveChange);
    await waitFor(() => expect(apiMocks.listSettings).toHaveBeenCalled());
    await editLlmModel();
    await waitFor(() => expect(beforeLeave).not.toBeNull());

    let leaveResult: Promise<boolean>;
    act(() => {
      leaveResult = beforeLeave!();
    });
    fireEvent.click(
      await screen.findByRole("button", { name: /继续编辑|Keep editing/ })
    );
    await expect(leaveResult!).resolves.toBe(false);

    act(() => {
      leaveResult = beforeLeave!();
    });
    fireEvent.click(
      await screen.findByRole("button", { name: /保存并离开|Save and leave/ })
    );
    await expect(leaveResult!).resolves.toBe(true);
  });

  it("stays on the current section when saving fails", async () => {
    apiMocks.setSetting.mockRejectedValueOnce(new Error("save failed"));
    renderPanel();
    await waitFor(() => expect(apiMocks.listSettings).toHaveBeenCalled());
    await editLlmModel();

    fireEvent.click(screen.getByRole("button", { name: "ASR" }));
    fireEvent.click(
      await screen.findByRole("button", { name: /保存并离开|Save and leave/ })
    );

    await waitFor(() => expect(apiMocks.setSetting).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "LLM" })).toHaveAttribute(
      "aria-current",
      "page"
    );
    expect(screen.getByLabelText(/模型名称|Model name/)).toHaveValue("local-model");
  });
});
