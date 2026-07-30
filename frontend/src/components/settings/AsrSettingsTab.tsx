import { Button, CheckboxField, PanelCard, SelectField, TextField } from "../ui";

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
  externalWarning: string | null;
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
  onSaveAsr: () => void;
};

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
  externalWarning,
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
  onSaveAsr
}: AsrSettingsTabProps) {
  return (
    <PanelCard
      title="ASR Provider 设置"
      className="max-form-card"
      actions={
        <Button variant="filled" onClick={onSaveAsr}>
          保存 ASR 设置
        </Button>
      }
    >
      <div className="settings-form-grid">
        <div className="asr-device-field">
          <span className="ui-field-label" aria-hidden="true">
            Provider
          </span>

          <SelectField
            label="Provider"
            hideLabel
            controlHeight={48}
            controlWidth="100%"
            controlMinWidth={0}
            controlMaxWidth="100%"
            menuWidth="control"
            value={asrProvider}
            options={[
              { value: "faster_whisper", label: "faster-whisper（内置）" },
              { value: "external", label: "External API（本地服务）" }
            ]}
            onValueChange={onAsrProviderChange}
          />
        </div>

        {asrProvider === "faster_whisper" && (
          <>
            <TextField
              label="Model Name / Path"
              value={asrModelName}
              placeholder="small 或本地模型路径"
              onValueChange={onAsrModelNameChange}
            />

            <div className="asr-device-field">
              <span className="ui-field-label" aria-hidden="true">
                Device
              </span>

              <SelectField
                label="Device"
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
              label="Compute Type"
              value={asrComputeType}
              placeholder="int8 / float16 / float32"
              onValueChange={onAsrComputeTypeChange}
            />

            <TextField
              label="Beam Size"
              value={asrBeamSize}
              placeholder="5"
              onValueChange={onAsrBeamSizeChange}
            />
          </>
        )}

        {asrProvider === "external" && (
          <>
            <TextField
              label="Endpoint"
              value={externalEndpoint}
              placeholder="http://127.0.0.1:8000/v1"
              onValueChange={onExternalEndpointChange}
            />

            <TextField
              label="Model Name"
              value={externalModelName}
              placeholder="qwen3-asr-1.7b"
              onValueChange={onExternalModelNameChange}
            />

            <TextField
              label="API Key，可为空"
              type="password"
              autoComplete="off"
              value={externalApiKey}
              placeholder="可为空"
              onValueChange={onExternalApiKeyChange}
            />

            <TextField
              label="Language"
              value={externalLanguage}
              placeholder="auto / zh / en"
              onValueChange={onExternalLanguageChange}
            />

            <div className="asr-device-field">
              <span className="ui-field-label" aria-hidden="true">
                时间戳策略
              </span>

              <SelectField
                label="时间戳策略"
                hideLabel
                controlHeight={48}
                controlWidth="100%"
                controlMinWidth={0}
                controlMaxWidth="100%"
                menuWidth="control"
                value={externalTimestampPolicy}
                options={[
                  { value: "off", label: "关闭" },
                  { value: "preferred", label: "优先使用，可无时间轴" },
                  { value: "required", label: "必须返回时间轴" }
                ]}
                onValueChange={onExternalTimestampPolicyChange}
              />
            </div>

            <TextField
              label="Timeout 秒"
              inputMode="numeric"
              value={externalTimeout}
              placeholder="3600"
              onValueChange={onExternalTimeoutChange}
            />

            <CheckboxField
              wrapperClassName="wide"
              label="允许非本机 / 内网 ASR endpoint"
              description="启用后，转写会把完整音频文件发送到该 endpoint，请只用于你信任的服务。"
              checked={externalAllowRemoteEndpoint}
              onCheckedChange={onExternalAllowRemoteEndpointChange}
            />
          </>
        )}
      </div>

      {externalWarning && asrProvider === "external" && (
        <p className="privacy-warning">隐私提醒：{externalWarning}</p>
      )}

      {asrProvider === "faster_whisper" ? (
        <p className="muted">
          需要后端环境安装 faster-whisper。若希望完全离线，请优先填写本地模型路径；
          如果填写 small / medium / large-v3 等模型名称，首次运行可能尝试下载模型。
        </p>
      ) : (
        <p className="muted">
          后端会向 Endpoint 下的 /audio/transcriptions 上传媒体库音频。服务应接受
          multipart/form-data，并返回 text、language、model 和可选 segments。
        </p>
      )}
    </PanelCard>
  );
}
