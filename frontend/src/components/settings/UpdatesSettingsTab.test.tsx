import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "../../i18n/LocaleProvider";
import UpdatesSettingsTab from "./UpdatesSettingsTab";

const mocks = vi.hoisted(() => ({
  prepareApplicationUpdate: vi.fn(),
  isApplicationUpdaterConfigured: vi.fn(),
  isTauriRuntime: vi.fn(),
  getCurrentApplicationVersion: vi.fn(),
  checkApplicationUpdate: vi.fn(),
  downloadApplicationUpdate: vi.fn(),
  installApplicationUpdate: vi.fn()
}));

vi.mock("../../api", () => ({
  api: { prepareApplicationUpdate: mocks.prepareApplicationUpdate }
}));

vi.mock("../../tauri", () => ({
  isTauriRuntime: mocks.isTauriRuntime,
  isApplicationUpdaterConfigured: mocks.isApplicationUpdaterConfigured,
  getCurrentApplicationVersion: mocks.getCurrentApplicationVersion,
  checkApplicationUpdate: mocks.checkApplicationUpdate,
  downloadApplicationUpdate: mocks.downloadApplicationUpdate,
  installApplicationUpdate: mocks.installApplicationUpdate
}));

function renderTab() {
  render(<LocaleProvider><UpdatesSettingsTab /></LocaleProvider>);
}

describe("UpdatesSettingsTab", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.isTauriRuntime.mockResolvedValue(true);
    mocks.isApplicationUpdaterConfigured.mockResolvedValue(true);
    mocks.getCurrentApplicationVersion.mockResolvedValue("1.0.0");
  });

  it("reports when the desktop application is current", async () => {
    mocks.checkApplicationUpdate.mockResolvedValue(null);
    renderTab();
    fireEvent.click(await screen.findByRole("button", { name: /检查更新|Check for updates/ }));
    expect(await screen.findByText(/当前已是最新版本|latest version/)).toBeInTheDocument();
  });

  it("downloads before creating a safety snapshot and installing", async () => {
    mocks.checkApplicationUpdate.mockResolvedValue({
      currentVersion: "1.0.0",
      version: "1.0.1",
      body: "修复更新"
    });
    mocks.downloadApplicationUpdate.mockImplementation(async (onProgress) => {
      onProgress({ downloadedBytes: 100, totalBytes: 100 });
    });
    mocks.prepareApplicationUpdate.mockResolvedValue({
      ok: true,
      current_version: "1.0.0",
      target_version: "1.0.1",
      backup: { name: "升级前安全快照" }
    });
    mocks.installApplicationUpdate.mockResolvedValue(undefined);
    renderTab();

    fireEvent.click(await screen.findByRole("button", { name: /检查更新|Check for updates/ }));
    fireEvent.click(await screen.findByRole("button", { name: /安全下载并安装|Download and install safely/ }));

    await waitFor(() => expect(mocks.installApplicationUpdate).toHaveBeenCalledTimes(1));
    expect(mocks.downloadApplicationUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.prepareApplicationUpdate).toHaveBeenCalledWith("1.0.1");
    expect(mocks.downloadApplicationUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.prepareApplicationUpdate.mock.invocationCallOrder[0]
    );
    expect(mocks.prepareApplicationUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.installApplicationUpdate.mock.invocationCallOrder[0]
    );
  });

  it("sends browser-lite users to the installer downloads", async () => {
    mocks.isTauriRuntime.mockResolvedValue(false);
    renderTab();
    const link = await screen.findByRole("link", { name: /官方下载页|official downloads/ });
    expect(link).toHaveAttribute("href", "https://github.com/luke-tangh/audux/releases/latest");
  });

  it("disables update checks in development builds", async () => {
    mocks.isApplicationUpdaterConfigured.mockResolvedValue(false);
    renderTab();

    expect(await screen.findByText(/开发构建和未签名|development and unsigned/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /检查更新|Check for updates/ })).not.toBeInTheDocument();
  });
});
