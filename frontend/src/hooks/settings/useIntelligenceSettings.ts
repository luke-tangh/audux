import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { api, asrEndpointPrivacyWarning, endpointPrivacyWarning } from "../../api";
import { useDialog } from "../../components/dialog/UnifiedDialog";
import {
  DEFAULT_CASE_GLOSSARY,
  validCaseGlossary
} from "../../components/settings/settingsUtils";
import { localizedPrivacyWarning } from "../../i18n/errors";
import type { ExternalAsrPreprocessingStatus, WhisperComponentStatus } from "../../types";
import { useAutoSaveSection } from "../useAutoSaveSection";
import type { ToastType } from "../useToast";

type Setting = { key: string; value: string };

type AsrForm = {
  provider: string;
  modelName: string;
  device: string;
  computeType: string;
  beamSize: string;
  externalEndpoint: string;
  externalModelName: string;
  externalApiKey: string;
  externalLanguage: string;
  externalTimestampPolicy: string;
  externalTimeout: string;
  externalAllowRemoteEndpoint: boolean;
  externalChunkingEnabled: boolean;
  externalChunkSeconds: string;
  externalChunkOverlapSeconds: string;
  externalChunkConcurrency: string;
  externalPreferSilence: boolean;
  externalVadThreshold: string;
  externalMinimumSilenceMs: string;
  externalFormattingEnabled: boolean;
  externalCaseGlossary: string;
};

type LlmForm = {
  endpoint: string;
  model: string;
  apiKey: string;
  timeout: string;
  maxTokens: string;
  temperature: string;
  allowRemoteEndpoint: boolean;
  outputLanguage: string;
};

const ASR_DEFAULTS: AsrForm = {
  provider: "faster_whisper",
  modelName: "small",
  device: "cpu",
  computeType: "int8",
  beamSize: "5",
  externalEndpoint: "",
  externalModelName: "",
  externalApiKey: "",
  externalLanguage: "auto",
  externalTimestampPolicy: "preferred",
  externalTimeout: "3600",
  externalAllowRemoteEndpoint: false,
  externalChunkingEnabled: false,
  externalChunkSeconds: "28",
  externalChunkOverlapSeconds: "1",
  externalChunkConcurrency: "1",
  externalPreferSilence: true,
  externalVadThreshold: "0.5",
  externalMinimumSilenceMs: "400",
  externalFormattingEnabled: true,
  externalCaseGlossary: DEFAULT_CASE_GLOSSARY
};

const LLM_DEFAULTS: LlmForm = {
  endpoint: "",
  model: "",
  apiKey: "",
  timeout: "60",
  maxTokens: "800",
  temperature: "0.2",
  allowRemoteEndpoint: false,
  outputLanguage: "auto"
};

function validHttpEndpoint(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      Boolean(parsed.hostname) &&
      !parsed.username &&
      !parsed.password &&
      !parsed.search &&
      !parsed.hash
    );
  } catch {
    return false;
  }
}

function settingValue(settings: Map<string, string>, key: string, fallback: string): string {
  return settings.get(key) ?? fallback;
}

function enabledSetting(value: string): boolean {
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function disabledSetting(value: string): boolean {
  return ["0", "false", "no", "off"].includes(value.toLowerCase());
}

export function useIntelligenceSettings({
  notify
}: {
  notify?: (message: string, type?: ToastType) => void;
}) {
  const { t } = useTranslation();
  const dialog = useDialog();
  const [asr, setAsr] = useState<AsrForm>(ASR_DEFAULTS);
  const [llm, setLlm] = useState<LlmForm>(LLM_DEFAULTS);
  const [loadVersion, setLoadVersion] = useState(0);
  const [backendStatus, setBackendStatus] = useState("checking");
  const [llmTestResult, setLlmTestResult] = useState("");
  const [externalPreprocessing, setExternalPreprocessing] =
    useState<ExternalAsrPreprocessingStatus | null>(null);
  const [whisperComponent, setWhisperComponent] =
    useState<WhisperComponentStatus | null>(null);

  function setAsrField<K extends keyof AsrForm>(key: K, value: AsrForm[K]) {
    setAsr((current) => ({ ...current, [key]: value }));
  }

  function setLlmField<K extends keyof LlmForm>(key: K, value: LlmForm[K]) {
    setLlm((current) => ({ ...current, [key]: value }));
  }

  const asrValues: Record<string, string> = {
    "asr.provider": asr.provider,
    "asr.model_name": asr.modelName.trim(),
    "asr.device": asr.device.trim(),
    "asr.compute_type": asr.computeType.trim(),
    "asr.beam_size": asr.beamSize.trim(),
    "asr.external.endpoint": asr.externalEndpoint.trim(),
    "asr.external.model_name": asr.externalModelName.trim(),
    "asr.external.api_key": asr.externalApiKey,
    "asr.external.language": asr.externalLanguage.trim(),
    "asr.external.timestamp_policy": asr.externalTimestampPolicy,
    "asr.external.timeout": asr.externalTimeout.trim(),
    "asr.external.allow_remote_endpoint": String(asr.externalAllowRemoteEndpoint),
    "asr.external.chunking_enabled": String(asr.externalChunkingEnabled),
    "asr.external.chunk_seconds": asr.externalChunkSeconds.trim(),
    "asr.external.chunk_overlap_seconds": asr.externalChunkOverlapSeconds.trim(),
    "asr.external.chunk_concurrency": asr.externalChunkConcurrency.trim(),
    "asr.external.prefer_silence": String(asr.externalPreferSilence),
    "asr.external.vad_threshold": asr.externalVadThreshold.trim(),
    "asr.external.minimum_silence_ms": asr.externalMinimumSilenceMs.trim(),
    "asr.external.formatting_enabled": String(asr.externalFormattingEnabled),
    "asr.external.case_glossary": asr.externalCaseGlossary
  };
  const llmValues: Record<string, string> = {
    "llm.endpoint": llm.endpoint.trim(),
    "llm.model_name": llm.model.trim(),
    "llm.api_key": llm.apiKey,
    "llm.timeout": llm.timeout.trim(),
    "llm.max_tokens": llm.maxTokens.trim(),
    "llm.temperature": llm.temperature.trim(),
    "llm.allow_remote_endpoint": String(llm.allowRemoteEndpoint),
    "ai.output_language": llm.outputLanguage
  };

  function validateAsr(values: Record<string, string>): string | null {
    if (values["asr.provider"] === "faster_whisper") {
      const beamSize = Number(values["asr.beam_size"]);
      return !values["asr.model_name"] ||
        !values["asr.device"] ||
        !values["asr.compute_type"] ||
        !Number.isInteger(beamSize) ||
        beamSize <= 0
        ? t("settings.autoSave.asrLocalInvalid")
        : null;
    }

    const endpoint = values["asr.external.endpoint"];
    if (!endpoint || !validHttpEndpoint(endpoint) || !values["asr.external.model_name"]) {
      return t("settings.autoSave.externalAsrRequired");
    }
    if (
      asrEndpointPrivacyWarning(endpoint) &&
      values["asr.external.allow_remote_endpoint"] !== "true"
    ) {
      return t("settings.asr.allowRemoteRequired");
    }

    const timeout = Number(values["asr.external.timeout"]);
    if (!Number.isInteger(timeout) || timeout <= 0) {
      return t("settings.autoSave.timeoutInvalid");
    }

    const chunkSeconds = Number(values["asr.external.chunk_seconds"]);
    const overlapSeconds = Number(values["asr.external.chunk_overlap_seconds"]);
    const concurrency = Number(values["asr.external.chunk_concurrency"]);
    const vadThreshold = Number(values["asr.external.vad_threshold"]);
    const minimumSilenceMs = Number(values["asr.external.minimum_silence_ms"]);
    if (
      !Number.isFinite(chunkSeconds) || chunkSeconds < 5 || chunkSeconds > 600 ||
      !Number.isFinite(overlapSeconds) || overlapSeconds < 0 || overlapSeconds > 10 ||
      overlapSeconds >= chunkSeconds / 2 ||
      !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4 ||
      !Number.isFinite(vadThreshold) || vadThreshold < 0.1 || vadThreshold > 0.9 ||
      !Number.isInteger(minimumSilenceMs) || minimumSilenceMs < 100 || minimumSilenceMs > 5000
    ) {
      return t("settings.asr.chunkingInvalid");
    }
    if (
      values["asr.external.formatting_enabled"] === "true" &&
      !validCaseGlossary(values["asr.external.case_glossary"])
    ) {
      return t("settings.asr.caseGlossaryInvalid");
    }
    return null;
  }

  function validateLlm(values: Record<string, string>): string | null {
    const endpoint = values["llm.endpoint"];
    if (endpoint && !validHttpEndpoint(endpoint)) {
      return t("settings.autoSave.llmEndpointInvalid");
    }
    if (
      endpointPrivacyWarning(endpoint) &&
      values["llm.allow_remote_endpoint"] !== "true"
    ) {
      return t("settings.llm.allowRemoteRequired");
    }
    const timeout = Number(values["llm.timeout"]);
    const maxTokens = Number(values["llm.max_tokens"]);
    const temperature = Number(values["llm.temperature"]);
    return !Number.isInteger(timeout) || timeout < 1 || timeout > 3600 ||
      !Number.isInteger(maxTokens) || maxTokens <= 0 ||
      !values["llm.temperature"] || !Number.isFinite(temperature) ||
      temperature < 0 || temperature > 2
      ? t("settings.autoSave.llmParametersInvalid")
      : null;
  }

  const asrAutoSave = useAutoSaveSection({
    value: asrValues,
    signature: JSON.stringify(asrValues),
    enabled: loadVersion > 0,
    resetVersion: loadVersion,
    validate: validateAsr,
    save: (values) => api.setSettingsSection("asr", values).then(() => undefined)
  });
  const llmAutoSave = useAutoSaveSection({
    value: llmValues,
    signature: JSON.stringify(llmValues),
    enabled: loadVersion > 0,
    resetVersion: loadVersion,
    validate: validateLlm,
    save: (values) => api.setSettingsSection("llm", values).then(() => undefined)
  });

  async function load() {
    try {
      await api.health();
      setBackendStatus("ok");
      const [settingRows, component, preprocessing] = await Promise.all([
        api.listSettings(),
        api.getWhisperComponentStatus(),
        api.getExternalAsrPreprocessingStatus()
      ]);
      const settings = new Map(
        (settingRows as Setting[]).map((setting) => [setting.key, setting.value])
      );
      setAsr({
        provider: settingValue(settings, "asr.provider", ASR_DEFAULTS.provider),
        modelName: settingValue(settings, "asr.model_name", ASR_DEFAULTS.modelName),
        device: settingValue(settings, "asr.device", ASR_DEFAULTS.device),
        computeType: settingValue(settings, "asr.compute_type", ASR_DEFAULTS.computeType),
        beamSize: settingValue(settings, "asr.beam_size", ASR_DEFAULTS.beamSize),
        externalEndpoint: settingValue(settings, "asr.external.endpoint", ""),
        externalModelName: settingValue(settings, "asr.external.model_name", ""),
        externalApiKey: settingValue(settings, "asr.external.api_key", ""),
        externalLanguage: settingValue(settings, "asr.external.language", "auto"),
        externalTimestampPolicy: settingValue(settings, "asr.external.timestamp_policy", "preferred"),
        externalTimeout: settingValue(settings, "asr.external.timeout", "3600"),
        externalAllowRemoteEndpoint: enabledSetting(settingValue(settings, "asr.external.allow_remote_endpoint", "")),
        externalChunkingEnabled: enabledSetting(settingValue(settings, "asr.external.chunking_enabled", "")),
        externalChunkSeconds: settingValue(settings, "asr.external.chunk_seconds", "28"),
        externalChunkOverlapSeconds: settingValue(settings, "asr.external.chunk_overlap_seconds", "1"),
        externalChunkConcurrency: settingValue(settings, "asr.external.chunk_concurrency", "1"),
        externalPreferSilence: !disabledSetting(settingValue(settings, "asr.external.prefer_silence", "true")),
        externalVadThreshold: settingValue(settings, "asr.external.vad_threshold", "0.5"),
        externalMinimumSilenceMs: settingValue(settings, "asr.external.minimum_silence_ms", "400"),
        externalFormattingEnabled: !disabledSetting(settingValue(settings, "asr.external.formatting_enabled", "true")),
        externalCaseGlossary: settingValue(settings, "asr.external.case_glossary", DEFAULT_CASE_GLOSSARY)
      });
      setLlm({
        endpoint: settingValue(settings, "llm.endpoint", ""),
        model: settingValue(settings, "llm.model_name", ""),
        apiKey: settingValue(settings, "llm.api_key", ""),
        timeout: settingValue(settings, "llm.timeout", "60"),
        maxTokens: settingValue(settings, "llm.max_tokens", "800"),
        temperature: settingValue(settings, "llm.temperature", "0.2"),
        allowRemoteEndpoint: enabledSetting(settingValue(settings, "llm.allow_remote_endpoint", "")),
        outputLanguage: settingValue(settings, "ai.output_language", "auto")
      });
      setWhisperComponent(component);
      setExternalPreprocessing(preprocessing);
      setLoadVersion((version) => version + 1);
    } catch (error) {
      setBackendStatus("failed");
      notify?.(error instanceof Error ? error.message : String(error), "error");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function refreshWhisperComponent() {
    setWhisperComponent(await api.getWhisperComponentStatus());
  }

  async function installWhisperComponent() {
    try {
      setWhisperComponent(await api.installWhisperComponent());
      notify?.(t("settings.asr.downloadStarted"), "info");
    } catch (error) {
      notify?.(error instanceof Error ? error.message : String(error), "error");
    }
  }

  async function cancelWhisperComponentInstall() {
    try {
      setWhisperComponent(await api.cancelWhisperComponentInstall());
      notify?.(t("settings.asr.cancelRequested"), "info");
    } catch (error) {
      notify?.(error instanceof Error ? error.message : String(error), "error");
    }
  }

  async function removeWhisperComponent() {
    const ok = await dialog.confirm({
      title: t("settings.asr.removeTitle"),
      message: t("settings.asr.removeMessage"),
      confirmLabel: t("settings.asr.removeComponent"),
      cancelLabel: t("common.actions.cancel"),
      tone: "danger",
      destructive: true
    });
    if (!ok) return;
    try {
      setWhisperComponent(await api.removeWhisperComponent());
      notify?.(t("settings.asr.removed"), "success");
    } catch (error) {
      notify?.(error instanceof Error ? error.message : String(error), "error");
    }
  }

  async function testLlm() {
    const warning = endpointPrivacyWarning(llm.endpoint);
    if (warning && !llm.allowRemoteEndpoint) {
      const ok = await dialog.confirm({
        title: t("settings.llm.testRemoteTitle"),
        message: t("settings.llm.testRemoteMessage", { warning }),
        confirmLabel: t("settings.llm.testContinue"),
        cancelLabel: t("common.actions.cancel"),
        tone: "privacy"
      });
      if (!ok) return;
    }
    setLlmTestResult(t("settings.llm.testing"));
    try {
      const result = await api.testLlm({
        endpoint: llm.endpoint.trim(),
        model_name: llm.model.trim(),
        api_key: llm.apiKey || undefined,
        timeout: Number(llm.timeout || "60"),
        max_tokens: Number(llm.maxTokens || "64"),
        temperature: Number(llm.temperature || "0")
      });
      if (result.privacy_warning) {
        notify?.(
          localizedPrivacyWarning(t, result.privacy_warning_code, result.privacy_warning),
          "error"
        );
      }
      setLlmTestResult(t("settings.llm.testDiagnostic", {
        endpoint: result.is_local_endpoint ? t("settings.llm.endpointLocal") : t("settings.llm.endpointRemote"),
        model: result.model_name || llm.model,
        latency: result.latency_ms ?? "—",
        content: result.content,
        capabilities: result.capabilities?.agent_execution
          ? t("settings.llm.agentToolsAvailable")
          : t("settings.llm.agentToolsUnavailable")
      }));
      notify?.(t("settings.llm.testSuccess"), "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLlmTestResult(t("settings.llm.testFailedResult", { error: message }));
      notify?.(t("settings.llm.testFailed", { error: message }), "error");
    }
  }

  async function discoverLlmModels(): Promise<string[] | null> {
    const warning = endpointPrivacyWarning(llm.endpoint);
    if (warning && !llm.allowRemoteEndpoint) {
      const ok = await dialog.confirm({
        title: t("settings.llm.discoverRemoteTitle"),
        message: t("settings.llm.discoverRemoteMessage", { warning }),
        confirmLabel: t("settings.llm.discoverContinue"),
        cancelLabel: t("common.actions.cancel"),
        tone: "privacy"
      });
      if (!ok) return null;
    }
    const result = await api.discoverLlmModels({
      endpoint: llm.endpoint.trim(),
      api_key: llm.apiKey || undefined,
      timeout: Number(llm.timeout || "60")
    });
    return result.models;
  }

  async function flushDirty(): Promise<"asr" | "llm" | null> {
    if (asrAutoSave.isDirty && !(await asrAutoSave.flush())) return "asr";
    if (llmAutoSave.isDirty && !(await llmAutoSave.flush())) return "llm";
    return null;
  }

  return {
    asr,
    setAsrField,
    llm,
    setLlmField,
    asrAutoSave,
    llmAutoSave,
    isDirty: asrAutoSave.isDirty || llmAutoSave.isDirty,
    flushDirty,
    backendStatus,
    llmTestResult,
    externalPreprocessing,
    whisperComponent,
    asrWarning: asrEndpointPrivacyWarning(asr.externalEndpoint),
    llmWarning: endpointPrivacyWarning(llm.endpoint),
    reload: load,
    refreshWhisperComponent,
    installWhisperComponent,
    cancelWhisperComponentInstall,
    removeWhisperComponent,
    testLlm,
    discoverLlmModels
  };
}
