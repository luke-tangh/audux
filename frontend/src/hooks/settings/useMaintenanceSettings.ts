import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { api } from "../../api";
import { useDialog } from "../../components/dialog/UnifiedDialog";
import { restartApplication } from "../../tauri";
import type { DatabaseBackup, DatabaseRestoreStatus, Tag } from "../../types";
import type { ToastType } from "../useToast";

export function useMaintenanceSettings({
  refresh,
  notify
}: {
  refresh: () => void;
  notify?: (message: string, type?: ToastType) => void;
}) {
  const { t } = useTranslation();
  const dialog = useDialog();
  const [tags, setTags] = useState<Tag[]>([]);
  const [backups, setBackups] = useState<DatabaseBackup[]>([]);
  const [restoreStatus, setRestoreStatus] = useState<DatabaseRestoreStatus | null>(null);
  const [action, setAction] = useState<string | null>(null);

  async function loadTags() {
    setTags(await api.listTags().catch(() => []));
  }

  async function loadBackups() {
    setAction("load");
    try {
      const [rows, status] = await Promise.all([
        api.listDatabaseBackups(),
        api.getDatabaseRestoreStatus()
      ]);
      setBackups(rows);
      setRestoreStatus(status);
    } finally {
      setAction(null);
    }
  }

  async function load() {
    const [tagRows, backupRows, status] = await Promise.all([
      api.listTags().catch(() => []),
      api.listDatabaseBackups().catch(() => []),
      api.getDatabaseRestoreStatus().catch(() => null)
    ]);
    setTags(tagRows);
    setBackups(backupRows);
    setRestoreStatus(status);
  }

  useEffect(() => {
    void load().catch((error) =>
      notify?.(error instanceof Error ? error.message : String(error), "error")
    );
  }, []);

  async function rebuildSearch() {
    const ok = await dialog.confirm({
      title: t("settings.search.rebuildTitle"),
      message: t("settings.search.rebuildMessage"),
      confirmLabel: t("settings.search.rebuildConfirm"),
      cancelLabel: t("common.actions.cancel"),
      tone: "warning"
    });
    if (!ok) return;
    try {
      const result = await api.rebuildSearchIndex();
      notify?.(t("settings.search.rebuilt", { count: result.count }), "success");
    } catch (error) {
      notify?.(error instanceof Error ? error.message : String(error), "error");
    }
  }

  async function renameTag(tag: Tag) {
    const name = await dialog.prompt({
      title: t("settings.tags.renameTitle"),
      message: t("settings.tags.renameMessage", { name: tag.name }),
      inputLabel: t("settings.tags.name"),
      defaultValue: tag.name,
      placeholder: t("settings.tags.newName"),
      required: true,
      confirmLabel: t("common.actions.save"),
      cancelLabel: t("common.actions.cancel"),
      validate: (value) => {
        const trimmed = value.trim();
        if (!trimmed) return t("settings.tags.nameRequired");
        if (trimmed === tag.name) return t("settings.tags.nameDifferent");
        return null;
      }
    });
    if (name === null) return;
    try {
      await api.updateTag(tag.id, { name: name.trim() });
      await loadTags();
      refresh();
      notify?.(t("settings.tags.renamed"), "success");
    } catch (error) {
      notify?.(error instanceof Error ? error.message : String(error), "error");
    }
  }

  async function deleteTag(tag: Tag) {
    const ok = await dialog.confirm({
      title: t("settings.tags.deleteTitle"),
      message: t("settings.tags.deleteMessage", { name: tag.name }),
      confirmLabel: t("settings.tags.deleteConfirm"),
      cancelLabel: t("common.actions.cancel"),
      tone: "danger",
      destructive: true
    });
    if (!ok) return;
    try {
      await api.deleteTag(tag.id, false);
      await loadTags();
      refresh();
      notify?.(t("settings.tags.deleted"), "success");
    } catch (error) {
      notify?.(error instanceof Error ? error.message : String(error), "error");
    }
  }

  async function mergeTag(tag: Tag) {
    const targetName = await dialog.prompt({
      title: t("settings.tags.mergeTitle"),
      message: t("settings.tags.mergeMessage", { name: tag.name }),
      inputLabel: t("settings.tags.targetName"),
      placeholder: t("settings.tags.targetPlaceholder"),
      required: true,
      confirmLabel: t("settings.maintenance.merge"),
      cancelLabel: t("common.actions.cancel"),
      tone: "warning",
      validate: (value) => {
        const normalized = value.trim();
        if (normalized === tag.name) return t("settings.tags.same");
        return tags.some((candidate) => candidate.name === normalized)
          ? null
          : t("settings.tags.targetMissing");
      }
    });
    if (targetName === null) return;
    const target = tags.find((candidate) => candidate.name === targetName.trim());
    if (!target) return;
    try {
      const result = await api.mergeTag(tag.id, target.id);
      await loadTags();
      refresh();
      notify?.(t("settings.tags.merged", {
        source: tag.name,
        target: result.target_tag.name,
        count: result.affected_audio_items
      }), "success");
    } catch (error) {
      notify?.(error instanceof Error ? error.message : String(error), "error");
    }
  }

  async function cleanupTags() {
    const ok = await dialog.confirm({
      title: t("settings.tags.cleanupTitle"),
      message: t("settings.tags.cleanupMessage"),
      confirmLabel: t("settings.tags.cleanupConfirm"),
      cancelLabel: t("common.actions.cancel"),
      tone: "warning"
    });
    if (!ok) return;
    try {
      const result = await api.cleanupTags();
      await loadTags();
      refresh();
      notify?.(t("settings.tags.cleaned", { count: result.deleted }), "success");
    } catch (error) {
      notify?.(error instanceof Error ? error.message : String(error), "error");
    }
  }

  async function createBackup() {
    const name = await dialog.prompt({
      title: t("settings.backup.createTitle"),
      message: t("settings.backup.createMessage"),
      inputLabel: t("settings.backup.name"),
      placeholder: t("settings.backup.namePlaceholder"),
      required: false,
      confirmLabel: t("settings.backup.create"),
      cancelLabel: t("common.actions.cancel"),
      validate: (value) => value.trim().length > 80
        ? t("settings.backup.nameTooLong")
        : null
    });
    if (name === null) return;
    setAction("create");
    try {
      await api.createDatabaseBackup(name.trim() || undefined);
      await loadBackups();
      notify?.(t("settings.backup.created"), "success");
    } catch (error) {
      notify?.(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setAction(null);
    }
  }

  async function validateBackup(backup: DatabaseBackup) {
    setAction(`validate:${backup.id}`);
    try {
      const result = await api.validateDatabaseBackup(backup.id);
      await loadBackups();
      notify?.(
        result.integrity_status === "valid"
          ? t("settings.backup.valid")
          : t("settings.backup.invalid", { error: result.integrity_error || "" }),
        result.integrity_status === "valid" ? "success" : "error"
      );
    } catch (error) {
      notify?.(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setAction(null);
    }
  }

  async function deleteBackup(backup: DatabaseBackup) {
    const ok = await dialog.confirm({
      title: t("settings.backup.deleteTitle"),
      message: t("settings.backup.deleteMessage", { name: backup.name }),
      confirmLabel: t("settings.backup.deleteConfirm"),
      cancelLabel: t("common.actions.cancel"),
      tone: "danger",
      destructive: true
    });
    if (!ok) return;
    setAction(`delete:${backup.id}`);
    try {
      await api.deleteDatabaseBackup(backup.id);
      await loadBackups();
      notify?.(t("settings.backup.deleted"), "success");
    } catch (error) {
      notify?.(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setAction(null);
    }
  }

  async function restoreBackup(backup: DatabaseBackup) {
    setAction(`preflight:${backup.id}`);
    try {
      const preflight = await api.preflightDatabaseRestore(backup.id);
      if (!preflight.ok) {
        const reasons = preflight.blockers.map((blocker) => {
          if (blocker.code === "backup.integrity_invalid") return t("settings.backup.blocker.integrity");
          if (blocker.code === "backup.incompatible") return t("settings.backup.blocker.incompatible");
          if (blocker.code === "backup.active_tasks") {
            return t("settings.backup.blocker.activeTasks", {
              aiTasks: preflight.active_ai_tasks,
              scanTasks: preflight.active_scan_tasks,
              healthTasks: preflight.active_health_tasks,
              agentRuns: preflight.active_agent_runs,
              organizationRuns: preflight.active_organization_runs
            });
          }
          if (blocker.code === "backup.insufficient_space") return t("settings.backup.blocker.space");
          if (blocker.code === "backup.restore_pending") return t("settings.backup.blocker.pending");
          return blocker.message;
        }).join("\n");
        await dialog.alert({
          title: t("settings.backup.preflightFailedTitle"),
          message: t("settings.backup.preflightFailedMessage", { reasons }),
          confirmLabel: t("common.dialog.acknowledge"),
          tone: "warning"
        });
        return;
      }

      const ok = await dialog.confirm({
        title: t("settings.backup.restoreTitle"),
        message: t("settings.backup.restoreMessage", {
          name: backup.name,
          aiTasks: preflight.active_ai_tasks,
          scanTasks: preflight.active_scan_tasks,
          healthTasks: preflight.active_health_tasks,
          agentRuns: preflight.active_agent_runs,
          organizationRuns: preflight.active_organization_runs
        }),
        details: t("settings.backup.restoreDetails"),
        confirmLabel: t("settings.backup.restoreConfirm"),
        cancelLabel: t("common.actions.cancel"),
        tone: "danger",
        destructive: true
      });
      if (!ok) return;
      await api.scheduleDatabaseRestore(backup.id);
      await loadBackups();
      if (!(await restartApplication())) {
        await dialog.alert({
          title: t("settings.backup.restartTitle"),
          message: t("settings.backup.restartManual"),
          confirmLabel: t("common.dialog.acknowledge"),
          tone: "warning"
        });
      }
    } catch (error) {
      notify?.(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setAction(null);
    }
  }

  async function cancelRestore() {
    setAction("cancel-restore");
    try {
      await api.cancelPendingDatabaseRestore();
      await loadBackups();
      notify?.(t("settings.backup.pendingCanceled"), "success");
    } catch (error) {
      notify?.(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setAction(null);
    }
  }

  return {
    tags,
    backups,
    restoreStatus,
    action,
    reload: load,
    loadTags,
    loadBackups,
    rebuildSearch,
    renameTag,
    deleteTag,
    mergeTag,
    cleanupTags,
    createBackup,
    validateBackup,
    deleteBackup,
    restoreBackup,
    cancelRestore
  };
}
