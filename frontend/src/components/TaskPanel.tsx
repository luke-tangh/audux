import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { AITask } from "../types";
import { Button, StatusPill } from "./ui";
import { useDialog } from "./dialog/UnifiedDialog";

type ToastType = "info" | "success" | "error";

type Props = {
  onTaskChanged?: () => void;
  notify?: (message: string, type?: ToastType) => void;
};

function formatTime(value?: string): string {
  if (!value) return "-";

  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}


function terminalStatus(status: string): boolean {
  return status === "done" || status === "failed" || status === "canceled";
}

export default function TaskPanel({ onTaskChanged, notify }: Props) {
  const dialog = useDialog();

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
            notify?.(`任务 #${task.id} 已完成：${task.task_type}`, "success");
          }

          if (task.status === "failed") {
            notify?.(`任务 #${task.id} 失败：${task.error_message || task.task_type}`, "error");
          }

          if (task.status === "canceled") {
            notify?.(`任务 #${task.id} 已取消`, "info");
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
      notify?.(`任务 #${task.id} 已重新加入队列`, "success");
      await load();
      onTaskChanged?.();
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function cancel(task: AITask) {
    const ok = await dialog.confirm({
      title: "取消任务？",
      message:
        task.status === "running"
          ? "running 任务无法立即中断底层模型调用，但会在当前处理阶段结束后标记取消。确认取消？"
          : "确认取消该任务？",
      confirmLabel: "取消任务",
      cancelLabel: "继续等待",
      tone: "warning"
    });

    if (!ok) return;

    try {
      await api.cancelTask(task.id);
      notify?.(`任务 #${task.id} 已请求取消`, "info");
      await load();
      onTaskChanged?.();
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  return (
    <div className="task-panel">
      <div className="task-panel-header">
        <h3>AI / ASR 任务队列</h3>
        <Button variant="outlined" onClick={load}>{loading ? "刷新中..." : "刷新"}</Button>
      </div>

      {tasks.length === 0 && <p className="muted">暂无任务</p>}

      {tasks.length > 0 && (
        <div className="task-table-wrap">
          <table className="task-table">
            <caption className="sr-only">AI / ASR 任务队列</caption>
            <thead>
              <tr>
                <th>ID</th>
                <th>音频</th>
                <th>类型</th>
                <th>状态</th>
                <th>重试</th>
                <th>创建时间</th>
                <th>更新时间</th>
                <th>错误</th>
                <th>操作</th>
              </tr>
            </thead>

            <tbody>
              {tasks.map((task) => (
                <tr key={task.id}>
                  <td>{task.id}</td>
                  <td>{task.audio_id}</td>
                  <td>{task.task_type}</td>
                  <td>
                    <StatusPill value={task.status} />
                  </td>
                  <td>{task.retry_count}</td>
                  <td>{formatTime(task.created_at)}</td>
                  <td>{formatTime(task.updated_at)}</td>
                  <td className="task-error" title={task.error_message || ""}>
                    {task.error_message || "-"}
                  </td>
                  <td>
                    <div className="task-actions">
                      {(task.status === "failed" || task.status === "canceled") && (
                        <Button
                          type="button"
                          variant="text"
                          aria-label={`重试任务 #${task.id}`}
                          onClick={() => retry(task)}
                        >
                          重试
                        </Button>
                      )}

                      {(task.status === "pending" || task.status === "running") && (
                        <Button
                          type="button"
                          variant="text"
                          aria-label={`取消任务 #${task.id}`}
                          onClick={() => cancel(task)}
                        >
                          取消
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
