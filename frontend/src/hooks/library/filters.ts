import type { AudioItem, Playlist } from "../../types";
import type {
  AudioListParams,
  MissingFilter,
  PlaylistListParams,
  TranscriptFilter,
  ViewMode
} from "./types";

export function transcriptFilterToParam(value: TranscriptFilter): boolean | undefined {
  if (value === "yes") return true;
  if (value === "no") return false;
  return undefined;
}

export function missingFilterToParam(value: MissingFilter): boolean | undefined {
  if (value === "missing") return true;
  if (value === "available") return false;
  return undefined;
}

export function isBusyStatus(status?: string): boolean {
  return status === "pending" || status === "running" || status === "cancel_requested";
}

export function isSmartView(view: ViewMode): boolean {
  return (
    view === "missingDescription" ||
    view === "transcribed" ||
    view === "missing" ||
    view === "aiFailed"
  );
}

export function uniqueAudioItems(items: AudioItem[]): AudioItem[] {
  const seen = new Set<number>();
  const result: AudioItem[] = [];

  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    result.push(item);
  }

  return result;
}

export function buildAudioListParams({
  view,
  debouncedQ,
  selectedTag,
  hasTranscriptFilter,
  missingFilter
}: {
  view: ViewMode;
  debouncedQ: string;
  selectedTag?: string;
  hasTranscriptFilter: TranscriptFilter;
  missingFilter: MissingFilter;
}): AudioListParams {
  return {
    q: debouncedQ || undefined,
    tag: selectedTag,
    favorite: view === "favorites" ? true : undefined,
    missing_description: view === "missingDescription" ? true : undefined,
    has_transcript:
      view === "transcribed" ? true : transcriptFilterToParam(hasTranscriptFilter),
    missing: view === "missing" ? true : missingFilterToParam(missingFilter),
    ai_status: view === "aiFailed" ? "failed" : undefined
  };
}

export function buildPlaylistListParams({
  debouncedQ,
  selectedTag,
  hasTranscriptFilter,
  missingFilter
}: {
  debouncedQ: string;
  selectedTag?: string;
  hasTranscriptFilter: TranscriptFilter;
  missingFilter: MissingFilter;
}): PlaylistListParams {
  return {
    q: debouncedQ || undefined,
    tag: selectedTag,
    has_transcript: transcriptFilterToParam(hasTranscriptFilter),
    missing: missingFilterToParam(missingFilter)
  };
}

export function listCopyForView(
  view: ViewMode,
  playlists: Playlist[],
  selectedPlaylistId: number | null
): { listTitle: string; listSubtitle: string } {
  const activePlaylist = playlists.find((playlist) => playlist.id === selectedPlaylistId);

  if (view === "favorites") {
    return {
      listTitle: "收藏",
      listSubtitle: "你标记为常听或重要的音频"
    };
  }

  if (view === "playlist") {
    return {
      listTitle: activePlaylist ? activePlaylist.name : "播放列表",
      listSubtitle: activePlaylist?.description || "管理当前播放列表中的音频顺序"
    };
  }

  if (view === "missingDescription") {
    return {
      listTitle: "缺少描述",
      listSubtitle: "需要补充用户描述或 AI 描述的音频"
    };
  }

  if (view === "transcribed") {
    return {
      listTitle: "已转写",
      listSubtitle: "已经生成 transcript，可全文搜索和导出的音频"
    };
  }

  if (view === "missing") {
    return {
      listTitle: "文件缺失",
      listSubtitle: "数据库中存在，但本地文件路径不可用的音频"
    };
  }

  if (view === "aiFailed") {
    return {
      listTitle: "AI 失败",
      listSubtitle: "AI 分析失败或需要重新处理的音频"
    };
  }

  return {
    listTitle: "资料库",
    listSubtitle: "浏览、搜索和整理你的本地音频知识库"
  };
}
