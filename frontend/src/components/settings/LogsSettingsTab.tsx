import { api } from "../../api";
import { Button } from "../ui";

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
    <section className="panel-card">
      <h3>日志</h3>

      <div className="section-actions">
        <Button variant="outlined" onClick={onLoadLogs}>
          刷新日志
        </Button>
        <Button variant="outlined" onClick={() => window.open(api.logsFileUrl(), "_blank")}>
          下载日志文件
        </Button>
        <Button variant="outlined" onClick={onReloadBackend}>
          重新检查后端
        </Button>
      </div>

      <pre className="log-viewer">{logs || "暂无日志"}</pre>
    </section>
  );
}
