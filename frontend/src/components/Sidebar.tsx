import { Button, IconButton, MaterialIcon } from "./ui";
import type { Playlist, SavedView, Tag } from "../types";
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
  savedViews: SavedView[];
  activeSavedViewId: number | null;
  onApplySavedView: (savedView: SavedView) => void;
  onRenameSavedView: (savedView: SavedView) => void;
  onCopySavedView: (savedView: SavedView) => void;
  onCreateSmartPlaylist: (savedView: SavedView) => void;
  onDeleteSavedView: (savedView: SavedView) => void;
  onMoveSavedView: (savedViewId: number, direction: -1 | 1) => void;
  onDeactivateSavedView: () => void;
  onOpenPlaylist: (playlist: Playlist) => void;
};

export default function Sidebar(props: Props) {
  const { t } = useTranslation();
  function openView(view: ViewMode) {
    props.onDeactivateSavedView();
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

  const allAudioActive =
    props.activeSavedViewId === null && props.view === "library" && !props.selectedTag;
  const favoriteActive =
    props.activeSavedViewId === null && props.view === "favorites";
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
            props.onDeactivateSavedView();
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

      </nav>

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
              props.onDeactivateSavedView();
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
              className={pillClass(
                props.activeSavedViewId === null && props.selectedTag === tag.name
              )}
              aria-pressed={
                props.activeSavedViewId === null && props.selectedTag === tag.name
              }
              onClick={() => {
                props.onDeactivateSavedView();
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
              className={`${
                props.view === "playlist" && props.selectedPlaylistId === playlist.id
                  ? "playlist-row active"
                  : "playlist-row"
              } ${playlist.kind === "smart" ? "smart-playlist-row" : "manual-playlist-row"}`}
              title={playlist.description || playlist.name}
              onClick={() => props.onOpenPlaylist(playlist)}
            >
              <MaterialIcon
                name={playlist.kind === "smart" ? "playlist_play" : "chevron_right"}
                size={18}
              />
              <span className="playlist-row-copy">
                <strong>{playlist.name}</strong>
                {playlist.kind === "smart" && (
                  <em>
                    {t("smartPlaylists.dynamicCount", {
                      count: playlist.current_count ?? "—"
                    })}
                  </em>
                )}
              </span>
            </Button>
          ))}
        </div>
      </div>

      <div className="sidebar-section saved-view-section">
        <div className="sidebar-section-heading">
          <h3>{t("savedViews.section")}</h3>
          <span>{props.savedViews.length}</span>
        </div>

        {props.savedViews.length === 0 && (
          <div className="sidebar-empty">{t("savedViews.empty")}</div>
        )}

        <div className="sidebar-scroll-area">
          {props.savedViews.map((savedView, index) => {
            const active = props.activeSavedViewId === savedView.id;
            return (
              <div className={active ? "saved-view-entry active" : "saved-view-entry"} key={savedView.id}>
                <Button
                  preserveChildren
                  type="button"
                  className="saved-view-row"
                  aria-current={active ? "page" : undefined}
                  title={savedView.query ? savedView.name : t("savedViews.definitionInvalid")}
                  onClick={() => props.onApplySavedView(savedView)}
                >
                  <MaterialIcon name={savedView.invalid_references.length ? "warning" : "menu_book"} size={18} />
                  <strong>{savedView.name}</strong>
                </Button>

                {active && (
                  <div className="saved-view-actions" role="group" aria-label={t("savedViews.manage", { name: savedView.name })}>
                    <IconButton
                      size="sm"
                      label={t("savedViews.moveUp", { name: savedView.name })}
                      disabled={index === 0}
                      onClick={() => props.onMoveSavedView(savedView.id, -1)}
                    >
                      <MaterialIcon name="keyboard_arrow_up" size={17} />
                    </IconButton>
                    <IconButton
                      size="sm"
                      label={t("savedViews.moveDown", { name: savedView.name })}
                      disabled={index === props.savedViews.length - 1}
                      onClick={() => props.onMoveSavedView(savedView.id, 1)}
                    >
                      <MaterialIcon name="keyboard_arrow_down" size={17} />
                    </IconButton>
                    <IconButton
                      size="sm"
                      label={t("savedViews.rename", { name: savedView.name })}
                      onClick={() => props.onRenameSavedView(savedView)}
                    >
                      <MaterialIcon name="edit_note" size={17} />
                    </IconButton>
                    <IconButton
                      size="sm"
                      label={t("savedViews.copy", { name: savedView.name })}
                      onClick={() => props.onCopySavedView(savedView)}
                    >
                      <MaterialIcon name="queue_music" size={17} />
                    </IconButton>
                    <IconButton
                      size="sm"
                      label={t("smartPlaylists.createFromView", { name: savedView.name })}
                      disabled={!savedView.query}
                      onClick={() => props.onCreateSmartPlaylist(savedView)}
                    >
                      <MaterialIcon name="playlist_play" size={17} />
                    </IconButton>
                    <IconButton
                      size="sm"
                      variant="danger"
                      label={t("savedViews.delete", { name: savedView.name })}
                      onClick={() => props.onDeleteSavedView(savedView)}
                    >
                      <MaterialIcon name="close" size={17} />
                    </IconButton>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="sidebar-footer">
        <Button preserveChildren
          type="button"
          className={settingsActive ? "settings-nav active" : "settings-nav"}
          aria-current={settingsActive ? "page" : undefined}
          onClick={() => {
            props.onDeactivateSavedView();
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
