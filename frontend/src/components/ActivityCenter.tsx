import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { api } from "../api";
import type { ActivityFeed, ActivityItem } from "../types";
import { localizedStoredError } from "../i18n/errors";
import { Button, IconButton, MaterialIcon, StatusPill } from "./ui";

type Props = {
  onActivityChanged?: () => void;
  notify?: (message: string, type?: "success" | "error" | "info") => void;
};

const EMPTY_FEED: ActivityFeed = { items: [], active_count: 0, failed_count: 0 };
const TERMINAL = new Set(["done", "failed", "canceled", "interrupted", "installed"]);

function activityProgress(item: ActivityItem): number | null {
  if (typeof item.progress === "number") return Math.round(item.progress * 100);
  if (item.total && item.current !== null && item.current !== undefined) {
    return Math.round((item.current / item.total) * 100);
  }
  return null;
}

export default function ActivityCenter({ onActivityChanged, notify }: Props) {
  const { t } = useTranslation();
  const [feed, setFeed] = useState<ActivityFeed>(EMPTY_FEED);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const statusRef = useRef<Record<string, string>>({});
  const openRef = useRef(false);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  async function load(announce = true) {
    try {
      const next = await api.listActivities();
      if (announce && Object.keys(statusRef.current).length > 0) {
        const completed = next.items.some((item) => {
          const previous = statusRef.current[item.id];
          return previous && previous !== item.status && TERMINAL.has(item.status);
        });
        if (completed) onActivityChanged?.();
      }
      statusRef.current = Object.fromEntries(next.items.map((item) => [item.id, item.status]));
      setFeed(next);
    } catch (error) {
      if (openRef.current) {
        notify?.(error instanceof Error ? error.message : String(error), "error");
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(false);
    const timer = window.setInterval(() => void load(true), 3000);
    return () => window.clearInterval(timer);
  }, []);

  async function runAction(item: ActivityItem, action: "cancel" | "retry") {
    try {
      if (item.source === "ai" && item.source_id) {
        await (action === "cancel"
          ? api.cancelTask(item.source_id)
          : api.retryTask(item.source_id));
      } else if (item.source === "scan") {
        if (action === "cancel" && item.source_id) await api.cancelScanTask(item.source_id);
        if (action === "retry" && item.target_id) await api.scanLibraryRoot(item.target_id);
      } else if (item.source === "health" && item.source_id) {
        await (action === "cancel"
          ? api.cancelLibraryHealthTask(item.source_id)
          : api.retryLibraryHealthTask(item.source_id));
      } else if (item.source === "component") {
        await (action === "cancel"
          ? api.cancelWhisperComponentInstall()
          : api.installWhisperComponent());
      }
      notify?.(
        action === "cancel" ? t("activities.cancelRequested") : t("activities.retryRequested"),
        "info"
      );
      await load(false);
      onActivityChanged?.();
    } catch (error) {
      notify?.(error instanceof Error ? error.message : String(error), "error");
    }
  }

  return (
    <div className="activity-center">
      <IconButton
        className="activity-center-trigger"
        variant="soft"
        label={t("activities.open")}
        aria-expanded={open}
        aria-controls="activity-center-panel"
        onClick={() => setOpen((value) => !value)}
      >
        <MaterialIcon name="task_alt" size={21} />
        {(feed.active_count > 0 || feed.failed_count > 0) && (
          <span className={feed.failed_count ? "activity-badge failed" : "activity-badge"}>
            {feed.active_count || feed.failed_count}
          </span>
        )}
      </IconButton>

      {open && (
        <aside id="activity-center-panel" className="activity-center-panel" aria-label={t("activities.title")}>
          <header>
            <div>
              <h2>{t("activities.title")}</h2>
              <p>{t("activities.summary", { active: feed.active_count, failed: feed.failed_count })}</p>
            </div>
            <IconButton label={t("common.actions.close")} onClick={() => setOpen(false)}>
              <MaterialIcon name="close" size={20} />
            </IconButton>
          </header>

          <div className="activity-center-list" aria-live="polite">
            {loading && <p className="muted">{t("activities.loading")}</p>}
            {!loading && feed.items.length === 0 && <p className="muted">{t("activities.empty")}</p>}
            {feed.items.map((item) => {
              const progress = activityProgress(item);
              const error = item.error_message || item.error_code
                ? localizedStoredError(t, item.error_code || undefined, item.error_params || undefined, item.error_message || undefined)
                : "";
              return (
                <article className="activity-item" key={item.id}>
                  <div className="activity-item-heading">
                    <div>
                      <strong>{t(`activities.kinds.${item.kind}`, { defaultValue: item.kind })}</strong>
                      <span title={item.title}>{item.title}</span>
                    </div>
                    <StatusPill value={item.status} />
                  </div>
                  {progress !== null && (
                    <div className="activity-progress-row">
                      <progress value={progress} max={100}>{progress}%</progress>
                      <span>{progress}%</span>
                    </div>
                  )}
                  {item.current !== null && item.current !== undefined && item.total ? (
                    <p className="muted">{t("activities.itemsProgress", { current: item.current, total: item.total })}</p>
                  ) : null}
                  {error && <p className="activity-error">{error}</p>}
                  {(item.can_cancel || item.can_retry) && (
                    <div className="activity-actions">
                      {item.can_cancel && <Button size="sm" variant="text" onClick={() => void runAction(item, "cancel")}>{t("common.actions.cancel")}</Button>}
                      {item.can_retry && <Button size="sm" variant="outlined" onClick={() => void runAction(item, "retry")}>{t("common.actions.retry")}</Button>}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </aside>
      )}
    </div>
  );
}
