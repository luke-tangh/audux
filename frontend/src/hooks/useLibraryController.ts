import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { AudioItem, Playlist, SavedView } from "../types";
import { useDialog } from "../components/dialog/UnifiedDialog";
import { useBackendReady } from "./useBackendReady";
import { useToast } from "./useToast";
import {
  buildAudioListParams as buildAudioListParamsForState,
  buildPlaylistListParams as buildPlaylistListParamsForState,
  describeSmartPlaylistRules,
  isAudioListView,
  isBusyStatus,
  isSmartView,
  listCopyForView
} from "./library/filters";
import { useBatchTasks } from "./library/useBatchTasks";
import { useBatchOrganization } from "./library/useBatchOrganization";
import { useDebouncedValue } from "./library/useDebouncedValue";
import { useNavigationData } from "./library/useNavigationData";
import { usePlaybackQueue } from "./library/usePlaybackQueue";
import { usePlaylistActions } from "./library/usePlaylistActions";
import { useAudioSelection } from "./library/useAudioSelection";
import { useSavedViewController } from "./library/useSavedViewController";
import { usePolling } from "./usePolling";
import { useTranslation } from "react-i18next";
import { formatDateTime } from "../i18n/format";
import { toErrorMessage } from "../i18n/errors";
import type {
  AudioListParams,
  MissingFilter,
  PlaylistListParams,
  SortMode,
  TranscriptFilter,
  ViewMode
} from "./library/types";

export type { MissingFilter, TranscriptFilter, ViewMode } from "./library/types";

const AUDIO_PAGE_LIMIT = 120;

export function useLibraryController() {
  const { t, i18n } = useTranslation();
  const [view, setView] = useState<ViewMode>("library");
  const [audioItems, setAudioItems] = useState<AudioItem[]>([]);
  const [audioTotal, setAudioTotal] = useState(0);
  const [audioHasMore, setAudioHasMore] = useState(false);
  const [searchLimited, setSearchLimited] = useState(false);
  const [searchLimit, setSearchLimit] = useState<number | null>(null);
  const [facets, setFacets] = useState<NonNullable<
    import("../types").PaginatedAudioItems["facets"]
  >>({ tags: [], roots: [] });
  const [selected, setSelected] = useState<AudioItem | null>(null);

  const [q, setQ] = useState("");
  const debouncedQ = useDebouncedValue(q, 240);
  const [selectedTag, setSelectedTagState] = useState<string | undefined>();
  const [includedTagIds, setIncludedTagIds] = useState<number[]>([]);
  const [excludedTagIds, setExcludedTagIds] = useState<number[]>([]);
  const [tagMode, setTagMode] = useState<"and" | "or">("and");
  const [selectedLibraryRootId, setSelectedLibraryRootId] = useState<number | undefined>();
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<number | null>(null);

  const [hasTranscriptFilter, setHasTranscriptFilter] = useState<TranscriptFilter>("all");
  const [missingFilter, setMissingFilter] = useState<MissingFilter>("all");
  const [sortMode, setSortMode] = useState<SortMode>("default");

  const [playlistItemsRaw, setPlaylistItemsRaw] = useState<AudioItem[]>([]);
  const [smartPlaylistRefreshedAt, setSmartPlaylistRefreshedAt] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [playbackQueueValidationToken, setPlaybackQueueValidationToken] = useState(0);

  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [initialized, setInitialized] = useState(false);
  const [startupState, setStartupState] = useState<"starting" | "ready" | "error">("starting");
  const [startupError, setStartupError] = useState("");

  const loadSeqRef = useRef(0);
  const hasLoadedListRef = useRef(false);
  const startupReadyRef = useRef(false);
  const navigationLoadedRef = useRef(false);
  const loadInFlightRef = useRef(false);
  const loadMoreInFlightRef = useRef(false);
  const loadMoreSeqRef = useRef(0);

  const { ensureBackendReady, resetBackendReady } = useBackendReady();
  const dialog = useDialog();
  const { toasts, notify, closeToast } = useToast();
  const {
    tags,
    playlists,
    roots,
    savedViews,
    navigationReady,
    loadNavigation
  } = useNavigationData();
  const selection = useAudioSelection({ items: audioItems, notify });
  const activePlaylist = playlists.find((playlist) => playlist.id === selectedPlaylistId);
  const isSmartPlaylist = activePlaylist?.kind === "smart";
  const manualPlaylists = playlists.filter((playlist) => playlist.kind !== "smart");

  function setSelectedTag(tag?: string) {
    setSelectedTagState(tag);
    setIncludedTagIds([]);
    setExcludedTagIds([]);
    setTagMode("and");
  }

  const savedViewController = useSavedViewController({
    view,
    setView,
    q,
    setQ,
    selectedTag,
    setSelectedTag,
    includedTagIds,
    setIncludedTagIds,
    excludedTagIds,
    setExcludedTagIds,
    tagMode,
    setTagMode,
    selectedLibraryRootId,
    setSelectedLibraryRootId,
    setSelectedPlaylistId,
    hasTranscriptFilter,
    setHasTranscriptFilter,
    missingFilter,
    setMissingFilter,
    sortMode,
    setSortMode,
    tags,
    savedViews,
    loadNavigation,
    notify
  });
  const {
    activeSavedView,
    activeSavedViewId,
    setActiveSavedViewId
  } = savedViewController;

  function setTagFilterState(
    tagId: number,
    state: "neutral" | "include" | "exclude"
  ) {
    setSelectedTagState(undefined);
    setIncludedTagIds((current) =>
      state === "include"
        ? Array.from(new Set([...current, tagId]))
        : current.filter((id) => id !== tagId)
    );
    setExcludedTagIds((current) =>
      state === "exclude"
        ? Array.from(new Set([...current, tagId]))
        : current.filter((id) => id !== tagId)
    );
  }

  function refresh() {
    setRefreshToken((value) => value + 1);
  }

  function currentAudioListParams(): AudioListParams {
    return buildAudioListParamsForState({
      view,
      debouncedQ,
      selectedTag,
      includedTagIds,
      excludedTagIds,
      tagMode,
      selectedLibraryRootId,
      hasTranscriptFilter,
      missingFilter,
      sortMode
    });
  }

  function currentPlaylistListParams(): PlaylistListParams {
    return buildPlaylistListParamsForState({
      debouncedQ,
      selectedTag,
      includedTagIds,
      excludedTagIds,
      tagMode,
      selectedLibraryRootId,
      hasTranscriptFilter,
      missingFilter,
      sortMode
    });
  }

  async function load() {
    const loadSeq = ++loadSeqRef.current;
    loadMoreSeqRef.current += 1;
    loadMoreInFlightRef.current = false;
    loadInFlightRef.current = true;
    setLoadingMore(false);
    const isListView = isAudioListView(view);

    if (isListView) {
      if (hasLoadedListRef.current) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
    } else {
      setLoading(false);
      setRefreshing(false);
    }

    setLoadError("");

    try {
      await ensureBackendReady();
      startupReadyRef.current = true;
      setStartupState("ready");
      setStartupError("");
      const navigation = navigationLoadedRef.current
        ? { tags, playlists, roots, savedViews }
        : await loadNavigation();
      navigationLoadedRef.current = true;

      if (loadSeq !== loadSeqRef.current) return;
      setPlaybackQueueValidationToken((value) => value + 1);

      if (!isListView) {
        hasLoadedListRef.current = false;
        setAudioItems([]);
        setPlaylistItemsRaw([]);
        setAudioTotal(0);
        setAudioHasMore(false);
        setSearchLimited(false);
        setSearchLimit(null);
        setFacets({ tags: [], roots: [] });
        return;
      }

      let items: AudioItem[] = [];
      let total = 0;
      let hasMore = false;
      let nextSearchLimited = false;
      let nextSearchLimit: number | null = null;
      let nextFacets = { tags: [], roots: [] } as typeof facets;
      let nextPlaylistItemsRaw: AudioItem[] = [];
      let nextSmartPlaylistRefreshedAt: string | null = null;

      if (view === "playlist") {
        if (!selectedPlaylistId) {
          setPlaylistItemsRaw([]);
          setAudioItems([]);
          setAudioTotal(0);
          setAudioHasMore(false);
          setSearchLimited(false);
          setSearchLimit(null);
          setFacets({ tags: [], roots: [] });
          setSelected(null);
          return;
        }

        const navigationPlaylist = navigation.playlists.find(
          (playlist) => playlist.id === selectedPlaylistId
        );
        const page = await api.listPlaylistItems(selectedPlaylistId, {
          ...currentPlaylistListParams(),
          limit: AUDIO_PAGE_LIMIT,
          offset: 0
        });

        if (navigationPlaylist?.kind === "smart") {
          nextSmartPlaylistRefreshedAt = page.refreshed_at ?? null;
        } else {
          const detail = await api.getPlaylist(selectedPlaylistId, {
            include_disabled_roots: true
          });
          nextPlaylistItemsRaw = detail.items.map((row) => ({
            ...row.audio,
            playlist_item_id: row.playlist_item.id,
            playlist_order_index: row.playlist_item.order_index
          }));
        }

        items = page.items;
        total = page.total;
        hasMore = page.has_more;
        nextSearchLimited = Boolean(page.search_limited);
        nextSearchLimit = page.search_limit ?? null;
        nextFacets = page.facets || nextFacets;
      } else {
        const page = await api.listAudioItems({
          ...currentAudioListParams(),
          limit: AUDIO_PAGE_LIMIT,
          offset: 0
        });

        items = page.items;
        total = page.total;
        hasMore = page.has_more;
        nextSearchLimited = Boolean(page.search_limited);
        nextSearchLimit = page.search_limit ?? null;
        nextFacets = page.facets || nextFacets;
      }

      if (loadSeq !== loadSeqRef.current) return;

      setPlaylistItemsRaw(nextPlaylistItemsRaw);
      setSmartPlaylistRefreshedAt(nextSmartPlaylistRefreshedAt);
      setAudioItems(items);
      setAudioTotal(total);
      setAudioHasMore(hasMore);
      setSearchLimited(nextSearchLimited);
      setSearchLimit(nextSearchLimit);
      setFacets(nextFacets);
      hasLoadedListRef.current = true;

      setSelected((prev) => {
        if (items.length === 0) return null;

        if (prev) {
          const found = items.find((item) => item.id === prev.id);
          if (found) return found;
        }

        return null;
      });
    } catch (err) {
      if (loadSeq !== loadSeqRef.current) return;

      const message = toErrorMessage(err);
      setLoadError(message);
      if (!startupReadyRef.current) {
        setStartupState("error");
        setStartupError(message);
      }
      throw err;
    } finally {
      if (loadSeq === loadSeqRef.current) {
        loadInFlightRef.current = false;
        setLoading(false);
        setRefreshing(false);
        setInitialized(true);
      }
    }
  }

  async function loadMoreAudioItems() {
    if (!isAudioListView(view) || loadMoreInFlightRef.current || !audioHasMore) {
      return;
    }

    if (view === "playlist" && !selectedPlaylistId) {
      return;
    }

    const loadSeq = loadSeqRef.current;
    const loadMoreSeq = ++loadMoreSeqRef.current;
    loadMoreInFlightRef.current = true;
    setLoadingMore(true);

    try {
      await ensureBackendReady();

      if (view === "playlist" && selectedPlaylistId) {
        const page = await api.listPlaylistItems(selectedPlaylistId, {
          ...currentPlaylistListParams(),
          limit: AUDIO_PAGE_LIMIT,
          offset: audioItems.length
        });

        if (
          loadSeq !== loadSeqRef.current ||
          loadMoreSeq !== loadMoreSeqRef.current
        ) return;

        setAudioItems((rows) => [...rows, ...page.items]);
        setAudioTotal(page.total);
        setAudioHasMore(page.has_more);
        setSearchLimited(Boolean(page.search_limited));
        setSearchLimit(page.search_limit ?? null);
        if (page.facets) setFacets(page.facets);
        if (page.playlist_kind === "smart") {
          setSmartPlaylistRefreshedAt(page.refreshed_at ?? null);
        }
      } else {
        const page = await api.listAudioItems({
          ...currentAudioListParams(),
          limit: AUDIO_PAGE_LIMIT,
          offset: audioItems.length
        });

        if (
          loadSeq !== loadSeqRef.current ||
          loadMoreSeq !== loadMoreSeqRef.current
        ) return;

        setAudioItems((rows) => [...rows, ...page.items]);
        setAudioTotal(page.total);
        setAudioHasMore(page.has_more);
        setSearchLimited(Boolean(page.search_limited));
        setSearchLimit(page.search_limit ?? null);
        if (page.facets) setFacets(page.facets);
      }
    } catch (err) {
      if (
        loadSeq !== loadSeqRef.current ||
        loadMoreSeq !== loadMoreSeqRef.current
      ) return;
      notify(toErrorMessage(err), "error");
    } finally {
      if (loadMoreSeq === loadMoreSeqRef.current) {
        loadMoreInFlightRef.current = false;
        setLoadingMore(false);
      }
    }
  }

  useEffect(() => {
    load().catch((err) => {
      console.error(err);
      notify(toErrorMessage(err), "error");
    });
  }, [
    view,
    debouncedQ,
    selectedTag,
    includedTagIds,
    excludedTagIds,
    tagMode,
    selectedLibraryRootId,
    selectedPlaylistId,
    hasTranscriptFilter,
    missingFilter,
    sortMode,
    refreshToken
  ]);

  useEffect(() => {
    if (view === "agent") return;
    selection.reset();
  }, [
    view,
    debouncedQ,
    selectedTag,
    includedTagIds,
    excludedTagIds,
    tagMode,
    selectedLibraryRootId,
    selectedPlaylistId,
    hasTranscriptFilter,
    missingFilter,
    sortMode
  ]);

  const hasBusyVisibleTask =
    audioItems.some(
      (item) => isBusyStatus(item.ai_status) || isBusyStatus(item.transcript_status)
    ) ||
    Boolean(
      selected &&
        (isBusyStatus(selected.ai_status) || isBusyStatus(selected.transcript_status))
    );

  usePolling({
    enabled: isAudioListView(view) && hasBusyVisibleTask,
    intervalMs: 3000,
    task: async () => {
      if (loadInFlightRef.current) return;
      await load();
    }
  });

  function clearFilters() {
    setQ("");
    setSelectedTag(undefined);
    setSelectedLibraryRootId(undefined);
    setHasTranscriptFilter("all");
    setMissingFilter("all");

    if (isSmartView(view)) {
      setView("library");
    }
  }

  function openSettings() {
    setView("settings");
    setSelectedTag(undefined);
    setSelectedLibraryRootId(undefined);
    setSelectedPlaylistId(null);
    setActiveSavedViewId(null);
  }

  function retryStartup() {
    resetBackendReady();
    navigationLoadedRef.current = false;
    startupReadyRef.current = false;
    setStartupState("starting");
    setStartupError("");
    setInitialized(false);
    refresh();
  }

  const playback = usePlaybackQueue({
    audioItems,
    setAudioItems,
    setPlaylistItemsRaw,
    setSelected,
    ensureBackendReady,
    validationToken: playbackQueueValidationToken,
    notify
  });

  const batchTasks = useBatchTasks({
    view,
    selectedPlaylistId,
    searchLimited,
    searchLimit,
    debouncedQ,
    ensureBackendReady,
    buildAudioListParams: currentAudioListParams,
    buildPlaylistListParams: currentPlaylistListParams,
    notify,
    refresh
  });

  const batchOrganization = useBatchOrganization({
    selectedAudioIds: Array.from(selection.selectedAudioIds),
    tags,
    playlists: manualPlaylists,
    clearSelection: selection.clear,
    loadNavigation: async () => {
      await loadNavigation();
    },
    refresh,
    notify
  });

  const playlistActions = usePlaylistActions({
    selectedPlaylistId,
    playlistItemsRaw,
    setPlaylistItemsRaw,
    setAudioItems,
    setAudioTotal,
    selected,
    setSelected,
    notify,
    refresh
  });

  function handleAudioDeleted(audioId: number) {
    playback.handleAudioDeleted(audioId);
    selection.remove(audioId);
    refresh();
  }

  const defaultListCopy = listCopyForView(
    view,
    playlists,
    selectedPlaylistId,
    t
  );

  const smartPlaylistSubtitle = isSmartPlaylist && activePlaylist
    ? t("smartPlaylists.subtitle", {
        count: audioTotal,
        rules: describeSmartPlaylistRules(activePlaylist, t),
        refreshed: smartPlaylistRefreshedAt || activePlaylist.last_refreshed_at
          ? formatDateTime(
              smartPlaylistRefreshedAt || activePlaylist.last_refreshed_at || undefined,
              i18n.resolvedLanguage || i18n.language
            )
          : t("smartPlaylists.neverRefreshed")
      })
    : null;
  const listTitle = activeSavedView?.name || defaultListCopy.listTitle;
  const listSubtitle = activeSavedView
    ? t("savedViews.appliedSubtitle")
    : smartPlaylistSubtitle || defaultListCopy.listSubtitle;

  function openPlaylist(playlist: Playlist) {
    setActiveSavedViewId(null);
    setView("playlist");
    setSelectedPlaylistId(playlist.id);
    setSelectedTag(undefined);
    setSmartPlaylistRefreshedAt(playlist.last_refreshed_at ?? null);

    if (playlist.kind !== "smart" || !playlist.query) return;
    const invalidReferences = playlist.invalid_references || [];
    setQ(playlist.query.q);
    setSelectedTag(
      invalidReferences.includes("tag") ? undefined : playlist.tag_name || undefined
    );
    setIncludedTagIds(
      invalidReferences.includes("tag") ? [] : playlist.query.tag_ids || []
    );
    setExcludedTagIds(
      invalidReferences.includes("tag") ? [] : playlist.query.excluded_tag_ids || []
    );
    setTagMode(playlist.query.tag_mode || "and");
    setSelectedLibraryRootId(
      invalidReferences.includes("library_root")
        ? undefined
        : playlist.query.library_root_id ?? undefined
    );
    setHasTranscriptFilter(playlist.query.transcript_filter);
    setMissingFilter(playlist.query.missing_filter);
    setSortMode(playlist.query.sort);
  }

  async function createPlaylist(name: string) {
    try {
      await api.createPlaylist(name);
      await loadNavigation();
      notify(t("settings.playlist.created"), "success");
      return true;
    } catch (err) {
      notify(toErrorMessage(err), "error");
      return false;
    }
  }

  async function createSmartPlaylist(savedView: SavedView) {
    if (!savedView.query) {
      notify(t("savedViews.definitionInvalid"), "error");
      return;
    }
    const name = await dialog.prompt({
      title: t("smartPlaylists.createTitle"),
      message: t("smartPlaylists.createMessage", { name: savedView.name }),
      inputLabel: t("smartPlaylists.name"),
      defaultValue: savedView.name,
      required: true,
      confirmLabel: t("smartPlaylists.createConfirm"),
      cancelLabel: t("common.actions.cancel"),
      validate: (value) => (value.trim() ? null : t("savedViews.nameRequired"))
    });
    if (name === null) return;
    try {
      const created = await api.createSmartPlaylist(savedView.id, name.trim());
      await loadNavigation();
      openPlaylist(created);
      notify(t("smartPlaylists.created"), "success");
    } catch (err) {
      notify(toErrorMessage(err), "error");
    }
  }

  const hasActiveFilter =
    Boolean(q.trim()) ||
    Boolean(selectedTag) ||
    includedTagIds.length > 0 ||
    excludedTagIds.length > 0 ||
    Boolean(selectedLibraryRootId) ||
    hasTranscriptFilter !== "all" ||
    missingFilter !== "all" ||
    isSmartView(view);

  return {
    view,
    setView,

    audioItems,
    audioTotal,
    audioHasMore,
    searchLimited,
    searchLimit,
    facets,
    selected,
    setSelected,
    selectionMode: selection.selectionMode,
    selectedAudioIds: selection.selectedAudioIds,

    playing: playback.playing,
    playbackQueue: playback.playbackQueue,
    playingIndex: playback.playingIndex,
    playRequestId: playback.playRequestId,

    q,
    setQ,
    selectedTag,
    setSelectedTag,
    includedTagIds,
    excludedTagIds,
    tagMode,
    setTagMode,
    setTagFilterState,
    selectedLibraryRootId,
    setSelectedLibraryRootId,
    selectedPlaylistId,
    setSelectedPlaylistId,

    hasTranscriptFilter,
    setHasTranscriptFilter,
    missingFilter,
    setMissingFilter,
    sortMode,
    setSortMode,

    tags,
    playlists,
    manualPlaylists,
    roots,
    savedViews,
    activeSavedViewId,
    savedViewDirty: savedViewController.isDirty,
    canSaveView: savedViewController.canSave,
    isSmartPlaylist,

    loading,
    refreshing,
    loadingMore,
    loadError,
    initialized,
    navigationReady,
    startupState,
    startupError,

    listTitle,
    listSubtitle,
    hasActiveFilter,

    toasts,
    notify,
    closeToast,

    refresh,
    retryStartup,
    clearFilters,
    openSettings,
    deactivateSavedView: savedViewController.deactivate,
    applySavedView: savedViewController.apply,
    openPlaylist,
    createPlaylist,
    createSmartPlaylist,
    saveCurrentView: savedViewController.saveCurrent,
    updateActiveSavedView: savedViewController.updateActive,
    renameSavedView: savedViewController.rename,
    copySavedView: savedViewController.copy,
    deleteSavedView: savedViewController.remove,
    moveSavedView: savedViewController.move,
    loadMoreAudioItems,
    enterSelectionMode: selection.enter,
    exitSelectionMode: selection.exit,
    toggleAudioSelection: selection.toggle,
    toggleSelectAllLoaded: selection.toggleAllLoaded,
    clearAudioSelection: selection.clear,

    playAudio: playback.playAudio,
    playAudioAt: playback.playAudioAt,
    addToQueue: playback.addToQueue,
    playNextAudio: playback.playNextAudio,
    playPrevious: playback.playPrevious,
    playNext: playback.playNext,
    removeQueueItem: playback.removeQueueItem,
    moveQueueItem: playback.moveQueueItem,
    clearQueue: playback.clearQueue,
    handlePlaybackPositionSaved: playback.handlePlaybackPositionSaved,

    batchTranscribeCurrentList: batchTasks.batchTranscribeCurrentList,
    batchAnalyzeCurrentList: batchTasks.batchAnalyzeCurrentList,
    batchAddTags: batchOrganization.addTags,
    batchRemoveTag: batchOrganization.removeTag,
    batchAddToPlaylist: batchOrganization.addToPlaylist,
    batchSetFavorite: batchOrganization.setFavorite,

    removeFromCurrentPlaylist: playlistActions.removeFromCurrentPlaylist,
    movePlaylistItem: playlistActions.movePlaylistItem,
    movePlaylistItemTo: playlistActions.movePlaylistItemTo,
    handleAudioDeleted
  };
}
