import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { AITask } from "../types";
import { Button, StatusPill } from "./ui";
import { useDialog } from "./dialog/UnifiedDialog";
import { useTranslation } from "react-i18next";
import { useLocale } from "../i18n/LocaleProvider";
import { localizedStoredError } from "../i18n/errors";
import { formatDateTime } from "../i18n/format";

type ToastType = "info" | "success" | "error";

type Props = {
  onTaskChanged?: () => void;
  notify?: (message: string, type?: ToastType) => void;
};

function terminalStatus(status: string): boolean {
  return status === "done" || status === "failed" || status === "canceled";
}

export default function TaskPanel({ onTaskChanged, notify }: Props) {
  const dialog = useDialog();
  const { t } = useTranslation();
  const { resolvedLanguage } = useLocale();

  const [tasks, setTasks] = useState<AITask[]>([]);
  const [loading, setLoading] = useState(false);

  const taskStatusRef = useRef<Record<number, string>>({});
  const initializedRef = useRef(false);

  function applyTasks(rows: AITask[]) {
    let shouldRefreshLibrary = false;

    if (initializedRef.current) {
      for (const task of rows) {
        const previous = taskStatusRef.current[task.id];

        if (previous && previous !== task.status && terminalStatus(task.status)) {
          if (task.status === "done") {
            notify?.(t("tasks.completed", { id: task.id, type: t(`tasks.types.${task.task_type}`, { defaultValue: task.task_type }) }), "success");
          }

          if (task.status === "failed") {
            notify?.(t("tasks.failed", {
              id: task.id,
              error: localizedStoredError(t, task.error_code, task.error_params, task.error_message || task.task_type)
            }), "error");
          }

          if (task.status === "canceled") {
            notify?.(t("tasks.canceled", { id: task.id }), "info");
          }

          shouldRefreshLibrary = true;
        }
      }
    }

    const nextStatus: Record<number, string> = {};
    for (const task of rows) {
      nextStatus[task.id] = task.status;
    }

    taskStatusRef.current = nextStatus;
    initializedRef.current = true;
    setTasks(rows);

    if (shouldRefreshLibrary) {
      onTaskChanged?.();
    }
  }

  async function load() {
    setLoading(true);
    try {
      const rows = await api.listTasks();
      applyTasks(rows);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load().catch((err) => {
      console.error(err);
      notify?.(err instanceof Error ? err.message : String(err), "error");
    });

    const timer = setInterval(() => {
      load().catch((err) => {
        console.error(err);
      });
    }, 3000);

    return () => clearInterval(timer);
  }, []);

  async function retry(task: AITask) {
    try {
      await api.retryTask(task.id);
      notify?.(t("tasks.requeued", { id: task.id }), "success");
      await load();
      onTaskChanged?.();
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function cancel(task: AITask) {
    const ok = await dialog.confirm({
      title: t("tasks.cancelTitle"),
      message:
        task.status === "running"
          ? t("tasks.cancelRunning")
          : t("tasks.cancelPending"),
      confirmLabel: t("tasks.cancelConfirm"),
      cancelLabel: t("tasks.keepWaiting"),
      tone: "warning"
    });

    if (!ok) return;

    try {
      await api.cancelTask(task.id);
      notify?.(t("tasks.cancelRequested", { id: task.id }), "info");
      await load();
      onTaskChanged?.();
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  return (
    <div className="task-panel">
      <div className="task-panel-header">
        <h3>{t("tasks.title")}</h3>
        <Button variant="outlined" onClick={load}>{loading ? t("common.actions.refreshing") : t("common.actions.refresh")}</Button>
      </div>

      {tasks.length === 0 && <p className="muted">{t("tasks.empty")}</p>}

      {tasks.length > 0 && (
        <div className="task-table-wrap">
          <table className="task-table">
            <caption className="sr-only">{t("tasks.title")}</caption>
            <thead>
              <tr>
                <th>ID</th>
                <th>{t("tasks.audio")}</th>
                <th>{t("tasks.type")}</th>
                <th>{t("tasks.status")}</th>
                <th>{t("tasks.retries")}</th>
                <th>{t("tasks.created")}</th>
                <th>{t("tasks.updated")}</th>
                <th>{t("tasks.error")}</th>
                <th>{t("tasks.actions")}</th>
              </tr>
            </thead>

            <tbody>
              {tasks.map((task) => (
                <tr key={task.id}>
                  <td>{task.id}</td>
                  <td>{task.audio_id}</td>
                  <td>{t(`tasks.types.${task.task_type}`, { defaultValue: task.task_type })}</td>
                  <td>
                    <StatusPill value={task.status} />
                  </td>
                  <td>{task.retry_count}</td>
                  <td>{formatDateTime(task.created_at, resolvedLanguage)}</td>
                  <td>{formatDateTime(task.updated_at, resolvedLanguage)}</td>
                  <td className="task-error" title={localizedStoredError(t, task.error_code, task.error_params, task.error_message)}>
                    {task.error_message || task.error_code
                      ? localizedStoredError(t, task.error_code, task.error_params, task.error_message)
                      : "-"}
                  </td>
                  <td>
                    <div className="task-actions">
                      {(task.status === "failed" || task.status === "canceled") && (
                        <Button
                          type="button"
                          variant="text"
                          aria-label={t("tasks.retryLabel", { id: task.id })}
                          onClick={() => retry(task)}
                        >
                          {t("common.actions.retry")}
                        </Button>
                      )}

                      {(task.status === "pending" || task.status === "running") && (
                        <Button
                          type="button"
                          variant="text"
                          aria-label={t("tasks.cancelLabel", { id: task.id })}
                          onClick={() => cancel(task)}
                        >
                          {t("common.actions.cancel")}
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
