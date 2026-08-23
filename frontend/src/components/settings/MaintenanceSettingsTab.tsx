import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { api } from "../../api";
import { formatDateTime } from "../../i18n/format";
import { useLocale } from "../../i18n/LocaleProvider";
import type { ArchiveImportDryRun, DatabaseBackup, DatabaseRestoreStatus, Tag } from "../../types";
import { Button, PanelCard, StatusPill } from "../ui";
import { formatFileSize } from "./settingsUtils";

type MaintenanceSettingsTabProps = {
  maintenanceTags: Tag[];
  databaseBackups: DatabaseBackup[];
  databaseRestoreStatus: DatabaseRestoreStatus | null;
  backupAction: string | null;
  onCreateBackup: () => void;
  onLoadBackups: () => void;
  onValidateBackup: (backup: DatabaseBackup) => void;
  onRestoreBackup: (backup: DatabaseBackup) => void;
  onDeleteBackup: (backup: DatabaseBackup) => void;
  onCancelRestore: () => void;
  onRebuildSearch: () => void;
  onCleanupTags: () => void;
  onLoadTags: () => void;
  onRenameTag: (tag: Tag) => void;
  onMergeTag: (tag: Tag) => void;
  onDeleteTag: (tag: Tag) => void;
  notify?: (message: string, tone?: "info" | "success" | "error") => void;
};

export default function MaintenanceSettingsTab({
  maintenanceTags,
  databaseBackups,
  databaseRestoreStatus,
  backupAction,
  onCreateBackup,
  onLoadBackups,
  onValidateBackup,
  onRestoreBackup,
  onDeleteBackup,
  onCancelRestore,
  onRebuildSearch,
  onCleanupTags,
  onLoadTags,
  onRenameTag,
  onMergeTag,
  onDeleteTag,
  notify
}: MaintenanceSettingsTabProps) {
  const { t } = useTranslation();
  const { resolvedLanguage } = useLocale();
  const pendingRestore = databaseRestoreStatus?.pending;
  const lastRestore = databaseRestoreStatus?.last_result;
  const [archiveAction, setArchiveAction] = useState<string | null>(null);
  const [importReport, setImportReport] = useState<ArchiveImportDryRun | null>(null);
  const archiveInputRef = useRef<HTMLInputElement | null>(null);

  async function createArchive() {
    setArchiveAction("export");
    try {
      const record = await api.createPortableArchive();
      window.open(api.portableArchiveUrl(record.id), "_blank");
      notify?.(t("settings.archive.created"), "success");
    } catch (error) {
      notify?.(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setArchiveAction(null);
    }
  }

  async function dryRunImport(file: File) {
    setArchiveAction("dry-run");
    setImportReport(null);
    try {
      setImportReport(await api.dryRunPortableArchiveImport(file));
    } catch (error) {
      notify?.(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setArchiveAction(null);
    }
  }

  async function executeImport() {
    if (!importReport?.can_import) return;
    setArchiveAction("import");
    try {
      const result = await api.executePortableArchiveImport(importReport.archive_id, importReport.fingerprint);
      setImportReport(null);
      notify?.(t("settings.archive.imported", { count: result.missing_audio }), "success");
    } catch (error) {
      notify?.(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setArchiveAction(null);
    }
  }

  async function createDiagnostics() {
    setArchiveAction("diagnostic");
    try {
      const record = await api.createDiagnosticBundle();
      window.open(api.diagnosticBundleUrl(record.id), "_blank");
      notify?.(t("settings.diagnostic.created"), "success");
    } catch (error) {
      notify?.(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setArchiveAction(null);
    }
  }

  return (
    <div className="settings-grid-layout">
      <PanelCard
        title={t("settings.backup.title")}
        className="settings-card-wide"
        actions={
          <>
            <Button variant="outlined" disabled={backupAction !== null} onClick={onLoadBackups}>
              {t("common.actions.refresh")}
            </Button>
            <Button
              variant="filled"
              disabled={backupAction !== null || Boolean(pendingRestore)}
              onClick={onCreateBackup}
            >
              {t("settings.backup.create")}
            </Button>
          </>
        }
      >
        <p className="muted">{t("settings.backup.description")}</p>

        {pendingRestore && (
          <div className="backup-restore-banner" role="status">
            <div>
              <strong>{t("settings.backup.pendingTitle")}</strong>
              <p>
                {t("settings.backup.pendingDescription", {
                  id: pendingRestore.snapshot_id,
                  time: formatDateTime(pendingRestore.requested_at, resolvedLanguage)
                })}
              </p>
            </div>
            <Button
              variant="outlined"
              disabled={backupAction !== null}
              onClick={onCancelRestore}
            >
              {t("settings.backup.cancelPending")}
            </Button>
          </div>
        )}

        {lastRestore && (
          <p className={`backup-restore-result ${lastRestore.status}`} role="status">
            {t(`settings.backup.result.${lastRestore.status}`, {
              time: formatDateTime(lastRestore.completed_at, resolvedLanguage),
              error: lastRestore.error || ""
            })}
          </p>
        )}

        {databaseBackups.length === 0 && (
          <p className="muted">{t("settings.backup.empty")}</p>
        )}

        <div className="backup-list">
          {databaseBackups.map((backup) => (
            <article className="backup-row" key={backup.id}>
              <div className="backup-row-main">
                <div className="backup-row-heading">
                  <strong>{backup.name}</strong>
                  <StatusPill value={backup.integrity_status}>
                    {t(`settings.backup.integrity.${backup.integrity_status}`)}
                  </StatusPill>
                </div>
                <p className="backup-row-meta">
                  {t(`settings.backup.kind.${backup.kind}`)} · {formatFileSize(backup.size_bytes)} ·{" "}
                  {formatDateTime(backup.created_at, resolvedLanguage)} ·{" "}
                  {t("settings.backup.schema", { version: backup.schema_version ?? "-" })}
                </p>
                {(backup.integrity_error || backup.compatibility_error) && (
                  <p className="backup-row-error">
                    {backup.integrity_error || backup.compatibility_error}
                  </p>
                )}
              </div>
              <div className="backup-row-actions">
                <Button
                  size="sm"
                  variant="outlined"
                  disabled={backupAction !== null}
                  onClick={() => onValidateBackup(backup)}
                >
                  {t("settings.backup.validate")}
                </Button>
                <Button
                  size="sm"
                  variant="tonal"
                  disabled={backupAction !== null || Boolean(pendingRestore) || !backup.restore_compatible}
                  onClick={() => onRestoreBackup(backup)}
                >
                  {t("settings.backup.restore")}
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  disabled={
                    backupAction !== null ||
                    pendingRestore?.snapshot_id === backup.id ||
                    pendingRestore?.safety_snapshot_id === backup.id
                  }
                  onClick={() => onDeleteBackup(backup)}
                >
                  {t("common.actions.delete")}
                </Button>
              </div>
            </article>
          ))}
        </div>
      </PanelCard>

      <PanelCard title={t("settings.archive.title")} className="settings-card-wide">
        <p className="muted">{t("settings.archive.description")}</p>
        <div className="section-actions">
          <Button variant="filled" disabled={archiveAction !== null} onClick={() => void createArchive()}>
            {t("settings.archive.export")}
          </Button>
          <Button
            variant="outlined"
            disabled={archiveAction !== null}
            onClick={() => archiveInputRef.current?.click()}
          >
            {t("settings.archive.dryRun")}
          </Button>
          <input
            ref={archiveInputRef}
            type="file"
            accept=".zip,.audux.zip,application/zip"
            hidden
            disabled={archiveAction !== null}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) void dryRunImport(file);
              event.currentTarget.value = "";
            }}
          />
          <Button variant="outlined" disabled={archiveAction !== null} onClick={() => void createDiagnostics()}>
            {t("settings.diagnostic.create")}
          </Button>
        </div>
        {importReport && (
          <div className="backup-restore-banner" role="status">
            <div>
              <strong>{t("settings.archive.reportTitle")}</strong>
              <p>{t("settings.archive.report", {
                schema: importReport.schema_version,
                missing: importReport.missing_audio,
                strategy: importReport.merge_strategy
              })}</p>
              {importReport.blockers.length > 0 && <p className="backup-row-error">{importReport.blockers.join("; ")}</p>}
            </div>
            <Button variant="tonal" disabled={!importReport.can_import || archiveAction !== null} onClick={() => void executeImport()}>
              {t("settings.archive.execute")}
            </Button>
          </div>
        )}
      </PanelCard>

      <PanelCard title={t("settings.maintenance.exportIndex")}>
        <div className="section-actions">
          <Button variant="outlined" onClick={() => window.open(api.metadataExportUrl("json"), "_blank")}>
            {t("settings.maintenance.exportJson")}
          </Button>

          <Button variant="outlined" onClick={() => window.open(api.metadataExportUrl("csv"), "_blank")}>
            {t("settings.maintenance.exportCsv")}
          </Button>

          <Button variant="outlined" onClick={onRebuildSearch}>
            {t("settings.maintenance.rebuild")}
          </Button>
        </div>
      </PanelCard>

      <PanelCard
        title={t("settings.maintenance.tags")}
        actions={
          <>
            <Button variant="outlined" onClick={onCleanupTags}>
              {t("settings.maintenance.cleanup")}
            </Button>
            <Button variant="outlined" onClick={onLoadTags}>
              {t("settings.maintenance.refresh")}
            </Button>
          </>
        }
      >
        <p className="muted">{t("settings.maintenance.description")}</p>

        {maintenanceTags.length === 0 && <p className="muted">{t("settings.maintenance.noTags")}</p>}

        <div className="tag-list">
          {maintenanceTags.map((tag) => (
            <span key={tag.id} className="tag">
              #{tag.name}
              <Button
                preserveChildren
                className="tag-text-action"
                size="sm"
                variant="text"
                onClick={() => onRenameTag(tag)}
              >
                {t("settings.maintenance.rename")}
              </Button>
              <Button
                preserveChildren
                className="tag-text-action"
                size="sm"
                variant="text"
                onClick={() => onMergeTag(tag)}
              >
                {t("settings.maintenance.merge")}
              </Button>
              <Button
                preserveChildren
                className="tag-text-action"
                size="sm"
                variant="danger"
                onClick={() => onDeleteTag(tag)}
              >
                {t("common.actions.delete")}
              </Button>
            </span>
          ))}
        </div>
      </PanelCard>
    </div>
  );
}
