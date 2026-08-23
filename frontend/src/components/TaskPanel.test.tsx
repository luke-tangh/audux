import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../api";
import type { AITask } from "../types";
import { DialogProvider } from "./dialog/UnifiedDialog";
import { LocaleProvider } from "../i18n/LocaleProvider";
import TaskPanel from "./TaskPanel";

vi.mock("../api", () => ({
  api: {
    listTasks: vi.fn(),
    retryTask: vi.fn(),
    cancelTask: vi.fn()
  }
}));

vi.mock("../hooks/usePolling", () => ({
  usePolling: vi.fn()
}));

function task(status: string): AITask {
  return {
    id: 8,
    audio_id: 3,
    task_type: "transcribe",
    status,
    retry_count: 1,
    created_at: "2026-08-20T00:00:00Z",
    updated_at: "2026-08-20T00:01:00Z",
    error_message: status === "failed" ? "worker unavailable" : undefined
  };
}

function renderPanel(props: React.ComponentProps<typeof TaskPanel> = {}) {
  return render(
    <LocaleProvider>
      <DialogProvider>
        <TaskPanel {...props} />
      </DialogProvider>
    </LocaleProvider>
  );
}

describe("TaskPanel", () => {
  beforeEach(() => {
    vi.mocked(api.listTasks).mockReset();
    vi.mocked(api.retryTask).mockReset();
    vi.mocked(api.cancelTask).mockReset();
  });

  it("loads failed tasks and retries them", async () => {
    vi.mocked(api.listTasks).mockResolvedValue([task("failed")]);
    vi.mocked(api.retryTask).mockResolvedValue(task("pending"));
    const notify = vi.fn();
    const onTaskChanged = vi.fn();
    renderPanel({ notify, onTaskChanged });

    fireEvent.click(screen.getByRole("button", { name: /刷新|refresh/i }));
    const retry = await screen.findByRole("button", { name: /8/ });
    fireEvent.click(retry);

    await waitFor(() => expect(api.retryTask).toHaveBeenCalledWith(8));
    expect(onTaskChanged).toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(expect.any(String), "success");
  });

  it("reports a task that changes from running to failed", async () => {
    vi.mocked(api.listTasks)
      .mockResolvedValueOnce([task("running")])
      .mockResolvedValueOnce([task("failed")]);
    const notify = vi.fn();
    const onTaskChanged = vi.fn();
    renderPanel({ notify, onTaskChanged });

    const refresh = screen.getByRole("button", { name: /刷新|refresh/i });
    fireEvent.click(refresh);
    await screen.findByLabelText(/进行中|in progress/i);
    fireEvent.click(refresh);

    await waitFor(() => expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("worker unavailable"),
      "error"
    ));
    expect(onTaskChanged).toHaveBeenCalledTimes(1);
  });
});
