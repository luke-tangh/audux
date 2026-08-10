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
    onExternalVadThresholdChange: vi.fn(),
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
        externalVadThreshold="0.5"
        externalMinimumSilenceMs="400"
        externalPreprocessing={{
          available: ffmpegAvailable,
          ffmpeg_available: ffmpegAvailable,
          ffprobe_available: ffmpegAvailable,
          vad_available: true,
          vad_model_available: true,
          vad_runtime_version: "1.23.2",
          vad_provider: "CPUExecutionProvider",
          vad_model: "silero_vad_16k_op15.onnx",
          vad_error: null,
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
      screen.getByText(/外部 ASR 预处理不可用|External ASR preprocessing is unavailable/)
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", {
        name: /启用 Silero VAD 智能切分|Enable Silero VAD boundary detection/
      })
    ).toBeChecked();
    expect(
      screen.getByLabelText(/VAD 语音概率阈值|VAD speech probability threshold/)
    ).toHaveValue("0.5");
  });
});
