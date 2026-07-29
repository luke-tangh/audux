import { Button, PanelCard, SelectField, TextField } from "../ui";

type AsrSettingsTabProps = {
  asrModelName: string;
  asrDevice: string;
  asrComputeType: string;
  asrBeamSize: string;
  onAsrModelNameChange: (value: string) => void;
  onAsrDeviceChange: (value: string) => void;
  onAsrComputeTypeChange: (value: string) => void;
  onAsrBeamSizeChange: (value: string) => void;
  onSaveAsr: () => void;
};

export default function AsrSettingsTab({
  asrModelName,
  asrDevice,
  asrComputeType,
  asrBeamSize,
  onAsrModelNameChange,
  onAsrDeviceChange,
  onAsrComputeTypeChange,
  onAsrBeamSizeChange,
  onSaveAsr
}: AsrSettingsTabProps) {
  return (
    <PanelCard
      title="本地 ASR 设置 faster-whisper"
      className="max-form-card"
      actions={
        <Button variant="filled" onClick={onSaveAsr}>
          保存 ASR 设置
        </Button>
      }
    >
      <div className="settings-form-grid">
        <TextField
          label="Model Name / Path"
          value={asrModelName}
          placeholder="small 或本地模型路径"
          onValueChange={onAsrModelNameChange}
        />

        <SelectField
          label="Device"
          density="compact"
          controlSize="compact"
          controlHeight={42}
          controlWidth={148}
          controlMinWidth={128}
          controlMaxWidth={148}
          menuWidth="control"
          menuMinWidth={128}
          value={asrDevice}
          options={[
            { value: "cpu", label: "cpu" },
            { value: "cuda", label: "cuda" }
          ]}
          onValueChange={onAsrDeviceChange}
        />

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
      </div>

      <p className="muted">
        需要后端环境安装 faster-whisper。若希望完全离线，请优先填写本地模型路径；
        如果填写 small / medium / large-v3 等模型名称，首次运行可能尝试下载模型。
      </p>
    </PanelCard>
  );
}
