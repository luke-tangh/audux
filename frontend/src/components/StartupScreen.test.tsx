import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "../i18n/LocaleProvider";
import StartupScreen from "./StartupScreen";

const tauri = vi.hoisted(() => ({
  openAppDataDirectory: vi.fn().mockResolvedValue(true),
  openLogsDirectory: vi.fn().mockResolvedValue(true),
  restartApplication: vi.fn().mockResolvedValue(true)
}));

vi.mock("../tauri", () => tauri);

describe("StartupScreen", () => {
  it("shows an actionable permission hint and recovery actions", () => {
    const onRetry = vi.fn();
    render(
      <LocaleProvider>
        <StartupScreen
          state="error"
          error="Permission denied while opening database"
          onRetry={onRetry}
        />
      </LocaleProvider>
    );

    expect(screen.getByRole("alert")).toHaveTextContent(/权限|permission/i);
    fireEvent.click(screen.getByRole("button", { name: /重试|Retry/ }));
    fireEvent.click(screen.getByRole("button", { name: /打开日志|Open logs/ }));

    expect(onRetry).toHaveBeenCalledOnce();
    expect(tauri.openLogsDirectory).toHaveBeenCalledOnce();
  });

  it("renders a non-error startup status", () => {
    render(
      <LocaleProvider>
        <StartupScreen state="starting" onRetry={vi.fn()} />
      </LocaleProvider>
    );

    expect(screen.getByRole("status")).toHaveTextContent(/正在启动|Starting/i);
    expect(screen.queryByRole("button", { name: /重试|Retry/ })).toBeNull();
  });
});
