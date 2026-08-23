import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { api } from "../../api";
import { useDialog } from "../../components/dialog/UnifiedDialog";
import { terminalStatus } from "../../components/settings/settingsUtils";
import { localizedStoredError } from "../../i18n/errors";
import { pickAudioFolder } from "../../tauri";
import type { LibraryRoot, Playlist, ScanTask } from "../../types";
import { usePolling } from "../usePolling";
import type { ToastType } from "../useToast";

export function useLibrarySettings({
  refresh,
  notify
}: {
  refresh: () => void;
  notify?: (message: string, type?: ToastType) => void;
}) {
  const { t } = useTranslation();
  const dialog = useDialog();
  const [roots, setRoots] = useState<LibraryRoot[]>([]);
  const [scanTasks, setScanTasks] = useState<ScanTask[]>([]);
  const [path, setPath] = useState("");
  const [scanResult, setScanResult] = useState("");
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const scanStatusRef = useRef<Record<number, string>>({});
  const scanInitializedRef = useRef(false);

  function applyScanTasks(rows: ScanTask[], allowNotify = true) {
    let shouldRefresh = false;
    if (allowNotify && scanInitializedRef.current) {
      for (const task of rows) {
        const previous = scanStatusRef.current[task.id];
        if (previous && previous !== task.status && terminalStatus(task.status)) {
          if (task.status === "done") {
            notify?.(t("settings.notifications.scanDone", {
              id: task.id,
              imported: task.imported,
              updated: task.updated,
              missing: task.missing
            }), "success");
          }
          if (task.status === "failed") {
            notify?.(t("settings.notifications.scanFailed", {
              id: task.id,
              error: localizedStoredError(
                t,
                task.error_code,
                task.error_params,
                task.error_message
              )
            }), "error");
          }
          if (task.status === "canceled") {
            notify?.(t("settings.notifications.scanCanceled", { id: task.id }), "info");
          }
          shouldRefresh = true;
        }
      }
    }
    scanStatusRef.current = Object.fromEntries(rows.map((task) => [task.id, task.status]));
    scanInitializedRef.current = true;
    setScanTasks(rows);
    if (shouldRefresh) refresh();
  }

  async function loadScanTasks() {
    applyScanTasks(await api.listScanTasks({ limit: 20 }), true);
  }

  async function load() {
    const [rootRows, scanRows, playlistRows] = await Promise.all([
      api.listLibraryRoots(),
      api.listScanTasks({ limit: 20 }),
      api.listPlaylists().catch(() => [])
    ]);
    setRoots(rootRows);
    applyScanTasks(scanRows, false);
    setPlaylists(playlistRows);
  }

  useEffect(() => {
    void load().catch((error) =>
      notify?.(error instanceof Error ? error.message : String(error), "error")
    );
  }, []);

  usePolling({
    intervalMs: 3000,
    task: loadScanTasks,
    onError: console.error
  });

  async function chooseFolder() {
    const selected = await pickAudioFolder();
    if (selected) setPath(selected);
    else notify?.(t("settings.notifications.noFolder"), "error");
  }

  async function addRoot() {
    if (!path.trim()) return;
    try {
      const imported = await api.importLibraryRoot(path.trim());
      setPath("");
      await load();
      refresh();
      notify?.(t("settings.notifications.rootAddedAndScanning", {
        id: imported.scan_task.id
      }), "success");
    } catch (error) {
      notify?.(error instanceof Error ? error.message : String(error), "error");
    }
  }

  async function toggleRoot(root: LibraryRoot, isEnabled: boolean) {
    try {
      await api.updateLibraryRoot(root.id, { is_enabled: isEnabled });
      await load();
      refresh();
      notify?.(isEnabled
        ? t("settings.notifications.rootEnabled")
        : t("settings.notifications.rootDisabled"), "success");
    } catch (error) {
      notify?.(error instanceof Error ? error.message : String(error), "error");
    }
  }

  async function removeRoot(root: LibraryRoot) {
    const ok = await dialog.confirm({
      title: t("settings.removeRoot.title"),
      message: t("settings.removeRoot.message", { path: root.path }),
      confirmLabel: t("settings.removeRoot.confirm"),
      cancelLabel: t("common.actions.cancel"),
      tone: "danger",
      destructive: true
    });
    if (!ok) return;
    try {
      const result = await api.deleteLibraryRoot(root.id);
      await load();
      refresh();
      notify?.(t("settings.notifications.rootRemoved", {
        count: result.detached_audio_items
      }), "success");
    } catch (error) {
      notify?.(error instanceof Error ? error.message : String(error), "error");
    }
  }

  async function scan(id: number) {
    try {
      setScanResult(t("settings.scan.creating"));
      const task = await api.scanLibraryRoot(id);
      setScanResult(t("settings.scan.created", { id: task.id }));
      notify?.(t("settings.scan.created", { id: task.id }), "success");
      await loadScanTasks();
      refresh();
    } catch (error) {
      notify?.(error instanceof Error ? error.message : String(error), "error");
    }
  }

  async function cancelScan(task: ScanTask) {
    const ok = await dialog.confirm({
      title: t("settings.scan.cancelTitle"),
      message: t("settings.scan.cancelMessage", { id: task.id }),
      confirmLabel: t("settings.scan.cancelConfirm"),
      cancelLabel: t("settings.scan.keep"),
      tone: "warning"
    });
    if (!ok) return;
    try {
      await api.cancelScanTask(task.id);
      notify?.(t("settings.scan.cancelRequested", { id: task.id }), "info");
      await loadScanTasks();
    } catch (error) {
      notify?.(error instanceof Error ? error.message : String(error), "error");
    }
  }

  async function renamePlaylist(playlist: Playlist) {
    const name = await dialog.prompt({
      title: t("settings.playlist.renameTitle"),
      message: t("settings.playlist.renameMessage", { name: playlist.name }),
      inputLabel: t("settings.library.playlistName"),
      defaultValue: playlist.name,
      required: true,
      confirmLabel: t("common.actions.save"),
      cancelLabel: t("common.actions.cancel"),
      validate: (value) => {
        const trimmed = value.trim();
        if (!trimmed) return t("settings.playlist.nameRequired");
        if (trimmed === playlist.name) return t("settings.playlist.nameDifferent");
        return null;
      }
    });
    if (name === null) return;
    try {
      await api.updatePlaylist(playlist.id, name.trim());
      await load();
      refresh();
      notify?.(t("settings.playlist.renamed"), "success");
    } catch (error) {
      notify?.(error instanceof Error ? error.message : String(error), "error");
    }
  }

  async function deletePlaylist(playlist: Playlist) {
    const ok = await dialog.confirm({
      title: t("settings.playlist.deleteTitle"),
      message: t("settings.playlist.deleteMessage", { name: playlist.name }),
      confirmLabel: t("settings.playlist.deleteConfirm"),
      cancelLabel: t("common.actions.cancel"),
      tone: "danger",
      destructive: true
    });
    if (!ok) return;
    try {
      const result = await api.deletePlaylist(playlist.id);
      await load();
      refresh();
      notify?.(t("settings.playlist.deleted", { count: result.removed_items }), "success");
    } catch (error) {
      notify?.(error instanceof Error ? error.message : String(error), "error");
    }
  }

  return {
    roots,
    scanTasks,
    path,
    setPath,
    scanResult,
    playlists,
    reload: load,
    chooseFolder,
    addRoot,
    toggleRoot,
    removeRoot,
    scan,
    cancelScan,
    renamePlaylist,
    deletePlaylist
  };
}
