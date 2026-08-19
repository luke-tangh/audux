import { Button, CheckboxField, PanelCard, SelectField, TextField } from "../ui";
import { useTranslation } from "react-i18next";
import { useState } from "react";

type LlmSettingsTabProps = {
  llmEndpoint: string;
  llmModel: string;
  llmApiKey: string;
  llmTimeout: string;
  llmMaxTokens: string;
  llmTemperature: string;
  llmAllowRemoteEndpoint: boolean;
  aiOutputLanguage: string;
  llmWarning: string | null;
  llmTestResult: string;
  onLlmEndpointChange: (value: string) => void;
  onLlmModelChange: (value: string) => void;
  onLlmApiKeyChange: (value: string) => void;
  onLlmTimeoutChange: (value: string) => void;
  onLlmMaxTokensChange: (value: string) => void;
  onLlmTemperatureChange: (value: string) => void;
  onLlmAllowRemoteEndpointChange: (value: boolean) => void;
  onAiOutputLanguageChange: (value: string) => void;
  onDiscoverLlmModels: () => Promise<string[] | null>;
  onSaveLlm: () => void;
  onTestLlm: () => void;
};

export default function LlmSettingsTab({
  llmEndpoint,
  llmModel,
  llmApiKey,
  llmTimeout,
  llmMaxTokens,
  llmTemperature,
  llmAllowRemoteEndpoint,
  aiOutputLanguage,
  llmWarning,
  llmTestResult,
  onLlmEndpointChange,
  onLlmModelChange,
  onLlmApiKeyChange,
  onLlmTimeoutChange,
  onLlmMaxTokensChange,
  onLlmTemperatureChange,
  onLlmAllowRemoteEndpointChange,
  onAiOutputLanguageChange,
  onDiscoverLlmModels,
  onSaveLlm,
  onTestLlm
}: LlmSettingsTabProps) {
  const { t } = useTranslation();
  const [advanced, setAdvanced] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [modelDiscoveryMessage, setModelDiscoveryMessage] = useState("");
  const [discoveringModels, setDiscoveringModels] = useState(false);

  function resetDiscoveredModels() {
    setAvailableModels([]);
    setModelDiscoveryMessage("");
  }

  function applyPreset(preset: "ollama" | "lmstudio" | "custom") {
    const endpoint = preset === "ollama"
      ? "http://127.0.0.1:11434/v1"
      : preset === "lmstudio"
        ? "http://127.0.0.1:1234/v1"
        : null;
    if (!endpoint) return;

    if (llmEndpoint.trim().replace(/\/+$/, "") !== endpoint) {
      onLlmModelChange("");
    }
    onLlmEndpointChange(endpoint);
    resetDiscoveredModels();
  }

  async function discoverModels() {
    if (!llmEndpoint.trim() || discoveringModels) return;

    setDiscoveringModels(true);
    setModelDiscoveryMessage("");
    try {
      const models = await onDiscoverLlmModels();
      if (models === null) return;
      setAvailableModels(models);
      setModelDiscoveryMessage(
        models.length > 0
          ? t("settings.llm.modelsFound", { count: models.length })
          : t("settings.llm.noModels")
      );
    } catch (error) {
      setAvailableModels([]);
      setModelDiscoveryMessage(t("settings.llm.modelDiscoveryFailed", {
        error: error instanceof Error ? error.message : String(error)
      }));
    } finally {
      setDiscoveringModels(false);
    }
  }
  return (
    <div className={`settings-tab-stack ${advanced ? "settings-mode-advanced" : "settings-mode-basic"}`}>
      <PanelCard title={t("settings.llm.presetsTitle")} className="max-form-card">
        <div className="settings-preset-grid">
          {(["ollama", "lmstudio", "custom"] as const).map((preset) => (
            <Button preserveChildren className="settings-preset" variant="outlined" key={preset} onClick={() => applyPreset(preset)}>
              <strong>{t(`settings.llm.presets.${preset}.title`)}</strong>
              <span>{t(`settings.llm.presets.${preset}.description`)}</span>
            </Button>
          ))}
        </div>
      </PanelCard>
    <PanelCard
      title={t("settings.llm.title")}
      className="max-form-card"
      actions={
        <Button variant="filled" onClick={onSaveLlm}>
          {t("settings.llm.save")}
        </Button>
      }
    >
      <div className="settings-form-grid">
        <TextField
          label={t("settings.common.endpoint")}
          value={llmEndpoint}
          placeholder="http://127.0.0.1:1234/v1"
          onValueChange={(value) => {
            resetDiscoveredModels();
            onLlmEndpointChange(value);
          }}
        />

        <div className="settings-select-field">
          <span className="ui-field-label" aria-hidden="true">
            {t("settings.llm.outputLanguage")}
          </span>
          <SelectField
            label={t("settings.llm.outputLanguage")}
            hideLabel
            controlHeight={52}
            controlWidth="100%"
            controlMinWidth={0}
            controlMaxWidth="100%"
            menuWidth="control"
            value={aiOutputLanguage}
            options={[
              { value: "auto", label: t("settings.llm.outputAuto") },
              { value: "zh-CN", label: t("settings.llm.outputChinese") },
              { value: "en", label: t("settings.llm.outputEnglish") }
            ]}
            onValueChange={onAiOutputLanguageChange}
          />
        </div>

        <TextField
          label={t("settings.common.modelName")}
          value={llmModel}
          placeholder={t("settings.llm.modelPlaceholder")}
          onValueChange={onLlmModelChange}
        />

        <TextField
          label={t("settings.common.apiKey")}
          value={llmApiKey}
          placeholder={t("settings.common.optional")}
          onValueChange={(value) => {
            resetDiscoveredModels();
            onLlmApiKeyChange(value);
          }}
        />

        <div className="settings-inline-actions wide">
          <Button
            variant="outlined"
            disabled={!llmEndpoint.trim() || discoveringModels}
            onClick={() => void discoverModels()}
          >
            {discoveringModels
              ? t("settings.llm.fetchingModels")
              : t("settings.llm.fetchModels")}
          </Button>
          <Button variant="outlined" onClick={onTestLlm}>
            {t("settings.llm.test")}
          </Button>
        </div>

        {availableModels.length > 0 && (
          <SelectField
            wrapperClassName="wide"
            label={t("settings.llm.availableModels")}
            controlWidth="100%"
            controlMinWidth={0}
            controlMaxWidth="100%"
            menuWidth="control"
            value={llmModel}
            options={availableModels.map((model) => ({
              value: model,
              label: model
            }))}
            onValueChange={onLlmModelChange}
          />
        )}

        {modelDiscoveryMessage && (
          <p className="muted wide" role="status">{modelDiscoveryMessage}</p>
        )}

        <CheckboxField
          wrapperClassName="wide"
          label={t("settings.llm.allowRemote")}
          description={t("settings.llm.allowRemoteDescription")}
          checked={llmAllowRemoteEndpoint}
          onCheckedChange={onLlmAllowRemoteEndpointChange}
        />

        <CheckboxField
          wrapperClassName="wide settings-advanced-toggle"
          label={t("settings.simple.showAdvanced")}
          description={t("settings.simple.advancedDescription")}
          checked={advanced}
          onCheckedChange={setAdvanced}
        />

        <TextField
          wrapperClassName="advanced-setting"
          label={t("settings.common.timeout")}
          value={llmTimeout}
          placeholder="60"
          onValueChange={onLlmTimeoutChange}
        />

        <TextField
          wrapperClassName="advanced-setting"
          label={t("settings.llm.maxTokens")}
          value={llmMaxTokens}
          placeholder="800"
          onValueChange={onLlmMaxTokensChange}
        />

        <TextField
          wrapperClassName="advanced-setting"
          label={t("settings.llm.temperature")}
          value={llmTemperature}
          placeholder="0.2"
          onValueChange={onLlmTemperatureChange}
        />
      </div>

      {llmWarning && <p className="privacy-warning">{t("settings.common.privacy", { warning: llmWarning })}</p>}

      {llmTestResult && <p className="test-result">{llmTestResult}</p>}
    </PanelCard>
    </div>
  );
}
