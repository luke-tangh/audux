import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "../../i18n/LocaleProvider";
import AsrSettingsTab from "./AsrSettingsTab";
import { DEFAULT_CASE_GLOSSARY } from "./settingsUtils";

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
    onExternalChunkConcurrencyChange: vi.fn(),
    onExternalPreferSilenceChange: vi.fn(),
    onExternalVadThresholdChange: vi.fn(),
    onExternalMinimumSilenceMsChange: vi.fn(),
    onExternalFormattingEnabledChange: vi.fn(),
    onExternalCaseGlossaryChange: vi.fn(),
    onResetExternalCaseGlossary: vi.fn(),
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
        externalChunkConcurrency="4"
        externalPreferSilence
        externalVadThreshold="0.5"
        externalMinimumSilenceMs="400"
        externalFormattingEnabled
        externalCaseGlossary={DEFAULT_CASE_GLOSSARY}
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
    const callbacks = renderTab(true);

    expect(
      screen.getByLabelText(/单片最长秒数|Maximum chunk length/)
    ).toHaveValue("28");
    const concurrency = screen.getByLabelText(
      /切片请求并发数|Concurrent chunk requests/
    );
    expect(concurrency).toHaveValue("4");
    fireEvent.change(concurrency, { target: { value: "2" } });
    expect(callbacks.onExternalChunkConcurrencyChange).toHaveBeenCalledWith("2");
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

  it("exposes text normalization and the custom casing glossary", () => {
    const callbacks = renderTab(false);

    expect(
      screen.getByRole("checkbox", {
        name: /规范外部 ASR 文本格式|Normalize external ASR text formatting/
      })
    ).toBeChecked();
    const glossary = screen.getByLabelText(
      /自定义大小写词典|Custom casing glossary/
    );
    expect(glossary).toHaveValue(DEFAULT_CASE_GLOSSARY);
    expect((glossary as HTMLTextAreaElement).value).toContain("Mrs");
    fireEvent.change(glossary, { target: { value: "ark asr=ARK-ASR" } });
    expect(callbacks.onExternalCaseGlossaryChange).toHaveBeenCalledWith(
      "ark asr=ARK-ASR"
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: /重置为默认词典|Reset to default glossary/
      })
    );
    expect(callbacks.onResetExternalCaseGlossary).toHaveBeenCalledOnce();
  });
});
