import type { Playlist, Tag } from "../types";

type Props = {
  view: "library" | "favorites" | "settings";
  setView: (v: "library" | "favorites" | "settings") => void;
  tags: Tag[];
  selectedTag?: string;
  setSelectedTag: (tag?: string) => void;
  playlists: Playlist[];
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
        }}
      >
        Library
      </button>

      <button
        className={props.view === "favorites" ? "active" : ""}
        onClick={() => props.setView("favorites")}
      >
        Favorites
      </button>

      <button
        className={props.view === "settings" ? "active" : ""}
        onClick={() => props.setView("settings")}
      >
        Settings
      </button>

      <div className="section">
        <h3>Tags</h3>
        <button
          className={!props.selectedTag ? "active small" : "small"}
          onClick={() => props.setSelectedTag(undefined)}
        >
          All Tags
        </button>
        {props.tags.map((tag) => (
          <button
            key={tag.id}
            className={props.selectedTag === tag.name ? "active small" : "small"}
            onClick={() => {
              props.setView("library");
              props.setSelectedTag(tag.name);
            }}
          >
            #{tag.name}
          </button>
        ))}
      </div>

      <div className="section">
        <h3>Playlists</h3>
        {props.playlists.map((p) => (
          <div key={p.id} className="playlist-name">
            {p.name}
          </div>
        ))}
      </div>
    </aside>
  );
}
