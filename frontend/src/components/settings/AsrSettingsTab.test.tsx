import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "../../i18n/LocaleProvider";
import AsrSettingsTab from "./AsrSettingsTab";

function renderTab(chunkingEnabled: boolean, ffmpegAvailable = false) {
  const callbacks = {
    onAsrProviderChange: vi.fn(),
    onAsrModelNameChange: vi.fn(),
    onAsrDeviceChange: vi.fn(),
    onAsrComputeTypeChange: vi.fn(),
    onAsrBeamSizeChange: vi.fn(),
    onExternalEndpointChange: vi.fn(),
    onExternalModelNameChange: vi.fn(),
    onExternalApiKeyChange: vi.fn(),
    onExternalLanguageChange: vi.fn(),
    onExternalTimestampPolicyChange: vi.fn(),
    onExternalTimeoutChange: vi.fn(),
    onExternalAllowRemoteEndpointChange: vi.fn(),
    onExternalChunkingEnabledChange: vi.fn(),
    onExternalChunkSecondsChange: vi.fn(),
    onExternalChunkOverlapSecondsChange: vi.fn(),
    onExternalPreferSilenceChange: vi.fn(),
    onExternalSilenceThresholdDbChange: vi.fn(),
    onExternalMinimumSilenceMsChange: vi.fn(),
    onInstallWhisperComponent: vi.fn(),
    onCancelWhisperComponentInstall: vi.fn(),
    onRemoveWhisperComponent: vi.fn(),
    onSaveAsr: vi.fn()
  };

  render(
    <LocaleProvider>
      <AsrSettingsTab
        asrProvider="external"
        asrModelName="small"
        asrDevice="cpu"
        asrComputeType="int8"
        asrBeamSize="5"
        externalEndpoint="http://127.0.0.1:8025/v1"
        externalModelName="ark-asr"
        externalApiKey=""
        externalLanguage="zh"
        externalTimestampPolicy="preferred"
        externalTimeout="3600"
        externalAllowRemoteEndpoint={false}
        externalChunkingEnabled={chunkingEnabled}
        externalChunkSeconds="28"
        externalChunkOverlapSeconds="1"
        externalPreferSilence
        externalSilenceThresholdDb="-35"
        externalMinimumSilenceMs="400"
        externalPreprocessing={{
          available: ffmpegAvailable,
          ffmpeg_available: ffmpegAvailable,
          ffprobe_available: ffmpegAvailable,
          missing: ffmpegAvailable ? [] : ["ffmpeg", "ffprobe"]
        }}
        externalWarning={null}
        whisperComponent={null}
        {...callbacks}
      />
    </LocaleProvider>
  );

  return callbacks;
}

describe("external ASR chunk settings", () => {
  it("keeps chunk parameters hidden while the default is off", () => {
    const callbacks = renderTab(false);

    expect(
      screen.queryByLabelText(/单片最长秒数|Maximum chunk length/)
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /启用外部 ASR 长音频切片|Enable long-audio chunking/
      })
    );
    expect(callbacks.onExternalChunkingEnabledChange).toHaveBeenCalledWith(true);
  });

  it("shows parameters and installation guidance when FFmpeg is missing", () => {
    renderTab(true);

    expect(
      screen.getByLabelText(/单片最长秒数|Maximum chunk length/)
    ).toHaveValue("28");
    expect(
      screen.getByText(/未检测到系统 FFmpeg|System FFmpeg or ffprobe was not found/)
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", {
        name: /优先在静音处切分|Prefer silence boundaries/
      })
    ).toBeChecked();
  });
});
