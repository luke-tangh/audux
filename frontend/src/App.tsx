import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { AudioItem, Tag, Playlist } from "./types";
import { displayAuthor, displayDescription, displayTitle } from "./types";
import Sidebar from "./components/Sidebar";
import AudioList from "./components/AudioList";
import DetailPanel from "./components/DetailPanel";
import PlayerBar from "./components/PlayerBar";
import SettingsPanel from "./components/SettingsPanel";

type ViewMode = "library" | "favorites" | "playlist" | "settings";
type TranscriptFilter = "all" | "yes" | "no";
type MissingFilter = "all" | "available" | "missing";
type ToastType = "info" | "success" | "error";

type Toast = {
  id: number;
  message: string;
  type: ToastType;
};

function transcriptFilterToParam(value: TranscriptFilter): boolean | undefined {
  if (value === "yes") return true;
  if (value === "no") return false;
  return undefined;
}

function missingFilterToParam(value: MissingFilter): boolean | undefined {
  if (value === "missing") return true;
  if (value === "available") return false;
  return undefined;
}

function isBusyStatus(status?: string): boolean {
  return status === "pending" || status === "running";
}

function ToastStack({
  toasts,
  onClose
}: {
  toasts: Toast[];
  onClose: (id: number) => void;
}) {
  if (toasts.length === 0) return null;

  return (
    <div className="toast-stack">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.type}`}>
          <div className="toast-content">
            <div className="toast-message">{toast.message}</div>

            <button className="toast-close" onClick={() => onClose(toast.id)}>
              ×
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function App() {
  const [view, setView] = useState<ViewMode>("library");
  const [audioItems, setAudioItems] = useState<AudioItem[]>([]);
  const [selected, setSelected] = useState<AudioItem | null>(null);

  const [playing, setPlaying] = useState<AudioItem | null>(null);
  const [playbackQueue, setPlaybackQueue] = useState<AudioItem[]>([]);
  const [playingIndex, setPlayingIndex] = useState(-1);

  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [selectedTag, setSelectedTag] = useState<string | undefined>();
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<number | null>(null);
  const [missingDescriptionOnly, setMissingDescriptionOnly] = useState(false);
  const [hasTranscriptFilter, setHasTranscriptFilter] = useState<TranscriptFilter>("all");
  const [missingFilter, setMissingFilter] = useState<MissingFilter>("all");

  const [tags, setTags] = useState<Tag[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [playlistItemsRaw, setPlaylistItemsRaw] = useState<AudioItem[]>([]);
  const [refreshToken, setRefreshToken] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");

  const loadSeqRef = useRef(0);

  function notify(message: string, type: ToastType = "info") {
    const id = Date.now() + Math.random();

    setToasts((rows) => [
      ...rows,
      {
        id,
        message,
        type
      }
    ]);

    window.setTimeout(() => {
      setToasts((rows) => rows.filter((toast) => toast.id !== id));
    }, type === "error" ? 8000 : 3800);
  }

  function closeToast(id: number) {
    setToasts((rows) => rows.filter((toast) => toast.id !== id));
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQ(q);
    }, 260);

    return () => window.clearTimeout(timer);
  }, [q]);

  async function loadNavigation() {
    const [tagRows, playlistRows] = await Promise.all([
      api.listTags().catch(() => []),
      api.listPlaylists().catch(() => [])
    ]);

    setTags(tagRows);
    setPlaylists(playlistRows);
  }

  function applyClientFiltersForPlaylist(items: AudioItem[]) {
    let result = [...items];

    const keyword = debouncedQ.trim().toLowerCase();
    if (keyword) {
      result = result.filter((item) => {
        const text = [
          displayTitle(item),
          displayAuthor(item),
          displayDescription(item),
          item.file_name,
          ...(item.tags || []).map((tag) => tag.name)
        ]
          .join(" ")
          .toLowerCase();

        return text.includes(keyword);
      });
    }

    if (missingDescriptionOnly) {
      result = result.filter((item) => !displayDescription(item).trim());
    }

    if (hasTranscriptFilter === "yes") {
      result = result.filter((item) => item.transcript_status === "done");
    }

    if (hasTranscriptFilter === "no") {
      result = result.filter((item) => item.transcript_status !== "done");
    }

    if (missingFilter === "missing") {
      result = result.filter((item) => item.is_missing);
    }

    if (missingFilter === "available") {
      result = result.filter((item) => !item.is_missing);
    }

    return result;
  }

  async function load() {
    const loadSeq = ++loadSeqRef.current;

    if (view !== "settings") {
      setLoading(true);
    }

    setLoadError("");

    try {
      await loadNavigation();

      if (loadSeq !== loadSeqRef.current) return;

      if (view === "settings") {
        setAudioItems([]);
        setPlaylistItemsRaw([]);
        return;
      }

      let items: AudioItem[] = [];

      if (view === "playlist") {
        if (!selectedPlaylistId) {
          setPlaylistItemsRaw([]);
          setAudioItems([]);
          setSelected(null);
          return;
        }

        const detail = await api.getPlaylist(selectedPlaylistId);

        const rawItems: AudioItem[] = detail.items.map((x) => ({
          ...x.audio,
          playlist_item_id: x.playlist_item.id,
          playlist_order_index: x.playlist_item.order_index
        }));

        setPlaylistItemsRaw(rawItems);
        items = applyClientFiltersForPlaylist(rawItems);
      } else {
        setPlaylistItemsRaw([]);

        items = await api.listAudioItems({
          q: debouncedQ || undefined,
          tag: selectedTag,
          favorite: view === "favorites" ? true : undefined,
          missing_description: missingDescriptionOnly || undefined,
          has_transcript: transcriptFilterToParam(hasTranscriptFilter),
          missing: missingFilterToParam(missingFilter)
        });
      }

      if (loadSeq !== loadSeqRef.current) return;

      setAudioItems(items);

      setSelected((prev) => {
        if (items.length === 0) return null;

        if (prev) {
          const found = items.find((x) => x.id === prev.id);
          if (found) return found;
        }

        return items[0];
      });
    } catch (err) {
      if (loadSeq !== loadSeqRef.current) return;

      const message = err instanceof Error ? err.message : String(err);
      setLoadError(message);
      throw err;
    } finally {
      if (loadSeq === loadSeqRef.current) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    load().catch((err) => {
      console.error(err);
      notify(err instanceof Error ? err.message : String(err), "error");
    });
  }, [
    view,
    debouncedQ,
    selectedTag,
    selectedPlaylistId,
    missingDescriptionOnly,
    hasTranscriptFilter,
    missingFilter,
    refreshToken
  ]);

  function refresh() {
    setRefreshToken((v) => v + 1);
  }

  function clearFilters() {
    setQ("");
    setSelectedTag(undefined);
    setMissingDescriptionOnly(false);
    setHasTranscriptFilter("all");
    setMissingFilter("all");
  }

  function openSettings() {
    setView("settings");
    setSelectedTag(undefined);
    setSelectedPlaylistId(null);
  }

  async function playQueueIndex(index: number, queue: AudioItem[] = playbackQueue) {
    const item = queue[index];
    if (!item) return;

    setPlaybackQueue(queue);
    setPlayingIndex(index);
    setPlaying(item);
    setSelected(item);

    await api.incrementPlayCount(item.id).catch(console.error);
  }

  async function playAudio(item: AudioItem, queue: AudioItem[] = audioItems) {
    const nextQueue = queue.length > 0 ? queue : [item];
    const index = Math.max(
      0,
      nextQueue.findIndex((x) => x.id === item.id)
    );

    await playQueueIndex(index, nextQueue);
  }

  async function playAudioAt(item: AudioItem, startSeconds: number, queue: AudioItem[] = audioItems) {
    await playAudio(item, queue);

    window.setTimeout(() => {
      const audioEl = document.querySelector("audio");
      if (audioEl) {
        audioEl.currentTime = startSeconds;
        audioEl.play().catch(console.error);
      }
    }, 180);
  }

  function playPrevious() {
    if (playingIndex <= 0) return;
    void playQueueIndex(playingIndex - 1, playbackQueue);
  }

  function playNext() {
    if (playingIndex < 0 || playingIndex >= playbackQueue.length - 1) return;
    void playQueueIndex(playingIndex + 1, playbackQueue);
  }

  async function removeQueueItem(index: number) {
    if (index < 0 || index >= playbackQueue.length) return;

    const nextQueue = playbackQueue.filter((_, i) => i !== index);

    if (index === playingIndex) {
      if (nextQueue.length === 0) {
        setPlaybackQueue([]);
        setPlayingIndex(-1);
        setPlaying(null);
        notify("播放队列已清空", "info");
        return;
      }

      const nextIndex = Math.min(index, nextQueue.length - 1);
      await playQueueIndex(nextIndex, nextQueue);
      notify("已移除当前音频并播放下一条", "info");
      return;
    }

    setPlaybackQueue(nextQueue);

    if (index < playingIndex) {
      setPlayingIndex((v) => v - 1);
    }

    notify("已从播放队列移除", "success");
  }

  function clearQueue() {
    if (playbackQueue.length === 0) return;

    const ok = window.confirm("确认清空播放队列并停止播放？");
    if (!ok) return;

    setPlaybackQueue([]);
    setPlayingIndex(-1);
    setPlaying(null);
    notify("播放队列已清空", "info");
  }

  async function batchTranscribeCurrentList() {
    if (audioItems.length === 0) return;

    const eligible = audioItems.filter(
      (item) => !item.is_missing && !isBusyStatus(item.transcript_status)
    );

    if (eligible.length === 0) {
      notify("当前列表没有可创建转写任务的音频。缺失文件或进行中的任务会被跳过。", "info");
      return;
    }

    const skippedByClient = audioItems.length - eligible.length;

    const ok = window.confirm(
      `将为 ${eligible.length} 个音频创建转写任务${
        skippedByClient ? `，并跳过 ${skippedByClient} 个缺失文件或进行中的音频` : ""
      }。确认继续？`
    );

    if (!ok) return;

    try {
      const result = await api.batchTranscribe(eligible.map((x) => x.id));
      const skippedTotal = skippedByClient + result.skipped;

      notify(`已创建 ${result.created} 个转写任务，跳过 ${skippedTotal} 个。`, "success");
      refresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function batchAnalyzeCurrentList() {
    if (audioItems.length === 0) return;

    const eligible = audioItems.filter((item) => !isBusyStatus(item.ai_status));

    if (eligible.length === 0) {
      notify("当前列表没有可创建 AI 分析任务的音频。进行中的任务会被跳过。", "info");
      return;
    }

    const skippedByClient = audioItems.length - eligible.length;

    const ok = window.confirm(
      `将为 ${eligible.length} 个音频创建 AI 分析任务${
        skippedByClient ? `，并跳过 ${skippedByClient} 个进行中的音频` : ""
      }。确认继续？`
    );

    if (!ok) return;

    try {
      const result = await api.batchAnalyze(eligible.map((x) => x.id));

      if (result.privacy_warning) {
        notify(result.privacy_warning, "error");
      }

      const skippedTotal = skippedByClient + result.skipped;

      notify(`已创建 ${result.created} 个 AI 分析任务，跳过 ${skippedTotal} 个。`, "success");
      refresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function removeFromCurrentPlaylist(item: AudioItem) {
    if (!selectedPlaylistId || !item.playlist_item_id) return;

    const ok = window.confirm(`确认从当前 playlist 移除「${displayTitle(item)}」？`);
    if (!ok) return;

    try {
      await api.removePlaylistItem(selectedPlaylistId, item.playlist_item_id);

      setPlaylistItemsRaw((rows) =>
        rows.filter((x) => x.playlist_item_id !== item.playlist_item_id)
      );

      setAudioItems((rows) =>
        rows.filter((x) => x.playlist_item_id !== item.playlist_item_id)
      );

      if (selected?.id === item.id) {
        setSelected(null);
      }

      notify("已从 playlist 移除", "success");
      refresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function persistPlaylistOrder(nextRaw: AudioItem[]) {
    if (!selectedPlaylistId) return;

    const itemIds = nextRaw
      .map((x) => x.playlist_item_id)
      .filter((id): id is number => typeof id === "number");

    if (itemIds.length !== nextRaw.length) return;

    await api.reorderPlaylistItems(selectedPlaylistId, itemIds);

    const normalized = nextRaw.map((x, index) => ({
      ...x,
      playlist_order_index: index
    }));

    setPlaylistItemsRaw(normalized);
    setAudioItems(applyClientFiltersForPlaylist(normalized));
  }

  async function movePlaylistItem(item: AudioItem, direction: "up" | "down") {
    if (!selectedPlaylistId || !item.playlist_item_id) return;

    const currentIndex = playlistItemsRaw.findIndex(
      (x) => x.playlist_item_id === item.playlist_item_id
    );

    if (currentIndex < 0) return;

    const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= playlistItemsRaw.length) return;

    const nextRaw = [...playlistItemsRaw];
    const tmp = nextRaw[currentIndex];
    nextRaw[currentIndex] = nextRaw[targetIndex];
    nextRaw[targetIndex] = tmp;

    try {
      await persistPlaylistOrder(nextRaw);
      notify("Playlist 顺序已更新", "success");
      refresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function movePlaylistItemTo(source: AudioItem, target: AudioItem) {
    if (!selectedPlaylistId || !source.playlist_item_id || !target.playlist_item_id) return;
    if (source.playlist_item_id === target.playlist_item_id) return;

    const sourceIndex = playlistItemsRaw.findIndex(
      (x) => x.playlist_item_id === source.playlist_item_id
    );

    const targetIndex = playlistItemsRaw.findIndex(
      (x) => x.playlist_item_id === target.playlist_item_id
    );

    if (sourceIndex < 0 || targetIndex < 0) return;

    const nextRaw = [...playlistItemsRaw];
    const [moved] = nextRaw.splice(sourceIndex, 1);
    nextRaw.splice(targetIndex, 0, moved);

    try {
      await persistPlaylistOrder(nextRaw);
      notify("Playlist 顺序已更新", "success");
      refresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    }
  }

  function handleAudioDeleted() {
    setSelected(null);
    refresh();
  }

  const activePlaylist = playlists.find((p) => p.id === selectedPlaylistId);

  let listTitle = "Library";
  if (view === "favorites") listTitle = "Favorites";
  if (view === "playlist") listTitle = activePlaylist ? `Playlist: ${activePlaylist.name}` : "Playlist";

  return (
    <div className="app">
      <div className="main">
        <Sidebar
          view={view}
          setView={setView}
          tags={tags}
          selectedTag={selectedTag}
          setSelectedTag={setSelectedTag}
          playlists={playlists}
          selectedPlaylistId={selectedPlaylistId}
          setSelectedPlaylistId={setSelectedPlaylistId}
          refresh={refresh}
        />

        {view === "settings" ? (
          <SettingsPanel refresh={refresh} notify={notify} />
        ) : (
          <>
            <AudioList
              title={listTitle}
              q={q}
              setQ={setQ}
              isLoading={loading}
              loadError={loadError}
              onOpenSettings={openSettings}
              onClearFilters={clearFilters}
              missingDescriptionOnly={missingDescriptionOnly}
              setMissingDescriptionOnly={setMissingDescriptionOnly}
              hasTranscriptFilter={hasTranscriptFilter}
              setHasTranscriptFilter={setHasTranscriptFilter}
              missingFilter={missingFilter}
              setMissingFilter={setMissingFilter}
              items={audioItems}
              selectedId={selected?.id}
              onSelect={setSelected}
              onPlay={(item) => playAudio(item, audioItems)}
              onPlayAt={(item, seconds) => playAudioAt(item, seconds, audioItems)}
              onBatchTranscribe={batchTranscribeCurrentList}
              onBatchAnalyze={batchAnalyzeCurrentList}
              isPlaylistView={view === "playlist"}
              onRemoveFromPlaylist={view === "playlist" ? removeFromCurrentPlaylist : undefined}
              onMovePlaylistItem={view === "playlist" ? movePlaylistItem : undefined}
              onMovePlaylistItemTo={view === "playlist" ? movePlaylistItemTo : undefined}
            />

            <DetailPanel
              audio={selected}
              refresh={refresh}
              onPlay={(item) => playAudio(item, audioItems)}
              playlists={playlists}
              selectedPlaylistId={selectedPlaylistId}
              onDeleted={handleAudioDeleted}
              notify={notify}
            />
          </>
        )}
      </div>

      <PlayerBar
        audio={playing}
        queue={playbackQueue}
        queueIndex={playingIndex}
        canPrevious={playingIndex > 0}
        canNext={playingIndex >= 0 && playingIndex < playbackQueue.length - 1}
        onPrevious={playPrevious}
        onNext={playNext}
        onQueueSelect={(index) => void playQueueIndex(index, playbackQueue)}
        onQueueRemove={(index) => void removeQueueItem(index)}
        onQueueClear={clearQueue}
        onPositionSaved={refresh}
      />

      <ToastStack toasts={toasts} onClose={closeToast} />
    </div>
  );
}
