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

  const [tags, setTags] = useState<Tag[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
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
          item.file_name
        ]
          .join(" ")
          .toLowerCase();

        return text.includes(keyword);
      });
    }

    if (missingDescriptionOnly) {
      result = result.filter((item) => !displayDescription(item).trim());
    }

    return result;
  }

  async function load() {
    await loadNavigation();

    if (view === "settings") return;

    let items: AudioItem[] = [];

    if (view === "playlist") {
      if (!selectedPlaylistId) {
        setAudioItems([]);
        return;
      }

      const detail = await api.getPlaylist(selectedPlaylistId);
      items = detail.items.map((x) => x.audio);
      items = applyClientFiltersForPlaylist(items);
    } else {
      items = await api.listAudioItems({
        q: q || undefined,
        tag: selectedTag,
        favorite: view === "favorites" ? true : undefined,
        missing_description: missingDescriptionOnly || undefined
      });
    }

    setAudioItems(items);

    if (selected) {
      const found = items.find((x) => x.id === selected.id);
      if (found) setSelected(found);
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
              items={audioItems}
              selectedId={selected?.id}
              onSelect={setSelected}
              onPlay={(item) => playAudio(item, audioItems)}
            />

            <DetailPanel
              audio={selected}
              refresh={refresh}
              onPlay={(item) => playAudio(item, audioItems)}
              playlists={playlists}
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
