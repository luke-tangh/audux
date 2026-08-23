import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ACTIVITY_CENTER_SETTING_KEY,
  useActivityCenterPreference
} from "./useActivityCenterPreference";

const apiMocks = vi.hoisted(() => ({
  listSettings: vi.fn(),
  setSetting: vi.fn()
}));

vi.mock("../api", () => ({ api: apiMocks }));

function PreferenceHarness() {
  const { enabled, updateEnabled } = useActivityCenterPreference();

  return (
    <button type="button" onClick={() => void updateEnabled(!enabled)}>
      {enabled ? "enabled" : "disabled"}
    </button>
  );
}

describe("useActivityCenterPreference", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.setSetting.mockResolvedValue({});
  });

  it("defaults to disabled when the setting is absent", async () => {
    apiMocks.listSettings.mockResolvedValue(undefined);

    render(<PreferenceHarness />);

    await waitFor(() => expect(apiMocks.listSettings).toHaveBeenCalledOnce());
    expect(screen.getByRole("button", { name: "disabled" })).toBeInTheDocument();
  });

  it("loads and persists the floating activity center preference", async () => {
    apiMocks.listSettings.mockResolvedValue([{
      key: ACTIVITY_CENTER_SETTING_KEY,
      value: "true",
      updated_at: "2026-08-23T00:00:00"
    }]);

    render(<PreferenceHarness />);

    const toggle = await screen.findByRole("button", { name: "enabled" });
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(apiMocks.setSetting).toHaveBeenCalledWith(
        ACTIVITY_CENTER_SETTING_KEY,
        "false"
      );
    });
    expect(await screen.findByRole("button", { name: "disabled" })).toBeInTheDocument();
  });
});
