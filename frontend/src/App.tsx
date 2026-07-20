import { useEffect, useState } from "react";
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

export default function App() {
  const [view, setView] = useState<ViewMode>("library");
  const [audioItems, setAudioItems] = useState<AudioItem[]>([]);
  const [selected, setSelected] = useState<AudioItem | null>(null);

  const [playing, setPlaying] = useState<AudioItem | null>(null);
  const [playbackQueue, setPlaybackQueue] = useState<AudioItem[]>([]);
  const [playingIndex, setPlayingIndex] = useState(-1);

  const [q, setQ] = useState("");
  const [selectedTag, setSelectedTag] = useState<string | undefined>();
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<number | null>(null);
  const [missingDescriptionOnly, setMissingDescriptionOnly] = useState(false);
  const [hasTranscriptFilter, setHasTranscriptFilter] = useState<TranscriptFilter>("all");
  const [missingFilter, setMissingFilter] = useState<MissingFilter>("all");

  const [tags, setTags] = useState<Tag[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [playlistItemsRaw, setPlaylistItemsRaw] = useState<AudioItem[]>([]);
  const [refreshToken, setRefreshToken] = useState(0);

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

    const keyword = q.trim().toLowerCase();
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
    await loadNavigation();

    if (view === "settings") return;

    let items: AudioItem[] = [];

    if (view === "playlist") {
      if (!selectedPlaylistId) {
        setPlaylistItemsRaw([]);
        setAudioItems([]);
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
        q: q || undefined,
        tag: selectedTag,
        favorite: view === "favorites" ? true : undefined,
        missing_description: missingDescriptionOnly || undefined,
        has_transcript: transcriptFilterToParam(hasTranscriptFilter),
        missing: missingFilterToParam(missingFilter)
      });
    }

    setAudioItems(items);

    if (selected) {
      const found = items.find((x) => x.id === selected.id);
      if (found) {
        setSelected(found);
      }
    }
  }

  useEffect(() => {
    load().catch(console.error);
  }, [
    view,
    q,
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

  function playPrevious() {
    if (playingIndex <= 0) return;
    void playQueueIndex(playingIndex - 1, playbackQueue);
  }

  function playNext() {
    if (playingIndex < 0 || playingIndex >= playbackQueue.length - 1) return;
    void playQueueIndex(playingIndex + 1, playbackQueue);
  }

  async function batchTranscribeCurrentList() {
    if (audioItems.length === 0) return;

    const ok = window.confirm(`确认为当前列表中的 ${audioItems.length} 个音频创建转写任务？`);
    if (!ok) return;

    const result = await api.batchTranscribe(audioItems.map((x) => x.id));
    alert(`已创建 ${result.created} 个任务，跳过 ${result.skipped} 个。`);
    refresh();
  }

  async function batchAnalyzeCurrentList() {
    if (audioItems.length === 0) return;

    const ok = window.confirm(`确认为当前列表中的 ${audioItems.length} 个音频创建 AI 分析任务？`);
    if (!ok) return;

    try {
      const result = await api.batchAnalyze(audioItems.map((x) => x.id));
      alert(`已创建 ${result.created} 个任务，跳过 ${result.skipped} 个。`);
      refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  }

  async function removeFromCurrentPlaylist(item: AudioItem) {
    if (!selectedPlaylistId || !item.playlist_item_id) return;

    const ok = window.confirm(`确认从当前 playlist 移除「${displayTitle(item)}」？`);
    if (!ok) return;

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

    refresh();
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

    refresh();
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
          <SettingsPanel refresh={refresh} />
        ) : (
          <>
            <AudioList
              title={listTitle}
              q={q}
              setQ={setQ}
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
              onBatchTranscribe={batchTranscribeCurrentList}
              onBatchAnalyze={batchAnalyzeCurrentList}
              isPlaylistView={view === "playlist"}
              onRemoveFromPlaylist={view === "playlist" ? removeFromCurrentPlaylist : undefined}
              onMovePlaylistItem={view === "playlist" ? movePlaylistItem : undefined}
            />

            <DetailPanel
              audio={selected}
              refresh={refresh}
              onPlay={(item) => playAudio(item, audioItems)}
              playlists={playlists}
              selectedPlaylistId={selectedPlaylistId}
              onDeleted={handleAudioDeleted}
            />
          </>
        )}
      </div>

      <PlayerBar
        audio={playing}
        canPrevious={playingIndex > 0}
        canNext={playingIndex >= 0 && playingIndex < playbackQueue.length - 1}
        onPrevious={playPrevious}
        onNext={playNext}
        onPositionSaved={refresh}
      />
    </div>
  );
}
