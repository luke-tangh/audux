import { api } from "../../api";
import { Button, PanelCard } from "../ui";
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation();
  return (
    <PanelCard
      title={t("settings.tabs.logs")}
      actions={
        <>
          <Button variant="outlined" onClick={onLoadLogs}>
            {t("settings.logs.refresh")}
          </Button>
          <Button variant="outlined" onClick={() => window.open(api.logsFileUrl(), "_blank")}>
            {t("settings.logs.download")}
          </Button>
          <Button variant="outlined" onClick={onReloadBackend}>
            {t("settings.logs.recheck")}
          </Button>
        </>
      }
    >
      <pre className="log-viewer">{logs || t("settings.logs.empty")}</pre>
    </PanelCard>
  );
}
