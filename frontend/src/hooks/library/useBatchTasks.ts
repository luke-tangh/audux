import { api } from "../../api";
import type { AudioItem } from "../../types";
import { useDialog } from "../../components/dialog/UnifiedDialog";
import type { ToastType } from "../useToast";
import type { AudioListParams, PlaylistListParams, ViewMode } from "./types";
import { isBusyStatus, uniqueAudioItems } from "./filters";

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
        notify("当前筛选结果没有可创建转写任务的音频。缺失文件或进行中的任务会被跳过。", "info");
        return;
      }

      const skippedByClient = allItems.length - eligible.length;
      const limitedNote =
        searchLimited && debouncedQ.trim()
          ? `\n\n注意：当前搜索结果仅包含后端返回的前 ${searchLimit || 200} 条。`
          : "";

      const ok = await dialog.confirm({
        title: "批量创建转写任务？",
        message: `将为当前筛选结果中的 ${eligible.length} 个音频创建转写任务${
          skippedByClient ? `，并跳过 ${skippedByClient} 个缺失文件或进行中的音频` : ""
        }。确认继续？${limitedNote}`,
        confirmLabel: "创建转写任务",
        cancelLabel: "取消",
        tone: "warning"
      });

      if (!ok) return;

      const result = await api.batchTranscribe(eligible.map((item) => item.id));
      const skippedTotal = skippedByClient + result.skipped;
      const errorText = result.errors.length ? `，错误 ${result.errors.length} 个` : "";

      notify(`已创建 ${result.created} 个转写任务，跳过 ${skippedTotal} 个${errorText}。`, "success");
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
        notify("当前筛选结果没有可创建 AI 分析任务的音频。进行中的任务会被跳过。", "info");
        return;
      }

      const skippedByClient = allItems.length - eligible.length;
      const limitedNote =
        searchLimited && debouncedQ.trim()
          ? `\n\n注意：当前搜索结果仅包含后端返回的前 ${searchLimit || 200} 条。`
          : "";

      const ok = await dialog.confirm({
        title: "批量创建 AI 分析任务？",
        message: `将为当前筛选结果中的 ${eligible.length} 个音频创建 AI 分析任务${
          skippedByClient ? `，并跳过 ${skippedByClient} 个进行中的音频` : ""
        }。确认继续？${limitedNote}`,
        confirmLabel: "创建 AI 任务",
        cancelLabel: "取消",
        tone: "warning"
      });

      if (!ok) return;

      const result = await api.batchAnalyze(eligible.map((item) => item.id));

      if (result.privacy_warning) {
        notify(result.privacy_warning, "error");
      }

      const skippedTotal = skippedByClient + result.skipped;
      const errorText = result.errors.length ? `，错误 ${result.errors.length} 个` : "";

      notify(`已创建 ${result.created} 个 AI 分析任务，跳过 ${skippedTotal} 个${errorText}。`, "success");
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
