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
  setSettingsSection: vi.fn()
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
            activityCenterEnabled={false}
            onActivityCenterEnabledChange={vi.fn().mockResolvedValue(undefined)}
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

describe("settings auto-save", () => {
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
    apiMocks.setSettingsSection.mockResolvedValue([]);
  });

  it("automatically saves a changed section as one grouped request", async () => {
    const { onDirtyChange } = renderPanel();
    await waitFor(() => expect(apiMocks.listSettings).toHaveBeenCalled());
    await editLlmModel();
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true));

    await waitFor(() => {
      expect(apiMocks.setSettingsSection).toHaveBeenCalledTimes(1);
    }, { timeout: 2000 });
    expect(apiMocks.setSettingsSection).toHaveBeenCalledWith("llm", {
      "llm.endpoint": "",
      "llm.model_name": "local-model",
      "llm.api_key": "",
      "llm.timeout": "60",
      "llm.max_tokens": "800",
      "llm.temperature": "0.2",
      "llm.allow_remote_endpoint": "false",
      "ai.output_language": "auto"
    });
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
    expect(await screen.findByText(/已自动保存|Auto-saved/)).toBeInTheDocument();
  });

  it("flushes auto-save before switching settings sections", async () => {
    renderPanel();
    await waitFor(() => expect(apiMocks.listSettings).toHaveBeenCalled());
    await editLlmModel();
    fireEvent.click(screen.getByRole("button", { name: "ASR" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "ASR" })).toHaveAttribute(
        "aria-current",
        "page"
      );
    });
    expect(apiMocks.setSettingsSection).toHaveBeenCalledTimes(1);
  });

  it("keeps invalid drafts local instead of sending them to the backend", async () => {
    const { onDirtyChange } = renderPanel();
    await waitFor(() => expect(apiMocks.listSettings).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "LLM" }));
    fireEvent.click(await screen.findByRole("checkbox", {
      name: /显示高级设置|Show advanced settings/
    }));
    fireEvent.change(screen.getByLabelText(/Timeout/), {
      target: { value: "" }
    });

    expect(await screen.findByText(
      /LLM Timeout 必须为|LLM timeout must be/
    )).toBeInTheDocument();
    expect(apiMocks.setSettingsSection).not.toHaveBeenCalled();
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  });

  it("flushes the latest change when leaving the settings page", async () => {
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
    await expect(leaveResult!).resolves.toBe(true);
    expect(apiMocks.setSettingsSection).toHaveBeenCalledTimes(1);
  });

  it("stays on the current section and exposes retry when auto-save fails", async () => {
    apiMocks.setSettingsSection.mockRejectedValueOnce(new Error("save failed"));
    renderPanel();
    await waitFor(() => expect(apiMocks.listSettings).toHaveBeenCalled());
    await editLlmModel();

    fireEvent.click(screen.getByRole("button", { name: "ASR" }));
    const dialog = await screen.findByRole("dialog", {
      name: /设置尚未保存|Settings not saved/
    });
    expect(dialog).toHaveTextContent(/自动保存未能完成|Auto-save could not finish/);
    expect(screen.getByRole("button", { name: "LLM" })).toHaveAttribute(
      "aria-current",
      "page"
    );
    expect(screen.getByLabelText(/模型名称|Model name/)).toHaveValue("local-model");
    expect(screen.getByRole("button", { name: /重试|Retry/ })).toBeInTheDocument();
  });
});
