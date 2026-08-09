import { Button, MaterialIcon } from "./ui";
import type { Playlist, Tag } from "../types";
import { useTranslation } from "react-i18next";

type ViewMode =
  | "library"
  | "favorites"
  | "playlist"
  | "settings"
  | "missingDescription"
  | "transcribed"
  | "missing"
  | "aiFailed";

type Props = {
  view: ViewMode;
  setView: (v: ViewMode) => void;
  tags: Tag[];
  selectedTag?: string;
  setSelectedTag: (tag?: string) => void;
  playlists: Playlist[];
  selectedPlaylistId: number | null;
  setSelectedPlaylistId: (id: number | null) => void;
};

export default function Sidebar(props: Props) {
  const { t } = useTranslation();
  function openView(view: ViewMode) {
    props.setView(view);
    props.setSelectedPlaylistId(null);

    if (view !== "library") {
      props.setSelectedTag(undefined);
    }
  }

  function navClass(active: boolean) {
    return active ? "nav-card active" : "nav-card";
  }

  function pillClass(active: boolean) {
    return active ? "sidebar-pill active" : "sidebar-pill";
  }

  const allAudioActive = props.view === "library" && !props.selectedTag;
  const favoriteActive = props.view === "favorites";
  const settingsActive = props.view === "settings";

  return (
    <aside className="sidebar">
      <div className="sidebar-scroll-content">
      <div className="brand">
        <div className="brand-orb" aria-hidden="true">
          <MaterialIcon name="library_music" size={28} />
        </div>

        <div className="brand-copy">
          <h2>Local Audio</h2>
          <p>{t("navigation.brandSubtitle")}</p>
        </div>
      </div>

      <nav className="sidebar-nav">
        <Button preserveChildren
          type="button"
          className={navClass(allAudioActive)}
          aria-current={allAudioActive ? "page" : undefined}
          onClick={() => {
            props.setView("library");
            props.setSelectedTag(undefined);
            props.setSelectedPlaylistId(null);
          }}
        >
          <span className="nav-symbol"><MaterialIcon name="home" size={22} /></span>
          <span>
            <strong>{t("navigation.library")}</strong>
            <em>{t("navigation.allAudio")}</em>
          </span>
        </Button>

        <Button preserveChildren
          type="button"
          className={navClass(favoriteActive)}
          aria-current={favoriteActive ? "page" : undefined}
          onClick={() => openView("favorites")}
        >
          <span className="nav-symbol"><MaterialIcon name="star" size={22} /></span>
          <span>
            <strong>{t("navigation.favorites")}</strong>
            <em>{t("navigation.frequent")}</em>
          </span>
        </Button>

        <Button preserveChildren
          type="button"
          className={navClass(props.view === "transcribed")}
          aria-current={props.view === "transcribed" ? "page" : undefined}
          onClick={() => openView("transcribed")}
        >
          <span className="nav-symbol"><MaterialIcon name="article" size={22} /></span>
          <span>
            <strong>{t("navigation.transcribed")}</strong>
            <em>{t("navigation.searchable")}</em>
          </span>
        </Button>

        <Button preserveChildren
          type="button"
          className={navClass(props.view === "missing")}
          aria-current={props.view === "missing" ? "page" : undefined}
          onClick={() => openView("missing")}
        >
          <span className="nav-symbol"><MaterialIcon name="report" size={22} /></span>
          <span>
            <strong>{t("navigation.missing")}</strong>
            <em>{t("navigation.relocate")}</em>
          </span>
        </Button>

        <Button preserveChildren
          type="button"
          className={navClass(props.view === "aiFailed")}
          aria-current={props.view === "aiFailed" ? "page" : undefined}
          onClick={() => openView("aiFailed")}
        >
          <span className="nav-symbol"><MaterialIcon name="bolt" size={22} /></span>
          <span>
            <strong>{t("navigation.aiFailed")}</strong>
            <em>{t("navigation.retryAnalysis")}</em>
          </span>
        </Button>
      </nav>

      <div className="sidebar-section">
        <div className="sidebar-section-heading">
          <h3>{t("navigation.playlists")}</h3>
          <span>{props.playlists.length}</span>
        </div>

        {props.playlists.length === 0 && (
          <div className="sidebar-empty">
            {t("navigation.noPlaylists")}
            <br />
            {t("navigation.createInSettings")}
          </div>
        )}

        <div className="sidebar-scroll-area">
          {props.playlists.map((playlist) => (
            <Button preserveChildren
              key={playlist.id}
              type="button"
              aria-current={
                props.view === "playlist" && props.selectedPlaylistId === playlist.id
                  ? "page"
                  : undefined
              }
              className={
                props.view === "playlist" && props.selectedPlaylistId === playlist.id
                  ? "playlist-row active"
                  : "playlist-row"
              }
              title={playlist.description || playlist.name}
              onClick={() => {
                props.setView("playlist");
                props.setSelectedTag(undefined);
                props.setSelectedPlaylistId(playlist.id);
              }}
            >
              <MaterialIcon name="chevron_right" size={18} />
              <strong>{playlist.name}</strong>
            </Button>
          ))}
        </div>
      </div>

      <div className="sidebar-section tag-section">
        <div className="sidebar-section-heading">
          <h3>{t("navigation.tags")}</h3>
          <span>{props.tags.length}</span>
        </div>

        <div className="tag-cloud-nav">
          <Button preserveChildren
            type="button"
            className={pillClass(allAudioActive)}
            aria-pressed={allAudioActive}
            onClick={() => {
              props.setView("library");
              props.setSelectedTag(undefined);
              props.setSelectedPlaylistId(null);
            }}
          >
            {t("navigation.allTags")}
          </Button>

          {props.tags.map((tag) => (
            <Button preserveChildren
              key={tag.id}
              type="button"
              className={pillClass(props.selectedTag === tag.name)}
              aria-pressed={props.selectedTag === tag.name}
              onClick={() => {
                props.setView("library");
                props.setSelectedPlaylistId(null);
                props.setSelectedTag(tag.name);
              }}
              title={t("navigation.viewTag", { name: tag.name })}
            >
              #{tag.name}
            </Button>
          ))}
        </div>
      </div>

      <div className="sidebar-footer">
        <Button preserveChildren
          type="button"
          className={settingsActive ? "settings-nav active" : "settings-nav"}
          aria-current={settingsActive ? "page" : undefined}
          onClick={() => {
            props.setView("settings");
            props.setSelectedTag(undefined);
            props.setSelectedPlaylistId(null);
          }}
        >
          <MaterialIcon name="settings" size={20} />
          <strong>{t("navigation.settings")}</strong>
        </Button>
      </div>
      </div>
    </aside>
  );
}
