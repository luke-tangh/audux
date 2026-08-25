import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { api } from "../../api";
import { toErrorMessage } from "../../i18n/errors";
import {
  checkApplicationUpdate,
  downloadApplicationUpdate,
  getCurrentApplicationVersion,
  installApplicationUpdate,
  isApplicationUpdaterConfigured,
  isTauriRuntime,
  type ApplicationUpdateInfo,
  type ApplicationUpdateProgress
} from "../../tauri";
import { Button, MaterialIcon, PanelCard } from "../ui";

type UpdateStatus =
  | "idle"
  | "checking"
  | "current"
  | "available"
  | "downloading"
  | "preparing"
  | "installing"
  | "failed";

const RELEASES_URL = "https://github.com/luke-tangh/audux/releases/latest";

export default function UpdatesSettingsTab() {
  const { t } = useTranslation();
  const [desktop, setDesktop] = useState<boolean | null>(null);
  const [updaterConfigured, setUpdaterConfigured] = useState<boolean | null>(null);
  const [currentVersion, setCurrentVersion] = useState("");
  const [update, setUpdate] = useState<ApplicationUpdateInfo | null>(null);
  const [status, setStatus] = useState<UpdateStatus>("idle");
  const [progress, setProgress] = useState<ApplicationUpdateProgress>({
    downloadedBytes: 0,
    totalBytes: null
  });
  const [backupName, setBackupName] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      isTauriRuntime(),
      getCurrentApplicationVersion(),
      isApplicationUpdaterConfigured()
    ])
      .then(([isDesktop, version, isUpdaterConfigured]) => {
        setDesktop(isDesktop);
        setUpdaterConfigured(isUpdaterConfigured);
        setCurrentVersion(version);
      })
      .catch((reason) => {
        setDesktop(false);
        setError(toErrorMessage(reason));
      });
  }, []);

  async function checkForUpdate() {
    if (!desktop || status === "checking") return;
    setStatus("checking");
    setError("");
    setBackupName("");
    try {
      const available = await checkApplicationUpdate();
      setUpdate(available);
      setStatus(available ? "available" : "current");
    } catch (reason) {
      setStatus("failed");
      setError(toErrorMessage(reason));
    }
  }

  async function installUpdate() {
    if (!update || status !== "available") return;
    setStatus("downloading");
    setError("");
    setProgress({ downloadedBytes: 0, totalBytes: null });
    try {
      await downloadApplicationUpdate(setProgress);
      setStatus("preparing");
      const prepared = await api.prepareApplicationUpdate(update.version);
      setBackupName(prepared.backup.name);
      setStatus("installing");
      await installApplicationUpdate();
    } catch (reason) {
      setStatus("failed");
      setError(toErrorMessage(reason));
    }
  }

  const percent = progress.totalBytes && progress.totalBytes > 0
    ? Math.min(100, Math.round((progress.downloadedBytes / progress.totalBytes) * 100))
    : null;
  const busy = ["checking", "downloading", "preparing", "installing"].includes(status);

  return (
    <div className="settings-grid-layout updates-settings">
      <PanelCard
        className="settings-card-wide update-card"
        title={t("settings.updates.title")}
        actions={desktop && updaterConfigured ? (
          <Button
            variant="outlined"
            disabled={busy}
            leadingIcon={<MaterialIcon name="refresh" size={18} />}
            onClick={() => void checkForUpdate()}
          >
            {status === "checking"
              ? t("settings.updates.checking")
              : t("settings.updates.check")}
          </Button>
        ) : undefined}
      >
        <div className="update-version-row">
          <div className="update-mark" aria-hidden="true">
            <MaterialIcon name="download" size={28} />
          </div>
          <div>
            <strong>{t("settings.updates.currentVersion", {
              version: currentVersion || "—"
            })}</strong>
            <p>{t("settings.updates.description")}</p>
          </div>
        </div>

        {desktop === false && (
          <div className="update-message">
            <p>{t("settings.updates.desktopOnly")}</p>
            <a href={RELEASES_URL} target="_blank" rel="noreferrer">
              {t("settings.updates.openDownloads")}
            </a>
          </div>
        )}

        {desktop && updaterConfigured === false && (
          <p className="update-message">{t("settings.updates.releaseOnly")}</p>
        )}

        {status === "current" && (
          <p className="update-message success" role="status">
            {t("settings.updates.current")}
          </p>
        )}

        {update && ["available", "downloading", "preparing", "installing", "failed"].includes(status) && (
          <section className="update-available" aria-live="polite">
            <div>
              <strong>{t("settings.updates.available", { version: update.version })}</strong>
              {update.date && <span>{update.date}</span>}
            </div>
            {update.body && <pre>{update.body}</pre>}
            {status === "downloading" && (
              <div className="update-progress">
                <progress value={percent ?? undefined} max={100}>
                  {percent === null ? t("settings.updates.downloading") : `${percent}%`}
                </progress>
                <span>{percent === null ? t("settings.updates.downloading") : `${percent}%`}</span>
              </div>
            )}
            {status === "preparing" && <p>{t("settings.updates.preparing")}</p>}
            {status === "installing" && (
              <p>{t("settings.updates.installing", { backup: backupName })}</p>
            )}
            {status === "available" && (
              <Button
                variant="filled"
                leadingIcon={<MaterialIcon name="download" size={18} />}
                onClick={() => void installUpdate()}
              >
                {t("settings.updates.install")}
              </Button>
            )}
          </section>
        )}

        {error && <p className="update-error" role="alert">{error}</p>}
      </PanelCard>

      <PanelCard className="settings-card-wide" title={t("settings.updates.safetyTitle")}>
        <ul className="update-safety-list">
          <li>{t("settings.updates.safetySigned")}</li>
          <li>{t("settings.updates.safetyBackup")}</li>
          <li>{t("settings.updates.safetyIdle")}</li>
          <li>{t("settings.updates.safetySchema")}</li>
        </ul>
      </PanelCard>
    </div>
  );
}
