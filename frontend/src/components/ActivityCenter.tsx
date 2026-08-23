import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
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
const TERMINAL = new Set(["done", "partial", "failed", "canceled", "interrupted", "installed"]);
const POSITION_STORAGE_KEY = "audux.activity-center.position.v1";
const TRIGGER_SIZE = 40;
const VIEWPORT_MARGIN = 12;
const DEFAULT_TOP = 72;

type Position = { x: number; y: number };
type DragState = {
  pointerId: number;
  startX: number;
  startY: number;
  origin: Position;
  moved: boolean;
};

function clampPosition(position: Position): Position {
  if (typeof window === "undefined") return position;
  return {
    x: Math.min(Math.max(position.x, VIEWPORT_MARGIN), Math.max(VIEWPORT_MARGIN, window.innerWidth - TRIGGER_SIZE - VIEWPORT_MARGIN)),
    y: Math.min(Math.max(position.y, VIEWPORT_MARGIN), Math.max(VIEWPORT_MARGIN, window.innerHeight - TRIGGER_SIZE - VIEWPORT_MARGIN))
  };
}

function defaultPosition(): Position {
  if (typeof window === "undefined") return { x: VIEWPORT_MARGIN, y: DEFAULT_TOP };
  return clampPosition({ x: window.innerWidth - TRIGGER_SIZE - 20, y: DEFAULT_TOP });
}

function storedPosition(): Position {
  if (typeof window === "undefined") return defaultPosition();
  try {
    const saved = JSON.parse(window.localStorage.getItem(POSITION_STORAGE_KEY) || "null") as Partial<Position> | null;
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
      return clampPosition({ x: saved.x as number, y: saved.y as number });
    }
  } catch {
    // A missing or unavailable preference should never hide the global control.
  }
  return defaultPosition();
}

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
  const [position, setPosition] = useState<Position>(storedPosition);
  const [dragging, setDragging] = useState(false);
  const statusRef = useRef<Record<string, string>>({});
  const openRef = useRef(false);
  const positionRef = useRef(position);
  const dragRef = useRef<DragState | null>(null);
  const suppressClickRef = useRef(false);

  positionRef.current = position;

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

  useEffect(() => {
    function keepInViewport() {
      const next = clampPosition(positionRef.current);
      positionRef.current = next;
      setPosition(next);
    }
    window.addEventListener("resize", keepInViewport);
    return () => window.removeEventListener("resize", keepInViewport);
  }, []);

  function startDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin: positionRef.current,
      moved: false
    };
    suppressClickRef.current = false;
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function moveDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(deltaX, deltaY) < 4) return;

    drag.moved = true;
    setDragging(true);
    event.preventDefault();
    const next = clampPosition({ x: drag.origin.x + deltaX, y: drag.origin.y + deltaY });
    positionRef.current = next;
    setPosition(next);
  }

  function finishDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.moved) {
      suppressClickRef.current = true;
      try {
        window.localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(positionRef.current));
      } catch {
        // Dragging remains useful even if preferences cannot be persisted.
      }
    }
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    dragRef.current = null;
    setDragging(false);
  }

  const panelOpensAbove = position.y + TRIGGER_SIZE / 2 > window.innerHeight / 2;
  const panelWidth = Math.min(410, window.innerWidth - 28);
  const preferredPanelLeft = position.x + TRIGGER_SIZE / 2 > window.innerWidth / 2
    ? position.x + TRIGGER_SIZE - panelWidth
    : position.x;
  const panelLeft = Math.min(Math.max(preferredPanelLeft, 14), window.innerWidth - panelWidth - 14);
  const panelAvailableHeight = panelOpensAbove
    ? position.y - 24
    : window.innerHeight - position.y - 64;
  const panelStyle = {
    left: panelLeft,
    width: panelWidth,
    maxHeight: Math.min(620, Math.max(96, panelAvailableHeight)),
    top: panelOpensAbove ? undefined : position.y + 52,
    bottom: panelOpensAbove ? window.innerHeight - position.y + 12 : undefined
  };

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
      } else if (item.source === "organization" && item.source_id) {
        await (action === "cancel"
          ? api.cancelOrganizationRun(item.source_id)
          : api.retryOrganizationRun(item.source_id));
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
    <div className="activity-center" style={{ left: position.x, top: position.y }}>
      <IconButton
        className={dragging ? "activity-center-trigger dragging" : "activity-center-trigger"}
        variant="soft"
        label={t("activities.open")}
        title={t("activities.dragHint")}
        aria-expanded={open}
        aria-controls="activity-center-panel"
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        onClick={(event) => {
          if (suppressClickRef.current) {
            suppressClickRef.current = false;
            event.preventDefault();
            return;
          }
          setOpen((value) => !value);
        }}
      >
        <MaterialIcon name="task_alt" size={21} />
        {(feed.active_count > 0 || feed.failed_count > 0) && (
          <span className={feed.failed_count ? "activity-badge failed" : "activity-badge"}>
            {feed.active_count || feed.failed_count}
          </span>
        )}
      </IconButton>

      {open && (
        <aside id="activity-center-panel" className="activity-center-panel" style={panelStyle} aria-label={t("activities.title")}>
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
