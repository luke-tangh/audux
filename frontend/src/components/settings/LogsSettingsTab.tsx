import { api } from "../../api";
import { Button, PanelCard } from "../ui";

type LogsSettingsTabProps = {
  logs: string;
  onLoadLogs: () => void;
  onReloadBackend: () => void;
};

export default function LogsSettingsTab({
  logs,
  onLoadLogs,
  onReloadBackend
}: LogsSettingsTabProps) {
  return (
    <PanelCard
      title="日志"
      actions={
        <>
          <Button variant="outlined" onClick={onLoadLogs}>
            刷新日志
          </Button>
          <Button variant="outlined" onClick={() => window.open(api.logsFileUrl(), "_blank")}>
            下载日志文件
          </Button>
          <Button variant="outlined" onClick={onReloadBackend}>
            重新检查后端
          </Button>
        </>
      }
    >
      <pre className="log-viewer">{logs || "暂无日志"}</pre>
    </PanelCard>
  );
}
