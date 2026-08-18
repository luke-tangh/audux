import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { api } from "../api";
import { pickAudioFolder } from "../tauri";
import type { ActivityItem, LibraryImportResult } from "../types";
import { Button, MaterialIcon, TextField } from "./ui";

type Props = {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
};

export default function OnboardingWizard({ open, onClose, onImported }: Props) {
  const { t } = useTranslation();
  const [path, setPath] = useState("");
  const [result, setResult] = useState<LibraryImportResult | null>(null);
  const [activity, setActivity] = useState<ActivityItem | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const previewRefreshed = useRef(false);

  useEffect(() => {
    if (!open || !result) return;
    let active = true;
    const update = async () => {
      try {
        const feed = await api.listActivities();
        const next = feed.items.find((item) => item.id === `scan:${result.scan_task.id}`) || null;
        if (!active) return;
        setActivity(next);
        if (
          next &&
          !previewRefreshed.current &&
          (Number(next.current || 0) > 0 || next.status === "done")
        ) {
          previewRefreshed.current = true;
          onImported();
        }
      } catch {
        // The global activity center will continue polling if this lightweight preview fails.
      }
    };
    void update();
    const timer = window.setInterval(() => void update(), 1000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [open, result?.scan_task.id]);

  if (!open) return null;

  async function chooseFolder() {
    const selected = await pickAudioFolder();
    if (selected) setPath(selected);
  }

  async function startImport() {
    if (!path.trim() || working) return;
    setWorking(true);
    setError("");
    try {
      const imported = await api.importLibraryRoot(path.trim());
      previewRefreshed.current = false;
      setResult(imported);
      onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setWorking(false);
    }
  }

  const progress = typeof activity?.progress === "number"
    ? Math.round(activity.progress * 100)
    : null;
  const finished = activity?.status === "done";

  return (
    <div className="onboarding-overlay" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
      <section className="onboarding-card">
        <div className="onboarding-mark" aria-hidden="true"><MaterialIcon name="library_music" size={34} /></div>
        <div className="onboarding-copy">
          <span className="eyebrow">{t("onboarding.eyebrow")}</span>
          <h1 id="onboarding-title">{result ? t("onboarding.scanningTitle") : t("onboarding.title")}</h1>
          <p>{result ? t("onboarding.scanningDescription") : t("onboarding.description")}</p>
        </div>

        {!result ? (
          <>
            <div className="onboarding-promises">
              <span><MaterialIcon name="privacy_tip" size={18} />{t("onboarding.local")}</span>
              <span><MaterialIcon name="hard_drive" size={18} />{t("onboarding.nonDestructive")}</span>
              <span><MaterialIcon name="play_circle" size={18} />{t("onboarding.browseEarly")}</span>
            </div>
            <div className="onboarding-folder-row">
              <TextField
                wide
                label={t("onboarding.folder")}
                value={path}
                placeholder={t("onboarding.folderPlaceholder")}
                disabled={working}
                onValueChange={setPath}
              />
              <Button variant="outlined" onClick={() => void chooseFolder()} disabled={working}>{t("onboarding.choose")}</Button>
            </div>
            <p className="muted">{t("onboarding.formats")}</p>
            {error && <p className="onboarding-error" role="alert">{error}</p>}
            <div className="onboarding-actions">
              <Button variant="text" onClick={onClose}>{t("onboarding.later")}</Button>
              <Button variant="filled" disabled={!path.trim() || working} onClick={() => void startImport()}>
                {working ? t("onboarding.starting") : t("onboarding.start")}
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="onboarding-scan-status" aria-live="polite">
              <div><strong>{result.root.path}</strong><span>{t(`activities.kinds.scan`)}</span></div>
              {progress !== null && <><progress value={progress} max={100}>{progress}%</progress><span>{progress}%</span></>}
              {activity?.total ? <p>{t("activities.itemsProgress", { current: activity.current || 0, total: activity.total })}</p> : <p>{t("onboarding.discovering")}</p>}
            </div>
            <div className="onboarding-actions">
              <Button variant="filled" onClick={onClose}>
                {finished ? t("onboarding.finish") : t("onboarding.enter")}
              </Button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
