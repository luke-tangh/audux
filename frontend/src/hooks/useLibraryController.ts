import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { AudioItem, Playlist, SavedView, SavedViewQuery } from "../types";
import { useDialog } from "../components/dialog/UnifiedDialog";
import { useBackendReady } from "./useBackendReady";
import { useToast } from "./useToast";
import {
  buildAudioListParams as buildAudioListParamsForState,
  buildPlaylistListParams as buildPlaylistListParamsForState,
  buildSavedViewQuery,
  describeSmartPlaylistRules,
  isBusyStatus,
  isSmartView,
  listCopyForView,
  savedViewQueriesEqual
} from "./library/filters";
import { useBatchTasks } from "./library/useBatchTasks";
import { useBatchOrganization } from "./library/useBatchOrganization";
import { useDebouncedValue } from "./library/useDebouncedValue";
import { useNavigationData } from "./library/useNavigationData";
import { usePlaybackQueue } from "./library/usePlaybackQueue";
import { usePlaylistActions } from "./library/usePlaylistActions";
import { useTranslation } from "react-i18next";
import { formatDateTime } from "../i18n/format";
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
const MAX_BATCH_SELECTION = 500;

function isSavableView(view: ViewMode): view is SavedViewQuery["view"] {
  return view !== "playlist" && view !== "settings";
}

export function useLibraryController() {
  const { t, i18n } = useTranslation();
  const [view, setView] = useState<ViewMode>("library");
  const [audioItems, setAudioItems] = useState<AudioItem[]>([]);
  const [audioTotal, setAudioTotal] = useState(0);
  const [audioHasMore, setAudioHasMore] = useState(false);
  const [searchLimited, setSearchLimited] = useState(false);
  const [searchLimit, setSearchLimit] = useState<number | null>(null);
  const [selected, setSelected] = useState<AudioItem | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedAudioIds, setSelectedAudioIds] = useState<Set<number>>(
    () => new Set()
  );

  const [q, setQ] = useState("");
  const debouncedQ = useDebouncedValue(q, 240);
  const [selectedTag, setSelectedTag] = useState<string | undefined>();
  const [selectedLibraryRootId, setSelectedLibraryRootId] = useState<number | undefined>();
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<number | null>(null);
  const [activeSavedViewId, setActiveSavedViewId] = useState<number | null>(null);

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

  const loadSeqRef = useRef(0);
  const hasLoadedListRef = useRef(false);

  const { ensureBackendReady } = useBackendReady();
  const dialog = useDialog();
  const { toasts, notify, closeToast } = useToast();
  const { tags, playlists, roots, savedViews, loadNavigation } = useNavigationData();
  const activePlaylist = playlists.find((playlist) => playlist.id === selectedPlaylistId);
  const isSmartPlaylist = activePlaylist?.kind === "smart";
  const manualPlaylists = playlists.filter((playlist) => playlist.kind !== "smart");

  function refresh() {
    setRefreshToken((value) => value + 1);
  }

  function currentAudioListParams(): AudioListParams {
    return buildAudioListParamsForState({
      view,
      debouncedQ,
      selectedTag,
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
      selectedLibraryRootId,
      hasTranscriptFilter,
      missingFilter,
      sortMode
    });
  }

  async function load() {
    const loadSeq = ++loadSeqRef.current;
    const isListView = view !== "settings";

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
      const navigation = await loadNavigation();

      if (loadSeq !== loadSeqRef.current) return;
      setPlaybackQueueValidationToken((value) => value + 1);

      if (view === "settings") {
        hasLoadedListRef.current = false;
        setAudioItems([]);
        setPlaylistItemsRaw([]);
        setAudioTotal(0);
        setAudioHasMore(false);
        setSearchLimited(false);
        setSearchLimit(null);
        return;
      }

      let items: AudioItem[] = [];
      let total = 0;
      let hasMore = false;
      let nextSearchLimited = false;
      let nextSearchLimit: number | null = null;

      if (view === "playlist") {
        if (!selectedPlaylistId) {
          setPlaylistItemsRaw([]);
          setAudioItems([]);
          setAudioTotal(0);
          setAudioHasMore(false);
          setSearchLimited(false);
          setSearchLimit(null);
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
          setPlaylistItemsRaw([]);
          setSmartPlaylistRefreshedAt(page.refreshed_at ?? null);
        } else {
          const detail = await api.getPlaylist(selectedPlaylistId, {
            include_disabled_roots: true
          });
          const rawItems: AudioItem[] = detail.items.map((row) => ({
            ...row.audio,
            playlist_item_id: row.playlist_item.id,
            playlist_order_index: row.playlist_item.order_index
          }));
          setPlaylistItemsRaw(rawItems);
          setSmartPlaylistRefreshedAt(null);
        }

        items = page.items;
        total = page.total;
        hasMore = page.has_more;
        nextSearchLimited = Boolean(page.search_limited);
        nextSearchLimit = page.search_limit ?? null;
      } else {
        setPlaylistItemsRaw([]);
        setSmartPlaylistRefreshedAt(null);

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
      }

      if (loadSeq !== loadSeqRef.current) return;

      setAudioItems(items);
      setAudioTotal(total);
      setAudioHasMore(hasMore);
      setSearchLimited(nextSearchLimited);
      setSearchLimit(nextSearchLimit);
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

      const message = err instanceof Error ? err.message : String(err);
      setLoadError(message);
      throw err;
    } finally {
      if (loadSeq === loadSeqRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }

  async function loadMoreAudioItems() {
    if (view === "settings" || loadingMore || !audioHasMore) {
      return;
    }

    if (view === "playlist" && !selectedPlaylistId) {
      return;
    }

    setLoadingMore(true);

    try {
      await ensureBackendReady();

      if (view === "playlist" && selectedPlaylistId) {
        const page = await api.listPlaylistItems(selectedPlaylistId, {
          ...currentPlaylistListParams(),
          limit: AUDIO_PAGE_LIMIT,
          offset: audioItems.length
        });

        setAudioItems((rows) => [...rows, ...page.items]);
        setAudioTotal(page.total);
        setAudioHasMore(page.has_more);
        setSearchLimited(Boolean(page.search_limited));
        setSearchLimit(page.search_limit ?? null);
        if (page.playlist_kind === "smart") {
          setSmartPlaylistRefreshedAt(page.refreshed_at ?? null);
        }
      } else {
        const page = await api.listAudioItems({
          ...currentAudioListParams(),
          limit: AUDIO_PAGE_LIMIT,
          offset: audioItems.length
        });

        setAudioItems((rows) => [...rows, ...page.items]);
        setAudioTotal(page.total);
        setAudioHasMore(page.has_more);
        setSearchLimited(Boolean(page.search_limited));
        setSearchLimit(page.search_limit ?? null);
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setLoadingMore(false);
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
    selectedLibraryRootId,
    selectedPlaylistId,
    hasTranscriptFilter,
    missingFilter,
    sortMode,
    refreshToken
  ]);

  useEffect(() => {
    setSelectionMode(false);
    setSelectedAudioIds(new Set());
  }, [
    view,
    debouncedQ,
    selectedTag,
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

  useEffect(() => {
    if (view === "settings") return;
    if (!hasBusyVisibleTask) return;

    const timer = window.setInterval(() => {
      refresh();
    }, 3000);

    return () => window.clearInterval(timer);
  }, [
    view,
    hasBusyVisibleTask,
    selected?.id,
    selected?.ai_status,
    selected?.transcript_status,
    audioItems.length
  ]);

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

  function clearAudioSelection() {
    setSelectedAudioIds(new Set());
  }

  function enterSelectionMode() {
    setSelectionMode(true);
  }

  function exitSelectionMode() {
    setSelectionMode(false);
    clearAudioSelection();
  }

  function toggleAudioSelection(audioId: number) {
    if (
      !selectedAudioIds.has(audioId) &&
      selectedAudioIds.size >= MAX_BATCH_SELECTION
    ) {
      notify(t("library.selection.maximum", { count: MAX_BATCH_SELECTION }), "info");
      return;
    }

    setSelectedAudioIds((current) => {
      const next = new Set(current);
      if (next.has(audioId)) {
        next.delete(audioId);
      } else {
        next.add(audioId);
      }
      return next;
    });
  }

  function toggleSelectAllLoaded() {
    const selectableItems = audioItems.slice(0, MAX_BATCH_SELECTION);
    const allSelectableSelected =
      selectableItems.length > 0 &&
      selectableItems.every((item) => selectedAudioIds.has(item.id));

    if (!allSelectableSelected && audioItems.length > MAX_BATCH_SELECTION) {
      notify(t("library.selection.firstSelected", { count: MAX_BATCH_SELECTION }), "info");
    }

    setSelectedAudioIds((current) => {
      const allLoadedSelected =
        selectableItems.length > 0 &&
        selectableItems.every((item) => current.has(item.id));
      if (allLoadedSelected) {
        return new Set();
      }
      return new Set(
        selectableItems.map((item) => item.id)
      );
    });
  }

  const batchOrganization = useBatchOrganization({
    selectedAudioIds: Array.from(selectedAudioIds),
    tags,
    playlists: manualPlaylists,
    clearSelection: clearAudioSelection,
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
    setSelectedAudioIds((current) => {
      if (!current.has(audioId)) return current;
      const next = new Set(current);
      next.delete(audioId);
      return next;
    });
    refresh();
  }

  const defaultListCopy = listCopyForView(
    view,
    playlists,
    selectedPlaylistId,
    t
  );

  const activeSavedView = savedViews.find((row) => row.id === activeSavedViewId);

  function currentSavedViewQuery(): SavedViewQuery | null {
    if (!isSavableView(view)) return null;
    const tagId = tags.find((tag) => tag.name === selectedTag)?.id;
    return buildSavedViewQuery({
      view,
      q,
      tagId,
      libraryRootId: selectedLibraryRootId,
      transcriptFilter: hasTranscriptFilter,
      missingFilter,
      sort: sortMode
    });
  }

  const currentViewQuery = currentSavedViewQuery();
  const savedViewDirty = Boolean(
    activeSavedView?.query &&
      currentViewQuery &&
      !savedViewQueriesEqual(activeSavedView.query, currentViewQuery)
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

  function deactivateSavedView() {
    setActiveSavedViewId(null);
  }

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
    setSelectedLibraryRootId(
      invalidReferences.includes("library_root")
        ? undefined
        : playlist.query.library_root_id ?? undefined
    );
    setHasTranscriptFilter(playlist.query.transcript_filter);
    setMissingFilter(playlist.query.missing_filter);
    setSortMode(playlist.query.sort);
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
      notify(err instanceof Error ? err.message : String(err), "error");
    }
  }

  function applySavedView(savedView: SavedView) {
    if (!savedView.query) {
      setActiveSavedViewId(savedView.id);
      notify(t("savedViews.definitionInvalid"), "error");
      return;
    }

    const invalidTag = savedView.invalid_references.includes("tag");
    const invalidRoot = savedView.invalid_references.includes("library_root");
    setView(savedView.query.view);
    setQ(savedView.query.q);
    setSelectedTag(invalidTag ? undefined : savedView.tag_name || undefined);
    setSelectedLibraryRootId(
      invalidRoot ? undefined : savedView.query.library_root_id ?? undefined
    );
    setHasTranscriptFilter(savedView.query.transcript_filter);
    setMissingFilter(savedView.query.missing_filter);
    setSortMode(savedView.query.sort);
    setSelectedPlaylistId(null);
    setActiveSavedViewId(savedView.id);

    if (savedView.invalid_references.length > 0) {
      const conditions = savedView.invalid_references
        .map((reference) =>
          reference === "tag"
            ? t("savedViews.tagCondition")
            : t("savedViews.libraryRootCondition")
        )
        .join(t("savedViews.conditionSeparator"));
      notify(t("savedViews.invalidReferences", { conditions }), "info");
    }
  }

  async function saveCurrentView() {
    const query = currentSavedViewQuery();
    if (!query) {
      notify(t("savedViews.unsupportedView"), "info");
      return;
    }
    const name = await dialog.prompt({
      title: t("savedViews.createTitle"),
      message: t("savedViews.createMessage"),
      inputLabel: t("savedViews.name"),
      required: true,
      confirmLabel: t("savedViews.createConfirm"),
      cancelLabel: t("common.actions.cancel"),
      validate: (value) => (value.trim() ? null : t("savedViews.nameRequired"))
    });
    if (name === null) return;
    try {
      const created = await api.createSavedView(name.trim(), query);
      setActiveSavedViewId(created.id);
      await loadNavigation();
      notify(t("savedViews.created"), "success");
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function updateActiveSavedView() {
    const query = currentSavedViewQuery();
    if (!activeSavedView || !query) return;
    try {
      await api.updateSavedView(activeSavedView.id, { query });
      await loadNavigation();
      notify(t("savedViews.updated"), "success");
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function renameSavedView(savedView: SavedView) {
    const name = await dialog.prompt({
      title: t("savedViews.renameTitle"),
      message: t("savedViews.renameMessage", { name: savedView.name }),
      inputLabel: t("savedViews.name"),
      defaultValue: savedView.name,
      required: true,
      confirmLabel: t("common.actions.save"),
      cancelLabel: t("common.actions.cancel"),
      validate: (value) => {
        if (!value.trim()) return t("savedViews.nameRequired");
        if (value.trim() === savedView.name) return t("savedViews.nameDifferent");
        return null;
      }
    });
    if (name === null) return;
    try {
      await api.updateSavedView(savedView.id, { name: name.trim() });
      await loadNavigation();
      notify(t("savedViews.renamed"), "success");
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function copySavedView(savedView: SavedView) {
    const name = await dialog.prompt({
      title: t("savedViews.copyTitle"),
      message: t("savedViews.copyMessage", { name: savedView.name }),
      inputLabel: t("savedViews.name"),
      defaultValue: t("savedViews.copyDefaultName", { name: savedView.name }),
      required: true,
      confirmLabel: t("savedViews.copyConfirm"),
      cancelLabel: t("common.actions.cancel"),
      validate: (value) => (value.trim() ? null : t("savedViews.nameRequired"))
    });
    if (name === null) return;
    try {
      const copied = await api.copySavedView(savedView.id, name.trim());
      await loadNavigation();
      setActiveSavedViewId(copied.id);
      if (copied.query) applySavedView(copied);
      notify(t("savedViews.copied"), "success");
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function deleteSavedView(savedView: SavedView) {
    const ok = await dialog.confirm({
      title: t("savedViews.deleteTitle"),
      message: t("savedViews.deleteMessage", { name: savedView.name }),
      confirmLabel: t("common.actions.delete"),
      cancelLabel: t("common.actions.cancel"),
      tone: "danger",
      destructive: true
    });
    if (!ok) return;
    try {
      await api.deleteSavedView(savedView.id);
      if (activeSavedViewId === savedView.id) setActiveSavedViewId(null);
      await loadNavigation();
      notify(t("savedViews.deleted"), "success");
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function moveSavedView(savedViewId: number, direction: -1 | 1) {
    const currentIndex = savedViews.findIndex((row) => row.id === savedViewId);
    const targetIndex = currentIndex + direction;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= savedViews.length) return;
    const reordered = [...savedViews];
    [reordered[currentIndex], reordered[targetIndex]] = [
      reordered[targetIndex],
      reordered[currentIndex]
    ];
    try {
      await api.reorderSavedViews(reordered.map((row) => row.id));
      await loadNavigation();
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    }
  }

  const hasActiveFilter =
    Boolean(q.trim()) ||
    Boolean(selectedTag) ||
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
    selected,
    setSelected,
    selectionMode,
    selectedAudioIds,

    playing: playback.playing,
    playbackQueue: playback.playbackQueue,
    playingIndex: playback.playingIndex,
    playRequestId: playback.playRequestId,

    q,
    setQ,
    selectedTag,
    setSelectedTag,
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
    savedViewDirty,
    canSaveView: isSavableView(view),
    isSmartPlaylist,

    loading,
    refreshing,
    loadingMore,
    loadError,

    listTitle,
    listSubtitle,
    hasActiveFilter,

    toasts,
    notify,
    closeToast,

    refresh,
    clearFilters,
    openSettings,
    deactivateSavedView,
    applySavedView,
    openPlaylist,
    createSmartPlaylist,
    saveCurrentView,
    updateActiveSavedView,
    renameSavedView,
    copySavedView,
    deleteSavedView,
    moveSavedView,
    loadMoreAudioItems,
    enterSelectionMode,
    exitSelectionMode,
    toggleAudioSelection,
    toggleSelectAllLoaded,
    clearAudioSelection,

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
