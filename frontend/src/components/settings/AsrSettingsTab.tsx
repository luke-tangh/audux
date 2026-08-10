import {
  Button,
  CheckboxField,
  PanelCard,
  SelectField,
  TextareaField,
  TextField
} from "../ui";
import { useTranslation } from "react-i18next";
import type {
  ExternalAsrPreprocessingStatus,
  WhisperComponentStatus
} from "../../types";

type AsrSettingsTabProps = {
  asrProvider: string;
  asrModelName: string;
  asrDevice: string;
  asrComputeType: string;
  asrBeamSize: string;
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
  externalPreferSilence: boolean;
  externalVadThreshold: string;
  externalMinimumSilenceMs: string;
  externalFormattingEnabled: boolean;
  externalCaseGlossary: string;
  externalPreprocessing: ExternalAsrPreprocessingStatus | null;
  externalWarning: string | null;
  whisperComponent: WhisperComponentStatus | null;
  onAsrProviderChange: (value: string) => void;
  onAsrModelNameChange: (value: string) => void;
  onAsrDeviceChange: (value: string) => void;
  onAsrComputeTypeChange: (value: string) => void;
  onAsrBeamSizeChange: (value: string) => void;
  onExternalEndpointChange: (value: string) => void;
  onExternalModelNameChange: (value: string) => void;
  onExternalApiKeyChange: (value: string) => void;
  onExternalLanguageChange: (value: string) => void;
  onExternalTimestampPolicyChange: (value: string) => void;
  onExternalTimeoutChange: (value: string) => void;
  onExternalAllowRemoteEndpointChange: (value: boolean) => void;
  onExternalChunkingEnabledChange: (value: boolean) => void;
  onExternalChunkSecondsChange: (value: string) => void;
  onExternalChunkOverlapSecondsChange: (value: string) => void;
  onExternalPreferSilenceChange: (value: boolean) => void;
  onExternalVadThresholdChange: (value: string) => void;
  onExternalMinimumSilenceMsChange: (value: string) => void;
  onExternalFormattingEnabledChange: (value: boolean) => void;
  onExternalCaseGlossaryChange: (value: string) => void;
  onResetExternalCaseGlossary: () => void;
  onInstallWhisperComponent: () => void;
  onCancelWhisperComponentInstall: () => void;
  onRemoveWhisperComponent: () => void;
  onSaveAsr: () => void;
};

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export default function AsrSettingsTab({
  asrProvider,
  asrModelName,
  asrDevice,
  asrComputeType,
  asrBeamSize,
  externalEndpoint,
  externalModelName,
  externalApiKey,
  externalLanguage,
  externalTimestampPolicy,
  externalTimeout,
  externalAllowRemoteEndpoint,
  externalChunkingEnabled,
  externalChunkSeconds,
  externalChunkOverlapSeconds,
  externalPreferSilence,
  externalVadThreshold,
  externalMinimumSilenceMs,
  externalFormattingEnabled,
  externalCaseGlossary,
  externalPreprocessing,
  externalWarning,
  whisperComponent,
  onAsrProviderChange,
  onAsrModelNameChange,
  onAsrDeviceChange,
  onAsrComputeTypeChange,
  onAsrBeamSizeChange,
  onExternalEndpointChange,
  onExternalModelNameChange,
  onExternalApiKeyChange,
  onExternalLanguageChange,
  onExternalTimestampPolicyChange,
  onExternalTimeoutChange,
  onExternalAllowRemoteEndpointChange,
  onExternalChunkingEnabledChange,
  onExternalChunkSecondsChange,
  onExternalChunkOverlapSecondsChange,
  onExternalPreferSilenceChange,
  onExternalVadThresholdChange,
  onExternalMinimumSilenceMsChange,
  onExternalFormattingEnabledChange,
  onExternalCaseGlossaryChange,
  onResetExternalCaseGlossary,
  onInstallWhisperComponent,
  onCancelWhisperComponentInstall,
  onRemoveWhisperComponent,
  onSaveAsr
}: AsrSettingsTabProps) {
  const { t } = useTranslation();
  const installing =
    whisperComponent?.status === "downloading" ||
    whisperComponent?.status === "installing";
  const progress =
    whisperComponent?.total_bytes && whisperComponent.total_bytes > 0
      ? Math.min(100, (whisperComponent.downloaded_bytes / whisperComponent.total_bytes) * 100)
      : 0;

  return (
    <div className="asr-settings-stack">
      <PanelCard
        title={t("settings.asr.whisperTitle")}
        className="max-form-card"
        actions={
          installing ? (
            <Button variant="outlined" onClick={onCancelWhisperComponentInstall}>
              {t("settings.asr.cancelDownload")}
            </Button>
          ) : whisperComponent?.available && whisperComponent.source === "component" ? (
            <Button variant="danger" onClick={onRemoveWhisperComponent}>
              {t("settings.asr.removeComponent")}
            </Button>
          ) : whisperComponent?.source === "development" ? null : (
            <Button variant="filled" onClick={onInstallWhisperComponent}>
              {t("settings.asr.install")}
            </Button>
          )
        }
      >
        <div className="whisper-component-status" aria-live="polite">
          <div>
            <strong>
              {whisperComponent?.available
                ? whisperComponent.source === "development"
                  ? t("settings.asr.devAvailable")
                  : t("settings.asr.installed")
                : installing
                  ? whisperComponent?.status === "installing"
                    ? t("settings.asr.installing")
                    : t("settings.asr.downloading")
                  : whisperComponent?.status === "failed"
                    ? t("settings.asr.installFailed")
                    : t("settings.asr.notInstalled")}
            </strong>
            <span>{whisperComponent?.target || t("settings.asr.loadingPlatform")}</span>
          </div>
          {installing && (
            <>
              <div
                className="progress-line"
                role="progressbar"
                aria-label={t("settings.asr.downloadProgress")}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(progress)}
              >
                <div style={{ width: `${progress}%` }} />
              </div>
              <span>
                {formatBytes(whisperComponent?.downloaded_bytes || 0)}
                {whisperComponent?.total_bytes
                  ? ` / ${formatBytes(whisperComponent.total_bytes)}`
                  : ""}
              </span>
            </>
          )}
          {whisperComponent?.error_message && (
            <p className="privacy-warning">{whisperComponent.error_message}</p>
          )}
        </div>
        <p className="muted">{t("settings.asr.componentDescription")}</p>
      </PanelCard>

      <PanelCard
        title={t("settings.asr.providerTitle")}
        className="max-form-card"
        actions={
          <Button variant="filled" onClick={onSaveAsr}>
            {t("settings.asr.save")}
          </Button>
        }
      >
      <div className="settings-form-grid">
        <div className="asr-device-field">
          <span className="ui-field-label" aria-hidden="true">
            Provider
          </span>

          <SelectField
            label={t("settings.asr.provider")}
            hideLabel
            controlHeight={48}
            controlWidth="100%"
            controlMinWidth={0}
            controlMaxWidth="100%"
            menuWidth="control"
            value={asrProvider}
            options={[
              { value: "faster_whisper", label: t("settings.asr.localComponent") },
              { value: "external", label: t("settings.asr.externalLocal") }
            ]}
            onValueChange={onAsrProviderChange}
          />
        </div>

        {asrProvider === "faster_whisper" && (
          <>
            <TextField
              label={t("settings.asr.modelPath")}
              value={asrModelName}
              placeholder={t("settings.asr.modelPlaceholder")}
              onValueChange={onAsrModelNameChange}
            />

            <div className="asr-device-field">
              <span className="ui-field-label" aria-hidden="true">
                Device
              </span>

              <SelectField
                label={t("settings.asr.device")}
                hideLabel
                controlHeight={48}
                controlWidth="100%"
                controlMinWidth={0}
                controlMaxWidth="100%"
                menuWidth="control"
                value={asrDevice}
                options={[
                  { value: "cpu", label: "cpu" },
                  { value: "cuda", label: "cuda" }
                ]}
                onValueChange={onAsrDeviceChange}
              />
            </div>

            <TextField
              label={t("settings.asr.computeType")}
              value={asrComputeType}
              placeholder="int8 / float16 / float32"
              onValueChange={onAsrComputeTypeChange}
            />

            <TextField
              label={t("settings.asr.beamSize")}
              value={asrBeamSize}
              placeholder="5"
              onValueChange={onAsrBeamSizeChange}
            />
          </>
        )}

        {asrProvider === "external" && (
          <>
            <TextField
              label={t("settings.common.endpoint")}
              value={externalEndpoint}
              placeholder="http://127.0.0.1:8000/v1"
              onValueChange={onExternalEndpointChange}
            />

            <TextField
              label={t("settings.common.modelName")}
              value={externalModelName}
              placeholder="qwen3-asr-1.7b"
              onValueChange={onExternalModelNameChange}
            />

            <TextField
              label={t("settings.common.apiKey")}
              type="password"
              autoComplete="off"
              value={externalApiKey}
              placeholder={t("settings.common.optional")}
              onValueChange={onExternalApiKeyChange}
            />

            <TextField
              label={t("settings.asr.language")}
              value={externalLanguage}
              placeholder="auto / zh / en"
              onValueChange={onExternalLanguageChange}
            />

            <div className="asr-device-field">
              <span className="ui-field-label" aria-hidden="true">
                {t("settings.asr.timestampPolicy")}
              </span>

              <SelectField
                label={t("settings.asr.timestampPolicy")}
                hideLabel
                controlHeight={48}
                controlWidth="100%"
                controlMinWidth={0}
                controlMaxWidth="100%"
                menuWidth="control"
                value={externalTimestampPolicy}
                options={[
                  { value: "off", label: t("settings.asr.timestampOff") },
                  { value: "preferred", label: t("settings.asr.timestampPreferred") },
                  { value: "required", label: t("settings.asr.timestampRequired") }
                ]}
                onValueChange={onExternalTimestampPolicyChange}
              />
            </div>

            <TextField
              label={t("settings.common.timeout")}
              inputMode="numeric"
              value={externalTimeout}
              placeholder="3600"
              onValueChange={onExternalTimeoutChange}
            />

            <CheckboxField
              wrapperClassName="wide"
              label={t("settings.asr.allowRemote")}
              description={t("settings.asr.allowRemoteDescription")}
              checked={externalAllowRemoteEndpoint}
              onCheckedChange={onExternalAllowRemoteEndpointChange}
            />

            <CheckboxField
              wrapperClassName="wide"
              label={t("settings.asr.formattingEnabled")}
              description={t("settings.asr.formattingDescription")}
              checked={externalFormattingEnabled}
              onCheckedChange={onExternalFormattingEnabledChange}
            />

            {externalFormattingEnabled && (
              <>
                <TextareaField
                  wide
                  label={t("settings.asr.caseGlossary")}
                  helperText={t("settings.asr.caseGlossaryDescription")}
                  value={externalCaseGlossary}
                  rows={10}
                  placeholder={"ark asr=ARK-ASR\npytorch=PyTorch\nopenai=OpenAI"}
                  onValueChange={onExternalCaseGlossaryChange}
                />
                <div className="wide">
                  <Button variant="outlined" onClick={onResetExternalCaseGlossary}>
                    {t("settings.asr.resetCaseGlossary")}
                  </Button>
                </div>
              </>
            )}

            <CheckboxField
              wrapperClassName="wide"
              label={t("settings.asr.chunkingEnabled")}
              description={t("settings.asr.chunkingDescription")}
              checked={externalChunkingEnabled}
              onCheckedChange={onExternalChunkingEnabledChange}
            />

            {externalChunkingEnabled && (
              <>
                <div className="wide" aria-live="polite">
                  {externalPreprocessing?.available ? (
                    <p className="muted">
                      {t("settings.asr.preprocessingAvailable", {
                        version: externalPreprocessing.vad_runtime_version
                      })}
                    </p>
                  ) : (
                    <p className="privacy-warning">
                      {externalPreprocessing
                        ? t("settings.asr.ffmpegInstallRequired")
                        : t("settings.asr.ffmpegChecking")}
                    </p>
                  )}
                </div>

                <TextField
                  label={t("settings.asr.chunkSeconds")}
                  inputMode="decimal"
                  value={externalChunkSeconds}
                  placeholder="28"
                  onValueChange={onExternalChunkSecondsChange}
                />

                <TextField
                  label={t("settings.asr.chunkOverlapSeconds")}
                  inputMode="decimal"
                  value={externalChunkOverlapSeconds}
                  placeholder="1"
                  onValueChange={onExternalChunkOverlapSecondsChange}
                />

                <CheckboxField
                  wrapperClassName="wide"
                  label={t("settings.asr.preferSilence")}
                  description={t("settings.asr.preferSilenceDescription")}
                  checked={externalPreferSilence}
                  onCheckedChange={onExternalPreferSilenceChange}
                />

                {externalPreferSilence && (
                  <>
                    <TextField
                      label={t("settings.asr.vadThreshold")}
                      inputMode="decimal"
                      value={externalVadThreshold}
                      placeholder="0.5"
                      onValueChange={onExternalVadThresholdChange}
                    />

                    <TextField
                      label={t("settings.asr.minimumSilenceMs")}
                      inputMode="numeric"
                      value={externalMinimumSilenceMs}
                      placeholder="400"
                      onValueChange={onExternalMinimumSilenceMsChange}
                    />
                  </>
                )}
              </>
            )}
          </>
        )}
      </div>

      {externalWarning && asrProvider === "external" && (
        <p className="privacy-warning">{t("settings.common.privacy", { warning: externalWarning })}</p>
      )}

      {asrProvider === "faster_whisper" ? (
        <p className="muted">{t("settings.asr.localHelp")}</p>
      ) : (
        <p className="muted">{t("settings.asr.externalHelp")}</p>
      )}
      </PanelCard>
    </div>
  );
}
