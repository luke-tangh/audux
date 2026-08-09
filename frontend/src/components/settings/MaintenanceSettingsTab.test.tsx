import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "../../i18n/LocaleProvider";
import type { DatabaseBackup, DatabaseRestoreStatus } from "../../types";
import MaintenanceSettingsTab from "./MaintenanceSettingsTab";

const backup: DatabaseBackup = {
  id: "database.manual-test.sqlite",
  name: "Before edits",
  kind: "manual",
  created_at: "2026-08-10T00:00:00",
  app_version: "0.5.0-beta.1",
  schema_version: 7,
  size_bytes: 1024,
  integrity_status: "valid",
  integrity_error: null,
  sha256: "abc",
  restore_compatible: true,
  compatibility_error: null
};

function renderTab(status: DatabaseRestoreStatus = { pending: null, last_result: null }) {
  const callbacks = {
    onCreateBackup: vi.fn(),
    onLoadBackups: vi.fn(),
    onValidateBackup: vi.fn(),
    onRestoreBackup: vi.fn(),
    onDeleteBackup: vi.fn(),
    onCancelRestore: vi.fn(),
    onRebuildSearch: vi.fn(),
    onCleanupTags: vi.fn(),
    onLoadTags: vi.fn(),
    onRenameTag: vi.fn(),
    onMergeTag: vi.fn(),
    onDeleteTag: vi.fn()
  };
  render(
    <LocaleProvider>
      <MaintenanceSettingsTab
        maintenanceTags={[]}
        databaseBackups={[backup]}
        databaseRestoreStatus={status}
        backupAction={null}
        {...callbacks}
      />
    </LocaleProvider>
  );
  return callbacks;
}

describe("database backup maintenance", () => {
  it("offers validation and restore actions for a compatible snapshot", () => {
    const callbacks = renderTab();

    expect(screen.getByText("Before edits")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Validate|校验/ }));
    fireEvent.click(screen.getByRole("button", { name: /Restore|恢复/ }));
    expect(callbacks.onValidateBackup).toHaveBeenCalledWith(backup);
    expect(callbacks.onRestoreBackup).toHaveBeenCalledWith(backup);
  });

  it("protects snapshots referenced by a pending restore", () => {
    const callbacks = renderTab({
      pending: {
        snapshot_id: backup.id,
        safety_snapshot_id: "database.pre-restore-test.sqlite",
        requested_at: "2026-08-10T00:00:00"
      },
      last_result: null
    });

    expect(screen.getByRole("button", { name: /Create snapshot|创建快照/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Restore|恢复/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Delete|删除/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /Cancel pending restore|取消待恢复请求/ }));
    expect(callbacks.onCancelRestore).toHaveBeenCalledOnce();
  });
});
