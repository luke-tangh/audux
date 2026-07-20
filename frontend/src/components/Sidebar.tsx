import type { Playlist, Tag } from "../types";

type ViewMode = "library" | "favorites" | "playlist" | "settings";

type Props = {
  view: ViewMode;
  setView: (v: ViewMode) => void;
  tags: Tag[];
  selectedTag?: string;
  setSelectedTag: (tag?: string) => void;
  playlists: Playlist[];
  selectedPlaylistId: number | null;
  setSelectedPlaylistId: (id: number | null) => void;
  refresh: () => void;
};

export default function Sidebar(props: Props) {
  return (
    <aside className="sidebar">
      <h2>Audio Library</h2>

      <button
        className={props.view === "library" ? "active" : ""}
        onClick={() => {
          props.setView("library");
          props.setSelectedTag(undefined);
          props.setSelectedPlaylistId(null);
        }}
      >
        Library
      </button>

      <button
        className={props.view === "favorites" ? "active" : ""}
        onClick={() => {
          props.setView("favorites");
          props.setSelectedTag(undefined);
          props.setSelectedPlaylistId(null);
        }}
      >
        Favorites
      </button>

      <button
        className={props.view === "settings" ? "active" : ""}
        onClick={() => {
          props.setView("settings");
          props.setSelectedPlaylistId(null);
        }}
      >
        Settings
      </button>

      <div className="section">
        <h3>Tags</h3>

        <button
          className={!props.selectedTag && props.view !== "playlist" ? "active small" : "small"}
          onClick={() => {
            props.setView("library");
            props.setSelectedTag(undefined);
            props.setSelectedPlaylistId(null);
          }}
        >
          All Tags
        </button>

        {props.tags.map((tag) => (
          <button
            key={tag.id}
            className={props.selectedTag === tag.name ? "active small" : "small"}
            onClick={() => {
              props.setView("library");
              props.setSelectedPlaylistId(null);
              props.setSelectedTag(tag.name);
            }}
          >
            #{tag.name}
          </button>
        ))}
      </div>

      <div className="section">
        <h3>Playlists</h3>

        {props.playlists.length === 0 && (
          <div className="playlist-empty">暂无 playlist</div>
        )}

        {props.playlists.map((p) => (
          <button
            key={p.id}
            className={
              props.view === "playlist" && props.selectedPlaylistId === p.id
                ? "active small"
                : "small"
            }
            title={p.description || ""}
            onClick={() => {
              props.setView("playlist");
              props.setSelectedTag(undefined);
              props.setSelectedPlaylistId(p.id);
            }}
          >
            {p.name}
          </button>
        ))}
      </div>
    </aside>
  );
}
