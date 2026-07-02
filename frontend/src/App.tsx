import { useEffect, useState } from "react";
import { api } from "./api";
import type { AudioItem, Tag, Playlist } from "./types";
import Sidebar from "./components/Sidebar";
import AudioList from "./components/AudioList";
import DetailPanel from "./components/DetailPanel";
import PlayerBar from "./components/PlayerBar";
import SettingsPanel from "./components/SettingsPanel";

type ViewMode = "library" | "favorites" | "settings";

export default function App() {
  const [view, setView] = useState<ViewMode>("library");
  const [audioItems, setAudioItems] = useState<AudioItem[]>([]);
  const [selected, setSelected] = useState<AudioItem | null>(null);
  const [playing, setPlaying] = useState<AudioItem | null>(null);
  const [q, setQ] = useState("");
  const [selectedTag, setSelectedTag] = useState<string | undefined>();
  const [tags, setTags] = useState<Tag[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [refreshToken, setRefreshToken] = useState(0);

  async function load() {
    if (view === "settings") return;

    const items = await api.listAudioItems({
      q: q || undefined,
      tag: selectedTag,
      favorite: view === "favorites" ? true : undefined
    });

    setAudioItems(items);
    setTags(await api.listTags());
    setPlaylists(await api.listPlaylists());

    if (selected) {
      const found = items.find((x) => x.id === selected.id);
      if (found) setSelected(found);
    }
  }

  useEffect(() => {
    load().catch(console.error);
  }, [view, q, selectedTag, refreshToken]);

  function refresh() {
    setRefreshToken((v) => v + 1);
  }

  async function playAudio(item: AudioItem) {
    setPlaying(item);
    setSelected(item);
    await api.incrementPlayCount(item.id).catch(console.error);
  }

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
          refresh={refresh}
        />

        {view === "settings" ? (
          <SettingsPanel refresh={refresh} />
        ) : (
          <>
            <AudioList
              q={q}
              setQ={setQ}
              items={audioItems}
              selectedId={selected?.id}
              onSelect={setSelected}
              onPlay={playAudio}
            />

            <DetailPanel
              audio={selected}
              refresh={refresh}
              setPlaying={setPlaying}
              playlists={playlists}
            />
          </>
        )}
      </div>

      <PlayerBar audio={playing} onPositionSaved={refresh} />
    </div>
  );
}
