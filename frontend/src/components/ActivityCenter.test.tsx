import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "../i18n/LocaleProvider";
import ActivityCenter from "./ActivityCenter";

const mocks = vi.hoisted(() => ({
  listActivities: vi.fn(),
  retryTask: vi.fn(),
  cancelTask: vi.fn()
}));

vi.mock("../api", () => ({
  api: {
    listActivities: mocks.listActivities,
    retryTask: mocks.retryTask,
    cancelTask: mocks.cancelTask
  }
}));

describe("ActivityCenter", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it("shows failed work and retries it from the global panel", async () => {
    mocks.listActivities.mockResolvedValue({
      items: [{
        id: "ai:9",
        source: "ai",
        source_id: 9,
        kind: "transcribe",
        status: "failed",
        title: "访谈录音",
        progress: 0.5,
        error_message: "Model unavailable",
        can_cancel: false,
        can_retry: true
      }],
      active_count: 0,
      failed_count: 1
    });
    mocks.retryTask.mockResolvedValue({});
    const notify = vi.fn();

    render(
      <LocaleProvider>
        <ActivityCenter notify={notify} />
      </LocaleProvider>
    );

    await waitFor(() => expect(mocks.listActivities).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /活动中心|activity center/i }));
    expect(screen.getByText("访谈录音")).toBeInTheDocument();
    expect(screen.getByText("Model unavailable")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /重试|Retry/ }));

    await waitFor(() => expect(mocks.retryTask).toHaveBeenCalledWith(9));
    expect(notify).toHaveBeenCalledWith(expect.any(String), "info");
  });

  it("starts at the upper right and persists a dragged position without opening", async () => {
    mocks.listActivities.mockResolvedValue({
      items: [],
      active_count: 0,
      failed_count: 0
    });

    const { container } = render(
      <LocaleProvider>
        <ActivityCenter />
      </LocaleProvider>
    );

    await waitFor(() => expect(mocks.listActivities).toHaveBeenCalled());
    const root = container.querySelector<HTMLElement>(".activity-center");
    const trigger = screen.getByRole("button", { name: /活动中心|activity center/i });
    expect(root?.style.top).toBe("72px");

    fireEvent.pointerDown(trigger, { pointerId: 4, button: 0, clientX: 990, clientY: 72 });
    fireEvent.pointerMove(trigger, { pointerId: 4, clientX: 420, clientY: 230 });
    fireEvent.pointerUp(trigger, { pointerId: 4, clientX: 420, clientY: 230 });
    fireEvent.click(trigger);

    expect(screen.queryByRole("complementary", { name: /任务与活动|tasks and activity/i })).not.toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem("audux.activity-center.position.v1") || "null")).toEqual({
      x: expect.any(Number),
      y: 230
    });
    expect(root?.style.top).toBe("230px");

    fireEvent.click(trigger);
    expect(screen.getByRole("complementary", { name: /任务与活动|tasks and activity/i })).toBeInTheDocument();
  });
});
