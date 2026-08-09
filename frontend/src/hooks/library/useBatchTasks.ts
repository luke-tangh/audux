import { api } from "../../api";
import type { AudioItem } from "../../types";
import { useDialog } from "../../components/dialog/UnifiedDialog";
import type { ToastType } from "../useToast";
import type { AudioListParams, PlaylistListParams, ViewMode } from "./types";
import { isBusyStatus, uniqueAudioItems } from "./filters";
import { useTranslation } from "react-i18next";
import { localizedPrivacyWarning } from "../../i18n/errors";

type Notify = (message: string, type?: ToastType) => void;

type UseBatchTasksParams = {
  view: ViewMode;
  selectedPlaylistId: number | null;
  searchLimited: boolean;
  searchLimit: number | null;
  debouncedQ: string;
  ensureBackendReady: () => Promise<void>;
  buildAudioListParams: () => AudioListParams;
  buildPlaylistListParams: () => PlaylistListParams;
  notify: Notify;
  refresh: () => void;
};

const AUDIO_BATCH_FETCH_LIMIT = 500;

export function useBatchTasks({
  view,
  selectedPlaylistId,
  searchLimited,
  searchLimit,
  debouncedQ,
  ensureBackendReady,
  buildAudioListParams,
  buildPlaylistListParams,
  notify,
  refresh
}: UseBatchTasksParams) {
  const dialog = useDialog();
  const { t } = useTranslation();

  async function fetchAllCurrentAudioItemsForBatch(): Promise<AudioItem[]> {
    await ensureBackendReady();

    const rows: AudioItem[] = [];
    let offset = 0;

    while (true) {
      const page =
        view === "playlist" && selectedPlaylistId
          ? await api.listPlaylistItems(selectedPlaylistId, {
              ...buildPlaylistListParams(),
              limit: AUDIO_BATCH_FETCH_LIMIT,
              offset
            })
          : await api.listAudioItems({
              ...buildAudioListParams(),
              limit: AUDIO_BATCH_FETCH_LIMIT,
              offset
            });

      rows.push(...page.items);

      if (!page.has_more || page.items.length === 0) {
        break;
      }

      offset += page.items.length;
    }

    return uniqueAudioItems(rows);
  }

  async function batchTranscribeCurrentList() {
    try {
      const allItems = await fetchAllCurrentAudioItemsForBatch();

      if (allItems.length === 0) return;

      const eligible = allItems.filter(
        (item) => !item.is_missing && !isBusyStatus(item.transcript_status)
      );

      if (eligible.length === 0) {
        notify(t("batch.transcribe.none"), "info");
        return;
      }

      const skippedByClient = allItems.length - eligible.length;
      const limitedNote =
        searchLimited && debouncedQ.trim()
          ? t("batch.limitNote", { count: searchLimit || 200 })
          : "";

      const ok = await dialog.confirm({
        title: t("batch.transcribe.title"),
        message: t("batch.transcribe.message", {
          count: eligible.length,
          skipped: skippedByClient ? t("batch.transcribe.skipped", { count: skippedByClient }) : "",
          note: limitedNote
        }),
        confirmLabel: t("batch.transcribe.confirm"),
        cancelLabel: t("common.actions.cancel"),
        tone: "warning"
      });

      if (!ok) return;

      const result = await api.batchTranscribe(eligible.map((item) => item.id));
      const skippedTotal = skippedByClient + result.skipped;
      notify(t("batch.result", {
        created: result.created,
        skipped: skippedTotal,
        errors: result.errors.length,
        type: t("batch.result.transcribeType")
      }), "success");
      refresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function batchAnalyzeCurrentList() {
    try {
      const allItems = await fetchAllCurrentAudioItemsForBatch();

      if (allItems.length === 0) return;

      const eligible = allItems.filter((item) => !isBusyStatus(item.ai_status));

      if (eligible.length === 0) {
        notify(t("batch.analyze.none"), "info");
        return;
      }

      const skippedByClient = allItems.length - eligible.length;
      const limitedNote =
        searchLimited && debouncedQ.trim()
          ? t("batch.limitNote", { count: searchLimit || 200 })
          : "";

      const ok = await dialog.confirm({
        title: t("batch.analyze.title"),
        message: t("batch.analyze.message", {
          count: eligible.length,
          skipped: skippedByClient ? t("batch.analyze.skipped", { count: skippedByClient }) : "",
          note: limitedNote
        }),
        confirmLabel: t("batch.analyze.confirm"),
        cancelLabel: t("common.actions.cancel"),
        tone: "warning"
      });

      if (!ok) return;

      const result = await api.batchAnalyze(eligible.map((item) => item.id));

      if (result.privacy_warning) {
        notify(
          localizedPrivacyWarning(t, result.privacy_warning_code, result.privacy_warning),
          "error"
        );
      }

      const skippedTotal = skippedByClient + result.skipped;
      notify(t("batch.result", {
        created: result.created,
        skipped: skippedTotal,
        errors: result.errors.length,
        type: t("batch.result.analyzeType")
      }), "success");
      refresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    }
  }

  return {
    batchTranscribeCurrentList,
    batchAnalyzeCurrentList
  };
}
