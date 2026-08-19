import { useTranslation } from "react-i18next";

import type { AutoSaveStatus } from "../../hooks/useAutoSaveSection";
import { Button } from "../ui";

type Props = {
  status: AutoSaveStatus;
  error: string | null;
  onRetry: () => void;
};

export default function SettingsAutoSaveStatus({
  status,
  error,
  onRetry
}: Props) {
  const { t } = useTranslation();
  const message = status === "error"
    ? t("settings.autoSave.failed", { error: error || "" })
    : t(`settings.autoSave.${status}`);

  return (
    <div
      className={`settings-auto-save-status ${status}`}
      role={status === "error" ? "alert" : "status"}
      aria-live="polite"
    >
      <span>{message}</span>
      {status === "error" && (
        <Button size="sm" variant="text" onClick={onRetry}>
          {t("common.actions.retry")}
        </Button>
      )}
    </div>
  );
}
