import { useTranslation } from "react-i18next";

import { openAppDataDirectory, openLogsDirectory, restartApplication } from "../tauri";
import { Button, MaterialIcon } from "./ui";

type Props = {
  state: "starting" | "error";
  error?: string;
  onRetry: () => void;
};

function errorHint(error: string, t: (key: string) => string): string {
  const normalized = error.toLowerCase();
  if (normalized.includes("schema version")) return t("startup.hints.schema");
  if (normalized.includes("permission") || normalized.includes("denied")) return t("startup.hints.permission");
  if (normalized.includes("space") || normalized.includes("disk")) return t("startup.hints.disk");
  if (normalized.includes("token") || normalized.includes("unauthorized")) return t("startup.hints.token");
  return t("startup.hints.generic");
}

export default function StartupScreen({ state, error = "", onRetry }: Props) {
  const { t } = useTranslation();
  const failed = state === "error";
  return (
    <main className="startup-screen" role={failed ? "alert" : "status"} aria-live="polite">
      <section className="startup-card">
        <div className={`startup-icon ${failed ? "failed" : ""}`}>
          <MaterialIcon name={failed ? "error" : "bolt"} size={38} />
        </div>
        <span className="eyebrow">Audux</span>
        <h1>{failed ? t("startup.failedTitle") : t("startup.startingTitle")}</h1>
        <p>{failed ? errorHint(error, t) : t("startup.startingDescription")}</p>
        {!failed && <div className="startup-loader" aria-hidden="true"><span /></div>}
        {failed && (
          <>
            <details className="startup-error-details">
              <summary>{t("startup.errorDetails")}</summary>
              <pre>{error || t("startup.noDetails")}</pre>
            </details>
            <div className="startup-actions">
              <Button variant="filled" onClick={onRetry}>{t("common.actions.retry")}</Button>
              <Button variant="outlined" onClick={() => void restartApplication()}>{t("startup.restart")}</Button>
              <Button variant="text" onClick={() => void openLogsDirectory()}>{t("startup.openLogs")}</Button>
              <Button variant="text" onClick={() => void openAppDataDirectory()}>{t("startup.openData")}</Button>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
