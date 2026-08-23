import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { api } from "../../api";
import { useDialog } from "../../components/dialog/UnifiedDialog";
import type {
  LibraryDuplicateGroup,
  LibraryHealthSummary,
  LibraryHealthTask,
  MissingAudioHealthItem,
  SafeRelinkCandidate
} from "../../types";
import { usePolling } from "../usePolling";
import type { ToastType } from "../useToast";

export function useLibraryHealthSettings({
  refresh,
  notify
}: {
  refresh: () => void;
  notify?: (message: string, type?: ToastType) => void;
}) {
  const { t } = useTranslation();
  const dialog = useDialog();
  const [summary, setSummary] = useState<LibraryHealthSummary | null>(null);
  const [tasks, setTasks] = useState<LibraryHealthTask[]>([]);
  const [candidates, setCandidates] = useState<Record<number, SafeRelinkCandidate[]>>({});
  const [action, setAction] = useState<string | null>(null);

  async function load() {
    const [nextSummary, taskRows] = await Promise.all([
      api.getLibraryHealth(),
      api.listLibraryHealthTasks(20)
    ]);
    setSummary(nextSummary);
    setTasks(taskRows);
  }

  useEffect(() => {
    void load().catch(console.error);
  }, []);

  usePolling({ intervalMs: 3000, task: load, onError: console.error });

  async function startCheck() {
    setAction("check");
    try {
      await api.startLibraryHealthCheck();
      await load();
      notify?.(t("settings.health.checkStarted"), "success");
    } catch (error) {
      notify?.(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setAction(null);
    }
  }

  async function cancelTask(task: LibraryHealthTask) {
    setAction(`cancel-${task.id}`);
    try {
      await api.cancelLibraryHealthTask(task.id);
      await load();
    } catch (error) {
      notify?.(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setAction(null);
    }
  }

  async function retryTask(task: LibraryHealthTask) {
    setAction(`retry-${task.id}`);
    try {
      await api.retryLibraryHealthTask(task.id);
      await load();
    } catch (error) {
      notify?.(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setAction(null);
    }
  }

  async function confirmDuplicates(group: LibraryDuplicateGroup) {
    setAction(`hash-${group.candidate_key || group.hash_prefix || "group"}`);
    try {
      await api.confirmDuplicateHashes(group.audio_items.map((item) => item.id));
      await load();
      notify?.(t("settings.health.hashStarted"), "success");
    } catch (error) {
      notify?.(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setAction(null);
    }
  }

  async function findCandidates(audio: MissingAudioHealthItem) {
    setAction(`candidates-${audio.id}`);
    try {
      const result = await api.findRelinkCandidates(audio.id);
      setCandidates((current) => ({ ...current, [audio.id]: result.candidates }));
    } catch (error) {
      notify?.(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setAction(null);
    }
  }

  async function relink(audio: MissingAudioHealthItem, candidate: SafeRelinkCandidate) {
    setAction(`preview-${audio.id}`);
    try {
      const preview = await api.previewSafeRelink(audio.id, candidate.path);
      const confirmed = await dialog.confirm({
        title: t("settings.health.relinkTitle"),
        message: t("settings.health.relinkMessage", {
          title: preview.audio.title,
          oldPath: preview.audio.old_path,
          newPath: preview.candidate.path,
          segments: preview.impacts.transcript_segments,
          tags: preview.impacts.tags_preserved,
          playlists: preview.impacts.manual_playlists_preserved,
          plays: preview.impacts.play_count_preserved
        }),
        confirmLabel: t("settings.health.relinkConfirm"),
        cancelLabel: t("common.actions.cancel"),
        tone: "warning"
      });
      if (!confirmed) return;
      await api.commitSafeRelink(audio.id, candidate.path, preview.confirmation);
      setCandidates((current) => {
        const next = { ...current };
        delete next[audio.id];
        return next;
      });
      await load();
      refresh();
      notify?.(t("settings.health.relinked"), "success");
    } catch (error) {
      notify?.(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setAction(null);
    }
  }

  return {
    summary,
    tasks,
    candidates,
    action,
    reload: load,
    startCheck,
    cancelTask,
    retryTask,
    confirmDuplicates,
    findCandidates,
    relink
  };
}
