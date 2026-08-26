import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../../api";
import { LocaleProvider } from "../../i18n/LocaleProvider";
import type { DatabaseBackup, DatabaseRestoreStatus } from "../../types";
import MaintenanceSettingsTab from "./MaintenanceSettingsTab";

vi.mock("../../api", () => ({
  api: {
    metadataExportUrl: vi.fn((format: string) => `http://test/metadata.${format}`),
    createPortableArchive: vi.fn(),
    portableArchiveUrl: vi.fn((id: string) => `http://test/archive/${id}`),
    dryRunPortableArchiveImport: vi.fn(),
    executePortableArchiveImport: vi.fn(),
    createDiagnosticBundle: vi.fn(),
    diagnosticBundleUrl: vi.fn((id: string) => `http://test/diagnostic/${id}`)
  }
}));

const backup: DatabaseBackup = {
  id: "database.manual-test.sqlite",
  name: "Before edits",
  kind: "manual",
  created_at: "2026-08-10T00:00:00",
  app_version: "0.5.0-beta.1",
  schema_version: 1,
  size_bytes: 1024,
  integrity_status: "valid",
  integrity_error: null,
  sha256: "abc",
  restore_compatible: true,
  compatibility_error: null
};

function renderTab(status: DatabaseRestoreStatus = { pending: null, last_result: null }) {
  const notify = vi.fn();
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
        notify={notify}
        {...callbacks}
      />
    </LocaleProvider>
  );
  return { ...callbacks, notify };
}

describe("database backup maintenance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
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

  it("exports a portable archive and requires a successful dry-run before import", async () => {
    vi.mocked(api.createPortableArchive).mockResolvedValue({
      id: "archive-1",
      file_name: "archive.zip",
      size_bytes: 100,
      manifest: {
        format: "audux-archive",
        format_version: 1,
        app_version: "1.0.0",
        schema_version: 6,
        created_at: "2026-08-23T00:00:00Z",
        counts: {}
      }
    });
    vi.mocked(api.dryRunPortableArchiveImport).mockResolvedValue({
      archive_id: "import-1",
      fingerprint: "a".repeat(64),
      compatible: true,
      schema_version: 6,
      counts: { audio_items: 2 },
      missing_audio: 2,
      id_conflicts: {},
      merge_strategy: "empty_library_only",
      can_import: true,
      blockers: []
    });
    vi.mocked(api.executePortableArchiveImport).mockResolvedValue({ ok: true, missing_audio: 2, counts: {} });
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    renderTab();

    fireEvent.click(screen.getByRole("button", { name: /导出当前格式归档|Export current-format archive/ }));
    await waitFor(() => expect(open).toHaveBeenCalledWith("http://test/archive/archive-1", "_blank"));

    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    fireEvent.change(input!, { target: { files: [new File(["zip"], "library.zip", { type: "application/zip" })] } });
    expect(await screen.findByText(/Schema v6/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /事务化导入|Import transactionally/ }));
    await waitFor(() => {
      expect(api.executePortableArchiveImport).toHaveBeenCalledWith("import-1", "a".repeat(64));
    });
    open.mockRestore();
  });
});
