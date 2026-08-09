import { Button, CheckboxField, PanelCard, SelectField, TextField } from "../ui";
import { useTranslation } from "react-i18next";

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
  onSaveLlm,
  onTestLlm
}: LlmSettingsTabProps) {
  const { t } = useTranslation();
  return (
    <PanelCard title={t("settings.llm.title")} className="max-form-card">
      <div className="settings-form-grid">
        <TextField
          label={t("settings.common.endpoint")}
          value={llmEndpoint}
          placeholder="http://127.0.0.1:1234/v1"
          onValueChange={onLlmEndpointChange}
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
          placeholder="local-model"
          onValueChange={onLlmModelChange}
        />

        <TextField
          label={t("settings.common.apiKey")}
          value={llmApiKey}
          placeholder={t("settings.common.optional")}
          onValueChange={onLlmApiKeyChange}
        />

        <TextField
          label={t("settings.common.timeout")}
          value={llmTimeout}
          placeholder="60"
          onValueChange={onLlmTimeoutChange}
        />

        <TextField
          label={t("settings.llm.maxTokens")}
          value={llmMaxTokens}
          placeholder="800"
          onValueChange={onLlmMaxTokensChange}
        />

        <TextField
          label={t("settings.llm.temperature")}
          value={llmTemperature}
          placeholder="0.2"
          onValueChange={onLlmTemperatureChange}
        />

        <CheckboxField
          wrapperClassName="wide"
          label={t("settings.llm.allowRemote")}
          description={t("settings.llm.allowRemoteDescription")}
          checked={llmAllowRemoteEndpoint}
          onCheckedChange={onLlmAllowRemoteEndpointChange}
        />
      </div>

      {llmWarning && <p className="privacy-warning">{t("settings.common.privacy", { warning: llmWarning })}</p>}

      <div className="section-actions">
        <Button variant="filled" onClick={onSaveLlm}>
          {t("settings.llm.save")}
        </Button>
        <Button variant="outlined" onClick={onTestLlm}>
          {t("settings.llm.test")}
        </Button>
      </div>

      {llmTestResult && <p className="test-result">{llmTestResult}</p>}
    </PanelCard>
  );
}
