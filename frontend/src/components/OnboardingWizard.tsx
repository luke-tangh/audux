import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";

import { api } from "../api";
import { usePolling } from "../hooks/usePolling";
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
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    restoreFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const overlay = overlayRef.current;
    const siblings = overlay?.parentElement
      ? Array.from(overlay.parentElement.children).filter(
          (element): element is HTMLElement => element instanceof HTMLElement && element !== overlay
        )
      : [];
    const siblingState = siblings.map((element) => ({
      element,
      inert: element.hasAttribute("inert"),
      ariaHidden: element.getAttribute("aria-hidden")
    }));

    for (const sibling of siblings) {
      sibling.setAttribute("inert", "");
      sibling.setAttribute("aria-hidden", "true");
    }

    const timer = window.setTimeout(() => {
      const target = dialogRef.current?.querySelector<HTMLElement>(
        'input:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      (target || dialogRef.current)?.focus();
    }, 0);

    return () => {
      window.clearTimeout(timer);
      for (const { element, inert, ariaHidden } of siblingState) {
        if (!inert) element.removeAttribute("inert");
        if (ariaHidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", ariaHidden);
      }
      const restoreTarget = restoreFocusRef.current;
      restoreFocusRef.current = null;
      if (restoreTarget?.isConnected) restoreTarget.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open || !result) return;
    const timer = window.setTimeout(() => {
      dialogRef.current?.querySelector<HTMLElement>("button:not([disabled])")?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [open, result]);

  usePolling({
    enabled: open && Boolean(result),
    intervalMs: 1000,
    immediate: true,
    task: async () => {
      if (!result) return;

      const feed = await api.listActivities();
      const next =
        feed.items.find((item) => item.id === `scan:${result.scan_task.id}`) || null;
      setActivity(next);
      if (
        next &&
        !previewRefreshed.current &&
        (Number(next.current || 0) > 0 || next.status === "done")
      ) {
        previewRefreshed.current = true;
        onImported();
      }
    }
  });

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

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }

    if (event.key !== "Tab") return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
    ));
    if (focusable.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      ref={overlayRef}
      className="onboarding-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
      onKeyDown={handleKeyDown}
    >
      <section ref={dialogRef} className="onboarding-card" tabIndex={-1}>
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
