import type {
  ArchiveImportDryRun,
  ApplicationUpdatePreparation,
  DatabaseBackup,
  DatabaseRestorePreflight,
  DatabaseRestoreStatus,
  DiagnosticBundleRecord,
  ExternalAsrPreprocessingStatus,
  PendingDatabaseRestore,
  PortableArchiveRecord,
  WhisperComponentStatus
} from "../types";
import type { ApiContext } from "./context";

interface SettingRecord {
  key: string;
  value: string;
  updated_at: string;
}

export function createSettingsApi(context: ApiContext) {
  const { request, appendAccessToken, getApiBase } = context;

  return {
    setSetting: (key: string, value: string) => request("/settings", {
      method: "PUT",
      body: JSON.stringify({ key, value })
    }),
    setSettingsSection: (section: "asr" | "llm", values: Record<string, string>) =>
      request<SettingRecord[]>(`/settings/${section}`, {
        method: "PUT",
        body: JSON.stringify({ values })
      }),
    listSettings: () => request<SettingRecord[]>("/settings"),
    getWhisperComponentStatus: () =>
      request<WhisperComponentStatus>("/asr/whisper-component"),
    getExternalAsrPreprocessingStatus: () =>
      request<ExternalAsrPreprocessingStatus>("/asr/external-preprocessing"),
    installWhisperComponent: () =>
      request<WhisperComponentStatus>("/asr/whisper-component/install", { method: "POST" }),
    cancelWhisperComponentInstall: () =>
      request<WhisperComponentStatus>("/asr/whisper-component/install/cancel", {
        method: "POST"
      }),
    removeWhisperComponent: () =>
      request<WhisperComponentStatus>("/asr/whisper-component", { method: "DELETE" }),
    rebuildSearchIndex: () =>
      request<{ ok: boolean; count: number }>("/maintenance/rebuild-search-index", {
        method: "POST"
      }),
    cleanupTags: () => request<{ ok: boolean; deleted: number }>(
      "/maintenance/cleanup-tags",
      { method: "POST" }
    ),
    createPortableArchive: () =>
      request<PortableArchiveRecord>("/maintenance/archives", { method: "POST" }),
    portableArchiveUrl: (id: string) => appendAccessToken(
      `${getApiBase()}/maintenance/archives/${encodeURIComponent(id)}/file`
    ),
    dryRunPortableArchiveImport: (file: File) => {
      const body = new FormData();
      body.append("file", file);
      return request<ArchiveImportDryRun>("/maintenance/archives/import/dry-run", {
        method: "POST",
        body
      });
    },
    executePortableArchiveImport: (archiveId: string, fingerprint: string) =>
      request<{ ok: boolean; missing_audio: number; counts: Record<string, number> }>(
        "/maintenance/archives/import",
        { method: "POST", body: JSON.stringify({ archive_id: archiveId, fingerprint }) }
      ),
    createDiagnosticBundle: () =>
      request<DiagnosticBundleRecord>("/maintenance/diagnostics", { method: "POST" }),
    diagnosticBundleUrl: (id: string) => appendAccessToken(
      `${getApiBase()}/maintenance/diagnostics/${encodeURIComponent(id)}/file`
    ),
    listDatabaseBackups: () => request<DatabaseBackup[]>("/maintenance/database-backups"),
    createDatabaseBackup: (name?: string) =>
      request<DatabaseBackup>("/maintenance/database-backups", {
        method: "POST",
        body: JSON.stringify({ name: name || null })
      }),
    prepareApplicationUpdate: (targetVersion: string) =>
      request<ApplicationUpdatePreparation>("/maintenance/application-update/prepare", {
        method: "POST",
        body: JSON.stringify({ target_version: targetVersion })
      }),
    validateDatabaseBackup: (snapshotId: string) => request<DatabaseBackup>(
      `/maintenance/database-backups/${encodeURIComponent(snapshotId)}/validate`,
      { method: "POST" }
    ),
    deleteDatabaseBackup: (snapshotId: string) => request<{ ok: boolean; id: string }>(
      `/maintenance/database-backups/${encodeURIComponent(snapshotId)}`,
      { method: "DELETE" }
    ),
    preflightDatabaseRestore: (snapshotId: string) => request<DatabaseRestorePreflight>(
      `/maintenance/database-backups/${encodeURIComponent(snapshotId)}/restore/preflight`,
      { method: "POST" }
    ),
    scheduleDatabaseRestore: (snapshotId: string) =>
      request<PendingDatabaseRestore & { status: string; restart_required: boolean }>(
        `/maintenance/database-backups/${encodeURIComponent(snapshotId)}/restore`,
        { method: "POST" }
      ),
    getDatabaseRestoreStatus: () =>
      request<DatabaseRestoreStatus>("/maintenance/database-restore"),
    cancelPendingDatabaseRestore: () => request<{ ok: boolean }>(
      "/maintenance/database-restore/pending",
      { method: "DELETE" }
    ),
    getLogs: (lines = 300) =>
      request<{ file: string; content: string }>(`/logs/app?lines=${lines}`),
    logsFileUrl: () => appendAccessToken(`${getApiBase()}/logs/app/file`)
  };
}
