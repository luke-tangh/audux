import { Button, CheckboxField, TextField } from "../ui";

type LlmSettingsTabProps = {
  llmEndpoint: string;
  llmModel: string;
  llmApiKey: string;
  llmTimeout: string;
  llmMaxTokens: string;
  llmTemperature: string;
  llmAllowRemoteEndpoint: boolean;
  llmWarning: string | null;
  llmTestResult: string;
  onLlmEndpointChange: (value: string) => void;
  onLlmModelChange: (value: string) => void;
  onLlmApiKeyChange: (value: string) => void;
  onLlmTimeoutChange: (value: string) => void;
  onLlmMaxTokensChange: (value: string) => void;
  onLlmTemperatureChange: (value: string) => void;
  onLlmAllowRemoteEndpointChange: (value: boolean) => void;
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
  llmWarning,
  llmTestResult,
  onLlmEndpointChange,
  onLlmModelChange,
  onLlmApiKeyChange,
  onLlmTimeoutChange,
  onLlmMaxTokensChange,
  onLlmTemperatureChange,
  onLlmAllowRemoteEndpointChange,
  onSaveLlm,
  onTestLlm
}: LlmSettingsTabProps) {
  return (
    <section className="panel-card max-form-card">
      <h3>本地 LLM 设置</h3>

      <div className="settings-form-grid">
        <TextField
          label="Endpoint"
          value={llmEndpoint}
          placeholder="http://127.0.0.1:1234/v1"
          onValueChange={onLlmEndpointChange}
        />

        <TextField
          label="Model Name"
          value={llmModel}
          placeholder="local-model"
          onValueChange={onLlmModelChange}
        />

        <TextField
          label="API Key，可为空"
          value={llmApiKey}
          placeholder="可为空"
          onValueChange={onLlmApiKeyChange}
        />

        <TextField
          label="Timeout 秒"
          value={llmTimeout}
          placeholder="60"
          onValueChange={onLlmTimeoutChange}
        />

        <TextField
          label="Max Tokens"
          value={llmMaxTokens}
          placeholder="800"
          onValueChange={onLlmMaxTokensChange}
        />

        <TextField
          label="Temperature"
          value={llmTemperature}
          placeholder="0.2"
          onValueChange={onLlmTemperatureChange}
        />

        <CheckboxField
          wrapperClassName="wide"
          label="允许非本机 / 内网 LLM endpoint"
          description="启用后，AI 分析会把 metadata 和 transcript 发送到该 endpoint，请只用于你信任的模型服务。"
          checked={llmAllowRemoteEndpoint}
          onCheckedChange={onLlmAllowRemoteEndpointChange}
        />
      </div>

      {llmWarning && <p className="privacy-warning">隐私提醒：{llmWarning}</p>}

      <div className="section-actions">
        <Button variant="filled" onClick={onSaveLlm}>
          保存 LLM 设置
        </Button>
        <Button variant="outlined" onClick={onTestLlm}>
          测试连接
        </Button>
      </div>

      {llmTestResult && <p className="test-result">{llmTestResult}</p>}
    </section>
  );
}
