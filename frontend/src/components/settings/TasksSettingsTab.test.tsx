import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "../../i18n/LocaleProvider";
import TasksSettingsTab from "./TasksSettingsTab";

vi.mock("../TaskPanel", () => ({
  default: () => <div>task queue</div>
}));

function renderTab(
  enabled: boolean,
  onChange = vi.fn<(_enabled: boolean) => Promise<void>>().mockResolvedValue()
) {
  const notify = vi.fn();
  render(
    <LocaleProvider>
      <TasksSettingsTab
        activityCenterEnabled={enabled}
        onActivityCenterEnabledChange={onChange}
        onTaskChanged={vi.fn()}
        notify={notify}
      />
    </LocaleProvider>
  );
  return { notify, onChange };
}

describe("TasksSettingsTab", () => {
  it("shows the floating activity center as off by default and enables it", async () => {
    const { onChange } = renderTab(false);
    const checkbox = screen.getByRole("checkbox", {
      name: /显示任务与活动浮标|Show the tasks and activity button/
    });

    expect(checkbox).not.toBeChecked();
    fireEvent.click(checkbox);

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(true));
  });

  it("keeps the controlled value and reports a persistence failure", async () => {
    const onChange = vi.fn().mockRejectedValue(new Error("save failed"));
    const { notify } = renderTab(false, onChange);

    fireEvent.click(screen.getByRole("checkbox", {
      name: /显示任务与活动浮标|Show the tasks and activity button/
    }));

    expect(await screen.findByRole("alert")).toHaveTextContent("save failed");
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("save failed"), "error");
  });
});
