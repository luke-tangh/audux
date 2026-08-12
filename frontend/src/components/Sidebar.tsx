import { Button, IconButton, MaterialIcon, TextField } from "./ui";
import type { Playlist, SavedView, Tag } from "../types";
import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

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
  compactNavigation?: boolean;
  navigationOpen?: boolean;
  onCloseNavigation?: () => void;
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
  onCreatePlaylist: (name: string) => Promise<boolean>;
};

export default function Sidebar(props: Props) {
  const { t } = useTranslation();
  const [expandedSections, setExpandedSections] = useState({
    tags: props.tags.length > 0,
    playlists: props.playlists.length > 0,
    savedViews: props.savedViews.length > 0
  });
  const [showAllTags, setShowAllTags] = useState(false);
  const [playlistMenuOpen, setPlaylistMenuOpen] = useState(false);
  const [playlistName, setPlaylistName] = useState("");
  const [creatingPlaylist, setCreatingPlaylist] = useState(false);
  const playlistSectionRef = useRef<HTMLDivElement | null>(null);
  const playlistTriggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!playlistMenuOpen) return;

    window.requestAnimationFrame(() => {
      playlistSectionRef.current?.querySelector<HTMLInputElement>("input")?.focus();
    });

    function handlePointerDown(event: PointerEvent) {
      if (!playlistSectionRef.current?.contains(event.target as Node)) {
        setPlaylistMenuOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [playlistMenuOpen]);

  useEffect(() => {
    setExpandedSections((current) => ({
      tags: current.tags || props.tags.length > 0,
      playlists: current.playlists || props.playlists.length > 0,
      savedViews: current.savedViews || props.savedViews.length > 0
    }));
  }, [props.playlists.length, props.savedViews.length, props.tags.length]);

  async function submitPlaylist(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = playlistName.trim();
    if (!name || creatingPlaylist) return;

    setCreatingPlaylist(true);
    const created = await props.onCreatePlaylist(name);
    setCreatingPlaylist(false);
    if (!created) return;

    setPlaylistName("");
    setPlaylistMenuOpen(false);
    setExpandedSections((current) => ({ ...current, playlists: true }));
    window.requestAnimationFrame(() => playlistTriggerRef.current?.focus());
  }

  function toggleSection(section: keyof typeof expandedSections) {
    setExpandedSections((current) => ({
      ...current,
      [section]: !current[section]
    }));
  }
  function openView(view: ViewMode) {
    props.onDeactivateSavedView();
    props.setView(view);
    props.setSelectedPlaylistId(null);

    if (view !== "library") {
      props.setSelectedTag(undefined);
    }
    if (props.compactNavigation) props.onCloseNavigation?.();
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
  const collapsedTags = props.tags.slice(0, 8);
  const selectedTagOutsidePreview = props.tags.find(
    (tag) => tag.name === props.selectedTag && !collapsedTags.some((row) => row.id === tag.id)
  );
  const visibleTags = showAllTags
    ? props.tags
    : selectedTagOutsidePreview
      ? [...collapsedTags, selectedTagOutsidePreview]
      : collapsedTags;
  return (
    <aside
      id="app-navigation"
      className={`sidebar ${props.navigationOpen ? "navigation-open" : ""}`.trim()}
      aria-hidden={props.compactNavigation && !props.navigationOpen ? true : undefined}
      inert={props.compactNavigation && !props.navigationOpen ? true : undefined}
    >
      <div className="sidebar-scroll-content">
      <div className="brand">
        <div className="brand-orb" aria-hidden="true">
          <MaterialIcon name="library_music" size={28} />
        </div>

        <div className="brand-copy">
          <h2>Local Audio</h2>
          <p>{t("navigation.brandSubtitle")}</p>
        </div>

        <IconButton
          size="sm"
          className="sidebar-drawer-close"
          label={t("navigation.closeNavigation")}
          onClick={props.onCloseNavigation}
        >
          <MaterialIcon name="close" size={20} />
        </IconButton>
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
            if (props.compactNavigation) props.onCloseNavigation?.();
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
          <button
            type="button"
            className="sidebar-section-toggle"
            aria-label={t(
              expandedSections.tags
                ? "navigation.collapseSection"
                : "navigation.expandSection",
              { name: t("navigation.tags") }
            )}
            aria-expanded={expandedSections.tags}
            onClick={() => toggleSection("tags")}
          >
            <h3>{t("navigation.tags")}</h3>
            <MaterialIcon name={expandedSections.tags ? "expand_less" : "expand_more"} size={18} />
          </button>
          {props.tags.length > 0 && (
            <span className="sidebar-section-count">{props.tags.length}</span>
          )}
        </div>

        {expandedSections.tags && <div className="tag-cloud-nav">
          <Button preserveChildren
            type="button"
            className="sidebar-pill sidebar-filter-reset"
            aria-pressed={false}
            onClick={() => {
              props.onDeactivateSavedView();
              props.setView("library");
              props.setSelectedTag(undefined);
              props.setSelectedPlaylistId(null);
              if (props.compactNavigation) props.onCloseNavigation?.();
            }}
          >
            {t("navigation.allTags")}
          </Button>

          {visibleTags.map((tag) => (
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
                if (props.compactNavigation) props.onCloseNavigation?.();
              }}
              title={t("navigation.viewTag", { name: tag.name })}
            >
              #{tag.name}
            </Button>
          ))}
          {props.tags.length > 8 && (
            <Button
              size="sm"
              className="sidebar-show-more"
              onClick={() => setShowAllTags((value) => !value)}
            >
              {showAllTags ? t("navigation.showLess") : t("navigation.showAllTags", { count: props.tags.length })}
            </Button>
          )}
        </div>}
      </div>

      <div className="sidebar-section playlist-section" ref={playlistSectionRef}>
        <div className="sidebar-section-heading">
          <button
            type="button"
            className="sidebar-section-toggle"
            aria-label={t(
              expandedSections.playlists
                ? "navigation.collapseSection"
                : "navigation.expandSection",
              { name: t("navigation.playlists") }
            )}
            aria-expanded={expandedSections.playlists}
            onClick={() => toggleSection("playlists")}
          >
            <h3>{t("navigation.playlists")}</h3>
            <MaterialIcon name={expandedSections.playlists ? "expand_less" : "expand_more"} size={18} />
          </button>
          <IconButton
            ref={playlistTriggerRef}
            size="sm"
            className="sidebar-create-playlist-trigger"
            label={t("navigation.createPlaylist")}
            aria-haspopup="dialog"
            aria-expanded={playlistMenuOpen}
            aria-controls={playlistMenuOpen ? "sidebar-create-playlist" : undefined}
            onClick={() => setPlaylistMenuOpen((open) => !open)}
          >
            <MaterialIcon name="add" size={18} />
          </IconButton>
          {props.playlists.length > 0 && (
            <span className="sidebar-section-count">{props.playlists.length}</span>
          )}
        </div>

        {playlistMenuOpen && (
          <form
            id="sidebar-create-playlist"
            className="sidebar-create-playlist-menu"
            role="dialog"
            aria-label={t("navigation.createPlaylist")}
            onSubmit={(event) => void submitPlaylist(event)}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.preventDefault();
              setPlaylistMenuOpen(false);
              window.requestAnimationFrame(() => playlistTriggerRef.current?.focus());
            }}
          >
            <TextField
              hideLabel
              label={t("settings.library.playlistName")}
              placeholder={t("settings.library.playlistName")}
              value={playlistName}
              disabled={creatingPlaylist}
              onValueChange={setPlaylistName}
            />
            <Button
              type="submit"
              variant="filled"
              size="sm"
              disabled={!playlistName.trim() || creatingPlaylist}
            >
              {creatingPlaylist ? t("common.status.running") : t("settings.library.create")}
            </Button>
          </form>
        )}

        {expandedSections.playlists && props.playlists.length === 0 && (
          <div className="sidebar-empty">
            {t("navigation.noPlaylists")}
          </div>
        )}

        {expandedSections.playlists && <div className="sidebar-scroll-area">
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
              onClick={() => {
                props.onOpenPlaylist(playlist);
                if (props.compactNavigation) props.onCloseNavigation?.();
              }}
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
        </div>}
      </div>

      <div className="sidebar-section saved-view-section">
        <div className="sidebar-section-heading">
          <button
            type="button"
            className="sidebar-section-toggle"
            aria-label={t(
              expandedSections.savedViews
                ? "navigation.collapseSection"
                : "navigation.expandSection",
              { name: t("savedViews.section") }
            )}
            aria-expanded={expandedSections.savedViews}
            onClick={() => toggleSection("savedViews")}
          >
            <h3>{t("savedViews.section")}</h3>
            <MaterialIcon name={expandedSections.savedViews ? "expand_less" : "expand_more"} size={18} />
          </button>
          {props.savedViews.length > 0 && (
            <span className="sidebar-section-count">{props.savedViews.length}</span>
          )}
        </div>

        {expandedSections.savedViews && props.savedViews.length === 0 && (
          <div className="sidebar-empty">{t("savedViews.empty")}</div>
        )}

        {expandedSections.savedViews && <div className="sidebar-scroll-area">
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
                  onClick={() => {
                    props.onApplySavedView(savedView);
                    if (props.compactNavigation) props.onCloseNavigation?.();
                  }}
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
        </div>}
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
            if (props.compactNavigation) props.onCloseNavigation?.();
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
