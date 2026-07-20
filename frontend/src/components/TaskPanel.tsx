import { useEffect, useState } from "react";
import { api } from "../api";
import type { AITask } from "../types";

type Props = {
  onTaskChanged?: () => void;
};

function formatTime(value?: string): string {
  if (!value) return "-";

  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function statusClass(status: string): string {
  if (status === "done") return "done";
  if (status === "failed") return "failed";
  if (status === "running") return "running";
  if (status === "pending") return "pending";
  if (status === "canceled") return "canceled";
  return "";
}

export default function TaskPanel({ onTaskChanged }: Props) {
  const [tasks, setTasks] = useState<AITask[]>([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const rows = await api.listTasks();
      setTasks(rows);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load().catch(console.error);

    const timer = setInterval(() => {
      load().catch(console.error);
    }, 3000);

    return () => clearInterval(timer);
  }, []);

  async function retry(task: AITask) {
    await api.retryTask(task.id);
    await load();
    onTaskChanged?.();
  }

  async function cancel(task: AITask) {
    const ok = window.confirm(
      task.status === "running"
        ? "running 任务无法立即中断底层模型调用，但会在当前处理阶段结束后标记取消。确认取消？"
        : "确认取消该任务？"
    );

    if (!ok) return;

    await api.cancelTask(task.id);
    await load();
    onTaskChanged?.();
  }

  return (
    <div className="task-panel">
      <div className="task-panel-header">
        <h3>AI / ASR 任务队列</h3>
        <button onClick={load}>{loading ? "刷新中..." : "刷新"}</button>
      </div>

      {tasks.length === 0 && <p className="muted">暂无任务</p>}

      {tasks.length > 0 && (
        <div className="task-table-wrap">
          <table className="task-table">
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
                    <span className={`status-pill ${statusClass(task.status)}`}>
                      {task.status}
                    </span>
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
                        <button onClick={() => retry(task)}>重试</button>
                      )}

                      {(task.status === "pending" || task.status === "running") && (
                        <button onClick={() => cancel(task)}>取消</button>
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
